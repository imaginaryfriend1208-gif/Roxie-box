import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { config } from './config.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function sendJson(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

export async function readJson(req, limit = 16 * 1024) {
  const type = req.headers['content-type'] || '';
  if (!type.includes('application/json')) throw new HttpError(415, 'Yêu cầu phải gửi dạng JSON');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'Dữ liệu gửi lên quá lớn');
    chunks.push(chunk);
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (!data || typeof data !== 'object') throw new Error();
    return data;
  } catch {
    throw new HttpError(400, 'JSON không hợp lệ');
  }
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      out[key] = part.slice(i + 1).trim();
    }
  }
  return out;
}

export function clientIp(req) {
  if (config.trustProxy) {
    const fwd = req.headers['x-forwarded-for'];
    // Lấy IP cuối cùng: do reverse proxy (nginx) thêm vào, người dùng không giả được
    if (fwd) return String(fwd).split(',').pop().trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

/**
 * Trả file tĩnh có hỗ trợ ETag (304) và Range (206) để tua video/audio.
 * Trả về false nếu file không tồn tại.
 */
export async function serveFile(req, res, absPath, { mime, headers = {} }) {
  let stat;
  try {
    stat = await fsp.stat(absPath);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;

  const etag = `"${stat.size.toString(36)}-${Math.floor(stat.mtimeMs).toString(36)}"`;
  const base = {
    ETag: etag,
    'Last-Modified': stat.mtime.toUTCString(),
    'Accept-Ranges': 'bytes',
    ...headers,
  };

  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, base);
    res.end();
    return true;
  }

  let start = 0;
  let end = stat.size - 1;
  let status = 200;
  const range = req.headers.range;
  if (range && stat.size > 0) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());
    if (m && (m[1] || m[2])) {
      if (m[1]) {
        start = Number(m[1]);
        end = m[2] ? Math.min(Number(m[2]), stat.size - 1) : stat.size - 1;
      } else {
        start = Math.max(0, stat.size - Number(m[2]));
      }
      if (start > end || start >= stat.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
        res.end();
        return true;
      }
      status = 206;
      base['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
    }
  }

  res.writeHead(status, {
    ...base,
    'Content-Type': mime,
    'Content-Length': stat.size === 0 ? 0 : end - start + 1,
  });
  if (req.method === 'HEAD' || stat.size === 0) {
    res.end();
    return true;
  }
  const stream = fs.createReadStream(absPath, { start, end });
  stream.on('error', () => res.destroy());
  stream.pipe(res);
  return true;
}
