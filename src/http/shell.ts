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
    /** The models the person may pick, the default first; no menu when there is one or none */
    readonly models?: readonly { readonly id: string; readonly label: string }[];
}

const TOGGLE_LABELS: Record<(typeof CONTEXT_TOGGLES)[number], string> = { theme: 'Theme', layout: 'Layout', data: 'Data', logic: 'Logic', screens: 'Screens' };

/** Line icons drawn in the text colour */
const svg = (path: string): string =>
    `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
const ICONS = {
    back: svg('<path d="M15 18l-6-6 6-6"/>'),
    close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
    chat: svg('<path d="M4 5h16v11H9l-5 4z"/>'),
    send: svg('<path d="M12 19V5M5 12l7-7 7 7"/>'),
    pointer: svg('<path d="M5 3l14 8-6 2-3 6z"/>'),
    hand: svg('<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10.5v-6a1.5 1.5 0 0 1 3 0V11M14 6.5a1.5 1.5 0 0 1 3 0V11M17 8.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-2a6 6 0 0 1-5-2.7L4.3 14a1.5 1.5 0 0 1 2.4-1.8L8 14"/>'),
    minus: svg('<path d="M5 12h14"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    fit: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>')
};

/** The sizes the app's frame can have on the canvas; the first is the default */
export const FRAME_SIZES = [
    { id: 'desktop', label: 'Desktop', width: 1280, height: 800 },
    { id: 'tablet', label: 'Tablet', width: 834, height: 1112 },
    { id: 'phone', label: 'Phone', width: 390, height: 844 }
] as const;

const sizeMenu = `<label class="hidden" for="frame-size">Frame size</label><select id="frame-size" title="The size of the app's frame">${FRAME_SIZES.map((size) => `<option value="${size.id}" data-width="${size.width}" data-height="${size.height}">${size.label}</option>`).join('')}</select>`;

/**
 * `GET /edit/<appId>`: the app is a frame on a canvas that pans and zooms, and the editor floats on it: the name and
 * frame size at the top left, Share at the top right, the tools and context toggles on a rail at the left, the zoom at
 * the bottom right and a chat bar at the bottom centre that opens into the chat. The body carries what the StateUI host script
 * (`/assets/host.js`) reads to build the app frame, as `/apps/<appId>` does, so the app is live while the agent works
 * on it; `/assets/shell.js` runs the chat
 */
export function shellPage(options: ShellPageOptions): string {
    const models = options.models ?? [];
    const menu =
        models.length < 2
            ? ''
            : `<label class="hidden" for="model">Model</label><select id="model" title="The model the agent uses">${models.map((model) => `<option value="${escapeHtml(model.id)}">${escapeHtml(model.label)}</option>`).join('')}</select>`;
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
        '<main class="board" id="board" aria-label="Canvas">',
        `<div class="world" id="world"><div class="artboard" id="artboard" data-app-frame><p class="artboard-label" aria-hidden="true"><span>${escapeHtml(options.name)}</span><span id="artboard-size"></span></p><div class="shield" id="shield" hidden></div></div></div>`,
        '</main>',
        `<header class="float corner start"><a href="/" class="back" title="All your apps">${ICONS.back}<span class="hidden">Apps</span></a><strong class="name">${escapeHtml(options.name)}</strong>${sizeMenu}<a href="/apps/${escapeHtml(options.appId)}" target="_blank" rel="noopener" class="open" title="Open the app on its own">Open</a></header>`,
        '<div class="float corner end"><button type="button" id="share-open" class="primary" aria-expanded="false" aria-controls="share">Share</button></div>',
        '<nav class="float rail" aria-label="Tools">',
        `<div class="tools" role="group" aria-label="Pointer"><button type="button" class="tool icon" data-tool="use" aria-pressed="true" title="Use the app (V)" aria-label="Use the app">${ICONS.pointer}</button><button type="button" class="tool icon" data-tool="move" aria-pressed="false" title="Move the canvas (H, or hold Space)" aria-label="Move the canvas">${ICONS.hand}</button></div>`,
        `<div class="shows" role="group" aria-label="Show the agent"><span class="rail-label" aria-hidden="true">Show</span>${toggles}</div>`,
        '</nav>',
        '<div class="float zoom" role="group" aria-label="Zoom">',
        `<button type="button" class="icon" id="zoom-out" title="Zoom out (-)" aria-label="Zoom out">${ICONS.minus}</button>`,
        '<button type="button" id="zoom-reset" title="Zoom to 100% (0)">100%</button>',
        `<button type="button" class="icon" id="zoom-in" title="Zoom in (+)" aria-label="Zoom in">${ICONS.plus}</button>`,
        `<button type="button" class="icon" id="zoom-fit" title="Fit the app (1)" aria-label="Fit the app">${ICONS.fit}</button>`,
        '</div>',
        '<section class="float sheet share" id="share" aria-label="Share this app" hidden>',
        '<form class="share-new" id="share-new"><label for="share-right">People with the link can</label><div class="row"><select id="share-right"><option value="use" selected>use it, with their own data</option><option value="view">look at it, live and read only</option><option value="remix">copy it, to change their copy</option></select><button type="submit" class="primary">Make link</button></div></form>',
        '<p class="small muted">Everyone signs in to open a link. Revoking a link takes the app back from everyone who opened it, and their browsers delete what they kept of it. A remix is a copy: revoking stops new remixes, but the copies already made belong to the people who made them.</p>',
        '<p class="small status" id="share-status" role="status"></p>',
        '<ol class="links" id="links"></ol>',
        '</section>',
        '<aside class="dock" aria-label="Build with the agent">',
        '<section class="float panel" id="panel" aria-label="Chat" hidden>',
        `<header class="bar"><strong>Chat</strong><span class="spacer"></span><button type="button" id="chat-close" class="icon" title="Close the chat" aria-label="Close the chat">${ICONS.close}</button></header>`,
        '<ol class="log" id="log" aria-live="polite"></ol>',
        '<section class="drawer" id="drawer" aria-label="Agent activity" hidden>',
        '<header class="bar"><strong>Activity</strong><span class="spacer"></span><button type="button" id="pin" aria-pressed="false">Keep open</button><button type="button" id="stop" class="stop">Stop</button></header>',
        '<p class="note" id="note"></p>',
        '<ol class="calls" id="calls"></ol>',
        '</section>',
        '</section>',
        '<form class="float ask" id="ask">',
        '<p class="status" id="status" role="status"></p>',
        `<div class="row"><button type="button" id="chat-open" class="icon" aria-expanded="false" aria-controls="panel" title="Show the chat" aria-label="Show the chat">${ICONS.chat}</button>`,
        '<label class="hidden" for="text">Your request</label>',
        '<textarea id="text" name="text" rows="1" maxlength="4000" placeholder="What shall we build?" required></textarea>',
        `${menu}<button type="submit" class="primary icon" id="send" title="Send (Enter)" aria-label="Send">${ICONS.send}</button></div>`,
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
export const SHELL_CSS = `:root { color-scheme: light dark; --ink: #1b1d22; --muted: #5d6470; --line: #d9dce2; --paper: #ffffff; --soft: #f3f4f7; --accent: #3047d8; --bad: #c0392b; --good: #23824a; --dot: #c9cdd6; --shadow: 0 2px 6px rgba(20, 24, 40, 0.08), 0 8px 24px rgba(20, 24, 40, 0.1); }
@media (prefers-color-scheme: dark) { :root { --ink: #e8eaee; --muted: #a2a8b3; --line: #343842; --paper: #15171c; --soft: #1e2128; --accent: #8c9cff; --bad: #ff8a7a; --good: #6fd39a; --dot: #353a45; --shadow: 0 2px 6px rgba(0, 0, 0, 0.35), 0 8px 24px rgba(0, 0, 0, 0.35); } }
html, body.shell { height: 100%; margin: 0; overflow: hidden; }
body.view.shell { display: block; font-family: system-ui, sans-serif; color: var(--ink); background: var(--soft); }
.board { position: fixed; inset: 0; overflow: hidden; touch-action: none; cursor: default; background-color: var(--soft); background-image: radial-gradient(var(--dot) 1px, transparent 1.2px); }
.board.moving, .board.moving .shield { cursor: grab; }
.board.dragging, .board.dragging .shield { cursor: grabbing; }
.world { position: absolute; top: 0; left: 0; transform-origin: 0 0; }
.world.glide { transition: transform 0.25s ease; }
.artboard { position: relative; background: #fff; border-radius: calc(6px / var(--zoom, 1)); box-shadow: var(--shadow); }
body.view.shell .artboard iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; border-radius: inherit; display: block; }
.artboard-label { position: absolute; left: 0; bottom: 100%; margin: 0 0 calc(6px / var(--zoom, 1)); display: flex; gap: 0.5em; white-space: nowrap; font-size: calc(12px / var(--zoom, 1)); color: var(--muted); }
.artboard-label span:first-child { color: var(--ink); font-weight: 600; }
.shield { position: absolute; inset: 0; z-index: 1; }
.shield[hidden] { display: none; }
body.view.shell[data-status]::after { top: 0.9rem; right: auto; left: 50%; transform: translateX(-50%); padding: 0.3rem 0.7rem; border-radius: 1rem; background: var(--paper); box-shadow: var(--shadow); }
.float { position: fixed; z-index: 2; background: var(--paper); color: var(--ink); border: 1px solid var(--line); border-radius: 0.75rem; box-shadow: var(--shadow); }
.corner { top: 0.75rem; display: flex; align-items: center; gap: 0.25rem; padding: 0.3rem; }
.corner.start { left: 0.75rem; max-width: calc(50vw - 2rem); }
.corner.end { right: 0.75rem; }
.corner .name { padding: 0 0.4rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.corner a { color: var(--ink); text-decoration: none; display: inline-flex; align-items: center; padding: 0.35rem 0.5rem; border-radius: 0.5rem; }
.corner a:hover, .corner a:focus-visible { background: var(--soft); }
.corner a.open { color: var(--accent); font-size: 0.9rem; }
.rail { left: 0.75rem; top: 50%; transform: translateY(-50%); display: flex; flex-direction: column; gap: 0.35rem; padding: 0.35rem; }
.rail .tools, .rail .shows { display: flex; flex-direction: column; gap: 0.25rem; }
.rail .tools { align-items: center; padding-bottom: 0.35rem; border-bottom: 1px solid var(--line); }
.float .tool.icon { border-radius: 0.5rem; }
.float .tool[aria-pressed="true"], .float .tool[aria-pressed="true"]:hover { background: var(--accent); color: var(--paper); }
.corner #frame-size { font: inherit; font-size: 0.8rem; padding: 0.25rem 0.3rem; border-radius: 0.5rem; border: 1px solid var(--line); background: var(--soft); color: var(--ink); }
.zoom { right: 0.75rem; bottom: 1rem; display: flex; align-items: center; gap: 0.1rem; padding: 0.25rem; }
.float.zoom #zoom-reset { min-width: 3.6rem; padding: 0.35rem 0.3rem; border: 0; font-size: 0.85rem; font-variant-numeric: tabular-nums; }
.float.zoom #zoom-reset:hover { background: var(--soft); }
@media (max-width: 1120px) { .zoom { bottom: 5rem; } }
.rail-label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); text-align: center; padding: 0.15rem 0 0.1rem; }
.float.rail .toggle { font-size: 0.8rem; padding: 0.4rem 0.55rem; border: 0; border-radius: 0.5rem; text-align: left; }
.float.rail .toggle:hover { background: var(--soft); }
.float.rail .toggle[aria-pressed="true"] { background: var(--accent); color: var(--paper); }
.sheet { top: 4rem; right: 0.75rem; width: min(22rem, calc(100vw - 1.5rem)); max-height: calc(100vh - 10rem); overflow-y: auto; padding: 0.8rem; display: grid; gap: 0.5rem; box-sizing: border-box; }
.sheet[hidden] { display: none; }
.dock { position: fixed; z-index: 3; left: 50%; bottom: 1rem; transform: translateX(-50%); width: min(40rem, calc(100vw - 1.5rem)); display: flex; flex-direction: column; gap: 0.5rem; pointer-events: none; }
.dock > * { pointer-events: auto; }
.dock .float { position: static; }
.panel { height: min(30rem, calc(100vh - 11rem)); display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
.panel[hidden] { display: none; }
.bar { display: flex; align-items: center; gap: 0.5rem; padding: 0.45rem 0.6rem 0.45rem 0.9rem; border-bottom: 1px solid var(--line); }
.spacer { flex: 1; }
.log { flex: 1; overflow-y: auto; list-style: none; margin: 0; padding: 0.8rem; display: flex; flex-direction: column; gap: 0.6rem; }
.log li { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.45; padding: 0.55rem 0.75rem; border-radius: 0.75rem; max-width: 88%; }
.log li.person { align-self: flex-end; background: var(--accent); color: var(--paper); }
.log li.agent { align-self: flex-start; background: var(--soft); }
.log li.empty { align-self: center; color: var(--muted); background: none; text-align: center; max-width: 30rem; margin: auto 0; }
.log .outcome { display: block; margin-top: 0.35rem; font-size: 0.85rem; color: var(--muted); }
.log .outcome.bad { color: var(--bad); }
.log details { margin-top: 0.35rem; font-size: 0.85rem; color: var(--muted); }
.log details ol { margin: 0.3rem 0 0; padding-left: 1.1rem; }
.drawer { border-top: 1px solid var(--line); background: var(--soft); max-height: 40%; display: flex; flex-direction: column; min-height: 0; }
.drawer[hidden] { display: none; }
.drawer .bar { padding-top: 0.3rem; padding-bottom: 0.3rem; font-size: 0.9rem; }
.drawer .note { margin: 0; padding: 0.4rem 0.9rem 0; font-size: 0.85rem; color: var(--muted); font-style: italic; white-space: pre-wrap; max-height: 4.5em; overflow: hidden; }
.drawer .note:empty { display: none; }
.calls { list-style: none; margin: 0; padding: 0.4rem 0.9rem 0.6rem; overflow-y: auto; font-size: 0.85rem; font-family: ui-monospace, monospace; }
.calls li { padding: 0.15rem 0; display: flex; gap: 0.4rem; }
.calls li::before { content: "…"; width: 1rem; flex: none; color: var(--muted); }
.calls li.ok::before { content: "✓"; color: var(--good); }
.calls li.failed::before { content: "✗"; color: var(--bad); }
.calls .what { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ask { border-radius: 1.6rem; padding: 0.35rem; display: grid; gap: 0.25rem; }
.ask .row { display: flex; align-items: flex-end; gap: 0.35rem; }
.ask textarea { flex: 1; min-width: 0; font: inherit; line-height: 1.4; resize: none; box-sizing: border-box; max-height: 9.8em; padding: 0.45rem 0.3rem; border: 0; outline: none; background: transparent; color: var(--ink); }
.ask .status { margin: 0; padding: 0.2rem 0.9rem 0; font-size: 0.85rem; color: var(--muted); }
.ask .status:empty { display: none; }
.ask .status.bad { color: var(--bad); }
.ask:focus-within { border-color: var(--accent); }
#model { font: inherit; font-size: 0.8rem; max-width: 11rem; height: 2.2rem; padding: 0 0.4rem; border-radius: 1.1rem; border: 1px solid var(--line); background: var(--soft); color: var(--ink); }
.float button { font: inherit; padding: 0.35rem 0.8rem; border-radius: 0.5rem; border: 1px solid var(--line); background: transparent; color: var(--ink); cursor: pointer; }
.float button.primary { background: var(--accent); border-color: var(--accent); color: var(--paper); }
.float button:disabled { opacity: 0.5; cursor: default; }
.float button.stop { border-color: var(--bad); color: var(--bad); }
.float button.icon { display: inline-flex; align-items: center; justify-content: center; padding: 0; width: 2.2rem; height: 2.2rem; flex: none; border: 0; border-radius: 50%; }
.float button.icon:not(.primary):hover { background: var(--soft); }
#chat-open[aria-expanded="true"] { color: var(--accent); }
#pin[aria-pressed="true"] { background: var(--line); }
#share-open[aria-expanded="true"] { filter: brightness(0.9); }
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
  .rail, .rail .tools, .rail .shows { flex-direction: row; }
  .rail { top: 4rem; transform: none; max-width: calc(100vw - 1.5rem); overflow-x: auto; scrollbar-width: none; }
  .rail .tools { padding: 0 0.35rem 0 0; border-bottom: 0; border-right: 1px solid var(--line); }
  .rail-label { align-self: center; padding: 0 0.3rem; }
  .corner.start { max-width: calc(100vw - 7.5rem); }
  .sheet { top: 7.2rem; }
  .panel { height: calc(100vh - 13rem); }
  #model { max-width: 6.5rem; }
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
const panel = document.getElementById('panel');
const chatOpen = document.getElementById('chat-open');
const chatClose = document.getElementById('chat-close');
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

// The chat panel opens above the chat bar and closes with its button or Escape; the bar stays
function showChat(open) {
    if (panel.hidden === !open) return;
    panel.hidden = !open;
    chatOpen.setAttribute('aria-expanded', String(open));
    chatOpen.title = open ? 'Hide the chat' : 'Show the chat';
    chatOpen.setAttribute('aria-label', chatOpen.title);
    if (open) scrollDown();
}

chatOpen.addEventListener('click', () => { showChat(panel.hidden); if (!panel.hidden) text.focus(); });
chatClose.addEventListener('click', () => { showChat(false); text.focus(); });
document.querySelector('.dock').addEventListener('keydown', (event) => { if (event.key === 'Escape' && !panel.hidden) { event.preventDefault(); showChat(false); text.focus(); } });
text.addEventListener('focus', () => showChat(true));

// The chat bar grows with the request, up to its CSS max-height
function fitText() { text.style.height = 'auto'; text.style.height = text.scrollHeight + 'px'; }
text.addEventListener('input', fitText);

function openDrawer() { cancelClose(); showChat(true); drawer.hidden = false; }

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
    if (history.length === 0) log.append(el('li', 'empty', 'Describe the app you want, or a change to this one. Turn on Layout, Data or the others at the left to show the agent those parts first.'));
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
    const refused = await post('/turns', model ? { text: value, context, model: model.value } : { text: value, context });
    if (refused === undefined) { text.value = ''; fitText(); status.textContent = status.textContent === 'Working…' ? status.textContent : ''; return; }
    send.disabled = running;
    status.className = 'status bad';
    status.textContent = refused;
});

text.addEventListener('keydown', (event) => {
    // Enter sends and Shift+Enter starts a new line
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); form.requestSubmit(); }
});

