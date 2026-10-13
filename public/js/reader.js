// Trình đọc card: lorebook, lời chào, mô tả, regex & script — danh sách trái, nội dung phải.
// Dùng trong dialog của trang chính (app.js) và trang link đọc công khai /r/<mã> (read.js).

import { $, escapeHtml, icon, copyText, flashCopied } from './common.js';

const READER_TABS = [
    ['lore', 'i-book', 'Lorebook'],
    ['greetings', 'i-message', 'Lời chào'],
    ['info', 'i-file-text', 'Thông tin'],
    ['code', 'i-code', 'Regex & Script'],
];

const LORE_MODE = {
    constant: ['Luôn bật', 'badge--success'],
    vector: ['Vector', ''],
    normal: ['Theo từ khoá', 'badge--muted'],
};

const readerText = (text) => `<pre class="reader-text">${escapeHtml(text)}</pre>`;
const charCount = (text) => `${text.length.toLocaleString('vi-VN')} ký tự`;
const keyChips = (keys) => keys.map((k) => `<span class="reader-key">${escapeHtml(k)}</span>`).join('');
const OFF_BADGE = '<span class="badge badge--error">Đang tắt</span>';

/**
 * Mỗi mục gồm: `title`, `badges` + `sub` (chữ thuần) cho danh sách trái;
 * `head` + `body` (HTML đã escape) cho cột phải; `copy` cho nút Copy; `search` cho ô tìm.
 */
function loreItem(e) {
    const [modeLabel, modeClass] = LORE_MODE[e.mode] || LORE_MODE.normal;
    const mode = `<span class="badge ${modeClass}">${modeLabel}</span>`;
    const meta = [
        e.keys.length ? `<dt>Từ khoá</dt><dd class="reader-keys">${keyChips(e.keys)}</dd>` : '',
        e.secondary.length ? `<dt>Từ khoá phụ (${escapeHtml(e.logic)})</dt><dd class="reader-keys">${keyChips(e.secondary)}</dd>` : '',
        `<dt>Vị trí</dt><dd>${escapeHtml(e.position)}</dd>`,
        `<dt>Thứ tự</dt><dd>${e.order}</dd>`,
        e.probability !== 100 ? `<dt>Xác suất</dt><dd>${e.probability}%</dd>` : '',
        e.group ? `<dt>Nhóm</dt><dd>${escapeHtml(e.group)}</dd>` : '',
        `<dt>Độ dài</dt><dd>${charCount(e.content)}</dd>`,
    ].join('');
    return {
        title: e.title || `Mục #${e.uid}`,
        off: !e.enabled,
        badges: mode,
        sub: e.keys.length ? e.keys.join(', ') : e.position,
        head: `${e.enabled ? '' : OFF_BADGE}${mode}<span class="badge badge--muted">${escapeHtml(e.position)}</span>`,
        body: `<dl class="reader-meta">${meta}</dl>${e.content ? readerText(e.content) : '<p class="rx-meta">Mục này không có nội dung.</p>'}`,
        copy: e.content,
        search: [e.title, ...e.keys, ...e.secondary, e.content].join('\n').toLowerCase(),
    };
}

const textItem = ({ title, text }) => ({
    title,
    sub: charCount(text),
    head: `<span class="rx-meta">${charCount(text)}</span>`,
    body: readerText(text),
    copy: text,
});

function readerTabsOf(data) {
    const tabs = {};
    const entries = data.lorebook?.entries || [];
    if (entries.length) {
        const on = entries.filter((e) => e.enabled).length;
        tabs.lore = {
            items: entries.map(loreItem),
            searchable: true,
            summary: `${data.lorebook.name ? `${data.lorebook.name} · ` : ''}${entries.length} mục · ${on} đang bật`,
        };
    }
    if (data.greetings.length) tabs.greetings = { items: data.greetings.map(textItem) };
    if (data.fields.length) tabs.info = { items: data.fields.map((f) => textItem({ title: f.label, text: f.text })) };

    const regexBadge = `<span class="badge">${icon('i-regex')}Regex</span>`;
    const scriptBadge = `<span class="badge">${icon('i-code')}Script</span>`;
    const code = [
        ...data.regex.map((r) => ({
            title: r.name,
            off: r.disabled,
            badges: regexBadge,
            sub: r.find,
            head: `${r.disabled ? OFF_BADGE : ''}${regexBadge}`,
            body: `<h4 class="reader-label">Tìm</h4>${readerText(r.find)}
                   <h4 class="reader-label">Thay bằng</h4>${r.replace ? readerText(r.replace) : '<p class="rx-meta">(xoá phần khớp)</p>'}`,
            copy: r.find,
        })),
        ...data.scripts.map((sc) => ({
            title: sc.name,
            off: !sc.enabled,
            badges: scriptBadge,
            sub: sc.info || charCount(sc.content),
            head: `${sc.enabled ? '' : OFF_BADGE}${scriptBadge}`,
            body: `${sc.info ? `<p class="reader-info">${escapeHtml(sc.info)}</p>` : ''}${readerText(sc.content)}`,
            copy: sc.content,
        })),
    ];
    if (code.length) tabs.code = { items: code };
    return tabs;
}

