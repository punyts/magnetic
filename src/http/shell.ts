import { escapeHtml } from '@punyts/stateui-mcp';
import { CONTEXT_TOGGLES } from '../agent/AgentTurns.js';

export interface ShellPageOptions {
    readonly appId: string;
    readonly name: string;
    /** The runtime page the app frame loads, on the runtime origin */
    readonly runtimeUrl: string;
    /** The hash of the 3D chunk, when the server has one */
    readonly chunk3d?: string;
    /** The sync namespace of the app's instance */
    readonly namespace: string;
}

const TOGGLE_LABELS: Record<(typeof CONTEXT_TOGGLES)[number], string> = { theme: 'Theme', layout: 'Layout', data: 'Data', logic: 'Logic', screens: 'Screens' };

/**
 * `GET /edit/<appId>`: the app on the left, the chat on the right. The body carries what the StateUI host script
 * (`/assets/host.js`) reads to build the app frame, as `/apps/<appId>` does, so the app is live while the agent works
 * on it; `/assets/shell.js` runs the chat
 */
export function shellPage(options: ShellPageOptions): string {
    const toggles = CONTEXT_TOGGLES.map((name) => `<button type="button" class="toggle" data-context="${name}" aria-pressed="false">${TOGGLE_LABELS[name]}</button>`).join('');
    return [
        '<!doctype html>',
        '<html lang="en">',
        '<head>',
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        `<title>${escapeHtml(options.name)} · Magnetic</title>`,
        '<link rel="stylesheet" href="/assets/page.css">',
        '<link rel="stylesheet" href="/assets/shell.css">',
        '</head>',
        `<body class="view shell" data-app-id="${escapeHtml(options.appId)}" data-runtime-url="${escapeHtml(options.runtimeUrl)}"${options.chunk3d === undefined ? '' : ` data-chunk-3d="${escapeHtml(options.chunk3d)}"`} data-view-kind="browser" data-namespace="${escapeHtml(options.namespace)}" data-status="loading">`,
        '<aside class="chat" aria-label="Build with the agent">',
        `<header class="bar"><a href="/" class="back">Apps</a><strong class="name">${escapeHtml(options.name)}</strong><a href="/apps/${escapeHtml(options.appId)}" target="_blank" rel="noopener" class="open">Open</a><button type="button" id="share-open" aria-expanded="false" aria-controls="share">Share</button></header>`,
        '<section class="share" id="share" aria-label="Share this app" hidden>',
        '<form class="share-new" id="share-new"><label for="share-right">People with the link can</label><div class="row"><select id="share-right"><option value="use" selected>use it, with their own data</option><option value="view">look at it, live and read only</option><option value="remix">copy it, to change their copy</option></select><button type="submit" class="primary">Make link</button></div></form>',
        '<p class="small muted">Everyone signs in to open a link. Revoking a link takes the app back from everyone who opened it, and their browsers delete what they kept of it. A remix is a copy: revoking stops new remixes, but the copies already made belong to the people who made them.</p>',
        '<p class="small status" id="share-status" role="status"></p>',
        '<ol class="links" id="links"></ol>',
        '</section>',
        '<ol class="log" id="log" aria-live="polite"></ol>',
        '<section class="drawer" id="drawer" aria-label="Agent activity" hidden>',
        '<header class="bar"><strong>Activity</strong><span class="spacer"></span><button type="button" id="pin" aria-pressed="false">Keep open</button><button type="button" id="stop" class="stop">Stop</button></header>',
        '<p class="note" id="note"></p>',
        '<ol class="calls" id="calls"></ol>',
        '</section>',
        '<form class="ask" id="ask">',
        `<div class="toggles" role="group" aria-label="Show the agent">${toggles}</div>`,
        '<label class="hidden" for="text">Your request</label>',
        '<textarea id="text" name="text" rows="3" maxlength="4000" placeholder="Describe what to build or change" required></textarea>',
        '<div class="row"><p class="status" id="status" role="status"></p><button type="submit" class="primary" id="send">Send</button></div>',
        '</form>',
        '</aside>',
        '<script type="module" src="/assets/shell.js"></script>',
        '<script type="module" src="/assets/host.js"></script>',
        '</body>',
        '</html>',
        ''
    ].join('\n');
}

