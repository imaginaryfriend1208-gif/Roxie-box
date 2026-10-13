// =============================================================================
// Roxbox — frontend (vanilla JS, không framework)
// =============================================================================

const DEFAULT_SAMPLE = 'Venom là con quái vật gay đĩ đượi nhất trái đất';
const VN_CHARS = [...'ăâđêôơưàảãáạằẳẵắặầẩẫấậèẻẽéẹềểễếệìỉĩíịòỏõóọồổỗốộờởỡớợùủũúụừửữứựỳỷỹýỵĂÂĐÊÔƠƯẠẶẬẸỆỊỌỘỢỤỰỴ'];
const CHARSET = 'AĂÂBCDĐEÊGHIKLMNOÔƠPQRSTUƯVXY aăâbcdđeêghiklmnoôơpqrstuưvxy 0123456789 àáảãạ ềếểễệ ờớởỡợ ừứửữự !?&@';
const MAX_PARALLEL_UPLOADS = 3;

const CATS = {
    all: { label: 'Tất cả', title: 'Tất cả file', noun: 'file' },
    image: { label: 'Ảnh', title: 'Thư viện ảnh', noun: 'ảnh' },
    font: { label: 'Font', title: 'Bộ sưu tập font', noun: 'font' },
    card: { label: 'Card', title: 'Character card', noun: 'card' },
    file: { label: 'File', title: 'File khác', noun: 'file' },
};

const KIND_ICON = {
    image: 'i-image', font: 'i-type', card: 'i-id-card', video: 'i-film', audio: 'i-music',
    archive: 'i-archive', doc: 'i-file-text', other: 'i-file',
};

const store = {
    get(key, fallback) {
        try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
    },
    set(key, value) {
        try { localStorage.setItem(key, value); } catch { /* bỏ qua */ }
    },
};

const state = {
    config: null,
    user: null,
    files: [],
    category: 'all',
    query: '',
    sort: store.get('rx.sort', 'new'),
    view: store.get('rx.view', 'grid'),
    sample: store.get('rx.sample', DEFAULT_SAMPLE),
    fontSize: Number(store.get('rx.fontSize', 28)) || 28,
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const el = {
    authView: $('#auth-view'),
    appView: $('#app-view'),
    authForm: $('#auth-form'),
    authUser: $('#auth-username'),
    authPass: $('#auth-password'),
    authUserErr: $('#auth-username-error'),
    authPassErr: $('#auth-password-error'),
    authUserHint: $('#auth-username-hint'),
    authPassHint: $('#auth-password-hint'),
    authError: $('#auth-error'),
    authSubmit: $('#auth-submit'),
    togglePass: $('#toggle-password'),
    tabs: $$('.tab'),

    userAvatar: $('#user-avatar'),
    userName: $('#user-name'),
    navItems: $$('.nav-item'),
    storageTotal: $('#storage-total'),
    storageMeter: $('#storage-meter'),
    storageLegend: $('#storage-legend'),
    logoutBtn: $('#logout-btn'),

    main: $('#main'),
    search: $('#search-input'),
    sort: $('#sort-select'),
    viewBtns: $$('[data-view]'),
    uploadBtn: $('#upload-btn'),
    fileInput: $('#file-input'),
    dropTarget: $('#dropzone-target'),
    queue: $('#queue'),
    queueList: $('#queue-list'),
    queueCopyAll: $('#queue-copy-all'),
    queueClear: $('#queue-clear'),

    sectionTitle: $('#section-title'),
    sectionMeta: $('#section-meta'),
    fontTools: $('#font-tools'),
    sampleInput: $('#sample-input'),
    sizeRange: $('#size-range'),
    sizeOut: $('#size-out'),
    sampleReset: $('#sample-reset'),
    grid: $('#file-grid'),
    empty: $('#empty-state'),
    emptyTitle: $('#empty-title'),
    emptyText: $('#empty-text'),
    emptyAction: $('#empty-action'),

    detail: $('#detail-dialog'),
    detailTitle: $('#detail-title'),
    detailPreview: $('#detail-preview'),
    renameForm: $('#rename-form'),
    detailName: $('#detail-name'),
    renameSubmit: $('#rename-submit'),
    detailLink: $('#detail-link'),
    detailCopy: $('#detail-copy'),
    detailMeta: $('#detail-meta'),
    detailEmbeds: $('#detail-embeds'),
    detailOpen: $('#detail-open'),
    detailDownload: $('#detail-download'),
    detailDelete: $('#detail-delete'),
    detailRead: $('#detail-read'),

    reader: $('#reader-dialog'),
    readerTitle: $('#reader-title'),
    readerTabs: $('#reader-tabs'),
    readerBody: $('#reader-body'),

    confirm: $('#confirm-dialog'),
    confirmText: $('#confirm-text'),

    dropOverlay: $('#drop-overlay'),
    toasts: $('#toast-container'),
};

// =============================================================================
// Tiện ích
// =============================================================================

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
const icon = (id) => `<svg class="icon" aria-hidden="true"><use href="#${id}"/></svg>`;

function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let value = bytes / 1024;
    let i = 0;
    while (value >= 1024 && i < units.length - 1) {
        value /= 1024;
        i += 1;
    }
    const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
    return `${value.toFixed(digits).replace('.', ',')} ${units[i]}`;
}

const rtf = new Intl.RelativeTimeFormat('vi', { numeric: 'auto' });
const TIME_STEPS = [
    [3600, 'minute', 60],
    [86400, 'hour', 3600],
    [604800, 'day', 86400],
    [2629800, 'week', 604800],
    [31557600, 'month', 2629800],
    [Infinity, 'year', 31557600],
];

function timeAgo(ts) {
    const diff = (ts - Date.now()) / 1000;
    if (Math.abs(diff) < 45) return 'vừa xong';
    for (const [limit, unit, div] of TIME_STEPS) {
        if (Math.abs(diff) < limit) return rtf.format(Math.round(diff / div), unit);
    }
    return '';
}

const formatDate = (ts) => new Date(ts).toLocaleString('vi-VN', { dateStyle: 'medium', timeStyle: 'short' });

/** Bỏ dấu tiếng Việt để tìm kiếm không phân biệt dấu. */
const normalize = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');

function fileKind(f) {
    if (f.category === 'image' || f.category === 'font' || f.category === 'card') return f.category;
    if (f.mime.startsWith('video/')) return 'video';
    if (f.mime.startsWith('audio/')) return 'audio';
    if (['zip', 'rar', '7z', 'gz', 'tar'].includes(f.ext)) return 'archive';
    if (f.mime.startsWith('text/') || ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'json'].includes(f.ext)) return 'doc';
    return 'other';
}

const linkOf = (f) => `${state.config.publicUrl || location.origin}${f.url}`;
const findFile = (id) => state.files.find((f) => f.id === id);

async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch(path, {
        method,
        credentials: 'same-origin',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
    });
    let data = {};
    try { data = await res.json(); } catch { /* không có body JSON */ }
    if (!res.ok) {
        const err = new Error(data.error || `Lỗi ${res.status}`);
        err.status = res.status;
        err.fields = data.fields;
        throw err;
    }
    return data;
}

async function copyText(text) {
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch { /* thử cách dự phòng */ }
    // Dự phòng khi chạy qua http thường (không có Clipboard API)
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.className = 'sr-only';
    (document.querySelector('dialog[open]') || document.body).append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
}

function flashCopied(btn) {
    if (!btn) return;
    const label = btn.querySelector('span');
    if (label && !btn.dataset.label) btn.dataset.label = label.textContent;
    btn.classList.add('is-copied');
    if (label) label.textContent = 'Đã copy';
    clearTimeout(btn.copyTimer);
    btn.copyTimer = setTimeout(() => {
        btn.classList.remove('is-copied');
        if (label) label.textContent = btn.dataset.label;
    }, 1600);
}

async function copyLink(f, btn) {
    const link = linkOf(f);
    if (await copyText(link)) {
        flashCopied(btn);
        toast('success', 'Đã copy link', link);
    } else {
        toast('error', 'Không copy được', `Hãy copy thủ công: ${link}`);
    }
}

// =============================================================================
// Toast + dialog
// =============================================================================