stop.addEventListener('click', () => { void post('/stop', {}); });
stop.disabled = true;

// The model menu remembers the person's pick in this browser
const model = document.getElementById('model');
if (model) {
    try {
        const kept = localStorage.getItem('magnetic.model');
        if (kept && [...model.options].some((option) => option.value === kept)) model.value = kept;
    } catch { /* storage may be blocked */ }
    model.addEventListener('change', () => { try { localStorage.setItem('magnetic.model', model.value); } catch { /* storage may be blocked */ } });
}

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

function showShare(open) {
    share.hidden = !open;
    shareOpen.setAttribute('aria-expanded', String(open));
    if (open) { shareSays(''); void loadLinks(); }
}

shareOpen.addEventListener('click', () => showShare(share.hidden));
share.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.preventDefault(); showShare(false); shareOpen.focus(); } });

shareForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const refused = await post('/share', { right: shareRight.value });
    if (refused !== undefined) { shareSays(refused, true); return; }
    shareSays('Link made. Copy it and send it.');
    await loadLinks();
});

// The canvas: the app is a frame on a board that pans and zooms. Scrolling on the board pans it, Ctrl or a pinch
// zooms, and dragging the board pans it. Over the app, the app gets the pointer, unless the Move tool is on or Space
// is held: then a shield covers the frame and the pointer moves the board. The view is kept per app in this browser
const board = document.getElementById('board');
const world = document.getElementById('world');
const artboard = document.getElementById('artboard');
const shield = document.getElementById('shield');
const frameSize = document.getElementById('frame-size');
const sizeLabel = document.getElementById('artboard-size');
const zoomReset = document.getElementById('zoom-reset');
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;
const VIEW_KEY = 'magnetic.view.' + appId;
const view = { x: 0, y: 0, zoom: 1 };
let tool = 'use';
let spaceHeld = false;
let saveTimer = null;

