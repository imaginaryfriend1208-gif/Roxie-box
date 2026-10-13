import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extOf, detect, sanitizeName, randomId, ID_RE, publicPath, toClient } from '../lib/files.js';
import { readPngText, parseCard, stripPngText, toWorldInfo, collectEmbeds, summarize, describeCard, findEmbed, safeFileName, readableCard } from '../lib/card.js';

test('extOf: lấy đuôi file, chữ thường', () => {
  assert.equal(extOf('Anh.PNG'), 'png');
  assert.equal(extOf('archive.tar.gz'), 'gz');
  assert.equal(extOf('C:\\fonts\\Roboto.ttf'), 'ttf');
  assert.equal(extOf('/tmp/a/b.woff2'), 'woff2');
});

test('extOf: không có đuôi hợp lệ thì trả về rỗng', () => {
  assert.equal(extOf('README'), '');
  assert.equal(extOf('.htaccess'), '');
  assert.equal(extOf('file.'), '');
  assert.equal(extOf('bad.p-n-g'), '');
  assert.equal(extOf('long.abcdefghijk'), '');
});

test('detect: xếp ảnh vào thư mục image', () => {
  for (const name of ['a.png', 'b.JPG', 'c.webp', 'd.gif', 'e.svg', 'f.avif']) {
    assert.equal(detect(name).category, 'image', name);
  }
  assert.equal(detect('a.jpg').mime, 'image/jpeg');
});

test('detect: xếp font vào thư mục font', () => {
  assert.deepEqual(detect('Roboto.ttf'), { ext: 'ttf', category: 'font', mime: 'font/ttf' });
  assert.equal(detect('x.otf').category, 'font');
  assert.equal(detect('x.woff').category, 'font');
  assert.equal(detect('x.woff2').mime, 'font/woff2');
});

test('detect: còn lại vào thư mục file', () => {
  assert.equal(detect('song.mp3').category, 'file');
  assert.equal(detect('doc.pdf').category, 'file');
  assert.equal(detect('noext').category, 'file');
  assert.equal(detect('weird.xyz').mime, 'application/octet-stream');
});

test('detect: loại có thể chạy script luôn là text/plain', () => {
  for (const name of ['x.html', 'x.htm', 'x.js', 'x.mjs', 'x.xml', 'x.xhtml']) {
    assert.equal(detect(name).mime, 'text/plain; charset=utf-8', name);
  }
});

test('sanitizeName: bỏ đường dẫn và ký tự điều khiển, giữ tiếng Việt', () => {
  assert.equal(sanitizeName('../../etc/passwd'), 'passwd');
  assert.equal(sanitizeName('C:\\Users\\x\\ảnh đẹp.png'), 'ảnh đẹp.png');
  assert.equal(sanitizeName('a\u0000b\u001fc\u007f.txt'), 'abc.txt');
  assert.equal(sanitizeName('  Venom đượi.ttf  '), 'Venom đượi.ttf');
  assert.equal(sanitizeName('thư mục/'), '');
});

test('sanitizeName: giới hạn 200 ký tự, không cắt đôi ký tự Unicode', () => {
  const name = sanitizeName('đ'.repeat(250));
  assert.equal([...name].length, 200);
  assert.equal(sanitizeName('😀'.repeat(201)), '😀'.repeat(200));
});

test('randomId: đúng 6 ký tự a-z0-9 và khác nhau', () => {
  const ids = new Set();
  for (let i = 0; i < 500; i++) {
    const id = randomId();
    assert.match(id, ID_RE);
    ids.add(id);
  }
  assert.ok(ids.size > 495);
  assert.equal(randomId(10).length, 10);
});

test('ID_RE: chỉ nhận mã hợp lệ', () => {
  assert.ok(ID_RE.test('abc123'));
  assert.ok(!ID_RE.test('ABC123'));
  assert.ok(!ID_RE.test('abc12'));
  assert.ok(!ID_RE.test('abc1234'));
  assert.ok(!ID_RE.test('../abc'));
});