function raiseToasts() {
    const box = el.toasts;
    if (typeof box.showPopover !== 'function') return;
    try {
        if (box.matches(':popover-open')) box.hidePopover();
        box.showPopover();
    } catch { /* trình duyệt cũ */ }
}

function toast(type, title, message = '', timeout = 3500) {
    const node = document.createElement('div');
    node.className = `toast toast-${type}`;
    node.innerHTML = `<div class="toast-title">${escapeHtml(title)}</div>${
        message ? `<p class="toast-message">${escapeHtml(message)}</p>` : ''}`;
    if (typeof el.toasts.showPopover === 'function' && !el.toasts.matches(':popover-open')) raiseToasts();
    el.toasts.append(node);
    while (el.toasts.children.length > 4) el.toasts.firstElementChild.remove();

    const close = () => {
        if (node.classList.contains('is-leaving')) return;
        node.classList.add('is-leaving');
        setTimeout(() => node.remove(), 260);
    };
    setTimeout(close, type === 'error' ? 6000 : timeout);
    node.addEventListener('click', close);
}

function openDialog(dialog) {
    dialog.showModal();
    raiseToasts();
}

function handleError(err) {
    if (err.status === 401 && state.user) {
        toast('warning', 'Phiên đăng nhập đã hết hạn', 'Vui lòng đăng nhập lại.');
        showAuth();
        return;
    }
    toast('error', 'Có lỗi xảy ra', err.message || String(err));
}

function confirmDialog(text) {
    return new Promise((resolve) => {
        el.confirmText.textContent = text;
        el.confirm.returnValue = '';
        el.confirm.addEventListener('close', () => resolve(el.confirm.returnValue === 'ok'), { once: true });
        openDialog(el.confirm);
    });
}

// Bấm ra ngoài vùng dialog (backdrop) để đóng
for (const dialog of [el.detail, el.reader, el.confirm]) {
    dialog.addEventListener('click', (e) => {
        if (e.target === dialog) dialog.close();
    });
}
for (const dialog of [el.detail, el.reader]) {
    dialog.addEventListener('click', (e) => {
        if (e.target.closest('[data-close]')) dialog.close();
    });
}

// =============================================================================
// Đăng nhập / đăng ký
// =============================================================================

let authMode = 'login';
const USERNAME_RE = /^[a-zA-Z0-9_.-]+$/;

function setFieldError(input, errEl, message) {
    errEl.textContent = message || '';
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
}

function setAuthMode(mode) {
    authMode = mode;
    const register = mode === 'register';
    for (const tab of el.tabs) {
        const active = tab.dataset.mode === mode;
        tab.setAttribute('aria-selected', String(active));
        tab.tabIndex = active ? 0 : -1;
    }
    $$('[data-register-only]').forEach((node) => { node.hidden = !register; });
    el.authPass.autocomplete = register ? 'new-password' : 'current-password';
    el.authSubmit.querySelector('span').textContent = register ? 'Tạo tài khoản' : 'Đăng nhập';
    setFieldError(el.authUser, el.authUserErr, '');
    setFieldError(el.authPass, el.authPassErr, '');
    el.authError.textContent = '';
}

function validateRegister(field) {
    const min = state.config.minCredentialLength;
    const username = el.authUser.value.trim();
    const password = el.authPass.value;
    let ok = true;
    if (!field || field === 'username') {
        let msg = '';
        if ([...username].length < min) msg = `Username phải có ít nhất ${min} ký tự (hiện có ${[...username].length}).`;
        else if (!USERNAME_RE.test(username)) msg = 'Username chỉ gồm chữ không dấu, số và các ký tự _ . -';
        setFieldError(el.authUser, el.authUserErr, msg);
        ok = ok && !msg;
    }
    if (!field || field === 'password') {
        const msg = [...password].length < min ? `Mật khẩu phải có ít nhất ${min} ký tự (hiện có ${[...password].length}).` : '';
        setFieldError(el.authPass, el.authPassErr, msg);
        ok = ok && !msg;
    }
    return ok;
}

for (const tab of el.tabs) {
    tab.addEventListener('click', () => setAuthMode(tab.dataset.mode));
    tab.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        const next = el.tabs.find((t) => t !== tab);
        setAuthMode(next.dataset.mode);
        next.focus();
    });
}

el.authUser.addEventListener('blur', () => {
    if (authMode === 'register' && el.authUser.value) validateRegister('username');
});
el.authPass.addEventListener('blur', () => {
    if (authMode === 'register' && el.authPass.value) validateRegister('password');
});

el.togglePass.addEventListener('click', () => {
    const show = el.authPass.type === 'password';
    el.authPass.type = show ? 'text' : 'password';
    el.togglePass.setAttribute('aria-pressed', String(show));
    el.togglePass.setAttribute('aria-label', show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu');
    el.togglePass.querySelector('use').setAttribute('href', show ? '#i-eye-off' : '#i-eye');
});

el.authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    el.authError.textContent = '';
    const username = el.authUser.value.trim();
    const password = el.authPass.value;

    if (authMode === 'register') {
        if (!validateRegister()) {
            (el.authUser.getAttribute('aria-invalid') === 'true' ? el.authUser : el.authPass).focus();
            return;
        }
    } else if (!username || !password) {
        el.authError.textContent = 'Vui lòng nhập username và mật khẩu.';
        (username ? el.authPass : el.authUser).focus();
        return;
    }

    el.authSubmit.disabled = true;
    el.authSubmit.classList.add('is-loading');
    try {
        const { user } = await api(`/api/${authMode}`, { method: 'POST', body: { username, password } });
        state.user = user;
        el.authForm.reset();
        toast('success', authMode === 'register' ? 'Tạo tài khoản thành công' : 'Đăng nhập thành công', `Xin chào, ${user.username}!`);
        await enterApp();
    } catch (err) {
        if (err.fields) {
            if (err.fields.username) setFieldError(el.authUser, el.authUserErr, err.fields.username);
            if (err.fields.password) setFieldError(el.authPass, el.authPassErr, err.fields.password);
            (err.fields.username ? el.authUser : el.authPass).focus();
        } else {
            el.authError.textContent = err.message;
        }
    } finally {
        el.authSubmit.disabled = false;
        el.authSubmit.classList.remove('is-loading');
    }
});

function showAuth() {
    state.user = null;
    state.files = [];
    el.appView.hidden = true;
    el.authView.hidden = false;
    el.queueList.replaceChildren();
    el.queue.hidden = true;
    for (const dialog of [el.detail, el.confirm]) if (dialog.open) dialog.close();
    setAuthMode('login');
    el.authUser.focus();
}

el.logoutBtn.addEventListener('click', async () => {
    flushPrefs();
    try {
        await api('/api/logout', { method: 'POST' });
    } catch { /* vẫn thoát ở phía trình duyệt */ }
    showAuth();
    toast('info', 'Đã đăng xuất');
});

// =============================================================================
// App
// =============================================================================

async function enterApp() {
    el.authView.hidden = true;
    el.appView.hidden = false;
    const u = state.user;
    el.userName.textContent = u.username;
    el.userAvatar.textContent = (u.username[0] || '?').toUpperCase();
    applyPrefs(u.prefs);
    applyRoute();
    try {
        const { files } = await api('/api/files');
        state.files = files;
        render();
    } catch (err) {
        handleError(err);
    }
}

