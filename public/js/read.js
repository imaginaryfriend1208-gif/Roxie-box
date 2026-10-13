// =============================================================================
// Trang đọc card công khai /r/<mã> — ai có link đều đọc được, không cần đăng nhập.
// =============================================================================

import { $, copyText, flashCopied } from './common.js';
import { createReader } from './reader.js';

const msg = $('#read-msg');
const reader = createReader({
    tabsEl: $('#reader-tabs'),
    bodyEl: $('#reader-body'),
    onCopyFail: () => { msg.textContent = 'Không copy được'; },
});

$('#read-copy').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (await copyText(location.href)) flashCopied(btn);
    else msg.textContent = 'Không copy được';
});

async function load() {
    const id = location.pathname.split('/')[2] || '';
    reader.status('Đang đọc nội dung card…');
    let data;
    try {
        const res = await fetch(`/api/read/${encodeURIComponent(id)}`);
        data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Lỗi ${res.status}`);
    } catch (err) {
        reader.status(err.message, true);
        return;
    }

    const { file } = data;
    $('#read-title').textContent = data.name;
    $('#read-meta').textContent = [data.creator && `Người tạo: ${data.creator}`, file.name].filter(Boolean).join(' · ');
    const download = $('#read-download');
    download.href = `${file.url}?download`;
    download.setAttribute('download', file.name);
    download.hidden = false;
    if (file.ext === 'png') {
        const avatar = $('#read-avatar');
        avatar.src = file.url;
        avatar.hidden = false;
    }
    reader.load(data);
}

load();
