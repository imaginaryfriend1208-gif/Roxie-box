import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { config } from './lib/config.js';
import { users, sessions, files } from './lib/db.js';
import {
  hashPassword, verifyPassword, verifyDummy, validateCredentials,
  startSession, endSession, currentUser, rateLimit, sanitizePrefs,
} from './lib/auth.js';
import { detect, sanitizeName, randomId, diskPath, toClient, ID_RE } from './lib/files.js';
import { HttpError, sendJson, readJson, clientIp, serveFile } from './lib/http.js';
import {
  inspectCardFile, summarize, describeCard, findEmbed, readableCard, avatarEmbed, stripPngText, parseCard, CARD_EXT, MAX_CARD_BYTES,
} from './lib/card.js';

fs.mkdirSync(config.paths.storage, { recursive: true });
fs.rmSync(config.paths.tmp, { recursive: true, force: true });
fs.mkdirSync(config.paths.tmp, { recursive: true });

sessions.purgeExpired();
setInterval(() => sessions.purgeExpired(), 6 * 3600 * 1000).unref();

// ---------------------------------------------------------------------------
// Character card
// ---------------------------------------------------------------------------

/** Đọc file vừa upload: nếu là character card thì chuyển sang thư mục 'card' và lưu tóm tắt. */
async function classifyCard(row) {
  const card = await inspectCardFile(diskPath(row.id), row.ext, row.size);
  if (!card) return { card: CARD_EXT.has(row.ext) ? '' : null, category: row.category };
  return { card: JSON.stringify(summarize(card)), category: 'card' };
}

// File png/json upload trước khi có tab Card: kiểm tra 1 lần lúc khởi động
async function backfillCards() {
  for (const row of files.uncheckedCards()) {
    const { card, category } = await classifyCard(row);
    files.setCard(row.id, card ?? '', category);
  }
}

// Giữ vài card vừa đọc trong RAM để mở chi tiết / tải nhiều mục liên tiếp không phải parse lại
const cardCache = new Map();
async function loadCard(row) {
  const key = `${row.id}:${row.size}`;
  if (cardCache.has(key)) return cardCache.get(key);
  if (row.size > MAX_CARD_BYTES) return null;
  let card = null;
  try {
    card = parseCard(await fsp.readFile(diskPath(row.id)));
  } catch { /* file mất trên ổ đĩa */ }
  cardCache.set(key, card);
  while (cardCache.size > 8) cardCache.delete(cardCache.keys().next().value);
  return card;
}

// ---------------------------------------------------------------------------
// Header bảo mật
// ---------------------------------------------------------------------------

const APP_CSP = [
  "default-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "media-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

// File người dùng upload: chặn mọi script (vd SVG có <script>) dù phục vụ cùng domain.
const FILE_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; media-src 'self'; font-src 'self' data:; sandbox";

const STATIC_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function requireUser(req) {
  const user = currentUser(req);
  if (!user) throw new HttpError(401, 'Bạn cần đăng nhập');
  return user;
}

// Chặn request thay đổi dữ liệu đến từ trang web khác (CSRF).
function assertSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return;
  let host;
  try {
    host = new URL(origin).host;
  } catch {
    throw new HttpError(403, 'Origin không hợp lệ');
  }
  if (host !== req.headers.host) throw new HttpError(403, 'Không cho phép request từ trang khác');
}

const publicUser = (u) => ({ id: u.id, username: u.username, createdAt: u.created_at, prefs: users.getPrefs(u.id) });

async function handleRegister(req, res) {
  if (!config.allowRegister) throw new HttpError(403, 'Đăng ký tài khoản đang tạm đóng');
  rateLimit(`register:${clientIp(req)}`, 10, 60 * 60 * 1000);
  const { username, password } = await readJson(req);
  const errors = validateCredentials(username, password);
  if (errors) return sendJson(res, 400, { error: 'Thông tin chưa hợp lệ', fields: errors });
  if (users.findByName(username)) {
    return sendJson(res, 409, { error: 'Username đã tồn tại', fields: { username: 'Username này đã có người dùng' } });
  }
  const userId = users.create(username, await hashPassword(password));
  startSession(res, userId);
  sendJson(res, 201, { user: publicUser(users.findById(userId)) });
}