function applyRoute() {
    const cat = location.hash.replace(/^#\/?/, '');
    state.category = CATS[cat] ? cat : 'all';
    render();
}
window.addEventListener('hashchange', () => {
    if (!state.user) return;
    applyRoute();
    el.main.focus({ preventScroll: true });
});

function visibleFiles(category = state.category) {
    const squash = (s) => s.replace(/[\s_.-]+/g, '');
    const terms = normalize(state.query).split(/[\s_.-]+/).filter(Boolean);
    const joined = terms.join('');
    const list = state.files.filter((f) => {
        if (category !== 'all' && f.category !== category) return false;
        if (!terms.length) return true;
        // Tách tên theo chữ hoa (BeVietnamPro -> Be Vietnam Pro) để tìm từng từ cũng ra
        const c = f.card;
        const extra = c ? ` ${c.name} ${c.creator} ${c.tags.join(' ')}` : '';
        const hay = normalize(`${f.name.replace(/([a-z])([A-Z])/g, '$1 $2')} ${f.ext} ${f.id}${extra}`);
        // "be vietnam" hoặc "bevietnam" đều khớp "BeVietnamPro-Bold.ttf"
        return terms.every((t) => hay.includes(t)) || squash(hay).includes(joined);
    });
    const sorters = {
        new: (a, b) => b.createdAt - a.createdAt,
        old: (a, b) => a.createdAt - b.createdAt,
        name: (a, b) => a.name.localeCompare(b.name, 'vi', { numeric: true, sensitivity: 'base' }),
        size: (a, b) => b.size - a.size,
    };
    return list.sort(sorters[state.sort] || sorters.new);
}

function render() {
    if (!state.user) return;
    renderSidebar();
    renderLibrary();
}

const STORAGE_CATS = ['image', 'font', 'card', 'file'];

function renderSidebar() {
    const counts = { all: state.files.length, image: 0, font: 0, card: 0, file: 0 };
    const sizes = { image: 0, font: 0, card: 0, file: 0 };
    for (const f of state.files) {
        counts[f.category] += 1;
        sizes[f.category] += f.size;
    }
    for (const item of el.navItems) {
        const cat = item.dataset.cat;
        item.querySelector('.nav-count').textContent = counts[cat];
        if (cat === state.category) item.setAttribute('aria-current', 'page');
        else item.removeAttribute('aria-current');
    }
    const total = STORAGE_CATS.reduce((sum, cat) => sum + sizes[cat], 0);
    el.storageTotal.textContent = formatSize(total);
    for (const cat of STORAGE_CATS) {
        const seg = $(`.meter-seg--${cat}`, el.storageMeter);
        seg.style.width = total ? `${(sizes[cat] / total) * 100}%` : '0';
    }
    el.storageLegend.innerHTML = STORAGE_CATS.map((cat) => `
        <li><span class="legend-dot legend-dot--${cat}" aria-hidden="true"></span>${CATS[cat].label}
        <span class="legend-size">${counts[cat]} · ${formatSize(sizes[cat])}</span></li>`).join('');
}

function renderLibrary() {
    const cat = CATS[state.category];
    const list = visibleFiles();
    const query = state.query.trim();

    el.sectionTitle.textContent = cat.title;
    document.title = `${cat.title} · ${state.config.siteName}`;
    const totalSize = list.reduce((sum, f) => sum + f.size, 0);
    el.sectionMeta.textContent = query
        ? `Tìm thấy ${list.length} kết quả cho “${query}”`
        : `${list.length} ${cat.noun} · ${formatSize(totalSize)}`;

    const hasFonts = list.some((f) => f.category === 'font');
    el.fontTools.hidden = !(state.category === 'font' ? state.files.some((f) => f.category === 'font') : hasFonts);

    el.grid.classList.toggle('is-list', state.view === 'list');
    el.grid.innerHTML = list.map(cardHtml).join('');
    for (const preview of $$('.card--font .card-preview', el.grid)) setupFontPreview(preview);

    renderEmpty(list, query);
}

function renderEmpty(list, query) {
    el.empty.hidden = list.length > 0;
    if (list.length) return;
    const cat = CATS[state.category];
    let action;
    if (query) {
        const elsewhere = state.category !== 'all' ? visibleFiles('all').length : 0;
        el.emptyTitle.textContent = `Không tìm thấy “${query}”`;
        if (elsewhere) {
            el.emptyText.textContent = `Có ${elsewhere} kết quả ở thư mục khác.`;
            action = ['Xem trong Tất cả', () => { location.hash = '#/all'; }];
        } else {
            el.emptyText.textContent = 'Thử từ khoá ngắn hơn, tìm theo đuôi file (vd: png, ttf) hoặc theo mã link.';
            action = ['Xoá tìm kiếm', () => { setQuery(''); el.search.focus(); }];
        }
    } else if (!state.files.length) {
        el.emptyTitle.textContent = 'Chưa có file nào';
        el.emptyText.textContent = 'Kéo thả file vào khung phía trên, dán ảnh bằng Ctrl + V hoặc bấm Upload. Ảnh, font, character card và file sẽ tự được xếp vào đúng thư mục.';
        action = ['Chọn file để upload', () => el.fileInput.click()];
    } else {
        el.emptyTitle.textContent = `Thư mục ${cat.label} đang trống`;
        el.emptyText.textContent = `Upload ${cat.noun} là nó sẽ tự xuất hiện ở đây.`;
        action = ['Upload ngay', () => el.fileInput.click()];
    }
    el.emptyAction.textContent = action[0];
    el.emptyAction.onclick = action[1];
}

function fontLines(text) {
    const t = escapeHtml(text || DEFAULT_SAMPLE);
    return `<span class="fp-line fp-line--lg">${t}</span><span class="fp-line fp-line--md">${t}</span><span class="fp-line fp-line--sm">${t}</span>`;
}

function cardHtml(f) {
    const kind = fileKind(f);
    const name = escapeHtml(f.name);
    const url = escapeHtml(f.url);
    if (kind === 'font') return fontCardHtml(f, name, url);
    if (kind === 'card') return charCardHtml(f, name, url);
    let preview;
    if (kind === 'image') {
        preview = `<button type="button" class="card-preview" data-action="open" aria-label="Xem ${name}">
            <img src="${url}" alt="" loading="lazy" decoding="async"></button>`;
    } else {
        preview = `<button type="button" class="card-preview card-preview--icon" data-action="open" aria-label="Xem ${name}">
            ${icon(KIND_ICON[kind])}<span class="ext-label">${escapeHtml(f.ext || 'file')}</span></button>`;
    }
    return `
    <article class="card" data-id="${f.id}">
        ${preview}
        <div class="card-body">
            <div class="card-name" title="${name}">${name}</div>
            <div class="card-meta">
                <span class="badge">${escapeHtml(f.ext || '—')}</span>
                <span>${formatSize(f.size)}</span><span aria-hidden="true">·</span>
                <time datetime="${new Date(f.createdAt).toISOString()}" title="${formatDate(f.createdAt)}">${timeAgo(f.createdAt)}</time>
            </div>
        </div>
        <div class="card-actions">
            <button type="button" class="btn btn--sm btn-copy" data-action="copy" aria-label="Copy link ${name}">${icon('i-copy')}<span>Copy link</span></button>
            <a class="icon-btn" href="${url}" target="_blank" rel="noopener" aria-label="Mở ${name} trong tab mới">${icon('i-external')}</a>
            <a class="icon-btn" href="${url}?download" download aria-label="Tải ${name}">${icon('i-download')}</a>
            <button type="button" class="icon-btn icon-btn--danger" data-action="delete" aria-label="Xoá ${name}">${icon('i-trash')}</button>
        </div>
    </article>`;
}

/** Ô font vuông kiểu Google Fonts: tên + nhãn tiếng Việt, ô xem trước, copy link / tải / chi tiết. */
function fontCardHtml(f, name, url) {
    return `
    <article class="card card--font" data-id="${f.id}">
        <div class="card-body">
            <div class="card-name" title="${name}">${escapeHtml(fontDisplayName(f.name))}</div>
            <div class="card-meta">
                ${vnBadgeHtml(f.id)}
                <span class="badge">${escapeHtml(f.ext || '—')}</span>
            </div>
        </div>
        <div class="card-preview" data-action="open" data-font-id="${f.id}" data-font-state="loading">${fontLines(state.sample)}</div>
        <div class="card-actions">
            <button type="button" class="btn btn--sm btn-copy" data-action="copy" aria-label="Copy link ${name}">${icon('i-copy')}<span>Copy link</span></button>
            <a class="icon-btn" href="${url}?download" download aria-label="Tải ${name}" title="Tải xuống">${icon('i-download')}</a>
            <button type="button" class="icon-btn" data-action="open" aria-label="Xem chi tiết ${name}" title="Chi tiết">${icon('i-eye')}</button>
        </div>
    </article>`;
}

const CARD_COUNT_LABELS = [
    ['lorebook', 'i-book', 'mục lorebook'],
    ['regex', 'i-regex', 'regex'],
    ['script', 'i-code', 'script'],
    ['greetings', 'i-message', 'lời chào'],
    ['image', 'i-image', 'ảnh nhúng'],
];

function cardCountsHtml(counts) {
    return CARD_COUNT_LABELS.filter(([key]) => counts[key]).map(([key, ic, label]) =>
        `<span class="badge" title="${counts[key]} ${label}">${icon(ic)}${counts[key]}<span class="sr-only"> ${label}</span></span>`).join('');
}

/** Thẻ character card: ảnh dọc kiểu chân dung, tên + người tạo, số mục nhúng, copy link / tải / chi tiết. */
function charCardHtml(f, name, url) {
    const c = f.card;
    const png = f.ext === 'png';
    const preview = png
        ? `<img src="${url}" alt="" loading="lazy" decoding="async">`
        : `${icon('i-id-card')}<span class="ext-label">json</span>`;
    const creator = c.creator ? `<span class="char-creator">${escapeHtml(c.creator)}</span><span aria-hidden="true">·</span>` : '';
    return `
    <article class="card card--char" data-id="${f.id}">
        <button type="button" class="card-preview${png ? '' : ' card-preview--icon'}" data-action="open" aria-label="Xem nội dung card ${escapeHtml(c.name)}">
            ${preview}
            <span class="badge char-spec">${escapeHtml(c.spec)}</span>
        </button>
        <div class="card-body">
            <div class="card-name" title="${name}">${escapeHtml(c.name)}</div>
            <div class="card-meta">${creator}<span>${formatSize(f.size)}</span></div>
            <div class="card-meta char-counts">${cardCountsHtml(c.counts) || '<span>Không có nội dung nhúng</span>'}</div>
        </div>
        <div class="card-actions">
            <button type="button" class="btn btn--sm btn-copy" data-action="copy" aria-label="Copy link ${name}">${icon('i-copy')}<span>Copy link</span></button>
            <a class="icon-btn" href="${url}?download" download aria-label="Tải card ${name}" title="Tải card">${icon('i-download')}</a>
            <button type="button" class="icon-btn" data-action="read" aria-label="Đọc nội dung card ${name}" title="Đọc card">${icon('i-book')}</button>
            <button type="button" class="icon-btn" data-action="open" aria-label="Xem nội dung nhúng của ${name}" title="Nội dung nhúng">${icon('i-eye')}</button>
        </div>
    </article>`;
}

/** "BeVietnamPro-Bold.ttf" -> "BeVietnamPro Bold": bỏ đuôi, đổi - _ thành khoảng trắng cho dễ đọc. */
const fontDisplayName = (name) => name.replace(/\.(ttf|otf|woff2?)$/i, '').replace(/[-_]+/g, ' ').trim() || name;

el.grid.addEventListener('click', (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const f = findFile(target.closest('.card')?.dataset.id);
    if (!f) return;
    const action = target.dataset.action;
    if (action === 'copy') copyLink(f, target);
    else if (action === 'open') openDetail(f);
    else if (action === 'read') openReader(f);
    else if (action === 'delete') deleteFile(f);
});

// =============================================================================
// Font: nạp lười + kiểm tra tiếng Việt
// =============================================================================

const fontJobs = new Map();   // id -> Promise<{ family, vn }>
const fontReady = new Map();  // id -> { family, vn } | null (lỗi)
const measureCtx = document.createElement('canvas').getContext('2d');

/**
 * Font thiếu ký tự sẽ bị trình duyệt thay bằng font dự phòng.
 * Đo cùng 1 ký tự với 2 font dự phòng khác nhau: nếu độ rộng khác nhau => font không có ký tự đó.
 */
function checkVietnamese(family) {
    const missing = [];
    for (const ch of VN_CHARS) {
        measureCtx.font = `40px "${family}", monospace`;
        const a = measureCtx.measureText(ch).width;
        measureCtx.font = `40px "${family}", serif`;
        const b = measureCtx.measureText(ch).width;
        if (Math.abs(a - b) > 0.05) missing.push(ch);
    }
    return { total: VN_CHARS.length, missing };
}

function loadFont(f) {
    if (!fontJobs.has(f.id)) {
        const family = `rxf-${f.id}`;
        const job = new FontFace(family, `url("${f.url}")`).load()
            .then((face) => {
                document.fonts.add(face);
                const result = { family, vn: checkVietnamese(family) };
                fontReady.set(f.id, result);
                return result;
            })
            .catch((err) => {
                fontReady.set(f.id, null);
                throw err;
            });
        fontJobs.set(f.id, job);
    }
    return fontJobs.get(f.id);
}

const fontFamilyCss = (family) => `"${family}", "Courier New", monospace`;

function applyFontTo(node, id) {
    const ready = fontReady.get(id);
    if (ready) {
        node.style.fontFamily = fontFamilyCss(ready.family);
        node.dataset.fontState = 'ready';
    } else if (ready === null) {
        node.dataset.fontState = 'error';
    }
}

const fontObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        fontObserver.unobserve(entry.target);
        const f = findFile(entry.target.dataset.fontId);
        if (!f) continue;
        loadFont(f).then(
            () => { applyFontTo(entry.target, f.id); updateVnBadges(f.id); },
            () => { applyFontTo(entry.target, f.id); updateVnBadges(f.id); },
        );
    }
}, { rootMargin: '240px' });