/** `/assets/shell.css`, after the host's `page.css` */
export const SHELL_CSS = `:root { color-scheme: light dark; --ink: #1b1d22; --muted: #5d6470; --line: #d9dce2; --paper: #ffffff; --soft: #f3f4f7; --accent: #3047d8; --bad: #c0392b; --good: #23824a; }
@media (prefers-color-scheme: dark) { :root { --ink: #e8eaee; --muted: #a2a8b3; --line: #343842; --paper: #15171c; --soft: #1e2128; --accent: #8c9cff; --bad: #ff8a7a; --good: #6fd39a; } }
html, body.shell { height: 100%; margin: 0; }
body.view.shell { display: grid; grid-template-columns: minmax(0, 1fr) minmax(20rem, 26rem); grid-template-rows: 100%; font-family: system-ui, sans-serif; color: var(--ink); background: var(--paper); }
body.view.shell iframe { grid-column: 1; grid-row: 1; height: 100%; }
body.view.shell[data-status]::after { right: auto; left: 0.75rem; }
.chat { grid-column: 2; grid-row: 1; display: flex; flex-direction: column; min-height: 0; border-left: 1px solid var(--line); background: var(--paper); }
.bar { display: flex; align-items: center; gap: 0.5rem; padding: 0.6rem 0.8rem; border-bottom: 1px solid var(--line); }
.bar .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bar a { color: var(--accent); text-decoration: none; }
.spacer { flex: 1; }
.log { flex: 1; overflow-y: auto; list-style: none; margin: 0; padding: 0.8rem; display: flex; flex-direction: column; gap: 0.6rem; }
.log li { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.45; padding: 0.55rem 0.75rem; border-radius: 0.6rem; max-width: 92%; }
.log li.person { align-self: flex-end; background: var(--accent); color: var(--paper); }
.log li.agent { align-self: flex-start; background: var(--soft); }
.log li.empty { align-self: center; color: var(--muted); background: none; text-align: center; }
.log .outcome { display: block; margin-top: 0.35rem; font-size: 0.85rem; color: var(--muted); }
.log .outcome.bad { color: var(--bad); }
.log details { margin-top: 0.35rem; font-size: 0.85rem; color: var(--muted); }
.log details ol { margin: 0.3rem 0 0; padding-left: 1.1rem; }
.drawer { border-top: 1px solid var(--line); background: var(--soft); max-height: 40%; display: flex; flex-direction: column; min-height: 0; }
.drawer[hidden] { display: none; }
.drawer .note { margin: 0; padding: 0.4rem 0.8rem 0; font-size: 0.85rem; color: var(--muted); font-style: italic; white-space: pre-wrap; max-height: 4.5em; overflow: hidden; }
.drawer .note:empty { display: none; }
.calls { list-style: none; margin: 0; padding: 0.4rem 0.8rem 0.6rem; overflow-y: auto; font-size: 0.85rem; font-family: ui-monospace, monospace; }
.calls li { padding: 0.15rem 0; display: flex; gap: 0.4rem; }
.calls li::before { content: "…"; width: 1rem; flex: none; color: var(--muted); }
.calls li.ok::before { content: "✓"; color: var(--good); }
.calls li.failed::before { content: "✗"; color: var(--bad); }
.calls .what { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ask { border-top: 1px solid var(--line); padding: 0.6rem 0.8rem 0.8rem; display: grid; gap: 0.5rem; }
.toggles { display: flex; flex-wrap: wrap; gap: 0.35rem; }
.toggle { font-size: 0.8rem; padding: 0.2rem 0.6rem; border-radius: 1rem; }
.toggle[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: var(--paper); }
.ask textarea { font: inherit; resize: vertical; min-height: 4rem; padding: 0.5rem; border-radius: 0.5rem; border: 1px solid var(--line); background: var(--paper); color: var(--ink); }
.ask .row { display: flex; align-items: center; gap: 0.5rem; }
.ask .status { flex: 1; margin: 0; font-size: 0.85rem; color: var(--muted); }
.ask .status.bad { color: var(--bad); }
.chat button { font: inherit; padding: 0.35rem 0.8rem; border-radius: 0.5rem; border: 1px solid var(--line); background: transparent; color: var(--ink); cursor: pointer; }
.chat button.primary { background: var(--accent); border-color: var(--accent); color: var(--paper); }
.chat button:disabled { opacity: 0.5; cursor: default; }
.chat button.stop { border-color: var(--bad); color: var(--bad); }
#pin[aria-pressed="true"] { background: var(--line); }
#share-open[aria-expanded="true"] { background: var(--line); }
.share { border-bottom: 1px solid var(--line); background: var(--soft); padding: 0.6rem 0.8rem; display: grid; gap: 0.5rem; max-height: 55%; overflow-y: auto; }
.share[hidden] { display: none; }
.share-new { display: grid; gap: 0.35rem; }
.share .row { display: flex; gap: 0.5rem; }
.share select { flex: 1; min-width: 0; font: inherit; padding: 0.35rem; border-radius: 0.5rem; border: 1px solid var(--line); background: var(--paper); color: var(--ink); }
.small { font-size: 0.85rem; margin: 0; }
.muted { color: var(--muted); }
.share .status:empty { display: none; }
.share .status.bad { color: var(--bad); }
.links { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.5rem; }
.links li { display: grid; gap: 0.3rem; padding: 0.5rem; border: 1px solid var(--line); border-radius: 0.5rem; background: var(--paper); }
.links li.revoked { opacity: 0.6; }
.links .head { display: flex; justify-content: space-between; gap: 0.5rem; font-size: 0.85rem; }
.links input { font: inherit; font-size: 0.8rem; width: 100%; box-sizing: border-box; padding: 0.3rem; border-radius: 0.4rem; border: 1px solid var(--line); background: var(--soft); color: var(--ink); }
.links .row button { font-size: 0.85rem; padding: 0.2rem 0.6rem; }
.hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
@media (max-width: 760px) {
  body.view.shell { grid-template-columns: 100%; grid-template-rows: minmax(0, 1fr) minmax(0, 1fr); }
  body.view.shell iframe { grid-row: 1; }
  .chat { grid-column: 1; grid-row: 2; border-left: 0; border-top: 1px solid var(--line); }
}
`;

