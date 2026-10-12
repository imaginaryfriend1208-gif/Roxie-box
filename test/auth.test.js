import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Dùng database tạm để không đụng vào data/ thật
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'roxbox-test-'));
process.env.DATA_DIR = tmpDir;

const { config } = await import('../lib/config.js');
const { users, closeDb } = await import('../lib/db.js');
const auth = await import('../lib/auth.js');

/** Giả lập res của node:http, chỉ ghi lại header. */
function fakeRes() {
  const headers = {};
  return { headers, setHeader: (k, v) => { headers[k.toLowerCase()] = v; } };
}
const cookieOf = (res) => res.headers['set-cookie'].split(';')[0];

let userId;
before(async () => {
  userId = users.create('roxie_test', await auth.hashPassword('matkhau123'));
});
after(() => {
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('độ dài tối thiểu là 6 ký tự', () => {
  assert.equal(config.minCredentialLength, 6);
});

test('validateCredentials: hợp lệ thì trả về null', () => {
  assert.equal(auth.validateCredentials('roxie1', '123456'), null);
  assert.equal(auth.validateCredentials('ro.x-i_e', 'mật khẩu có dấu'), null);
});

test('validateCredentials: dưới 6 ký tự bị từ chối', () => {
  const err = auth.validateCredentials('abcde', '12345');
  assert.match(err.username, /ít nhất 6/);
  assert.match(err.password, /ít nhất 6/);
});

test('validateCredentials: đếm ký tự Unicode, không đếm byte', () => {
  // 5 ký tự có dấu (dài hơn 5 đơn vị UTF-16 khi ở dạng tổ hợp) vẫn là chưa đủ
  assert.ok(auth.validateCredentials('roxie1', 'đượi1').password);
  assert.equal(auth.validateCredentials('roxie1', 'đượi12'), null);
  assert.ok(auth.validateCredentials('roxie1', '😀😀😀😀😀').password);
});

test('validateCredentials: giới hạn độ dài tối đa', () => {
  assert.match(auth.validateCredentials('a'.repeat(33), '123456').username, /tối đa/);
  assert.equal(auth.validateCredentials('a'.repeat(32), '123456'), null);
  assert.match(auth.validateCredentials('roxie1', 'x'.repeat(129)).password, /tối đa/);
});

test('validateCredentials: username chỉ gồm chữ không dấu, số, _ . -', () => {
  for (const bad of ['roxie đẹp', 'roxie!@#', 'đượiđượi', '<script>']) {
    assert.match(auth.validateCredentials(bad, '123456').username, /chỉ gồm/, bad);
  }
});

test('validateCredentials: sai kiểu dữ liệu bị từ chối', () => {
  const err = auth.validateCredentials(null, 123456);
  assert.ok(err.username);
  assert.ok(err.password);
});

test('hashPassword / verifyPassword', async () => {
  const hash = await auth.hashPassword('matkhau123');
  assert.match(hash, /^scrypt\$/);
  assert.ok(!hash.includes('matkhau123'));
  assert.notEqual(hash, await auth.hashPassword('matkhau123'), 'mỗi lần hash có salt khác nhau');
  assert.equal(await auth.verifyPassword('matkhau123', hash), true);
  assert.equal(await auth.verifyPassword('matkhau124', hash), false);
  assert.equal(await auth.verifyPassword('matkhau123', 'bcrypt$xxx'), false);
});

test('verifyDummy luôn trả về false', async () => {
  assert.equal(await auth.verifyDummy('matkhau123'), false);
});

test('startSession: đặt cookie an toàn, đăng nhập được bằng cookie', () => {
  const res = fakeRes();
  auth.startSession(res, userId);
  const header = res.headers['set-cookie'];
  assert.match(header, /^rx_session=[\w-]{43};/);
  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Lax/);
  assert.match(header, new RegExp(`Max-Age=${config.sessionDays * 86400}`));

  const user = auth.currentUser({ headers: { cookie: `other=1; ${cookieOf(res)}` } });
  assert.equal(user.id, userId);
  assert.equal(user.username, 'roxie_test');
});

test('currentUser: không có hoặc sai cookie thì null', () => {
  assert.equal(auth.currentUser({ headers: {} }), null);
  assert.equal(auth.currentUser({ headers: { cookie: 'rx_session=khongtontai' } }), null);
});

test('endSession: xoá phiên và cookie', () => {
  const res = fakeRes();
  auth.startSession(res, userId);
  const req = { headers: { cookie: cookieOf(res) } };
  assert.ok(auth.currentUser(req));

  const out = fakeRes();
  auth.endSession(req, out);
  assert.match(out.headers['set-cookie'], /^rx_session=;.*Max-Age=0/);
  assert.equal(auth.currentUser(req), null);
});

test('rateLimit: chặn khi vượt số lần cho phép', () => {
  const key = `test:${Math.random()}`;
  for (let i = 0; i < 3; i++) auth.rateLimit(key, 3, 60_000);
  assert.throws(() => auth.rateLimit(key, 3, 60_000), (err) => err.status === 429 && /đợi 1 phút/.test(err.message));
});

test('rateLimit: mỗi key đếm riêng và reset sau khoảng thời gian', async () => {
  const a = `test:a:${Math.random()}`;
  const b = `test:b:${Math.random()}`;
  auth.rateLimit(a, 1, 30);
  auth.rateLimit(b, 1, 30);
  assert.throws(() => auth.rateLimit(a, 1, 30));
  await new Promise((r) => setTimeout(r, 40));
  assert.doesNotThrow(() => auth.rateLimit(a, 1, 30));
});

test('sanitizePrefs: chỉ giữ tuỳ chọn hợp lệ', () => {
  assert.deepEqual(auth.sanitizePrefs({ view: 'list', sort: 'name', sample: 'Chào', fontSize: 40 }),
    { view: 'list', sort: 'name', sample: 'Chào', fontSize: 40 });
  assert.deepEqual(auth.sanitizePrefs({ view: 'table', sort: 'x', sample: 'a'.repeat(201), fontSize: 100, evil: 1 }), {});
  assert.deepEqual(auth.sanitizePrefs({ fontSize: 14.5, __proto__: { view: 'list' } }), {});
  assert.deepEqual(auth.sanitizePrefs(null), {});
  assert.deepEqual(auth.sanitizePrefs(['grid']), {});
});

test('users.getPrefs / setPrefs: lưu tuỳ chọn theo tài khoản', () => {
  assert.deepEqual(users.getPrefs(userId), {});
  users.setPrefs(userId, { view: 'grid', fontSize: 30 });
  assert.deepEqual(users.getPrefs(userId), { view: 'grid', fontSize: 30 });
  const other = users.create('roxie_other', 'x');
  assert.deepEqual(users.getPrefs(other), {});
});