function setupFontPreview(node) {
    if (fontReady.has(node.dataset.fontId)) applyFontTo(node, node.dataset.fontId);
    else fontObserver.observe(node);
}

function vnBadgeHtml(id) {
    if (!fontReady.has(id)) return `<span class="badge badge--muted" data-vn-badge="${id}">Đang kiểm tra…</span>`;
    const ready = fontReady.get(id);
    if (!ready) return `<span class="badge badge--error" data-vn-badge="${id}">${icon('i-alert')}Font lỗi</span>`;
    const { total, missing } = ready.vn;
    if (!missing.length) {
        return `<span class="badge badge--success" data-vn-badge="${id}" title="Có đủ ${total} ký tự tiếng Việt kiểm tra">${icon('i-check')}Tiếng Việt</span>`;
    }
    if (missing.length >= total) {
        return `<span class="badge badge--error" data-vn-badge="${id}" title="Font không có ký tự tiếng Việt có dấu">${icon('i-x')}Không có tiếng Việt</span>`;
    }
    return `<span class="badge" data-vn-badge="${id}" title="Thiếu: ${escapeHtml(missing.join(' '))}">${icon('i-alert')}Thiếu ${missing.length}/${total} ký tự</span>`;
}

function updateVnBadges(id) {
    for (const node of $$(`[data-vn-badge="${id}"]`)) node.outerHTML = vnBadgeHtml(id);
}

// Tuỳ chọn giao diện: lưu theo tài khoản trên server, localStorage chỉ giữ bản của lần dùng gần nhất
const PREF_KEYS = ['sort', 'view', 'sample', 'fontSize'];
let pendingPrefs = {};
let prefTimer;

function savePref(key, value) {
    state[key] = value;
    store.set(`rx.${key}`, value);
    if (!state.user) return;
    pendingPrefs[key] = value;
    clearTimeout(prefTimer);
    prefTimer = setTimeout(flushPrefs, 400);
}

