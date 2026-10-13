// Tiện ích dùng chung cho trang chính (app.js) và trang đọc card công khai (read.js).

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
export const icon = (id) => `<svg class="icon" aria-hidden="true"><use href="#${id}"/></svg>`;

export async function copyText(text) {
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

export function flashCopied(btn) {
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