test('publicPath / toClient: tạo link công khai', () => {
  assert.equal(publicPath({ id: 'abc123', ext: 'png' }), '/f/abc123.png');
  assert.equal(publicPath({ id: 'abc123', ext: '' }), '/f/abc123');

  const row = { id: 'abc123', user_id: 7, name: 'a.png', ext: 'png', mime: 'image/png', size: 10, category: 'image', created_at: 1 };
  assert.deepEqual(toClient(row), {
    id: 'abc123', name: 'a.png', ext: 'png', mime: 'image/png', size: 10, category: 'image', createdAt: 1, url: '/f/abc123.png',
  });
});

// ---------------------------------------------------------------------------
// Character card (lib/card.js)
// ---------------------------------------------------------------------------

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  return Buffer.concat([len, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]); // CRC không được kiểm tra
};
const textChunk = (key, obj) => chunk('tEXt', Buffer.from(`${key}\0${Buffer.from(JSON.stringify(obj)).toString('base64')}`, 'latin1'));
const makePng = (...extra) => Buffer.concat([PNG_SIG, chunk('IHDR', Buffer.alloc(13)), ...extra, chunk('IDAT', Buffer.from('pixels')), chunk('IEND', Buffer.alloc(0))]);

const v2 = (data) => ({ spec: 'chara_card_v2', spec_version: '2.0', data: { name: 'Roxie', first_mes: 'Chào', ...data } });

test('parseCard: đọc card V2 trong chunk tEXt "chara"', () => {
  const card = parseCard(makePng(textChunk('chara', v2({ creator: 'me' }))));
  assert.equal(card.data.name, 'Roxie');
  assert.equal(readPngText(makePng(textChunk('Chara', { a: 1 }))).chara !== undefined, true); // keyword chữ thường
});

test('parseCard: ưu tiên ccv3, ccv3 hỏng thì quay về chara', () => {
  const v3 = { spec: 'chara_card_v3', spec_version: '3.0', data: { name: 'V3', first_mes: 'x' } };
  assert.equal(parseCard(makePng(textChunk('chara', v2({ name: 'V2' })), textChunk('ccv3', v3))).data.name, 'V3');
  const broken = chunk('tEXt', Buffer.from('ccv3\0!!!', 'latin1'));
  assert.equal(parseCard(makePng(broken, textChunk('chara', v2({ name: 'V2' })))).data.name, 'V2');
});

test('parseCard: card JSON (có BOM) và card V1', () => {
  assert.equal(parseCard(Buffer.from('\uFEFF' + JSON.stringify(v2({})))).data.name, 'Roxie');
  const v1 = { name: 'Old', description: 'd', personality: 'p', first_mes: 'hi' };
  assert.equal(parseCard(Buffer.from(JSON.stringify(v1))).name, 'Old');
  assert.equal(summarize(v1).spec, 'V1');
});

test('parseCard: không phải card thì null', () => {
  assert.equal(parseCard(makePng()), null);
  assert.equal(parseCard(makePng(textChunk('chara', { hello: 'world' }))), null);
  assert.equal(parseCard(Buffer.from('{"a":1}')), null);
  assert.equal(parseCard(Buffer.from('not json')), null);
  assert.equal(readPngText(Buffer.from('GIF89a')), null);
});

test('stripPngText: bỏ dữ liệu card, giữ ảnh', () => {
  const png = makePng(textChunk('chara', v2({})), chunk('iTXt', Buffer.from('x')), chunk('zTXt', Buffer.from('y')));
  const clean = stripPngText(png);
  assert.deepEqual(readPngText(clean), {});
  assert.equal(parseCard(clean), null);
  assert.ok(clean.includes(Buffer.from('IDATpixels')));
  assert.ok(clean.subarray(0, 8).equals(PNG_SIG));
});

test('toWorldInfo: chuyển character_book sang World Info của ST', () => {
  const wi = toWorldInfo({ name: 'Book', entries: [
    { id: 5, keys: ['a'], secondary_keys: ['b'], content: 'c', comment: 'note', enabled: false, insertion_order: 10, position: 'before_char', extensions: { depth: 2 } },
    { keys: ['z'], content: 'z' },
  ] });
  assert.deepEqual(Object.keys(wi.entries), ['1', '5']);
  const e = wi.entries[5];
  assert.deepEqual([e.key, e.keysecondary, e.content, e.comment, e.disable, e.order, e.position, e.depth], [['a'], ['b'], 'c', 'note', true, 10, 0, 2]);
  assert.equal(wi.entries[1].position, 1);
  assert.equal(wi.originalData.name, 'Book');
});

