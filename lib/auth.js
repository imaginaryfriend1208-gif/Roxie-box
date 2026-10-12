import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { config } from './config.js';
import { sessions } from './db.js';
import { HttpError, parseCookies } from './http.js';

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const COOKIE = 'rx_session';
const USERNAME_RE = /^[a-zA-Z0-9_.-]+$/;

// ----- Mật khẩu -----

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password, stored) {
  const [algo, N, r, p, saltB64, keyB64] = String(stored).split('$');
  if (algo !== 'scrypt') return false;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
  });
  return crypto.timingSafeEqual(key, expected);
}

// Dùng khi username không tồn tại, để thời gian phản hồi giống với sai mật khẩu.
const DUMMY_HASH = await hashPassword(crypto.randomBytes(12).toString('hex'));
export const verifyDummy = (password) => verifyPassword(password, DUMMY_HASH);

// ----- Kiểm tra dữ liệu đăng ký -----

export function validateCredentials(username, password) {
  const errors = {};
  const min = config.minCredentialLength;
  if (typeof username !== 'string' || [...username].length < min) {
    errors.username = `Username phải có ít nhất ${min} ký tự`;
  } else if (username.length > config.maxUsernameLength) {
    errors.username = `Username tối đa ${config.maxUsernameLength} ký tự`;
  } else if (!USERNAME_RE.test(username)) {
    errors.username = 'Username chỉ gồm chữ không dấu, số và các ký tự _ . -';
  }
  if (typeof password !== 'string' || [...password].length < min) {
    errors.password = `Mật khẩu phải có ít nhất ${min} ký tự`;
  } else if (password.length > config.maxPasswordLength) {
    errors.password = `Mật khẩu tối đa ${config.maxPasswordLength} ký tự`;
  }
  return Object.keys(errors).length ? errors : null;
}

// ----- Tuỳ chọn giao diện của từng tài khoản -----

const PREF_RULES = {
  sort: (v) => ['new', 'old', 'name', 'size'].includes(v),
  view: (v) => v === 'grid' || v === 'list',
  sample: (v) => typeof v === 'string' && [...v].length <= 200,
  fontSize: (v) => Number.isInteger(v) && v >= 14 && v <= 72,
};

/** Chỉ giữ các khoá đã biết với giá trị hợp lệ; giá trị sai bị bỏ qua. */
export function sanitizePrefs(input) {
  const out = {};
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const [key, ok] of Object.entries(PREF_RULES)) {
    if (Object.hasOwn(input, key) && ok(input[key])) out[key] = input[key];
  }
  return out;
}

// ----- Phiên đăng nhập (cookie) -----

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

function cookieHeader(value, maxAgeSec) {
  const parts = [`${COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
  if (config.secureCookies) parts.push('Secure');
  return parts.join('; ');
}

export function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const maxAge = config.sessionDays * 86400;
  sessions.create(hashToken(token), userId, Date.now() + maxAge * 1000);
  res.setHeader('Set-Cookie', cookieHeader(token, maxAge));
}

export function endSession(req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) sessions.remove(hashToken(token));
  res.setHeader('Set-Cookie', cookieHeader('', 0));
}

export function currentUser(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return null;
  return sessions.findUser(hashToken(token)) || null;
}

// ----- Giới hạn số lần thử (chống dò mật khẩu) -----

const buckets = new Map();

export function rateLimit(key, max, windowMs) {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || bucket.reset <= now) {
    bucket = { count: 0, reset: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count > max) {
    const minutes = Math.ceil((bucket.reset - now) / 60000);
    throw new HttpError(429, `Thử quá nhiều lần, vui lòng đợi ${minutes} phút`);
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) if (bucket.reset <= now) buckets.delete(key);
}, 10 * 60 * 1000).unref();