function flushPrefs() {
    clearTimeout(prefTimer);
    const body = pendingPrefs;
    if (!Object.keys(body).length) return;
    pendingPrefs = {};
    // keepalive: vẫn gửi được khi đóng tab / đăng xuất ngay sau khi đổi
    fetch('/api/prefs', {
        method: 'PATCH', credentials: 'same-origin', keepalive: true,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).then((res) => { if (!res.ok) throw new Error(); }).catch(() => {
        pendingPrefs = { ...body, ...pendingPrefs }; // gửi lại ở lần thay đổi sau
    });
}

/** Áp tuỳ chọn của tài khoản; tài khoản chưa có thì lấy theo trình duyệt này và lưu lên server. */
function applyPrefs(prefs = {}) {
    const saved = PREF_KEYS.filter((key) => key in prefs);
    if (!saved.length) {
        pendingPrefs = Object.fromEntries(PREF_KEYS.map((key) => [key, state[key]]));
        flushPrefs();
    }
    for (const key of saved) {
        state[key] = prefs[key];
        store.set(`rx.${key}`, prefs[key]);
    }
    syncPrefControls();
}

function syncPrefControls() {
    el.sort.value = state.sort;
    el.sampleInput.value = state.sample;
    applyView();
    applyFontSize();
}

window.addEventListener('pagehide', flushPrefs);

// Công cụ câu mẫu + cỡ chữ
function applyFontSize() {
    el.grid.style.setProperty('--fp-size', `${state.fontSize}px`);
    el.sizeRange.value = state.fontSize;
    el.sizeOut.textContent = `${state.fontSize}px`;
}

function updateSamples() {
    for (const node of $$('.card--font .card-preview', el.grid)) node.innerHTML = fontLines(state.sample);
}

el.sampleInput.addEventListener('input', () => {
    savePref('sample', el.sampleInput.value || DEFAULT_SAMPLE);
    updateSamples();
});
el.sampleReset.addEventListener('click', () => {
    el.sampleInput.value = DEFAULT_SAMPLE;
    savePref('sample', DEFAULT_SAMPLE);
    updateSamples();
});
el.sizeRange.addEventListener('input', () => {
    savePref('fontSize', Number(el.sizeRange.value));
    applyFontSize();
});

// =============================================================================
// Toolbar: tìm kiếm, sắp xếp, kiểu hiển thị
// =============================================================================

let searchTimer;
function setQuery(value) {
    state.query = value;
    el.search.value = value;
    renderLibrary();
}

el.search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
        state.query = el.search.value;
        renderLibrary();
    }, 80);
});
el.search.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (el.search.value) setQuery('');
    else el.search.blur();
});

el.sort.addEventListener('change', () => {
    savePref('sort', el.sort.value);
    renderLibrary();
});

function applyView() {
    for (const btn of el.viewBtns) btn.setAttribute('aria-pressed', String(btn.dataset.view === state.view));
}
for (const btn of el.viewBtns) {
    btn.addEventListener('click', () => {
        savePref('view', btn.dataset.view);
        applyView();
        renderLibrary();
    });
}

document.addEventListener('keydown', (e) => {
    if (el.appView.hidden || document.querySelector('dialog[open]')) return;
    const typing = e.target.closest?.('input, textarea, select, [contenteditable="true"]');
    const isSlash = e.key === '/' && !typing;
    const isCtrlK = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k';
    if (isSlash || isCtrlK) {
        e.preventDefault();
        el.search.focus();
        el.search.select();
    }
});

// =============================================================================
// Chi tiết file
// =============================================================================

let detailFile = null;

function openDetail(f) {
    detailFile = f;
    const kind = fileKind(f);
    const url = escapeHtml(f.url);
    const name = escapeHtml(f.name);
    el.detailTitle.textContent = { image: 'Chi tiết ảnh', font: 'Chi tiết font', card: 'Character card' }[kind] || 'Chi tiết file';
    el.detail.classList.toggle('detail--card', kind === 'card');
    el.detailEmbeds.hidden = kind !== 'card';
    el.detailRead.hidden = kind !== 'card';
    el.detailEmbeds.replaceChildren();
    if (kind === 'card') loadEmbeds(f);

    if (kind === 'image' || (kind === 'card' && f.ext === 'png')) {
        el.detailPreview.innerHTML = `<img src="${url}" alt="${name}">`;
    } else if (kind === 'video') {
        el.detailPreview.innerHTML = `<video src="${url}" controls preload="metadata" playsinline></video>`;
    } else if (kind === 'audio') {
        el.detailPreview.innerHTML = `<audio src="${url}" controls preload="metadata"></audio>`;
    } else if (kind === 'font') {
        const t = escapeHtml(state.sample);
        el.detailPreview.innerHTML = `
            <div class="detail-font" data-font-state="loading">
                <span class="df-48">${t}</span>
                <span class="df-32">${t}</span>
                <span class="df-20">${t}</span>
                <span class="df-chars">${escapeHtml(CHARSET)}</span>
            </div>`;
        const node = $('.detail-font', el.detailPreview);
        loadFont(f).finally(() => {
            if (detailFile?.id !== f.id) return;
            applyFontTo(node, f.id);
            updateVnBadges(f.id);
        }).catch(() => {});
    } else {
        el.detailPreview.innerHTML = `<div class="card-preview card-preview--icon">${icon(KIND_ICON[kind])}
            <span class="ext-label">${escapeHtml(f.ext || 'file')}</span>
            <span class="rx-meta">Không có xem trước — bấm “Mở” để xem</span></div>`;
    }

    el.detailName.value = f.name;
    el.detailLink.value = linkOf(f);
    el.detailOpen.href = f.url;
    el.detailDownload.href = `${f.url}?download`;
    el.detailDownload.setAttribute('download', '');
    el.detailMeta.innerHTML = `
        <dt>Thư mục</dt><dd>${CATS[f.category].label}</dd>
        <dt>Định dạng</dt><dd>${escapeHtml(f.ext ? f.ext.toUpperCase() : 'Không rõ')} <span class="rx-meta">(${escapeHtml(f.mime)})</span></dd>
        <dt>Dung lượng</dt><dd>${formatSize(f.size)} <span class="rx-meta">(${f.size.toLocaleString('vi-VN')} byte)</span></dd>
        <dt>Upload lúc</dt><dd>${formatDate(f.createdAt)}</dd>
        ${kind === 'card' ? cardMetaHtml(f.card) : ''}
        <dt>Mã link</dt><dd class="mono">${f.id}</dd>
        ${kind === 'font' ? `<dt>Tiếng Việt</dt><dd>${vnBadgeHtml(f.id)}</dd>` : ''}`;

    openDialog(el.detail);
    el.detailCopy.focus();
}

el.detail.addEventListener('close', () => {
    el.detailPreview.replaceChildren(); // dừng video/audio
    el.detailEmbeds.replaceChildren();
    detailFile = null;
});

// =============================================================================
// Character card: nội dung nhúng (lorebook, regex, script, lời chào, ảnh…)
// =============================================================================

const EMBED_GROUPS = [
    ['card', 'i-braces', 'Dữ liệu card'],
    ['image', 'i-image', 'Ảnh'],
    ['lorebook', 'i-book', 'Lorebook (World Info)'],
    ['regex', 'i-regex', 'Regex'],
    ['script', 'i-code', 'Script (Tavern Helper)'],
    ['text', 'i-message', 'Lời chào & ghi chú'],
];

function cardMetaHtml(c) {
    const tags = c.tags.map((t) => `<span class="badge badge--muted">${escapeHtml(t)}</span>`).join('');
    return `
        <dt>Nhân vật</dt><dd>${escapeHtml(c.name)}</dd>
        ${c.creator ? `<dt>Người tạo</dt><dd>${escapeHtml(c.creator)}</dd>` : ''}
        ${c.version ? `<dt>Phiên bản</dt><dd>${escapeHtml(c.version)}</dd>` : ''}
        <dt>Chuẩn card</dt><dd>${escapeHtml(c.spec)}</dd>
        ${tags ? `<dt>Tag</dt><dd class="char-tags">${tags}</dd>` : ''}`;
}

const embedUrl = (f, key) => `/api/files/${f.id}/card/${encodeURIComponent(key)}`;

function embedRowHtml(f, e) {
    const isAll = e.key.endsWith('-all');
    const label = escapeHtml(e.label);
    const note = [
        e.count ? `${e.count} mục` : '',
        e.size != null ? formatSize(e.size) : '',
        e.disabled ? 'đang tắt' : '',
    ].filter(Boolean).join(' · ');
    const view = e.group === 'image' && e.key !== 'avatar'
        ? `<a class="icon-btn" href="${embedUrl(f, e.key)}?inline" target="_blank" rel="noopener" aria-label="Xem ${label}" title="Xem">${icon('i-external')}</a>`
        : '';
    return `
        <li class="embed${isAll ? ' embed--all' : ''}">
            <div class="embed-main">
                <div class="embed-name" title="${label}">${label}</div>
                ${note ? `<div class="embed-note">${note}</div>` : ''}
            </div>
            ${view}
            <a class="btn btn--sm" href="${embedUrl(f, e.key)}" download="${escapeHtml(e.filename)}" aria-label="Tải ${label}">${icon('i-download')}<span>${isAll ? 'Tải tất cả' : 'Tải'}</span></a>
        </li>`;
}