test('collectEmbeds / summarize: liệt kê đủ nội dung nhúng', () => {
  const img = `data:image/png;base64,${'A'.repeat(600)}`;
  const card = v2({
    alternate_greetings: ['Chào 2'],
    character_book: { entries: [{ keys: ['k'], content: 'v' }] },
    creator_notes: `nhạc https://x.com/a.mp3 mẫu https://x.com/$1.png ${img} ${img}`,
    extensions: {
      regex_scripts: [{ scriptName: 'R1' }, { scriptName: 'R2', disabled: true }],
      tavern_helper: [['scripts', [{ type: 'folder', value: { scripts: [{ name: 'S1', content: 'js' }] } }]], ['variables', { hp: 1 }]],
      depth_prompt: { prompt: 'note', depth: 3 },
    },
  });
  const { items, links } = collectEmbeds(card);
  assert.deepEqual(items.map((i) => i.key), ['card', 'lorebook', 'regex-all', 'regex-0', 'regex-1', 'script-all', 'script-0', 'variables', 'greetings', 'note', 'image-0']);
  assert.deepEqual(links, ['https://x.com/a.mp3']);
  assert.equal(items.find((i) => i.key === 'regex-1').disabled, true);
  assert.match(findEmbed(card, 'greetings').build(), /Chào 2/);
  assert.equal(findEmbed(card, 'nope'), null);
  assert.deepEqual(summarize(card).counts, { lorebook: 1, regex: 2, script: 1, greetings: 2, image: 1, link: 1 });

  const desc = describeCard(card, { png: true });
  assert.equal(desc.embeds[1].key, 'avatar');
  assert.ok(desc.embeds.every((e) => !('build' in e)));
});

test('readableCard: tách nội dung để đọc (lorebook, lời chào, regex, script)', () => {
  const img = `data:image/png;base64,${'A'.repeat(80)}`;
  const card = v2({
    description: `Mô tả ${img}`,
    alternate_greetings: ['Chào 2', ''],
    character_book: { name: 'Sổ', entries: [
      { id: 7, comment: 'Sau', keys: ['b'], content: 'nội dung b', insertion_order: '<b>', extensions: { display_index: 1, position: 4, depth: 2, role: 1 } },
      { comment: 'Trước', keys: ['a', ''], secondary_keys: ['c'], content: 'a', constant: true, enabled: false,
        extensions: { display_index: 0, selectiveLogic: 3, probability: 40 } },
    ] },
    extensions: {
      regex_scripts: [{ scriptName: 'R', findRegex: '/x/g', replaceString: 'y', disabled: true }],
      tavern_helper: { scripts: [{ name: 'S', content: 'js', enabled: false }] },
      depth_prompt: { prompt: 'ghi chú', depth: 3 },
    },
  });
  const r = readableCard(card);
  assert.equal(r.name, 'Roxie');
  assert.deepEqual(r.fields.map((f) => f.key), ['description', 'depth_prompt']);
  assert.equal(r.fields[0].text, 'Mô tả [ảnh nhúng]');
  assert.deepEqual(r.greetings.map((g) => g.title), ['Lời chào đầu', 'Lời chào thay thế 1']);

  assert.equal(r.lorebook.name, 'Sổ');
  const [a, b] = r.lorebook.entries;
  assert.deepEqual([a.title, a.keys, a.secondary, a.logic, a.mode, a.enabled, a.probability, a.position],
    ['Trước', ['a'], ['c'], 'AND ALL', 'constant', false, 40, 'Sau char']);
  assert.deepEqual([b.uid, b.title, b.mode, b.order, b.position], [7, 'Sau', 'normal', 100, 'Độ sâu 2 (user)']);
  assert.ok(!('sort' in a));

  assert.deepEqual(r.regex, [{ name: 'R', find: '/x/g', replace: 'y', disabled: true }]);
  assert.deepEqual(r.scripts.map((s) => [s.name, s.content, s.enabled]), [['S', 'js', false]]);
  assert.equal(readableCard(v2({ first_mes: '' })).lorebook, null);
});

test('safeFileName: bỏ ký tự cấm trong tên file', () => {
  assert.equal(safeFileName('a/b:c*?"<>|d'), 'a b c d');
  assert.equal(safeFileName('', 'x'), 'x');
});
