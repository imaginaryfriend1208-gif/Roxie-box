import fsp from 'node:fs/promises';

// Character card của SillyTavern: PNG có chunk tEXt "chara" (V2) / "ccv3" (V3) chứa JSON base64, hoặc file .json.

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const CARD_EXT = new Set(['png', 'json']);
export const MAX_CARD_BYTES = 64 * 1024 * 1024;
const MAX_IMAGES = 100;
const MAX_LINKS = 200;

const str = (v, max = 200) => (typeof v === 'string' ? [...v.trim()].slice(0, max).join('') : '');
const arr = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const dataOf = (card) => (isObj(card.data) ? card.data : card);

/** Đọc các chunk tEXt của PNG -> { keyword: text }. Không phải PNG thì trả về null. */
export function readPngText(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIG)) return null;
  const out = {};
  let off = 8;
  while (off + 12 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const end = off + 12 + len;
    if (end > buf.length) break;
    if (type === 'tEXt') {
      const data = buf.subarray(off + 8, off + 8 + len);
      const z = data.indexOf(0);
      if (z > 0) out[data.toString('latin1', 0, z).toLowerCase()] = data.toString('latin1', z + 1);
    }
    if (type === 'IEND') break;
    off = end;
  }
  return out;
}

export function isCard(raw) {
  if (!isObj(raw)) return false;
  if (typeof raw.spec === 'string' && raw.spec.startsWith('chara_card')) return isObj(raw.data);
  // Card V1: các trường nằm ngay ở gốc
  return typeof raw.name === 'string' && ('first_mes' in raw || 'description' in raw)
    && ('personality' in raw || 'scenario' in raw || 'mes_example' in raw);
}

/** Buffer (PNG hoặc JSON) -> object card, hoặc null nếu không phải character card. */
export function parseCard(buf) {
  const text = readPngText(buf);
  const candidates = [];
  if (text) {
    // ST ưu tiên ccv3, lỗi thì quay về chara
    for (const key of ['ccv3', 'chara']) {
      if (text[key]) candidates.push(() => Buffer.from(text[key], 'base64').toString('utf8'));
    }
  } else if (buf.subarray(0, 64).toString('utf8').replace(/^﻿/, '').trimStart().startsWith('{')) {
    candidates.push(() => buf.toString('utf8').replace(/^﻿/, ''));
  }
  for (const read of candidates) {
    try {
      const raw = JSON.parse(read());
      if (isCard(raw)) return raw;
    } catch { /* thử nguồn tiếp theo */ }
  }
  return null;
}

/** Ảnh avatar sạch: bỏ các chunk chữ (tEXt/iTXt/zTXt) chứa dữ liệu card, giữ nguyên ảnh. */
export function stripPngText(buf) {
  const parts = [buf.subarray(0, 8)];
  let off = 8;
  while (off + 12 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const end = Math.min(off + 12 + len, buf.length);
    if (!['tEXt', 'iTXt', 'zTXt'].includes(type)) parts.push(buf.subarray(off, end));
    if (type === 'IEND') break;
    off = end;
  }
  return Buffer.concat(parts);
}