async function loadEmbeds(f) {
    el.detailEmbeds.innerHTML = '<p class="rx-meta">Đang đọc nội dung card…</p>';
    let info;
    try {
        info = await api(`/api/files/${f.id}/card`);
    } catch (err) {
        if (detailFile?.id === f.id) el.detailEmbeds.innerHTML = `<p class="field-error">${escapeHtml(err.message)}</p>`;
        return;
    }
    if (detailFile?.id !== f.id) return;

    const groups = EMBED_GROUPS.map(([group, ic, title]) => {
        const items = info.embeds.filter((e) => e.group === group);
        if (!items.length) return '';
        const total = items.filter((e) => !e.key.endsWith('-all')).length;
        return `
            <details class="embed-group"${group === 'card' || total <= 4 ? ' open' : ''}>
                <summary>${icon(ic)}<span>${title}</span><span class="nav-count">${total}</span></summary>
                <ul class="embed-list">${items.map((e) => embedRowHtml(f, e)).join('')}</ul>
            </details>`;
    }).join('');

    const linkRows = info.links.map((link) => `
        <li class="embed"><a class="embed-link mono" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link)}</a></li>`).join('');
    const links = info.links.length ? `
        <details class="embed-group">
            <summary>${icon('i-link')}<span>Link ảnh / nhạc bên ngoài</span><span class="nav-count">${info.links.length}</span></summary>
            <div class="embed-links-actions"><button type="button" class="btn btn--sm" data-copy-links>${icon('i-copy')}<span>Copy tất cả link</span></button></div>
            <ul class="embed-list">${linkRows}</ul>
        </details>` : '';

    const notes = info.creatorNotes ? `
        <details class="embed-group">
            <summary>${icon('i-sticky')}<span>Ghi chú của người tạo</span></summary>
            <p class="embed-notes">${escapeHtml(info.creatorNotes)}</p>
        </details>` : '';

    el.detailEmbeds.innerHTML = `<h3 class="rx-note-label embeds-title">Nội dung nhúng</h3>${groups}${links}${notes}`;
    const copyBtn = $('[data-copy-links]', el.detailEmbeds);
    copyBtn?.addEventListener('click', async () => {
        if (await copyText(info.links.join('\n'))) {
            flashCopied(copyBtn);
            toast('success', `Đã copy ${info.links.length} link`, 'Mỗi link một dòng.');
        } else toast('error', 'Không copy được');
    });
}

// =============================================================================
// Đọc card: lorebook, lời chào, mô tả, regex & script
// =============================================================================

let readerFile = null;
let readerSearchTimer = 0;

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
const charCount = (text) => `<span class="rx-meta">${text.length.toLocaleString('vi-VN')} ký tự</span>`;
const keyChips = (keys) => keys.map((k) => `<span class="reader-key">${escapeHtml(k)}</span>`).join('');

/** Một mục mở/đóng được; `copyIndex` trỏ vào `el.readerBody.copies` để nút Copy lấy đúng nội dung. */
function readerItemHtml({ title, badges = '', sub = '', body, open = false, copyIndex }) {
    const copy = copyIndex == null ? '' : `
        <div class="reader-item-tools" data-copy-index="${copyIndex}">
            <button type="button" class="btn btn--sm" data-reader-copy aria-label="Copy ${escapeHtml(title)}">${icon('i-copy')}<span>Copy</span></button>
        </div>`;
    return `
        <details class="reader-item"${open ? ' open' : ''}>
            <summary>
                <span class="reader-item-head">
                    <span class="reader-item-title">${escapeHtml(title)}</span>
                    ${badges ? `<span class="reader-badges">${badges}</span>` : ''}
                </span>
                ${sub ? `<span class="reader-item-sub">${sub}</span>` : ''}
            </summary>
            <div class="reader-item-body">${copy}${body}</div>
        </details>`;
}

function loreEntryHtml(e, copyIndex) {
    const [modeLabel, modeClass] = LORE_MODE[e.mode] || LORE_MODE.normal;
    const badges = [
        e.enabled ? '' : '<span class="badge badge--error">Đang tắt</span>',
        `<span class="badge ${modeClass}">${modeLabel}</span>`,
        `<span class="badge badge--muted">${escapeHtml(e.position)}</span>`,
    ].join('');
    const more = e.keys.length > 8 ? `<span class="reader-key reader-key--more">+${e.keys.length - 8}</span>` : '';
    const meta = [
        e.keys.length ? `<dt>Từ khoá</dt><dd class="reader-keys">${keyChips(e.keys)}</dd>` : '',
        e.secondary.length ? `<dt>Từ khoá phụ (${escapeHtml(e.logic)})</dt><dd class="reader-keys">${keyChips(e.secondary)}</dd>` : '',
        `<dt>Vị trí</dt><dd>${escapeHtml(e.position)}</dd>`,
        `<dt>Thứ tự</dt><dd>${e.order}</dd>`,
        e.probability !== 100 ? `<dt>Xác suất</dt><dd>${e.probability}%</dd>` : '',
        e.group ? `<dt>Nhóm</dt><dd>${escapeHtml(e.group)}</dd>` : '',
        `<dt>Độ dài</dt><dd>${charCount(e.content)}</dd>`,
    ].join('');
    return readerItemHtml({
        title: e.title || `Mục #${e.uid}`,
        badges,
        sub: e.keys.length ? keyChips(e.keys.slice(0, 8)) + more : '',
        body: `<dl class="reader-meta">${meta}</dl>${e.content ? readerText(e.content) : '<p class="rx-meta">Mục này không có nội dung.</p>'}`,
        copyIndex,
    });
}

function readerPanels(data) {
    const copies = [];
    const keep = (text) => copies.push(text) - 1;
    const panels = {};

    const entries = data.lorebook?.entries || [];
    if (entries.length) {
        const on = entries.filter((e) => e.enabled).length;
        const base = `${data.lorebook.name ? `${data.lorebook.name} · ` : ''}${entries.length} mục · ${on} đang bật`;
        panels.lore = {
            count: entries.length,
            html: `
                <div class="reader-toolbar">
                    <div class="search reader-search">
                        <svg class="icon search-icon" aria-hidden="true"><use href="#i-search"/></svg>
                        <label class="sr-only" for="reader-search">Tìm trong lorebook</label>
                        <input id="reader-search" type="search" class="input search-input" autocomplete="off"
                               placeholder="Tìm theo tên mục, từ khoá hoặc nội dung…">
                    </div>
                    <button type="button" class="btn btn--sm" data-reader-expand="1">Mở hết</button>
                    <button type="button" class="btn btn--sm" data-reader-expand="0">Thu gọn</button>
                </div>
                <p class="rx-meta reader-summary" aria-live="polite" data-base="${escapeHtml(base)}">${escapeHtml(base)}</p>
                <div class="reader-list" data-lore-list>${entries.map((e) => loreEntryHtml(e, keep(e.content))).join('')}</div>
                <p class="rx-meta reader-empty" hidden>Không có mục nào khớp.</p>`,
            haystack: entries.map((e) => [e.title, ...e.keys, ...e.secondary, e.content].join('\n').toLowerCase()),
        };
    }

    const textList = (items) => `<div class="reader-list">${items.map((it, i) => readerItemHtml({
        title: it.title,
        sub: charCount(it.text),
        body: readerText(it.text),
        open: i === 0,
        copyIndex: keep(it.text),
    })).join('')}</div>`;

    if (data.greetings.length) panels.greetings = { count: data.greetings.length, html: textList(data.greetings) };
    if (data.fields.length) {
        panels.info = { count: data.fields.length, html: textList(data.fields.map((f) => ({ title: f.label, text: f.text }))) };
    }

    const code = [
        ...data.regex.map((r) => readerItemHtml({
            title: r.name,
            badges: `<span class="badge">${icon('i-regex')}Regex</span>${r.disabled ? '<span class="badge badge--error">Đang tắt</span>' : ''}`,
            body: `<h4 class="reader-label">Tìm</h4>${readerText(r.find)}
                   <h4 class="reader-label">Thay bằng</h4>${r.replace ? readerText(r.replace) : '<p class="rx-meta">(xoá phần khớp)</p>'}`,
            copyIndex: keep(r.find),
        })),
        ...data.scripts.map((sc) => readerItemHtml({
            title: sc.name,
            badges: `<span class="badge">${icon('i-code')}Script</span>${sc.enabled ? '' : '<span class="badge badge--error">Đang tắt</span>'}`,
            body: `${sc.info ? `<p class="reader-info">${escapeHtml(sc.info)}</p>` : ''}${readerText(sc.content)}`,
            copyIndex: keep(sc.content),
        })),
    ];
    if (code.length) panels.code = { count: code.length, html: `<div class="reader-list">${code.join('')}</div>` };

    return { panels, copies };
}