async function handleLogin(req, res) {
  const { username, password } = await readJson(req);
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    throw new HttpError(400, 'Vui lòng nhập username và mật khẩu');
  }
  rateLimit(`login:${clientIp(req)}`, 20, 15 * 60 * 1000);
  const user = users.findByName(username);
  const ok = user ? await verifyPassword(password, user.pass_hash) : await verifyDummy(password);
  if (!user || !ok) throw new HttpError(401, 'Sai username hoặc mật khẩu');
  startSession(res, user.id);
  sendJson(res, 200, { user: publicUser(user) });
}

async function handleUpload(req, res, user) {
  const rawName = req.headers['x-file-name'];
  if (!rawName) throw new HttpError(400, 'Thiếu tên file (header X-File-Name)');
  let name;
  try {
    name = sanitizeName(decodeURIComponent(String(rawName)));
  } catch {
    throw new HttpError(400, 'Tên file không hợp lệ');
  }
  if (!name) throw new HttpError(400, 'Tên file không hợp lệ');

  const declared = Number(req.headers['content-length']);
  if (declared > config.maxUploadBytes) {
    res.setHeader('Connection', 'close');
    throw new HttpError(413, `File vượt quá giới hạn ${Math.round(config.maxUploadBytes / 1048576)} MB`);
  }

  const tmpPath = path.join(config.paths.tmp, `${Date.now()}-${randomId(10)}`);
  let size = 0;
  const limiter = new Transform({
    transform(chunk, _enc, cb) {
      size += chunk.length;
      if (size > config.maxUploadBytes) {
        cb(new HttpError(413, `File vượt quá giới hạn ${Math.round(config.maxUploadBytes / 1048576)} MB`));
      } else cb(null, chunk);
    },
  });

  try {
    await pipeline(req, limiter, fs.createWriteStream(tmpPath));
  } catch (err) {
    await fsp.rm(tmpPath, { force: true });
    if (err instanceof HttpError) {
      res.setHeader('Connection', 'close');
      throw err;
    }
    throw new HttpError(400, 'Upload bị gián đoạn');
  }

  if (size === 0) {
    await fsp.rm(tmpPath, { force: true });
    throw new HttpError(400, 'File rỗng (0 byte)');
  }

  let id;
  do id = randomId(); while (files.exists(id) || fs.existsSync(diskPath(id)));

  await fsp.rename(tmpPath, diskPath(id));
  const detected = detect(name);
  const { ext, mime } = detected;
  const { card, category } = await classifyCard({ id, ext, size, category: detected.category });
  files.create({ id, userId: user.id, name, ext, mime, size, category, card, createdAt: Date.now() });
  sendJson(res, 201, { file: toClient(files.findById(id)) });
}

async function handleRename(req, res, user, id) {
  const { name } = await readJson(req);
  const clean = sanitizeName(name ?? '');
  if (!clean) throw new HttpError(400, 'Tên không được để trống');
  if (!files.rename(id, user.id, clean)) throw new HttpError(404, 'Không tìm thấy file');
  sendJson(res, 200, { file: toClient(files.findById(id)) });
}

async function userCard(user, id) {
  const row = files.findById(id);
  if (!row || row.user_id !== user.id) throw new HttpError(404, 'Không tìm thấy file');
  if (row.category !== 'card') throw new HttpError(400, 'File này không phải character card');
  const card = await loadCard(row);
  if (!card) throw new HttpError(422, 'Không đọc được dữ liệu card');
  return { row, card };
}

async function handleCardInfo(_req, res, user, id) {
  const { row, card } = await userCard(user, id);
  sendJson(res, 200, describeCard(card, { png: row.ext === 'png' }));
}