/** Đọc file trên ổ đĩa nếu có thể là card (png/json, không quá lớn). */
export async function inspectCardFile(absPath, ext, size) {
  if (!CARD_EXT.has(ext) || size > MAX_CARD_BYTES) return null;
  try {
    return parseCard(await fsp.readFile(absPath));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Nội dung nhúng
// ---------------------------------------------------------------------------

/** Script Tavern Helper: extensions.tavern_helper ([[key, value]] hoặc object) / TavernHelper_scripts (bản cũ). */
function tavernHelper(ext) {
  const th = ext.tavern_helper;
  const map = Array.isArray(th) ? Object.fromEntries(th.filter((p) => Array.isArray(p) && p.length === 2)) : isObj(th) ? th : {};
  const scripts = [];
  const walk = (list) => {
    for (const item of arr(list)) {
      if (!isObj(item)) continue;
      const s = isObj(item.value) ? item.value : item;
      if (Array.isArray(s.scripts)) walk(s.scripts); // thư mục script
      else if (typeof s.content === 'string') scripts.push(s);
    }
  };
  walk(map.scripts);
  walk(ext.TavernHelper_scripts);
  const variables = isObj(map.variables) && Object.keys(map.variables).length ? map.variables : null;
  return { scripts, variables };
}

const IMAGE_MIME_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif', 'image/bmp': 'bmp' };
const DATA_URI_RE = /data:(image\/(?:png|jpe?g|gif|webp|avif|bmp));base64,([A-Za-z0-9+/]+={0,2})/g;
const LINK_RE = /https?:\/\/[^\s"'<>\\()`]+?\.(?:png|jpe?g|gif|webp|avif|svg|mp3|wav|ogg|m4a|flac|mp4|webm|ttf|otf|woff2?)(?:\?[^\s"'<>\\()`]*)?(?=[\s"'<>\\()`]|$)/gi;

function embeddedImages(json) {
  const seen = new Set();
  const out = [];
  for (const m of json.matchAll(DATA_URI_RE)) {
    if (out.length >= MAX_IMAGES) break;
    const b64 = m[2];
    if (b64.length < 400) continue; // bỏ ảnh 1px / icon đệm
    const sig = `${b64.length}:${b64.slice(0, 48)}:${b64.slice(-16)}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push({ mime: m[1] === 'image/jpg' ? 'image/jpeg' : m[1], b64 });
  }
  return out;
}

function externalLinks(json, assets) {
  const set = new Set();
  for (const a of assets) if (typeof a?.uri === 'string' && /^https?:\/\//i.test(a.uri)) set.add(a.uri);
  for (const m of json.matchAll(LINK_RE)) {
    if (set.size >= MAX_LINKS) break;
    if (!m[0].includes('$')) set.add(m[0]); // bỏ link mẫu dạng .../$1.png trong regex
  }
  return [...set].slice(0, MAX_LINKS);
}

/** character_book (spec V2) -> file World Info của SillyTavern (giống convertCharacterBook của ST). */
export function toWorldInfo(book) {
  const entries = {};
  arr(book.entries).forEach((e, index) => {
    if (!isObj(e)) return;
    const x = isObj(e.extensions) ? e.extensions : {};
    const uid = Number.isInteger(e.id) ? e.id : index;
    entries[uid] = {
      uid,
      key: arr(e.keys),
      keysecondary: arr(e.secondary_keys),
      comment: e.comment || e.name || '',
      content: e.content ?? '',
      constant: !!e.constant,
      vectorized: x.vectorized ?? false,
      selective: e.selective ?? true,
      selectiveLogic: x.selectiveLogic ?? 0,
      addMemo: !!(e.comment || e.name),
      order: e.insertion_order ?? 100,
      position: x.position ?? (e.position === 'before_char' ? 0 : 1),
      disable: e.enabled === false,
      ignoreBudget: x.ignore_budget ?? false,
      excludeRecursion: x.exclude_recursion ?? false,
      preventRecursion: x.prevent_recursion ?? false,
      matchPersonaDescription: x.match_persona_description ?? false,
      matchCharacterDescription: x.match_character_description ?? false,
      matchCharacterPersonality: x.match_character_personality ?? false,
      matchCharacterDepthPrompt: x.match_character_depth_prompt ?? false,
      matchScenario: x.match_scenario ?? false,
      matchCreatorNotes: x.match_creator_notes ?? false,
      delayUntilRecursion: x.delay_until_recursion ?? false,
      probability: x.probability ?? 100,
      useProbability: x.useProbability ?? true,
      depth: x.depth ?? 4,
      outletName: x.outlet_name ?? '',
      group: x.group ?? '',
      groupOverride: x.group_override ?? false,
      groupWeight: x.group_weight ?? 100,
      scanDepth: x.scan_depth ?? null,
      caseSensitive: x.case_sensitive ?? null,
      matchWholeWords: x.match_whole_words ?? null,
      useGroupScoring: x.use_group_scoring ?? null,
      automationId: x.automation_id ?? '',
      role: x.role ?? 0,
      sticky: x.sticky ?? null,
      cooldown: x.cooldown ?? null,
      delay: x.delay ?? null,
      triggers: arr(x.triggers),
      displayIndex: x.display_index ?? index,
      extensions: x,
    };
  });
  return { entries, originalData: book };
}

/** Tên file an toàn cho Content-Disposition. */
export const safeFileName = (name, fallback = 'file') =>
  [...String(name ?? '').replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()].slice(0, 80).join('') || fallback;

const json = (v) => JSON.stringify(v, null, 2);

/**
 * Toàn bộ nội dung nhúng của card. Mỗi mục: { key, group, label, filename, mime, count?, build() }.
 * key ổn định (card không đổi sau khi upload) để tải lại từng mục: card, lorebook, regex-all, regex-0, script-0…
 */
export function collectEmbeds(card) {
  const d = dataOf(card);
  const ext = isObj(d.extensions) ? d.extensions : {};
  const name = str(d.name, 100) || 'card';
  const items = [];

  items.push({ key: 'card', group: 'card', label: 'Toàn bộ card (JSON)', filename: `${safeFileName(name, 'card')}.json`, mime: 'application/json', build: () => json(card) });

  const book = isObj(d.character_book) ? d.character_book : null;
  if (book && arr(book.entries).length) {
    const bookName = str(book.name, 100) || `${name} Lorebook`;
    items.push({
      key: 'lorebook', group: 'lorebook', label: bookName, count: arr(book.entries).length,
      filename: `${safeFileName(bookName, 'lorebook')}.json`, mime: 'application/json', build: () => json(toWorldInfo(book)),
    });
  }

  const regex = arr(ext.regex_scripts).filter(isObj);
  if (regex.length) {
    items.push({ key: 'regex-all', group: 'regex', label: 'Tất cả regex', count: regex.length, filename: `${safeFileName(name)} - regex.json`, mime: 'application/json', build: () => json(regex) });
    regex.forEach((r, i) => {
      const label = str(r.scriptName, 100) || `Regex ${i + 1}`;
      items.push({ key: `regex-${i}`, group: 'regex', label, disabled: !!r.disabled, filename: `regex-${safeFileName(label, String(i + 1))}.json`, mime: 'application/json', build: () => json(r) });
    });
  }

  const th = tavernHelper(ext);
  if (th.scripts.length) {
    items.push({ key: 'script-all', group: 'script', label: 'Tất cả script', count: th.scripts.length, filename: `${safeFileName(name)} - scripts.json`, mime: 'application/json', build: () => json(th.scripts) });
    th.scripts.forEach((s, i) => {
      const label = str(s.name, 100) || `Script ${i + 1}`;
      items.push({ key: `script-${i}`, group: 'script', label, disabled: s.enabled === false, filename: `script-${safeFileName(label, String(i + 1))}.json`, mime: 'application/json', build: () => json(s) });
    });
  }
  if (th.variables) {
    items.push({ key: 'variables', group: 'script', label: 'Biến (variables)', count: Object.keys(th.variables).length, filename: `${safeFileName(name)} - variables.json`, mime: 'application/json', build: () => json(th.variables) });
  }

  const greetings = [
    ...(str(d.first_mes, 1e7) ? [['Lời chào đầu', d.first_mes]] : []),
    ...arr(d.alternate_greetings).filter((g) => str(g, 10)).map((g, i) => [`Lời chào thay thế ${i + 1}`, g]),
    ...arr(d.group_only_greetings).filter((g) => str(g, 10)).map((g, i) => [`Lời chào nhóm ${i + 1}`, g]),
  ];
  if (greetings.length) {
    items.push({
      key: 'greetings', group: 'text', label: 'Lời chào', count: greetings.length,
      filename: `${safeFileName(name)} - greetings.txt`, mime: 'text/plain; charset=utf-8',
      build: () => greetings.map(([title, text]) => `===== ${title} =====\n\n${text}`).join('\n\n\n'),
    });
  }

  const note = isObj(ext.depth_prompt) ? str(ext.depth_prompt.prompt, 1e7) : '';
  if (note) {
    items.push({ key: 'note', group: 'text', label: `Character note (depth ${ext.depth_prompt.depth ?? 4})`, filename: `${safeFileName(name)} - character note.txt`, mime: 'text/plain; charset=utf-8', build: () => note });
  }

  const raw = JSON.stringify(card);
  embeddedImages(raw).forEach((img, i) => {
    items.push({
      key: `image-${i}`, group: 'image', label: `Ảnh nhúng ${i + 1}`, size: Math.floor((img.b64.length * 3) / 4),
      filename: `${safeFileName(name)} - ${i + 1}.${IMAGE_MIME_EXT[img.mime] || 'png'}`, mime: img.mime, build: () => Buffer.from(img.b64, 'base64'),
    });
  });

  return { items, links: externalLinks(raw, arr(d.assets)) };
}

/** Tóm tắt lưu vào DB để hiện thẻ card + tìm kiếm mà không cần đọc lại file. */
export function summarize(card) {
  const d = dataOf(card);
  const { items, links } = collectEmbeds(card);
  const count = (key) => items.find((i) => i.key === key)?.count || 0;
  const spec = typeof card.spec === 'string' ? card.spec : '';
  return {
    name: str(d.name, 100) || 'Không tên',
    creator: str(d.creator, 100),
    version: str(d.character_version, 50),
    spec: spec.includes('v3') ? 'V3' : spec.includes('v2') ? 'V2' : 'V1',
    tags: arr(d.tags).map((t) => str(t, 40)).filter(Boolean).slice(0, 20),
    counts: {
      lorebook: count('lorebook'),
      regex: count('regex-all'),
      script: count('script-all'),
      greetings: count('greetings'),
      image: items.filter((i) => i.group === 'image').length,
      link: links.length,
    },
  };
}

/** Mục "ảnh avatar sạch" — chỉ có với card PNG, server tự đọc file và gọi stripPngText. */
export const avatarEmbed = (card) => ({
  key: 'avatar', group: 'image', label: 'Ảnh avatar (không kèm dữ liệu card)',
  filename: `${safeFileName(str(dataOf(card).name, 100), 'avatar')}.png`, mime: 'image/png',
});

/** Danh sách nội dung nhúng gửi cho frontend (không kèm nội dung). */
export function describeCard(card, { png = false } = {}) {
  const d = dataOf(card);
  const { items, links } = collectEmbeds(card);
  const embeds = items.map(({ build, ...meta }) => ({ ...meta, size: meta.size ?? Buffer.byteLength(build()) }));
  if (png) embeds.splice(1, 0, avatarEmbed(card));
  return {
    summary: summarize(card),
    creatorNotes: str(d.creator_notes, 4000),
    embeds,
    links,
  };
}

export function findEmbed(card, key) {
  return collectEmbeds(card).items.find((i) => i.key === key) || null;
}