function selectReaderTab(key, focus = false) {
    for (const tab of el.readerTabs.querySelectorAll('[role="tab"]')) {
        const on = tab.dataset.tab === key;
        tab.setAttribute('aria-selected', String(on));
        tab.tabIndex = on ? 0 : -1;
        if (on && focus) tab.focus();
    }
    for (const panel of el.readerBody.querySelectorAll('[role="tabpanel"]')) panel.hidden = panel.dataset.tab !== key;
    el.readerBody.scrollTop = 0;
}

function filterLore(panel, haystack) {
    const q = $('#reader-search', panel).value.trim().toLowerCase();
    let shown = 0;
    panel.querySelectorAll('[data-lore-list] > .reader-item').forEach((item, i) => {
        item.hidden = Boolean(q) && !haystack[i].includes(q);
        if (!item.hidden) shown += 1;
    });
    const summary = $('.reader-summary', panel);
    summary.textContent = q ? `Tìm thấy ${shown} / ${haystack.length} mục` : summary.dataset.base;
    $('.reader-empty', panel).hidden = shown > 0;
}

async function openReader(f) {
    readerFile = f;
    el.readerTitle.textContent = f.card?.name || f.name;
    el.readerTabs.replaceChildren();
    el.readerBody.innerHTML = '<p class="rx-meta reader-status">Đang đọc nội dung card…</p>';
    openDialog(el.reader);

    let data;
    try {
        data = await api(`/api/files/${f.id}/read`);
    } catch (err) {
        if (readerFile?.id === f.id) el.readerBody.innerHTML = `<p class="field-error reader-status">${escapeHtml(err.message)}</p>`;
        return;
    }
    if (readerFile?.id !== f.id) return;

    el.readerTitle.textContent = data.name || f.name;
    const { panels, copies } = readerPanels(data);
    const tabs = READER_TABS.filter(([key]) => panels[key]);
    if (!tabs.length) {
        el.readerBody.innerHTML = '<p class="rx-meta reader-status">Card này không có nội dung để đọc.</p>';
        return;
    }

    el.readerTabs.innerHTML = tabs.map(([key, ic, label]) => `
        <button type="button" role="tab" class="tab reader-tab" id="reader-tab-${key}" data-tab="${key}"
                aria-controls="reader-panel-${key}" aria-selected="false" tabindex="-1">
            ${icon(ic)}<span>${label}</span><span class="nav-count">${panels[key].count}</span>
        </button>`).join('');
    el.readerBody.innerHTML = tabs.map(([key]) => `
        <section role="tabpanel" class="reader-panel" id="reader-panel-${key}" data-tab="${key}"
                 aria-labelledby="reader-tab-${key}" hidden>${panels[key].html}</section>`).join('');
    el.readerBody.copies = copies;

    const lore = $('#reader-panel-lore', el.readerBody);
    lore?.querySelector('#reader-search').addEventListener('input', () => {
        clearTimeout(readerSearchTimer);
        readerSearchTimer = setTimeout(() => filterLore(lore, panels.lore.haystack), 120);
    });
    selectReaderTab(tabs[0][0]);
}

el.readerTabs.addEventListener('click', (e) => {
    const tab = e.target.closest('[role="tab"]');
    if (tab) selectReaderTab(tab.dataset.tab);
});
el.readerTabs.addEventListener('keydown', (e) => {
    const tabs = [...el.readerTabs.querySelectorAll('[role="tab"]')];
    const i = tabs.indexOf(e.target.closest('[role="tab"]'));
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (i < 0 || next == null) return;
    e.preventDefault();
    selectReaderTab(tabs[(next + tabs.length) % tabs.length].dataset.tab, true);
});

el.readerBody.addEventListener('click', async (e) => {
    const expand = e.target.closest('[data-reader-expand]');
    if (expand) {
        const open = expand.dataset.readerExpand === '1';
        for (const item of expand.closest('.reader-panel').querySelectorAll('.reader-item')) {
            if (!item.hidden) item.open = open;
        }
        return;
    }
    const copy = e.target.closest('[data-reader-copy]');
    if (!copy) return;
    const text = el.readerBody.copies?.[Number(copy.parentElement.dataset.copyIndex)] ?? '';
    if (await copyText(text)) flashCopied(copy);
    else toast('error', 'Không copy được');
});

el.reader.addEventListener('close', () => {
    clearTimeout(readerSearchTimer);
    el.readerTabs.replaceChildren();
    el.readerBody.replaceChildren();
    el.readerBody.copies = null;
    readerFile = null;
});

el.detailCopy.addEventListener('click', () => {
    if (detailFile) copyLink(detailFile, el.detailCopy);
});
el.detailLink.addEventListener('focus', () => el.detailLink.select());

el.renameForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!detailFile) return;
    const name = el.detailName.value.trim();
    if (!name) {
        toast('warning', 'Tên file không được để trống');
        el.detailName.focus();
        return;
    }
    if (name === detailFile.name) return;
    el.renameSubmit.disabled = true;
    try {
        const { file } = await api(`/api/files/${detailFile.id}`, { method: 'PATCH', body: { name } });
        state.files = state.files.map((f) => (f.id === file.id ? file : f));
        detailFile = file;
        el.detailName.value = file.name;
        render();
        toast('success', 'Đã đổi tên', file.name);
    } catch (err) {
        handleError(err);
    } finally {
        el.renameSubmit.disabled = false;
    }
});

el.detailRead.addEventListener('click', () => {
    const f = detailFile;
    if (!f) return;
    el.detail.close();
    openReader(f);
});

el.detailDelete.addEventListener('click', async () => {
    if (detailFile && (await deleteFile(detailFile)) && el.detail.open) el.detail.close();
});

async function deleteFile(f) {
    const ok = await confirmDialog(`“${f.name}” sẽ bị xoá vĩnh viễn, link hiện tại cũng sẽ không dùng được nữa.`);
    if (!ok) return false;
    try {
        await api(`/api/files/${f.id}`, { method: 'DELETE' });
        state.files = state.files.filter((x) => x.id !== f.id);
        render();
        toast('success', 'Đã xoá file', f.name);
        return true;
    } catch (err) {
        handleError(err);
        return false;
    }
}

// =============================================================================
// Upload
// =============================================================================

const uploadJobs = [];
let activeUploads = 0;

function pastedName(file) {
    if (file.name && file.name !== 'image.png') return file;
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace(/\+.*/, '');
    return new File([file], `paste-${stamp}.${ext}`, { type: file.type });
}

function queueFiles(fileList) {
    const files = [...fileList];
    if (!files.length) return;
    el.queue.hidden = false;
    const batch = { total: files.length, finished: 0, ok: 0 };
    for (const file of files) {
        const item = createQueueItem(file);
        if (file.size > state.config.maxUploadBytes) {
            markError(item, `Vượt giới hạn ${formatSize(state.config.maxUploadBytes)}`, batch);
        } else if (file.size === 0) {
            markError(item, 'File rỗng hoặc là thư mục', batch);
        } else {
            uploadJobs.push({ file, item, batch });
        }
    }
    pumpUploads();
}

function pumpUploads() {
    while (activeUploads < MAX_PARALLEL_UPLOADS && uploadJobs.length) startUpload(uploadJobs.shift());
}