async function handleCardRead(_req, res, user, id) {
  const { card } = await userCard(user, id);
  sendJson(res, 200, readableCard(card));
}

async function handleCardEmbed(req, res, user, id, key, url) {
  const { row, card } = await userCard(user, id);
  let item;
  let body;
  if (key === 'avatar' && row.ext === 'png') {
    item = avatarEmbed(card);
    body = stripPngText(await fsp.readFile(diskPath(row.id)));
  } else {
    item = findEmbed(card, key);
    if (!item) throw new HttpError(404, 'Không tìm thấy nội dung nhúng này');
    body = item.build();
  }
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
  const disposition = url.searchParams.has('inline') && item.group === 'image' ? 'inline' : 'attachment';
  res.writeHead(200, {
    'Content-Type': item.mime === 'application/json' ? 'application/json; charset=utf-8' : item.mime,
    'Content-Length': buf.length,
    'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(item.filename)}`,
    'Content-Security-Policy': FILE_CSP,
    'Cache-Control': 'private, no-cache',
  });
  res.end(req.method === 'HEAD' ? undefined : buf);
}

async function handleDelete(_req, res, user, id) {
  if (!files.remove(id, user.id)) throw new HttpError(404, 'Không tìm thấy file');
  for (const key of cardCache.keys()) if (key.startsWith(`${id}:`)) cardCache.delete(key);
  await fsp.rm(diskPath(id), { force: true });
  sendJson(res, 200, { ok: true });
}

async function handleApi(req, res, pathname, url) {
  const { method } = req;
  if (method !== 'GET' && method !== 'HEAD') assertSameOrigin(req);

  if (pathname === '/api/config' && method === 'GET') {
    return sendJson(res, 200, {
      siteName: config.siteName,
      publicUrl: config.publicUrl,
      allowRegister: config.allowRegister,
      minCredentialLength: config.minCredentialLength,
      maxUploadBytes: config.maxUploadBytes,
    });
  }
  if (pathname === '/api/register' && method === 'POST') return handleRegister(req, res);
  if (pathname === '/api/login' && method === 'POST') return handleLogin(req, res);
  if (pathname === '/api/logout' && method === 'POST') {
    endSession(req, res);
    return sendJson(res, 200, { ok: true });
  }
  if (pathname === '/api/me' && method === 'GET') {
    return sendJson(res, 200, { user: publicUser(requireUser(req)) });
  }
  if (pathname === '/api/prefs' && method === 'PATCH') {
    const user = requireUser(req);
    const prefs = { ...users.getPrefs(user.id), ...sanitizePrefs(await readJson(req)) };
    users.setPrefs(user.id, prefs);
    return sendJson(res, 200, { prefs });
  }
  if (pathname === '/api/files' && method === 'GET') {
    const user = requireUser(req);
    return sendJson(res, 200, { files: files.listByUser(user.id).map(toClient) });
  }
  if (pathname === '/api/upload' && method === 'POST') return handleUpload(req, res, requireUser(req));

  const cm = /^\/api\/files\/([a-z0-9]{6})\/card(?:\/([a-z0-9-]{1,40}))?$/.exec(pathname);
  if (cm && (method === 'GET' || method === 'HEAD')) {
    const user = requireUser(req);
    return cm[2] ? handleCardEmbed(req, res, user, cm[1], cm[2], url) : handleCardInfo(req, res, user, cm[1]);
  }

  const rm = /^\/api\/files\/([a-z0-9]{6})\/read$/.exec(pathname);
  if (rm && method === 'GET') return handleCardRead(req, res, requireUser(req), rm[1]);

  const m = /^\/api\/files\/([a-z0-9]{6})$/.exec(pathname);
  if (m) {
    const user = requireUser(req);
    if (method === 'PATCH') return handleRename(req, res, user, m[1]);
    if (method === 'DELETE') return handleDelete(req, res, user, m[1]);
  }
  throw new HttpError(404, 'API không tồn tại');
}

