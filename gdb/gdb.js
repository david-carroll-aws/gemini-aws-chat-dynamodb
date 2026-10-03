/* ============================================================
   GDB — Gemini Chat -> DynamoDB overlay
   ============================================================ */

/* ---------- Config ---------- */
const GDB_CONFIG = {
    CAPTURE_VISITOR_URL: '/api/capture-visitor',
    CHAT_URL:            'https://niqxdroq1b.execute-api.us-east-1.amazonaws.com/gchatDB',
    HISTORY_URL:         'https://niqxdroq1b.execute-api.us-east-1.amazonaws.com/gchatDB/history',
    MARKUP_URL:          'gdb/gdb.html',
};

/* ---------- State ---------- */
let gdbVisitorId = null;
let gdbConversationId = null;
let gdbInitialized = false;
let gdbOverlayReady = false;
let gdbSavedCount = 0;
let gdbFirstSavedAt = null;

/* ---------- Helpers ---------- */
function makeId(prefix = '') {
    if (window.crypto && typeof crypto.randomUUID === 'function') {
        return prefix + crypto.randomUUID();
    }
    return prefix + 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

function setGdbStatus(label, cls) {
    const el = document.getElementById('gdb-status');
    if (!el) return;
    el.textContent = label;
    el.className = 'gdb-status' + (cls ? ' ' + cls : '');
}

function appendGdbMessage(role, text, isTyping = false) {
    const messages = document.getElementById('gdb-messages');
    const div = document.createElement('div');
    div.className = `gdb-msg gdb-msg-${role}` + (isTyping ? ' gdb-typing' : '');
    const bubble = document.createElement('div');
    bubble.className = 'gdb-bubble';
    bubble.textContent = text;
    div.appendChild(bubble);
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
    return div;
}

function renderSaveTag(messageEl, savedAt) {
    if (messageEl.nextElementSibling?.classList?.contains('gdb-save-tag')) return;

    const tag = document.createElement('div');
    tag.className = 'gdb-save-tag';
    tag.innerHTML = `
        <span class="gdb-check">✓</span>
        <span>Saved to DynamoDB</span>
        <span class="gdb-save-sep">·</span>
        <span>${savedAt}</span>
    `;
    messageEl.insertAdjacentElement('afterend', tag);
}

function updateSavedCount(count, savedAt) {
    gdbSavedCount = count;
    if (!gdbFirstSavedAt && savedAt) gdbFirstSavedAt = savedAt;

    const chip = document.getElementById('gdb-saved-count');
    if (chip) {
        chip.hidden = false;
        chip.textContent = `${count} AI response${count === 1 ? '' : 's'} recorded to DynamoDB`;
        chip.classList.add('pulse');
        setTimeout(() => chip.classList.remove('pulse'), 1200);
    }

    const countEl = document.getElementById('gdb-detail-count');
    if (countEl) countEl.textContent = count;

    const firstEl = document.getElementById('gdb-detail-first');
    if (firstEl && gdbFirstSavedAt) firstEl.textContent = gdbFirstSavedAt;

    const visitorEl = document.getElementById('gdb-detail-visitor');
    if (visitorEl) visitorEl.textContent = gdbVisitorId || '—';

    const convoEl = document.getElementById('gdb-detail-conversation');
    if (convoEl) convoEl.textContent = gdbConversationId || '—';
}

/* ---------- Inject overlay markup once ---------- */
(async function injectGdbOverlay() {
    const frames = document.getElementById('frames');
    if (!frames || document.getElementById('gdb-overlay')) return;

    try {
        const r = await fetch(GDB_CONFIG.MARKUP_URL);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const html = await r.text();

        const wrapper = document.createElement('div');
        wrapper.innerHTML = html.trim();
        const overlay = wrapper.firstElementChild;
        if (!overlay) throw new Error('No root element in gdb.html');

        frames.appendChild(overlay);
        gdbOverlayReady = true;
    } catch (e) {
        console.error('[gdb] failed to load overlay markup:', e);
    }
})();

/* ---------- Open / Close ---------- */
async function openGdb() {
    if (!gdbOverlayReady) await new Promise(r => setTimeout(r, 100));

    const overlay = document.getElementById('gdb-overlay');
    if (!overlay) { console.warn('[gdb] overlay not ready'); return; }

    overlay.classList.remove('gdb-hidden');
    document.getElementById('gdb-input')?.focus();

    if (gdbInitialized) {
        // refresh the DB panel every time the overlay is opened
        loadHistory();
        return;
    }
    gdbInitialized = true;

    setGdbStatus('connecting…', '');

    try {
        const r = await fetch(GDB_CONFIG.CAPTURE_VISITOR_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();

        gdbVisitorId      = data.visitorId      || makeId();
        gdbConversationId = data.conversationId || makeId('conv-');

        setGdbStatus('connected', 'connected');
    } catch (e) {
        gdbVisitorId      = gdbVisitorId      || makeId();
        gdbConversationId = gdbConversationId || makeId('conv-');
        setGdbStatus('connected', 'connected');
    }

    const visitorEl = document.getElementById('gdb-detail-visitor');
    if (visitorEl) visitorEl.textContent = gdbVisitorId;

    const convoEl = document.getElementById('gdb-detail-conversation');
    if (convoEl) convoEl.textContent = gdbConversationId;

    // Initial fetch of DB items
    loadHistory();
}

function closeGdb() {
    document.getElementById('gdb-overlay')?.classList.add('gdb-hidden');
}

/* ---------- Send message ---------- */
async function sendGdbMessage(event) {
    event.preventDefault();

    const input   = document.getElementById('gdb-input');
    const sendBtn = document.getElementById('gdb-send');
    const text    = input.value.trim();
    if (!text) return;

    appendGdbMessage('user', text);
    input.value = '';
    sendBtn.disabled = true;

    const typingEl = appendGdbMessage('assistant', '', true);

    try {
        const r = await fetch(GDB_CONFIG.CHAT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                visitorId:      gdbVisitorId,
                conversationId: gdbConversationId,
                input:          text,
            }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();

        const reply = (data.response ?? data.reply ?? data.text ?? '(no response)').trim();
        typingEl.querySelector('.gdb-bubble').textContent = reply;
        typingEl.classList.remove('gdb-typing');

        if (data.saved) {
            const savedAt = new Date().toLocaleTimeString('en-GB', {
                hour: '2-digit', minute: '2-digit', second: '2-digit'
            });
            renderSaveTag(typingEl, savedAt);
            updateSavedCount((data.savedCount ?? gdbSavedCount + 1), savedAt);

            // Refresh the DB panel from DynamoDB
            loadHistory();
        }
    } catch (e) {
        console.error('[gdb] chat failed:', e);
        typingEl.querySelector('.gdb-bubble').textContent = 'Error: ' + e.message;
        typingEl.classList.remove('gdb-typing');
    } finally {
        sendBtn.disabled = false;
        input.focus();
    }
}

/* ---------- Load + render DB panel ---------- */
async function loadHistory() {
    const list = document.getElementById('gdb-db-list');
    const empty = document.getElementById('gdb-db-empty');
    const countEl = document.getElementById('gdb-db-count');
    if (!list) return;

    try {
        const r = await fetch(GDB_CONFIG.HISTORY_URL);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();

        const items = data.items || [];

        if (countEl) countEl.textContent = items.length;

        // Clear existing items (keep the empty placeholder element)
        [...list.querySelectorAll('.gdb-db-item')].forEach(el => el.remove());

        if (items.length === 0) {
            if (empty) empty.style.display = '';
            return;
        }
        if (empty) empty.style.display = 'none';

        // Remember the most recent timestamp we knew about, to highlight new items
        const previousTopTs = list.dataset.topTs || '';
        const newTopTs = items[0]?.timestamp || '';

        items.forEach((item, idx) => {
            const row = document.createElement('div');
            row.className = 'gdb-db-item';
            if (idx === 0 && newTopTs && newTopTs !== previousTopTs) {
                row.classList.add('is-new');
            }

			const time = (item.timestamp || '').slice(11, 19);
			const input = truncate(item.input || '', 20);
			const resp  = truncate(item.response || '', 30);
			const conv  = truncate(item.conversationId || '', 20);

            row.innerHTML = `
                <span class="gdb-db-time">${escapeHtml(time)}</span>
                <span class="gdb-db-input">${escapeHtml(input)}</span>
                <span class="gdb-db-resp">${escapeHtml(resp)}</span>
                <span class="gdb-db-conv">${escapeHtml(conv)}</span>
            `;
            list.appendChild(row);
        });

        list.dataset.topTs = newTopTs;

    } catch (e) {
        console.error('[gdb] history load failed:', e);
    }
}

function truncate(s, n) {
    s = String(s);
    return s.length > n ? s.slice(0, n) + '…' : s;
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
        '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
}

/* ---------- ESC to close ---------- */
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeGdb();
});