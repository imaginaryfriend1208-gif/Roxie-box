import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

fs.mkdirSync(config.paths.data, { recursive: true });

const db = new DatabaseSync(path.join(config.paths.data, 'roxbox.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    username    TEXT NOT NULL UNIQUE COLLATE NOCASE,
    pass_hash   TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash  TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS files (
    id          TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    ext         TEXT NOT NULL,
    mime        TEXT NOT NULL,
    size        INTEGER NOT NULL,
    category    TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_files_user ON files(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
`);

// Cột card: NULL = chưa kiểm tra, '' = không phải character card, còn lại = JSON tóm tắt card
if (!db.prepare('PRAGMA table_info(files)').all().some((c) => c.name === 'card')) {
  db.exec('ALTER TABLE files ADD COLUMN card TEXT');
}

// Cột prefs: JSON tuỳ chọn giao diện (kiểu hiển thị, sắp xếp, câu mẫu, cỡ chữ)
if (!db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'prefs')) {
  db.exec("ALTER TABLE users ADD COLUMN prefs TEXT NOT NULL DEFAULT '{}'");
}

const stmt = {
  userByName: db.prepare('SELECT * FROM users WHERE username = ?'),
  userById: db.prepare('SELECT id, username, created_at FROM users WHERE id = ?'),
  insertUser: db.prepare('INSERT INTO users (username, pass_hash, created_at) VALUES (?, ?, ?)'),
  userPrefs: db.prepare('SELECT prefs FROM users WHERE id = ?'),
  setPrefs: db.prepare('UPDATE users SET prefs = ? WHERE id = ?'),

  insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'),
  sessionUser: db.prepare(`
    SELECT u.id, u.username, u.created_at FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `),
  deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
  purgeSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),

  fileExists: db.prepare('SELECT 1 FROM files WHERE id = ?'),
  fileById: db.prepare('SELECT * FROM files WHERE id = ?'),
  filesByUser: db.prepare('SELECT * FROM files WHERE user_id = ? ORDER BY created_at DESC'),
  insertFile: db.prepare(`
    INSERT INTO files (id, user_id, name, ext, mime, size, category, created_at, card)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  uncheckedCards: db.prepare("SELECT * FROM files WHERE card IS NULL AND ext IN ('png', 'json')"),
  setCard: db.prepare('UPDATE files SET card = ?, category = ? WHERE id = ?'),
  renameFile: db.prepare('UPDATE files SET name = ? WHERE id = ? AND user_id = ?'),
  deleteFile: db.prepare('DELETE FROM files WHERE id = ? AND user_id = ?'),
};

export const users = {
  findByName: (username) => stmt.userByName.get(username),
  findById: (id) => stmt.userById.get(id),
  create: (username, passHash) =>
    Number(stmt.insertUser.run(username, passHash, Date.now()).lastInsertRowid),
  getPrefs: (id) => {
    try { return JSON.parse(stmt.userPrefs.get(id)?.prefs || '{}'); } catch { return {}; }
  },
  setPrefs: (id, prefs) => stmt.setPrefs.run(JSON.stringify(prefs), id),
};

export const sessions = {
  create: (tokenHash, userId, expiresAt) => stmt.insertSession.run(tokenHash, userId, expiresAt),
  findUser: (tokenHash) => stmt.sessionUser.get(tokenHash, Date.now()),
  remove: (tokenHash) => stmt.deleteSession.run(tokenHash),
  purgeExpired: () => stmt.purgeSessions.run(Date.now()),
};

export const files = {
  exists: (id) => Boolean(stmt.fileExists.get(id)),
  findById: (id) => stmt.fileById.get(id),
  listByUser: (userId) => stmt.filesByUser.all(userId),
  create: (f) =>
    stmt.insertFile.run(f.id, f.userId, f.name, f.ext, f.mime, f.size, f.category, f.createdAt, f.card ?? null),
  uncheckedCards: () => stmt.uncheckedCards.all(),
  setCard: (id, card, category) => stmt.setCard.run(card, category, id),
  rename: (id, userId, name) => stmt.renameFile.run(name, id, userId).changes > 0,
  remove: (id, userId) => stmt.deleteFile.run(id, userId).changes > 0,
};

export const closeDb = () => db.close();