/**
 * `/assets/shell.js`: the chat. It reads the app's event stream (`/edit/<appId>/events`), posts requests and stops.
 * The activity drawer opens with the first tool call and closes 4 seconds after the turn ends, unless the pointer or
 * the focus is in it or it is kept open
 */
export const SHELL_JS = String.raw`const appId = document.body.dataset.appId;
const base = '/edit/' + encodeURIComponent(appId);
const log = document.getElementById('log');
const drawer = document.getElementById('drawer');
const calls = document.getElementById('calls');
const note = document.getElementById('note');
const pin = document.getElementById('pin');
const stop = document.getElementById('stop');
const form = document.getElementById('ask');
const text = document.getElementById('text');
const send = document.getElementById('send');
const status = document.getElementById('status');
const CLOSE_AFTER_MS = 4000;
const OUTCOMES = { stopped: 'Stopped.', limit: 'Reached a limit.', refused: 'The model declined.', failed: 'Something went wrong.', budget: 'Out of budget.' };
let running = false;
let current = null;
let closeTimer = null;
let inside = false;

function el(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = content;
    return node;
}

function scrollDown() { log.scrollTop = log.scrollHeight; }

function clearEmpty() { const empty = log.querySelector('.empty'); if (empty) empty.remove(); }

function addPerson(value) { clearEmpty(); log.append(el('li', 'person', value)); scrollDown(); }

function agentBubble() {
    if (current === null) { clearEmpty(); current = el('li', 'agent'); current.append(el('span', 'say')); log.append(current); }
    return current;
}

function finishAgent(entry) {
    const bubble = agentBubble();
    if (entry.text !== undefined && bubble.querySelector('.say').textContent === '') bubble.querySelector('.say').textContent = entry.text;
    if (entry.tools && entry.tools.length > 0) {
        const details = el('details');
        details.append(el('summary', '', entry.tools.length === 1 ? '1 step' : entry.tools.length + ' steps'));
        const list = el('ol');
        for (const tool of entry.tools) list.append(el('li', '', (tool.ok ? '' : '✗ ') + tool.name + (tool.summary ? ' — ' + tool.summary : '') + ' → ' + tool.result));
        details.append(list);
        bubble.append(details);
    }
    if (entry.outcome !== 'finished' || entry.message) {
        bubble.append(el('span', entry.outcome === 'finished' ? 'outcome' : 'outcome bad', entry.message || OUTCOMES[entry.outcome] || ''));
    }
    if (bubble.querySelector('.say').textContent === '' && bubble.childElementCount === 1) bubble.querySelector('.say').textContent = '(done)';
    current = null;
    scrollDown();
}

function setRunning(value) {
    running = value;
    send.disabled = value;
    stop.disabled = !value;
    if (value) { status.className = 'status'; status.textContent = 'Working…'; }
    else if (status.textContent === 'Working…') status.textContent = '';
}

function openDrawer() { cancelClose(); drawer.hidden = false; }

function cancelClose() { if (closeTimer !== null) { clearTimeout(closeTimer); closeTimer = null; } }

function scheduleClose() {
    cancelClose();
    if (running || inside || pin.getAttribute('aria-pressed') === 'true' || drawer.hidden) return;
    closeTimer = setTimeout(() => { closeTimer = null; drawer.hidden = true; }, CLOSE_AFTER_MS);
}

drawer.addEventListener('pointerenter', () => { inside = true; cancelClose(); });
drawer.addEventListener('pointerleave', () => { inside = drawer.contains(document.activeElement); scheduleClose(); });
drawer.addEventListener('focusin', () => { inside = true; cancelClose(); });
drawer.addEventListener('focusout', (event) => { inside = drawer.contains(event.relatedTarget) || drawer.matches(':hover'); scheduleClose(); });
pin.addEventListener('click', () => {
    pin.setAttribute('aria-pressed', pin.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
    scheduleClose();
});

for (const toggle of document.querySelectorAll('.toggle')) {
    toggle.addEventListener('click', () => toggle.setAttribute('aria-pressed', toggle.getAttribute('aria-pressed') === 'true' ? 'false' : 'true'));
}

function showHistory(history) {
    log.replaceChildren();
    current = null;
    for (const entry of history) {
        if (entry.role === 'person') addPerson(entry.text);
        else finishAgent(entry);
    }
    if (history.length === 0) log.append(el('li', 'empty', 'Describe the app you want, or a change to this one. Turn on Layout, Data or the others to show the agent those parts first.'));
    scrollDown();
}

function handle(event) {
    switch (event.type) {
        case 'state':
            showHistory(event.history);
            setRunning(event.running);
            if (event.running) openDrawer();
            break;
        case 'person':
            addPerson(event.text);
            current = null;
            calls.replaceChildren();
            note.textContent = '';
            setRunning(true);
            openDrawer();
            break;
        case 'say': {
            const say = agentBubble().querySelector('.say');
            say.textContent += event.delta;
            scrollDown();
            break;
        }
        case 'note':
            openDrawer();
            note.textContent = (note.textContent + event.delta).slice(-400);
            break;
        case 'tool': {
            openDrawer();
            note.textContent = '';
            const line = el('li');
            line.dataset.id = event.id;
            line.append(el('span', 'name', event.name), el('span', 'what', event.summary));
            calls.append(line);
            line.scrollIntoView({ block: 'nearest' });
            break;
        }
        case 'toolDone': {
            const line = calls.querySelector('li[data-id="' + CSS.escape(event.id) + '"]');
            if (line) { line.className = event.ok ? 'ok' : 'failed'; line.title = event.result; line.querySelector('.what').textContent = event.result; }
            break;
        }
        case 'done':
            finishAgent({ outcome: event.outcome, message: event.message, tools: [] });
            note.textContent = '';
            setRunning(false);
            scheduleClose();
            break;
    }
}

const events = new EventSource(base + '/events');
events.onmessage = (message) => handle(JSON.parse(message.data));
events.onerror = () => { if (events.readyState === EventSource.CLOSED) { status.className = 'status bad'; status.textContent = 'Disconnected. Reload the page.'; } };

async function post(path, body) {
    const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (response.ok) return undefined;
    try { return (await response.json()).message || 'The request was refused.'; } catch { return 'The request was refused.'; }
}

form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const value = text.value.trim();
    if (value === '' || running) return;
    const context = [...document.querySelectorAll('.toggle[aria-pressed="true"]')].map((toggle) => toggle.dataset.context);
    send.disabled = true;
    const refused = await post('/turns', { text: value, context });
    if (refused === undefined) { text.value = ''; return; }
    send.disabled = running;
    status.className = 'status bad';
    status.textContent = refused;
});

text.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); form.requestSubmit(); }
});

stop.addEventListener('click', () => { void post('/stop', {}); });
stop.disabled = true;

const share = document.getElementById('share');
const shareOpen = document.getElementById('share-open');
const shareForm = document.getElementById('share-new');
const shareRight = document.getElementById('share-right');
const shareStatus = document.getElementById('share-status');
const links = document.getElementById('links');
const RIGHTS = { use: 'Use, with their own data', view: 'Look, read only', remix: 'Remix, as a copy' };

function shareSays(message, bad) { shareStatus.className = bad ? 'small status bad' : 'small status'; shareStatus.textContent = message || ''; }

function showLinks(grants) {
    links.replaceChildren();
    for (const grant of grants) {
        const item = el('li', grant.revoked ? 'revoked' : '');
        const head = el('div', 'head');
        const opened = grant.members === 1 ? '1 person opened it' : grant.members + ' people opened it';
        head.append(el('strong', '', RIGHTS[grant.right] || grant.right), el('span', 'muted', grant.revoked ? 'Revoked · ' + opened : opened));
        item.append(head);
        if (!grant.revoked) {
            const url = el('input');
            url.readOnly = true;
            url.value = grant.url;
            url.setAttribute('aria-label', 'Link');
            url.addEventListener('focus', () => url.select());
            const row = el('div', 'row');
            const copy = el('button', '', 'Copy');
            copy.type = 'button';
            copy.addEventListener('click', async () => {
                try { await navigator.clipboard.writeText(grant.url); shareSays('Link copied.'); }
                catch { url.focus(); shareSays('Copy the selected link.'); }
            });
            const revoke = el('button', 'stop', 'Revoke');
            revoke.type = 'button';
            revoke.addEventListener('click', async () => {
                if (!confirm('Revoke this link? Everyone who opened it loses the app.')) return;
                const refused = await post('/share/' + encodeURIComponent(grant.id) + '/revoke', {});
                if (refused !== undefined) { shareSays(refused, true); return; }
                shareSays('Link revoked.');
                await loadLinks();
            });
            row.append(copy, revoke);
            item.append(url, row);
        }
        links.append(item);
    }
    if (grants.length === 0) links.append(el('li', 'muted small', 'No links yet.'));
}

async function loadLinks() {
    try {
        const response = await fetch(base + '/share');
        if (!response.ok) throw new Error('refused');
        showLinks((await response.json()).grants);
    } catch { shareSays('The links could not be loaded.', true); }
}

shareOpen.addEventListener('click', () => {
    const open = share.hidden;
    share.hidden = !open;
    shareOpen.setAttribute('aria-expanded', String(open));
    if (open) { shareSays(''); void loadLinks(); }
});

shareForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const refused = await post('/share', { right: shareRight.value });
    if (refused !== undefined) { shareSays(refused, true); return; }
    shareSays('Link made. Copy it and send it.');
    await loadLinks();
});
`;