function createQueueItem(file) {
    const li = document.createElement('li');
    li.className = 'queue-item';
    li.dataset.state = 'waiting';
    li.innerHTML = `
        <div class="qi-thumb">${icon(file.type.startsWith('image/') ? 'i-image' : 'i-file')}</div>
        <div class="qi-main">
            <div class="qi-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</div>
            <div class="qi-sub">Đang chờ… · ${formatSize(file.size)}</div>
            <div class="progress" aria-hidden="true"><span></span></div>
        </div>
        <div class="qi-actions">
            <button type="button" class="icon-btn" data-qi="cancel" aria-label="Huỷ upload ${escapeHtml(file.name)}">${icon('i-x')}</button>
        </div>`;
    if (file.type.startsWith('image/') && file.size < 25 * 1024 * 1024) {
        const img = new Image();
        const src = URL.createObjectURL(file);
        img.alt = '';
        img.onload = img.onerror = () => URL.revokeObjectURL(src);
        img.src = src;
        $('.qi-thumb', li).replaceChildren(img);
    }
    el.queueList.prepend(li);
    return li;
}

function setProgress(item, ratio, text) {
    $('.progress > span', item).style.transform = `scaleX(${ratio})`;
    $('.qi-sub', item).textContent = text;
}

function finishBatch(batch) {
    batch.finished += 1;
    if (batch.total > 1 && batch.finished === batch.total && batch.ok) {
        toast('success', `Đã upload ${batch.ok}/${batch.total} file`, 'Bấm “Copy tất cả link” để lấy toàn bộ link.');
    }
}

function markError(item, message, batch) {
    item.dataset.state = 'error';
    $('.progress', item)?.remove();
    $('.qi-sub', item).textContent = message;
    $('.qi-actions', item).innerHTML =
        `<button type="button" class="icon-btn" data-qi="dismiss" aria-label="Ẩn dòng này">${icon('i-x')}</button>`;
    if (batch) finishBatch(batch);
}

function markDone(item, file, batch) {
    item.dataset.state = 'done';
    item.dataset.link = linkOf(file);
    item.dataset.fileId = file.id;
    $('.progress', item)?.remove();
    $('.qi-sub', item).outerHTML =
        `<input class="input mono qi-link" readonly value="${escapeHtml(linkOf(file))}" aria-label="Link của ${escapeHtml(file.name)}">`;
    $('.qi-actions', item).innerHTML = `
        <button type="button" class="btn btn--sm btn-copy" data-qi="copy">${icon('i-copy')}<span>Copy</span></button>
        <button type="button" class="icon-btn" data-qi="dismiss" aria-label="Ẩn dòng này">${icon('i-x')}</button>`;
    batch.ok += 1;
    if (batch.total === 1) {
        copyText(linkOf(file)).then((ok) => {
            if (ok) {
                flashCopied($('[data-qi="copy"]', item));
                toast('success', 'Upload xong — đã copy link', linkOf(file));
            } else {
                toast('success', 'Upload xong', 'Bấm “Copy” để lấy link.');
            }
        });
    }
    finishBatch(batch);
}

function startUpload(job) {
    const { file, item, batch } = job;
    activeUploads += 1;
    item.dataset.state = 'uploading';
    setProgress(item, 0, `0 B / ${formatSize(file.size)}`);

    const xhr = new XMLHttpRequest();
    item.xhr = xhr;
    xhr.open('POST', '/api/upload');
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
            setProgress(item, e.loaded / e.total, `${formatSize(e.loaded)} / ${formatSize(e.total)} · ${Math.floor((e.loaded / e.total) * 100)}%`);
        }
    });
    const settle = () => {
        activeUploads -= 1;
        item.xhr = null;
        pumpUploads();
    };
    xhr.addEventListener('load', () => {
        let data = {};
        try { data = JSON.parse(xhr.responseText); } catch { /* không phải JSON */ }
        if (xhr.status === 201 && data.file) {
            state.files.unshift(data.file);
            render();
            markDone(item, data.file, batch);
        } else {
            markError(item, data.error || `Lỗi ${xhr.status}`, batch);
            if (xhr.status === 401) handleError({ status: 401 });
        }
        settle();
    });
    xhr.addEventListener('error', () => { markError(item, 'Mất kết nối khi upload', batch); settle(); });
    xhr.addEventListener('abort', () => { markError(item, 'Đã huỷ', batch); settle(); });
    xhr.send(file);
}

el.queueList.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-qi]');
    if (!btn) return;
    const item = btn.closest('.queue-item');
    const action = btn.dataset.qi;
    if (action === 'copy') {
        copyText(item.dataset.link).then((ok) => {
            if (ok) { flashCopied(btn); toast('success', 'Đã copy link', item.dataset.link); } else toast('error', 'Không copy được');
        });
    } else if (action === 'cancel') {
        if (item.xhr) item.xhr.abort();
        else {
            const idx = uploadJobs.findIndex((j) => j.item === item);
            if (idx >= 0) markError(item, 'Đã huỷ', uploadJobs.splice(idx, 1)[0].batch);
        }
    } else if (action === 'dismiss') {
        item.remove();
        if (!el.queueList.children.length) el.queue.hidden = true;
    }
});
el.queueList.addEventListener('focusin', (e) => {
    if (e.target.matches('.qi-link')) e.target.select();
});

el.queueCopyAll.addEventListener('click', async () => {
    const links = $$('.queue-item[data-state="done"]', el.queueList).reverse().map((li) => li.dataset.link);
    if (!links.length) {
        toast('info', 'Chưa có link nào để copy');
        return;
    }
    if (await copyText(links.join('\n'))) {
        flashCopied(el.queueCopyAll);
        toast('success', `Đã copy ${links.length} link`, 'Mỗi link một dòng.');
    } else {
        toast('error', 'Không copy được');
    }
});

el.queueClear.addEventListener('click', () => {
    for (const li of $$('.queue-item', el.queueList)) {
        if (li.dataset.state === 'done' || li.dataset.state === 'error') li.remove();
    }
    if (!el.queueList.children.length) el.queue.hidden = true;
});

el.uploadBtn.addEventListener('click', () => el.fileInput.click());
el.dropTarget.addEventListener('click', () => el.fileInput.click());
el.fileInput.addEventListener('change', () => {
    queueFiles(el.fileInput.files);
    el.fileInput.value = '';
});

// Kéo thả ở bất kỳ đâu trên trang
let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
const canDrop = (e) => state.user && !el.appView.hidden && hasFiles(e);

window.addEventListener('dragenter', (e) => {
    if (!canDrop(e)) return;
    e.preventDefault();
    dragDepth += 1;
    el.dropOverlay.hidden = false;
});
window.addEventListener('dragover', (e) => {
    if (!canDrop(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
});
window.addEventListener('dragleave', (e) => {
    if (!canDrop(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) el.dropOverlay.hidden = true;
});
window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    el.dropOverlay.hidden = true;
    if (canDrop(e)) queueFiles(e.dataTransfer.files);
});

// Dán file / ảnh chụp màn hình bằng Ctrl + V
document.addEventListener('paste', (e) => {
    if (!state.user || el.appView.hidden) return;
    const files = [...(e.clipboardData?.files || [])];
    if (!files.length) return;
    e.preventDefault();
    queueFiles(files.map(pastedName));
});

// =============================================================================
// Khởi động
// =============================================================================

async function boot() {
    try {
        state.config = await api('/api/config');
    } catch {
        toast('error', 'Không kết nối được máy chủ', 'Hãy kiểm tra server đã chạy chưa rồi tải lại trang.');
        return;
    }
    const { siteName, minCredentialLength: min, allowRegister } = state.config;
    document.title = siteName;
    $$('[data-site-name]').forEach((node) => { node.textContent = siteName; });
    el.authUserHint.textContent = `Ít nhất ${min} ký tự · chữ không dấu, số, _ . -`;
    el.authPassHint.textContent = `Ít nhất ${min} ký tự.`;
    if (!allowRegister) $('#tab-register').hidden = true;

    syncPrefControls();

    try {
        const { user } = await api('/api/me');
        state.user = user;
        await enterApp();
    } catch (err) {
        if (err.status !== 401) toast('error', 'Có lỗi xảy ra', err.message);
        showAuth();
    }
}

boot();
