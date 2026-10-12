import crypto from 'node:crypto';
import path from 'node:path';
import { config } from './config.js';

const TEXT = 'text/plain; charset=utf-8';

const MIME = {
  // Ảnh
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml', ico: 'image/x-icon',
  apng: 'image/apng', tif: 'image/tiff', tiff: 'image/tiff', heic: 'image/heic', heif: 'image/heif',
  // Font
  ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2',
  // Video
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  mkv: 'video/x-matroska', avi: 'video/x-msvideo', ogv: 'video/ogg',
  // Âm thanh
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/opus',
  flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/aac',
  // Tài liệu
  pdf: 'application/pdf', txt: TEXT, md: TEXT, log: TEXT, csv: 'text/csv; charset=utf-8',
  json: 'application/json; charset=utf-8', css: 'text/css; charset=utf-8',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // Nén
  zip: 'application/zip', rar: 'application/vnd.rar', '7z': 'application/x-7z-compressed',
  gz: 'application/gzip', tar: 'application/x-tar',
  // Loại có thể chạy script trên trình duyệt -> luôn trả về dạng văn bản thuần
  html: TEXT, htm: TEXT, xhtml: TEXT, xht: TEXT, shtml: TEXT, xml: TEXT, xsl: TEXT, xslt: TEXT,
  js: TEXT, mjs: TEXT, cjs: TEXT,
};

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'jfif', 'gif', 'webp', 'avif', 'bmp', 'svg', 'ico', 'apng', 'tif', 'tiff', 'heic', 'heif']);
const FONT_EXT = new Set(['ttf', 'otf', 'woff', 'woff2']);

// 'card' = character card SillyTavern (png/json có dữ liệu card), xác định sau khi đọc nội dung file
export const CATEGORIES = ['image', 'font', 'card', 'file'];

export function extOf(filename) {
  const base = path.basename(String(filename));
  const i = base.lastIndexOf('.');
  if (i <= 0) return '';
  const ext = base.slice(i + 1).toLowerCase();
  return /^[a-z0-9]{1,10}$/.test(ext) ? ext : '';
}

export function detect(filename) {
  const ext = extOf(filename);
  const category = IMAGE_EXT.has(ext) ? 'image' : FONT_EXT.has(ext) ? 'font' : 'file';
  return { ext, category, mime: MIME[ext] || 'application/octet-stream' };
}

/** Tên hiển thị: bỏ đường dẫn, ký tự điều khiển; giữ nguyên tiếng Việt. */
export function sanitizeName(name) {
  const base = String(name).split(/[\\/]/).pop() || '';
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return [...clean].slice(0, 200).join('');
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
export const ID_RE = /^[a-z0-9]{6}$/;

export function randomId(length = 6) {
  let id = '';
  for (let i = 0; i < length; i++) id += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return id;
}

export const diskPath = (id) => path.join(config.paths.storage, id);
export const publicPath = (row) => `/f/${row.id}${row.ext ? `.${row.ext}` : ''}`;

function parseCardSummary(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function toClient(row) {
  const card = parseCardSummary(row.card);
  return {
    id: row.id,
    name: row.name,
    ext: row.ext,
    mime: row.mime,
    size: row.size,
    category: row.category,
    createdAt: row.created_at,
    url: publicPath(row),
    ...(card && { card }),
  };
}