async function handlePublicFile(req, res, pathname, url) {
  const m = /^\/f\/([a-z0-9]{6})(?:\.[a-z0-9]{1,10})?$/.exec(pathname);
  const row = m && ID_RE.test(m[1]) ? files.findById(m[1]) : null;
  if (!row) throw new HttpError(404, 'File không tồn tại hoặc đã bị xoá');

  const disposition = url.searchParams.has('download') ? 'attachment' : 'inline';
  const headers = {
    'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(row.name)}`,
    'Cache-Control': 'public, max-age=31536000, immutable',
    // Cho phép web khác (vd SillyTavern theme) nhúng ảnh/font trực tiếp.
    'Access-Control-Allow-Origin': '*',
    'Cross-Origin-Resource-Policy': 'cross-origin',
  };
  // Trình xem PDF của Chrome không chạy được khi có CSP sandbox.
  if (row.mime !== 'application/pdf') headers['Content-Security-Policy'] = FILE_CSP;

  const served = await serveFile(req, res, diskPath(row.id), { mime: row.mime, headers });
  if (!served) throw new HttpError(404, 'File không tồn tại trên ổ đĩa');
}

/** index.html với link CSS/JS kèm ?v=<mtime> -> trình duyệt luôn tải bản mới sau mỗi lần cập nhật. */
async function sendIndex(res) {
  const html = await fsp.readFile(path.join(config.paths.public, 'index.html'), 'utf8');
  const parts = await Promise.all(html.split(/((?:href|src)="\/(?:css|js)\/[\w.-]+\.(?:css|js))"/).map(async (part, i) => {
    if (i % 2 === 0) return part;
    const [, attr, rel] = part.match(/^(\w+)="\/(.+)$/);
    const stat = await fsp.stat(path.join(config.paths.public, rel)).catch(() => null);
    return `${attr}="/${rel}${stat ? `?v=${Math.floor(stat.mtimeMs).toString(36)}` : ''}"`;
  }));
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Content-Security-Policy': APP_CSP,
    'X-Frame-Options': 'DENY',
  });
  res.end(parts.join(''));
  return true;
}

async function handleStatic(req, res, pathname) {
  if (pathname === '/' || pathname === '/index.html') return sendIndex(res);
  const rel = pathname.slice(1);
  const abs = path.resolve(config.paths.public, rel);
  if (!abs.startsWith(config.paths.public + path.sep)) return false;
  const mime = STATIC_MIME[path.extname(abs)] || 'application/octet-stream';
  const isHtml = mime.startsWith('text/html');
  return serveFile(req, res, abs, {
    mime,
    headers: {
      // no-cache: vẫn dùng cache nhưng hỏi lại server (ETag) mỗi lần -> cập nhật code là thấy ngay
      'Cache-Control': 'no-cache',
      ...(isHtml && { 'Content-Security-Policy': APP_CSP, 'X-Frame-Options': 'DENY' }),
    },
  });
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');

  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    res.writeHead(400).end();
    return;
  }
  const { pathname } = url;

  try {
    if (pathname.startsWith('/api/')) return await handleApi(req, res, pathname, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method không được hỗ trợ');
    if (pathname.startsWith('/f/')) return await handlePublicFile(req, res, pathname, url);
    if (await handleStatic(req, res, pathname)) return;
    throw new HttpError(404, 'Không tìm thấy trang');
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error(err);
    if (res.headersSent) return res.destroy();
    sendJson(res, status, { error: status === 500 ? 'Lỗi máy chủ' : err.message });
  }
});

server.requestTimeout = 0; // upload file lớn có thể mất nhiều thời gian
server.listen(config.port, config.host, () => {
  console.log(`${config.siteName} đang chạy tại http://${config.host}:${config.port}`);
  backfillCards().catch((err) => console.error('Lỗi kiểm tra character card:', err));
});