const readerNavHtml = (items) => items.map((it, i) => `
    <button type="button" class="reader-nav-item" data-index="${i}" aria-current="false">
        <span class="reader-nav-top">
            <span class="reader-nav-title">${escapeHtml(it.title)}</span>
            ${it.off || it.badges ? `<span class="reader-badges">${it.off ? OFF_BADGE : ''}${it.badges || ''}</span>` : ''}
        </span>
        ${it.sub ? `<span class="reader-nav-sub">${escapeHtml(it.sub)}</span>` : ''}
    </button>`).join('');

/**
 * Gắn trình đọc vào `tabsEl` (hàng tab) và `bodyEl` (khung nội dung).
 * Trả về { load(data), status(text, isError), clear() } — `data` là kết quả `readableCard()` của server.
 */
export function createReader({ tabsEl, bodyEl, onCopyFail = () => {} }) {
    let state = null; // { tabs, tab, index }
    let searchTimer = 0;

    function selectTab(key, focus = false) {
        state.tab = key;
        for (const tab of tabsEl.querySelectorAll('[role="tab"]')) {
            const on = tab.dataset.tab === key;
            tab.setAttribute('aria-selected', String(on));
            tab.tabIndex = on ? 0 : -1;
            if (on && focus) tab.focus();
        }
        const t = state.tabs[key];
        const search = t.searchable ? `
            <div class="search reader-search">
                <svg class="icon search-icon" aria-hidden="true"><use href="#i-search"/></svg>
                <label class="sr-only" for="reader-search">Tìm trong lorebook</label>
                <input id="reader-search" type="search" class="input search-input" autocomplete="off"
                       placeholder="Tìm tên, từ khoá, nội dung…">
            </div>
            <p class="rx-meta reader-summary" aria-live="polite">${escapeHtml(t.summary)}</p>` : '';
        bodyEl.innerHTML = `
            <div class="reader-split" role="tabpanel" id="reader-panel" aria-labelledby="reader-tab-${key}">
                <aside class="reader-side">
                    ${search}
                    <nav class="reader-nav" aria-label="Danh sách mục">${readerNavHtml(t.items)}</nav>
                    <p class="rx-meta reader-empty" hidden>Không có mục nào khớp.</p>
                </aside>
                <section class="reader-view" aria-label="Nội dung mục"></section>
            </div>`;
        $('#reader-search', bodyEl)?.addEventListener('input', () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(filter, 120);
        });
        selectItem(0, { show: false });
    }

    /** Hiện mục thứ `index` ở cột phải. `show` = trên điện thoại chuyển sang màn nội dung. */
    function selectItem(index, { show = true, focus = false } = {}) {
        const it = state.tabs[state.tab].items[index];
        const view = $('.reader-view', bodyEl);
        if (!it || !view) return;
        state.index = index;
        for (const btn of bodyEl.querySelectorAll('.reader-nav-item')) {
            const on = Number(btn.dataset.index) === index;
            btn.setAttribute('aria-current', String(on));
            if (on && focus) {
                btn.focus();
                btn.scrollIntoView({ block: 'nearest' });
            }
        }
        view.innerHTML = `
            <div class="reader-view-head">
                <button type="button" class="btn btn--sm reader-back" data-reader-back>${icon('i-arrow-left')}<span>Danh sách</span></button>
                <h3 class="reader-view-title">${escapeHtml(it.title)}</h3>
                <div class="reader-view-tools">
                    <span class="reader-badges">${it.head || ''}</span>
                    <button type="button" class="btn btn--sm" data-reader-copy aria-label="Copy nội dung ${escapeHtml(it.title)}">${icon('i-copy')}<span>Copy</span></button>
                </div>
            </div>
            <div class="reader-view-body">${it.body}</div>`;
        view.scrollTop = 0;
        $('.reader-split', bodyEl).classList.toggle('is-viewing', show);
    }

    function filter() {
        const t = state.tabs[state.tab];
        const q = $('#reader-search', bodyEl)?.value.trim().toLowerCase() || '';
        let shown = 0;
        let first = -1;
        for (const btn of bodyEl.querySelectorAll('.reader-nav-item')) {
            const i = Number(btn.dataset.index);
            btn.hidden = Boolean(q) && !t.items[i].search.includes(q);
            if (btn.hidden) continue;
            shown += 1;
            if (first < 0) first = i;
        }
        $('.reader-summary', bodyEl).textContent = q ? `Tìm thấy ${shown} / ${t.items.length} mục` : t.summary;
        $('.reader-empty', bodyEl).hidden = shown > 0;
        const current = bodyEl.querySelector(`.reader-nav-item[data-index="${state.index}"]`);
        if (first >= 0 && current?.hidden) selectItem(first, { show: false });
    }

    tabsEl.addEventListener('click', (e) => {
        const tab = e.target.closest('[role="tab"]');
        if (tab && state) selectTab(tab.dataset.tab);
    });
    tabsEl.addEventListener('keydown', (e) => {
        const tabs = [...tabsEl.querySelectorAll('[role="tab"]')];
        const i = tabs.indexOf(e.target.closest('[role="tab"]'));
        const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
        if (i < 0 || next == null) return;
        e.preventDefault();
        selectTab(tabs[(next + tabs.length) % tabs.length].dataset.tab, true);
    });

    bodyEl.addEventListener('click', async (e) => {
        const item = e.target.closest('.reader-nav-item');
        if (item) {
            selectItem(Number(item.dataset.index));
            return;
        }
        if (e.target.closest('[data-reader-back]')) {
            $('.reader-split', bodyEl)?.classList.remove('is-viewing');
            bodyEl.querySelector('.reader-nav-item[aria-current="true"]')?.focus();
            return;
        }
        const copy = e.target.closest('[data-reader-copy]');
        if (!copy || !state) return;
        const text = state.tabs[state.tab].items[state.index]?.copy ?? '';
        if (await copyText(text)) flashCopied(copy);
        else onCopyFail();
    });

    // Mũi tên lên/xuống trong danh sách để chuyển mục
    bodyEl.addEventListener('keydown', (e) => {
        if ((e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || !e.target.closest('.reader-nav-item')) return;
        const visible = [...bodyEl.querySelectorAll('.reader-nav-item:not([hidden])')];
        const next = visible[visible.indexOf(e.target.closest('.reader-nav-item')) + (e.key === 'ArrowDown' ? 1 : -1)];
        if (!next) return;
        e.preventDefault();
        selectItem(Number(next.dataset.index), { show: false, focus: true });
    });

    return {
        status(text, isError = false) {
            state = null;
            tabsEl.replaceChildren();
            bodyEl.innerHTML = `<p class="${isError ? 'field-error' : 'rx-meta'} reader-status">${escapeHtml(text)}</p>`;
        },
        load(data) {
            const tabs = readerTabsOf(data);
            const keys = READER_TABS.filter(([key]) => tabs[key]);
            if (!keys.length) {
                this.status('Card này không có nội dung để đọc.');
                return;
            }
            state = { tabs, tab: keys[0][0], index: 0 };
            tabsEl.innerHTML = keys.map(([key, ic, label]) => `
                <button type="button" role="tab" class="tab reader-tab" id="reader-tab-${key}" data-tab="${key}"
                        aria-controls="reader-panel" aria-selected="false" tabindex="-1">
                    ${icon(ic)}<span>${label}</span><span class="nav-count">${tabs[key].items.length}</span>
                </button>`).join('');
            selectTab(keys[0][0]);
        },
        clear() {
            clearTimeout(searchTimer);
            state = null;
            tabsEl.replaceChildren();
            bodyEl.replaceChildren();
        },
    };
}