function clampZoom(zoom) { return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)); }

function saveView() {
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        saveTimer = null;
        try { localStorage.setItem(VIEW_KEY, JSON.stringify({ x: view.x, y: view.y, zoom: view.zoom, size: frameSize.value })); } catch { /* storage may be blocked */ }
    }, 300);
}

function render(glide) {
    world.classList.toggle('glide', Boolean(glide));
    world.style.transform = 'translate(' + view.x + 'px, ' + view.y + 'px) scale(' + view.zoom + ')';
    world.style.setProperty('--zoom', String(view.zoom));
    let step = 24 * view.zoom;
    while (step < 12) step *= 4;
    board.style.backgroundSize = step + 'px ' + step + 'px';
    board.style.backgroundPosition = view.x + 'px ' + view.y + 'px';
    zoomReset.textContent = Math.round(view.zoom * 100) + '%';
    saveView();
}

// Where the frame can show without the floating panels covering it
function freeArea() {
    const rail = document.querySelector('.rail').getBoundingClientRect();
    const corner = document.querySelector('.corner.start').getBoundingClientRect();
    const ask = form.getBoundingClientRect();
    const upright = rail.height > rail.width;
    const left = upright ? rail.right + 24 : 24;
    const top = Math.max(corner.bottom, upright ? 0 : rail.bottom) + 32;
    const right = innerWidth - 24;
    const bottom = Math.min(ask.top, document.querySelector('.zoom').getBoundingClientRect().top) - 24;
    return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

function frameWidth() { return artboard.offsetWidth; }
function frameHeight() { return artboard.offsetHeight; }

// Fit the frame into the free area, never past 100%
function fit(glide) {
    const area = freeArea();
    view.zoom = clampZoom(Math.min(1, area.width / frameWidth(), area.height / frameHeight()));
    view.x = area.left + (area.width - frameWidth() * view.zoom) / 2;
    view.y = area.top + (area.height - frameHeight() * view.zoom) / 2;
    render(glide);
}

// Zoom keeping the board point under (cx, cy) where it is
function zoomAt(zoom, cx, cy, glide) {
    const next = clampZoom(zoom);
    view.x = cx - ((cx - view.x) / view.zoom) * next;
    view.y = cy - ((cy - view.y) / view.zoom) * next;
    view.zoom = next;
    render(glide);
}

function zoomCentre(zoom) {
    const area = freeArea();
    zoomAt(zoom, area.left + area.width / 2, area.top + area.height / 2, true);
}

function panBy(dx, dy) { view.x += dx; view.y += dy; render(false); }

function setSize(id, refit) {
    const option = [...frameSize.options].find((item) => item.value === id) || frameSize.options[0];
    frameSize.value = option.value;
    artboard.style.width = option.dataset.width + 'px';
    artboard.style.height = option.dataset.height + 'px';
    sizeLabel.textContent = option.dataset.width + ' × ' + option.dataset.height;
    if (refit) fit(true);
}

function moving() { return tool === 'move' || spaceHeld; }

function showTool() {
    for (const button of document.querySelectorAll('.tool')) button.setAttribute('aria-pressed', String(button.dataset.tool === tool));
    board.classList.toggle('moving', moving());
    shield.hidden = !moving() && !board.classList.contains('dragging');
}

function setTool(name) { tool = name; showTool(); }

for (const button of document.querySelectorAll('.tool')) button.addEventListener('click', () => setTool(button.dataset.tool));

board.addEventListener('wheel', (event) => {
    event.preventDefault();
    const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1;
    if (event.ctrlKey || event.metaKey) {
        const delta = Math.max(-30, Math.min(30, event.deltaY * scale));
        zoomAt(view.zoom * Math.exp(-delta * 0.01), event.clientX, event.clientY, false);
    } else if (event.shiftKey && event.deltaX === 0) {
        panBy(-event.deltaY * scale, 0);
    } else {
        panBy(-event.deltaX * scale, -event.deltaY * scale);
    }
}, { passive: false });

// Dragging pans; two touches pinch
const pointers = new Map();
let pinch = null;

function pinchState() {
    const [a, b] = [...pointers.values()];
    return { distance: Math.hypot(a.x - b.x, a.y - b.y) || 1, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

board.addEventListener('pointerdown', (event) => {
    const onBackground = event.target === board || event.target === world;
    if (!(onBackground || event.target === shield || event.button === 1)) return;
    if (event.button !== 0 && event.button !== 1) return;
    event.preventDefault();
    board.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    board.classList.add('dragging');
    shield.hidden = false;
    pinch = pointers.size === 2 ? pinchState() : null;
});

board.addEventListener('pointermove', (event) => {
    const last = pointers.get(event.pointerId);
    if (last === undefined) return;
    const now = { x: event.clientX, y: event.clientY };
    pointers.set(event.pointerId, now);
    if (pointers.size === 2 && pinch !== null) {
        const next = pinchState();
        view.x += next.x - pinch.x;
        view.y += next.y - pinch.y;
        zoomAt(view.zoom * (next.distance / pinch.distance), next.x, next.y, false);
        pinch = next;
    } else if (pointers.size === 1) {
        panBy(now.x - last.x, now.y - last.y);
    }
});

function endDrag(event) {
    if (!pointers.delete(event.pointerId)) return;
    pinch = pointers.size === 2 ? pinchState() : null;
    if (pointers.size > 0) return;
    board.classList.remove('dragging');
    showTool();
}
board.addEventListener('pointerup', endDrag);
board.addEventListener('pointercancel', endDrag);

function typing(target) { return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)); }

document.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey || typing(event.target)) return;
    if (event.key === ' ') { event.preventDefault(); if (!spaceHeld) { spaceHeld = true; showTool(); } return; }
    const keys = { v: () => setTool('use'), h: () => setTool('move'), '+': () => zoomCentre(view.zoom * 1.25), '=': () => zoomCentre(view.zoom * 1.25), '-': () => zoomCentre(view.zoom / 1.25), '0': () => zoomCentre(1), '1': () => fit(true) };
    const run = keys[event.key.toLowerCase()];
    if (run) { event.preventDefault(); run(); }
});
document.addEventListener('keyup', (event) => { if (event.key === ' ' && spaceHeld) { event.preventDefault(); spaceHeld = false; showTool(); } });
addEventListener('blur', () => { if (spaceHeld) { spaceHeld = false; showTool(); } });

document.getElementById('zoom-in').addEventListener('click', () => zoomCentre(view.zoom * 1.25));
document.getElementById('zoom-out').addEventListener('click', () => zoomCentre(view.zoom / 1.25));
document.getElementById('zoom-fit').addEventListener('click', () => fit(true));
zoomReset.addEventListener('click', () => zoomCentre(1));
frameSize.addEventListener('change', () => setSize(frameSize.value, true));

(function startCanvas() {
    let kept = null;
    try { kept = JSON.parse(localStorage.getItem(VIEW_KEY) || 'null'); } catch { /* storage may be blocked */ }
    setSize((kept && kept.size) || (innerWidth < 760 ? 'phone' : 'desktop'), false);
    if (kept && [kept.x, kept.y, kept.zoom].every(Number.isFinite)) {
        view.x = kept.x;
        view.y = kept.y;
        view.zoom = clampZoom(kept.zoom);
        render(false);
    } else {
        fit(false);
    }
    showTool();
})();
`;
