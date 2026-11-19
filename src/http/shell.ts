import { escapeHtml } from '@punyts/stateui-mcp';
import { FAVICON_LINK } from './logo.js';
import { htmlOpen, schemeCss } from './pages.js';
import type { PageLook } from './pages.js';
import { SCRIPT_TEXTS, textBlock, textsOf } from './text.js';

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
    /** True: the editor shows (`/edit/<appId>`); false: the app fills the window (`/apps/<appId>`) until Ctrl+Shift+E */
    readonly editing: boolean;
    /** True: the app has nothing on its screens yet, and the editor offers ideas to start from */
    readonly blank?: boolean;
    /** The person's language and mode */
    readonly look: PageLook;
    /** The org whose workspace holds the app, shown beside its name; absent for the person's own */
    readonly workspace?: string;
}

/** The key chord that shows and hides the editor, as the runtime names it (`mod` is Ctrl, or Cmd on a Mac) */
export const EDIT_KEY = 'mod+shift+e';

/** The sizes the app's frame can have on the canvas; the first is the default */
export const FRAME_SIZES = [
    { id: 'desktop', label: 'Desktop', width: 1280, height: 800 },
    { id: 'tablet', label: 'Tablet', width: 834, height: 1112 },
    { id: 'phone', label: 'Phone', width: 390, height: 844 }
] as const;

/**
 * `GET /apps/<appId>` and `GET /edit/<appId>`, one page: the app fills the window, and Ctrl+Shift+E (Cmd+Shift+E on
 * a Mac) brings the editor around it, and takes it away again, without loading the page again. The address follows.
 *
 * The canvas is the page's: the app's live frame on a board that fills the window, pans and zooms. The editor is a
 * StateUI app of the person's own (`/assets/editor.json`, their `magnetic-editor`): panels floating over the canvas,
 * in a frame that covers the window above it. The page clips that frame to the panels (the frame says where they are,
 * and again whenever they move), so the rest of the window is the canvas's. The page drives the editor through its
 * data and its emits. The body carries what the StateUI host script (`/assets/host.js`) reads to build the app frame,
 * so the app is live while the agent works on it
 */
export function shellPage(options: ShellPageOptions): string {
    const t = textsOf(options.look.language);
    const models = (options.models ?? []).map((model) => ({ id: model.id, label: model.label }));
    return [
        '<!doctype html>',
        htmlOpen(options.look),
        '<head>',
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        `<title>${escapeHtml(options.name)} · Magnetic</title>`,
        FAVICON_LINK,
        '<link rel="stylesheet" href="/assets/page.css">',
        '<link rel="stylesheet" href="/assets/shell.css">',
        '<link rel="stylesheet" href="/assets/views.css">',
        '</head>',
        `<body class="view shell${options.editing ? ' editing' : ''}" data-host-keys="${EDIT_KEY}" data-app-id="${escapeHtml(options.appId)}" data-app-name="${escapeHtml(options.name)}"${options.workspace === undefined ? '' : ` data-workspace-name="${escapeHtml(options.workspace)}"`} data-runtime-url="${escapeHtml(options.runtimeUrl)}"${options.chunk3d === undefined ? '' : ` data-chunk-3d="${escapeHtml(options.chunk3d)}"`} data-view-kind="browser" data-namespace="${escapeHtml(options.namespace)}" data-mode="${options.look.mode}" data-locale="${options.look.language}"${options.blank === true ? ' data-blank="true"' : ''} data-status="loading">`,
        '<div class="shadows" id="shadows" aria-hidden="true"></div>',
        '<div class="editor" id="editor"></div>',
        '<main class="board" id="board" tabindex="-1">',
        `<div class="world" id="world"><div class="artboard" id="artboard" data-app-frame><p class="artboard-label" aria-hidden="true"><span>${escapeHtml(options.name)}</span><span id="artboard-size"></span></p><div class="shield" id="shield" hidden></div><div class="overlay" id="overlay" aria-hidden="true"></div></div></div>`,
        '</main>',
        `<p class="hint" id="hint" role="status" hidden>${escapeHtml(t['shell.hintBefore'])} <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>E</kbd> ${escapeHtml(t['shell.hintAfter'])}</p>`,
        `<script type="application/json" id="magnetic-models">${JSON.stringify(models).replace(/</g, '\\u003c')}</script>`,
        textBlock(options.look.language),
        '<script type="module" src="/assets/host.js"></script>',
        '<script type="module" src="/assets/shell.js"></script>',
        '<script type="module" src="/assets/inspect.js"></script>',
        '<script type="module" src="/assets/screens.js"></script>',
        '<script type="module" src="/assets/views.js"></script>',
        '</body>',
        '</html>',
        ''
    ].join('\n');
}

/** `/assets/shell.css`, after the host's `page.css`: the canvas, and the editor's frame around it */
export const SHELL_CSS = `${schemeCss(
    '--ink: #1b1d22; --muted: #5d6470; --paper: #ffffff; --soft: #f3f4f7; --accent: #3047d8; --dot: #c9cdd6; --shadow: 0 2px 6px rgba(20, 24, 40, 0.08), 0 8px 24px rgba(20, 24, 40, 0.1);',
    '--ink: #e8eaee; --muted: #a2a8b3; --paper: #15171c; --soft: #1e2128; --accent: #8c9cff; --dot: #353a45; --shadow: 0 2px 6px rgba(0, 0, 0, 0.35), 0 8px 24px rgba(0, 0, 0, 0.35);'
)}
html, body.shell { height: 100%; margin: 0; overflow: hidden; }
body.view.shell { display: block; font-family: system-ui, sans-serif; color: var(--ink); background: var(--paper); }
/* The editor's frame covers the window above the canvas, clipped to its panels (the script sets the clip); until the
   panels are known nothing of it shows. Without the editor it is out of sight but loaded, to come back at once */
.editor { position: fixed; inset: 0; z-index: 3; clip-path: inset(0 calc(100% - 1px) calc(100% - 1px) 0); }
.editor iframe { width: 100%; height: 100%; border: 0; display: block; }
body.shell:not(.editing) .editor { visibility: hidden; pointer-events: none; }
/* The editor's panels cast their shadows from here, under the frame: the frame is clipped to the panels themselves */
.shadows { position: fixed; inset: 0; z-index: 2; pointer-events: none; }
.shadows div { position: absolute; border-radius: 12px; box-shadow: var(--shadow); }
body.shell:not(.editing) .shadows { display: none; }
/* Until the editor says where its panels are, the app waits out of sight rather than show at the wrong place */
body.shell.editing.unfitted .world { visibility: hidden; }
/* The canvas fills the window under the editor */
.board { position: fixed; inset: 0; z-index: 1; overflow: hidden; touch-action: none; cursor: default; background-color: var(--soft); background-image: radial-gradient(var(--dot) 1px, transparent 1.2px); }
.board.moving, .board.moving .shield { cursor: grab; }
.board.dragging, .board.dragging .shield { cursor: grabbing; }
.world { position: absolute; top: 0; left: 0; transform-origin: 0 0; }
.world.glide { transition: transform 0.25s ease; }
.artboard { position: relative; background: var(--paper); border-radius: calc(6px / var(--zoom, 1)); box-shadow: var(--shadow); }
/* Each screen of the app in a slot of its own, in rows left to right: the live frame in the slot of the screen it shows, the
   others as previews (screens.js) with a cover that makes the screen the one worked on */
body.shell.editing .artboard { left: var(--slot-x, 0px); top: var(--slot-y, 0px); }
.preview { position: absolute; top: 0; background: var(--paper); border-radius: calc(6px / var(--zoom, 1)); box-shadow: var(--shadow); }
.preview-frame, .preview-frame iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; display: block; border-radius: inherit; overflow: hidden; }
.preview-cover { position: absolute; inset: 0; z-index: 1; margin: 0; padding: 0; border: 0; background: transparent; cursor: pointer; border-radius: inherit; }
.preview-cover:hover, .preview-cover:focus-visible { outline: calc(2px / var(--zoom, 1)) solid var(--accent, #3d5afe); }
.preview-idle { position: absolute; inset: 0; display: grid; place-items: center; color: var(--muted); font: calc(14px / var(--zoom, 1)) system-ui, sans-serif; }
body.shell:not(.editing) .preview { display: none; }
/* Many screens in view, or far out: each screen is a tile with its name, dragged to another slot to move the screen.
   Nothing renders: the live frame hides (its screen has a tile) until a tile is pressed, and the name above a tile goes */
body.screen-names .preview-idle { color: var(--ink); font-size: calc(20px / var(--zoom, 1)); font-weight: 600; padding: 0 calc(12px / var(--zoom, 1)); text-align: center; }
body.screen-names .preview-cover { cursor: grab; }
body.screen-names .preview .artboard-label { display: none; }
body.live-hidden .artboard, body.no-screens .artboard { visibility: hidden; }
.add-screen { position: absolute; z-index: 2; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: calc(12px / var(--zoom, 1)); box-sizing: border-box; border: calc(2px / var(--zoom, 1)) dashed var(--dot); border-radius: calc(12px / var(--zoom, 1)); background: transparent; color: var(--muted); font: calc(18px / var(--zoom, 1)) system-ui, sans-serif; cursor: pointer; }
.add-screen:hover, .add-screen:focus-visible { border-color: var(--accent); color: var(--ink); outline: none; }
.add-screen[hidden] { display: none; }
.add-screen svg { width: calc(48px / var(--zoom, 1)); height: calc(48px / var(--zoom, 1)); fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
.preview-tools { display: none; position: absolute; z-index: 2; top: calc(8px / var(--zoom, 1)); right: calc(8px / var(--zoom, 1)); gap: calc(4px / var(--zoom, 1)); }
body.screen-names .preview-tools { display: flex; }
.preview-tool, .live-close { display: grid; place-items: center; width: calc(28px / var(--zoom, 1)); height: calc(28px / var(--zoom, 1)); padding: 0; border: calc(1px / var(--zoom, 1)) solid var(--dot); border-radius: calc(6px / var(--zoom, 1)); background: var(--paper); color: var(--muted); cursor: pointer; }
.preview-tool[hidden], .live-close[hidden] { display: none; }
.preview-tool:hover, .preview-tool:focus-visible, .live-close:hover, .live-close:focus-visible { color: var(--ink); border-color: var(--accent); outline: none; }
.preview-tool svg, .live-close svg { width: 60%; height: 60%; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.live-close { position: absolute; z-index: 3; transform: translate(-100%, calc(-100% - 6px / var(--zoom, 1))); }
.preview.lifted { z-index: 3; opacity: 0.85; box-shadow: 0 calc(12px / var(--zoom, 1)) calc(32px / var(--zoom, 1)) rgba(20, 24, 40, 0.3); }
.preview.lifted .preview-cover { cursor: grabbing; }
.drop-slot { position: absolute; box-sizing: border-box; border: calc(2px / var(--zoom, 1)) dashed var(--accent); border-radius: calc(6px / var(--zoom, 1)); background: color-mix(in srgb, var(--accent) 8%, transparent); pointer-events: none; z-index: 2; }
.drop-slot[hidden] { display: none; }
/* A screen's menu, opened from its preview */
.screen-menu { position: fixed; z-index: 5; display: flex; flex-direction: column; gap: 2px; min-width: 220px; max-width: 280px; padding: 6px; border-radius: 10px; background: var(--paper); color: var(--ink); box-shadow: var(--shadow); border: 1px solid var(--dot); font: 13px system-ui, sans-serif; }
.screen-menu > button { text-align: left; padding: 6px 8px; border: 0; border-radius: 6px; background: transparent; color: inherit; font: inherit; cursor: pointer; }
.screen-menu > button:hover, .screen-menu > button:focus-visible { background: var(--soft); outline: none; }
.screen-menu form { display: flex; align-items: end; gap: 6px; padding: 4px 8px; }
.screen-menu label { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; color: var(--muted); font-size: 12px; }
.screen-menu input { padding: 4px 6px; border: 1px solid var(--dot); border-radius: 6px; background: var(--paper); color: var(--ink); font: 13px system-ui, sans-serif; }
.screen-menu form button { padding: 4px 8px; border: 0; border-radius: 6px; background: var(--soft); color: var(--accent); font: inherit; cursor: pointer; }
.screen-menu > button.danger, .screen-menu-row button.danger { color: #c62828; }
.screen-menu-question { margin: 0; padding: 6px 8px; }
.screen-menu-row { display: flex; gap: 6px; justify-content: flex-end; padding: 4px 8px; }
.screen-menu-row button { padding: 6px 10px; border: 1px solid var(--dot); border-radius: 6px; background: var(--paper); color: var(--ink); font: inherit; cursor: pointer; }
.screen-menu-row button.danger { border-color: #c62828; }
.screen-menu-status { margin: 0; padding: 0 8px; color: #c62828; font-size: 12px; }
.screen-menu-status:empty { display: none; }
body.view.shell .artboard iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; border-radius: inherit; display: block; }
.artboard-label { position: absolute; left: 0; bottom: 100%; margin: 0 0 calc(6px / var(--zoom, 1)); display: flex; gap: 0.5em; white-space: nowrap; font-size: calc(12px / var(--zoom, 1)); color: var(--muted); }
.artboard-label span:first-child { color: var(--ink); font-weight: 600; }
.shield { position: absolute; inset: 0; z-index: 1; }
.shield[hidden] { display: none; }
.board.selecting .shield { cursor: crosshair; }
.overlay { position: absolute; inset: 0; z-index: 2; pointer-events: none; }
.overlay .box { position: absolute; box-sizing: border-box; border: calc(1.5px / var(--zoom, 1)) solid var(--accent); border-radius: calc(3px / var(--zoom, 1)); }
.overlay .box.hover { border-style: dashed; opacity: 0.8; }
/* A layout shown while the pointer is over it: its area, its children, its gaps and the cells of a grid */
.overlay .box.layout { border-style: dotted; background: color-mix(in srgb, var(--accent) 4%, transparent); }
.overlay .item { position: absolute; box-sizing: border-box; border: calc(1px / var(--zoom, 1)) solid color-mix(in srgb, var(--accent) 70%, transparent); background: color-mix(in srgb, var(--accent) 10%, transparent); }
.overlay .cell { position: absolute; box-sizing: border-box; border: calc(1px / var(--zoom, 1)) dashed color-mix(in srgb, var(--accent) 45%, transparent); }
.overlay .gutter { position: absolute; background: repeating-linear-gradient(-45deg, color-mix(in srgb, var(--accent) 40%, transparent) 0 calc(1.5px / var(--zoom, 1)), transparent 0 calc(5px / var(--zoom, 1))); }
.overlay .box.target { background: color-mix(in srgb, var(--accent) 8%, transparent); }
/* While a component is dragged: every layout section of the screen, its name and layout inside its top left */
.overlay .box.section { border-style: dashed; border-color: color-mix(in srgb, var(--accent) 55%, transparent); }
.overlay .box.section .tag { bottom: auto; top: 0; left: 0; margin: 0; background: color-mix(in srgb, var(--accent) 70%, transparent); border-radius: 0 0 calc(3px / var(--zoom, 1)) 0; }
.overlay .tag { position: absolute; left: -1px; bottom: 100%; margin-bottom: calc(2px / var(--zoom, 1)); padding: calc(1px / var(--zoom, 1)) calc(5px / var(--zoom, 1)); font: calc(11px / var(--zoom, 1)) system-ui, sans-serif; color: var(--paper); background: var(--accent); border-radius: calc(3px / var(--zoom, 1)); white-space: nowrap; }
.overlay .drop { position: absolute; background: var(--accent); border-radius: calc(2px / var(--zoom, 1)); }
.overlay .dot { position: absolute; width: calc(10px / var(--zoom, 1)); height: calc(10px / var(--zoom, 1)); margin: calc(-5px / var(--zoom, 1)); border-radius: 50%; background: var(--accent); }
body.view.shell[data-status]::after { top: 0.9rem; right: auto; left: 50%; transform: translateX(-50%); padding: 0.3rem 0.7rem; border-radius: 1rem; background: var(--paper); box-shadow: var(--shadow); z-index: 3; }
/* Without the editor the app fills the window: no canvas */
body.shell:not(.editing) .artboard-label { display: none; }
body.shell:not(.editing) .board { background: var(--paper); }
body.shell:not(.editing) .world { transform: none !important; transition: none; }
body.shell:not(.editing) .artboard { width: 100vw !important; height: 100vh !important; border-radius: 0; box-shadow: none; }
.hint { position: fixed; z-index: 4; left: 50%; bottom: 1rem; transform: translateX(-50%); margin: 0; padding: 0.45rem 0.9rem; border-radius: 1rem; background: var(--ink); color: var(--paper); font: 0.85rem system-ui, sans-serif; box-shadow: var(--shadow); transition: opacity 0.4s; pointer-events: none; }
.hint[hidden] { display: none; }
.hint.gone { opacity: 0; }
.hint kbd { font: inherit; font-weight: 600; }
body.shell.editing .hint { display: none; }
`;

/**
 * `/assets/shell.js`, after the host script: mounts the editor and drives it (the chat, Share, the choices, the tools,
 * the frame size and the zoom), and runs the canvas. What it shows goes into the editor's data (`$.data.editor` and its
 * lists); what the person does there comes back as the editor's emits. `/assets/inspect.js` adds the selection, the
 * properties, the component library and the state, through the same editor (`magneticShell.editor`)
 */
export const SHELL_JS = String.raw`${SCRIPT_TEXTS}const appId = document.body.dataset.appId;
const base = '/edit/' + encodeURIComponent(appId);
const host = window.stateuiHost;
const holder = document.getElementById('editor');
const MODELS = JSON.parse(document.getElementById('magnetic-models').textContent || '[]');
const OUTCOMES = { stopped: T['chat.stopped'], limit: T['chat.limit'], refused: T['chat.refused'], failed: T['chat.failed'], budget: T['chat.budget'] };
const READY_MS = 10000;

// The editor: a StateUI app the page drives through its data and its emits
let panel = null;
let editorDocument = null;
let editorId = null;
let ready = false;
const pending = [];
const emitListeners = [];
const readyListeners = [];
const editorState = {};
/** The app has no screens: the board's Add a screen tile is then the way on, so the blank app's hint goes */
let noScreens = false;

/** Writes fields of $.data.editor; the same value written again changes nothing */
function ed(fields) {
    const writes = [];
    for (const [name, value] of Object.entries(fields)) {
        if (JSON.stringify(editorState[name]) === JSON.stringify(value)) continue;
        editorState[name] = value;
        writes.push({ path: '$.data.editor.' + name, value });
    }
    write(writes);
}
function write(writes) {
    if (writes.length === 0) return;
    if (panel && ready) panel.write(writes);
    else pending.push(...writes);
}
/** Writes a list of the editor's data as records by id */
/**
 * Writes a list as records keyed by id, in order. A write merges into the records there, where a key keeps its place, so
 * a list whose ids changed (a screen moved, or renamed, which would put it last) is cleared first
 */
const listIds = new Map();
function list(name, records) {
    const path = '$.data.' + name;
    const ids = records.map((record) => record.id).join('\n');
    const changed = listIds.has(name) && listIds.get(name) !== ids;
    listIds.set(name, ids);
    const value = Object.fromEntries(records.map((record) => [record.id, record]));
    write(changed ? [{ path, value: null }, { path, value }] : [{ path, value }]);
}

/** The path of the first node kept under a key, anywhere in the editor's screens */
function pathOfKey(key) {
    const visit = (node, at) => {
        if (!node || typeof node !== 'object') return undefined;
        for (const slot of ['children', 'start', 'end', 'body', 'header', 'footer']) {
            const inner = node[slot];
            if (!inner || typeof inner !== 'object') continue;
            if (slot === 'children') {
                for (const [name, child] of Object.entries(inner)) {
                    if (name === key) return at + '.children.' + name;
                    const found = visit(child, at + '.children.' + name);
                    if (found) return found;
                }
            } else {
                const found = visit(inner, at + '.' + slot);
                if (found) return found;
            }
        }
        return undefined;
    };
    for (const [name, screen] of Object.entries((editorDocument && editorDocument.screens) || {})) {
        const found = visit(screen.root, '$.screens.' + name);
        if (found) return found;
    }
    return undefined;
}

function valueOf(payload) {
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        if ('value' in payload) return payload.value;
        if ('checked' in payload) return payload.checked;
        if ('key' in payload) return payload.key;
        if ('selected' in payload) return payload.selected;
        if ('text' in payload) return payload.text;
    }
    return payload;
}

// Which editor loads when one does not: the person's own, then Magnetic's (what an admin published), then the code's
const NEXT_EDITOR = { own: 'default', default: 'code' };

async function mountEditor(which) {
    if (panel) { panel.dispose(); panel = null; }
    ready = false;
    const response = await fetch('/assets/editor.json' + (which === 'own' ? '' : '?editor=' + which));
    if (!response.ok) throw new Error('The editor could not load');
    const editor = await response.json();
    editorDocument = editor.document;
    editorId = editor.id;
    holder.replaceChildren();
    for (const name of Object.keys(editorState)) delete editorState[name];
    panel = host.mount(holder, { document: editor.document, icons: editor.icons, keys: ['mod+shift+e', ...Object.keys(TOOL_KEYS)] }, T['editor.title']);
    const timer = setTimeout(() => { if (!ready && NEXT_EDITOR[which]) void mountEditor(NEXT_EDITOR[which]); }, READY_MS);
    holder.onstateuiready = null;
    return new Promise((resolve) => {
        const onReady = () => {
            holder.removeEventListener('stateui:ready', onReady);
            clearTimeout(timer);
            ready = true;
            const queued = pending.splice(0);
            if (queued.length > 0) panel.write(queued);
            if (editor.fallback) ed({ notice: T['editor.fallback'], noNotice: false });
            for (const listener of readyListeners) listener();
            resolve();
        };
        holder.addEventListener('stateui:ready', onReady);
    });
}

holder.addEventListener('stateui:emit', (event) => {
    const { name, payload } = event.detail || {};
    if (typeof name !== 'string') return;
    for (const listener of emitListeners) listener(name, payload);
});

// The chat: the conversation is the editor's messages; the agent's tool calls its calls
const messages = [];
let streaming = null;
let calls = [];
let running = false;
let messageCount = 0;
function time() { return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
function showMessages() {
    list('messages', messages);
    ed({ hasMessages: messages.length > 0, noMessages: messages.length === 0 });
}
function addMessage(author, text) {
    messageCount += 1;
    const message = { id: 'm' + messageCount, author, text, time: time() };
    messages.push(message);
    showMessages();
    return message;
}
function agentMessage() {
    if (streaming === null) streaming = addMessage(T['editor.agent'], '');
    return streaming;
}
function finishAgent(entry) {
    const message = agentMessage();
    if (entry.text !== undefined && message.text === '') message.text = entry.text;
    const steps = entry.tools && entry.tools.length > 0 ? (entry.tools.length === 1 ? T['chat.oneStep'] : fill(T['chat.steps'], { count: entry.tools.length })) : '';
    const outcome = entry.outcome !== 'finished' || entry.message ? entry.message || OUTCOMES[entry.outcome] || '' : '';
    const extra = [steps && '_' + steps + '_', outcome && '**' + outcome + '**'].filter(Boolean).join(' · ');
    if (extra) message.text = (message.text ? message.text + '\n\n' : '') + extra;
    if (message.text === '') message.text = T['chat.done'];
    streaming = null;
    showMessages();
}
function setRunning(value) {
    running = value;
    ed({ working: value, notWorking: !value });
    if (value) status(T['chat.working']);
    else if (editorState.status === T['chat.working']) status('');
}
function status(text) { ed({ status: text || '', noStatus: !text }); }
function showCalls() { list('calls', calls); }
function showHistory(history) {
    messages.length = 0;
    streaming = null;
    for (const entry of history) {
        if (entry.role === 'person') addMessage(T['editor.you'], entry.text);
        else finishAgent(entry);
    }
    showMessages();
}

function handle(event) {
    switch (event.type) {
        case 'state':
            showHistory(event.history);
            setRunning(event.running);
            if (event.running) showDrawer(true);
            break;
        case 'person':
            addMessage(T['editor.you'], event.text);
            streaming = null;
            calls = [];
            showCalls();
            ed({ note: '' });
            setRunning(true);
            showDrawer(true);
            break;
        case 'note':
            ed({ note: ((editorState.note || '') + event.delta).slice(-400) });
            break;
        case 'say': {
            const message = agentMessage();
            message.text += event.delta;
            showMessages();
            break;
        }
        case 'tool':
            ed({ note: '' });
            calls.push({ id: event.id, line: event.name + (event.summary ? ' — ' + event.summary : '') });
            showCalls();
            break;
        case 'toolDone': {
            const call = calls.find((item) => item.id === event.id);
            if (call) { call.line = (event.ok ? '✓ ' : '✗ ') + call.line + ' → ' + event.result; showCalls(); }
            break;
        }
        case 'done':
            finishAgent({ outcome: event.outcome, message: event.message, tools: [] });
            setRunning(false);
            ed({ note: '' });
            scheduleDrawerClose();
            editorChanged();
            void loadBudget();
            break;
    }
}

const events = new EventSource(base + '/events');
events.onmessage = (message) => handle(JSON.parse(message.data));
events.onerror = () => { if (events.readyState === EventSource.CLOSED) status(T['chat.disconnected']); };

/** The person's agent use, on the line above the chat bar; the request and Send are off once they may not ask */
function money(dollars) { return '$' + Number(dollars).toFixed(2); }
async function loadBudget() {
    try {
        const response = await fetch(base + '/budget');
        if (!response.ok) return;
        const budget = await response.json();
        const limited = typeof budget.total === 'number';
        const spent = limited && budget.used >= budget.total;
        const line = budget.refusal
            ? (spent ? fill(T['chat.spentByHand'], { total: money(budget.total) }) : budget.refusal)
            : limited ? fill(T['chat.budgetLine'], { used: money(budget.used), total: money(budget.total), left: money(Math.max(0, budget.total - budget.used)) }) : '';
        // The ring: used against the whole budget, in cents; warning from four fifths, danger once spent or refused
        const used = limited ? Math.round(Math.min(budget.used, budget.total) * 100) : 0;
        const total = limited ? Math.max(1, Math.round(budget.total * 100)) : 1;
        const tone = budget.refusal || spent ? 'danger' : used >= total * 0.8 ? 'warning' : 'accent';
        ed({ budgetLine: line, noBudget: line === '', chatOff: Boolean(budget.refusal), budgetUsed: used, budgetTotal: total, budgetTone: tone });
    } catch { /* the line stays as it was */ }
}
void loadBudget();

async function post(path, body) {
    const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (response.ok) return undefined;
    try { return (await response.json()).message || T['chat.requestRefused']; } catch { return T['chat.requestRefused']; }
}

// The model of the next request
let model = '';
try { model = localStorage.getItem('magnetic.model') || ''; } catch { /* storage may be blocked */ }
if (!MODELS.some((item) => item.id === model)) model = MODELS.length > 0 ? MODELS[0].id : '';

async function sendRequest(text) {
    const value = String(text || '').trim();
    if (value === '' || running) return;
    // What the next request shows the agent: what the view shown is about (views.js)
    const context = magneticShell.contextOf ? magneticShell.contextOf() : [];
    const focus = magneticShell.focus.slice();
    const refused = await post('/turns', { text: value, context, ...(model && MODELS.length > 1 && { model }), ...(focus.length > 0 && { focus }) });
    if (refused !== undefined) { status(refused); void loadBudget(); return; }
    ed({ blank: false, notBlank: true, hintHidden: true });
    magneticShell.focus.length = 0;
    showFocus();
}

/**
 * What the next request is about, as removable chips: each by the name it was given (a node as its component and key),
 * else its path. A path has dots, so each chip is keyed by a short id of its own, kept while the path is in the list
 */
const focusLabels = new Map();
const focusIds = new Map();
let focusCount = 0;
function showFocus() {
    const paths = magneticShell.focus;
    for (const path of [...focusIds.keys()]) if (!paths.includes(path)) focusIds.delete(path);
    const items = {};
    for (const path of paths) {
        if (!focusIds.has(path)) focusIds.set(path, 'f' + (++focusCount));
        items[focusIds.get(path)] = { text: focusLabels.get(path) || path };
    }
    ed({ focusItems: items, noFocus: paths.length === 0 });
}


/** Takes one thing out of what the next request is about, by the id of its chip */
function removeFocus(id) {
    const path = [...focusIds].find(([, chip]) => chip === id)?.[0];
    const index = path === undefined ? -1 : magneticShell.focus.indexOf(path);
    if (index >= 0) magneticShell.focus.splice(index, 1);
    showFocus();
}

// Share: the links of this app, each with Copy and Revoke
let grants = [];
let shareRight = 'use';
const RIGHTS = { use: T['share.use'], view: T['share.view'], remix: T['share.remix'] };
function shareSays(text) { ed({ shareStatus: text || '' }); }
function showLinks() {
    list('links', grants.map((grant) => {
        const opened = grant.members === 1 ? T['share.openedOne'] : fill(T['share.opened'], { count: grant.members });
        return { id: grant.id, title: RIGHTS[grant.right] || grant.right, note: grant.revoked ? fill(T['share.revokedLine'], { opened }) : opened + ' · ' + grant.url, url: grant.url, revoked: Boolean(grant.revoked) };
    }));
}
async function loadLinks() {
    try {
        const response = await fetch(base + '/share');
        if (!response.ok) throw new Error('refused');
        grants = (await response.json()).grants || [];
        showLinks();
    } catch { shareSays(T['share.loadFailed']); }
}
/**
 * The component library beside the rail: shown when the editor opens on a wide window, and after that as the person
 * last left it in this browser. The rail's button is soft while it shows. A fitted view fits again around it
 */
let libraryOpen = null;
let screensOpen = false;
let connectionsOpen = false;
let sharedOpen = false;
function showLibraryPanel(open, remember) {
    libraryOpen = open;
    if (open && screensOpen) showScreensPanel(false);
    if (open && connectionsOpen) showConnectionsPanel(false);
    if (open && sharedOpen) showSharedPanel(false);
    ed({ libraryHidden: !open, libraryLook: open ? 'soft' : 'ghost', libraryTone: open ? 'accent' : 'neutral' });
    if (remember) { try { localStorage.setItem('magnetic.library', open ? '1' : '0'); } catch { /* storage may be blocked */ } }
    if (fittedRail !== null) setTimeout(() => fit(true), 50);
}
/** The Screens panel takes the library's place beside the rail: opening one closes the other */
function showScreensPanel(open) {
    screensOpen = open;
    if (open && libraryOpen) showLibraryPanel(false, false);
    if (open && connectionsOpen) showConnectionsPanel(false);
    if (open && sharedOpen) showSharedPanel(false);
    ed({ screensHidden: !open, screensLook: open ? 'soft' : 'ghost', screensTone: open ? 'accent' : 'neutral' });
    if (fittedRail !== null) setTimeout(() => fit(true), 50);
}
/**
 * The Connections panel, in the library's place too: the outside APIs the app's workspace has and their endpoints, from
 * GET /edit/<id>/connections (never a key or secret). Pressing an endpoint asks the agent to show what it answers in
 * the app; Manage opens the Connections page of the workspace, for those who manage it
 */
function showConnectionsPanel(open) {
    connectionsOpen = open;
    if (open && libraryOpen) showLibraryPanel(false, false);
    if (open && screensOpen) showScreensPanel(false);
    if (open && sharedOpen) showSharedPanel(false);
    ed({ connectionsHidden: !open, connectionsLook: open ? 'soft' : 'ghost', connectionsTone: open ? 'accent' : 'neutral' });
    if (open) void loadConnections();
    if (fittedRail !== null) setTimeout(() => fit(true), 50);
}
let connectionsManage = null;
const endpointsById = new Map();
async function loadConnections() {
    let answer = null;
    try {
        const response = await fetch(base + '/connections');
        if (response.ok) answer = await response.json();
    } catch { /* offline: the panel keeps what it had */ }
    if (!answer) return;
    connectionsManage = typeof answer.manage === 'string' ? answer.manage : null;
    endpointsById.clear();
    const rows = [];
    for (const connection of Array.isArray(answer.connections) ? answer.connections : []) {
        for (const endpoint of connection.endpoints) {
            const id = connection.name + '_' + endpoint.name;
            endpointsById.set(id, { connection: connection.name, endpoint: endpoint.name });
            const params = endpoint.params.length > 0 ? ' · ' + endpoint.params.join(', ') : '';
            rows.push({ id, title: connection.name + ' · ' + endpoint.name, subtitle: endpoint.method + ' ' + connection.host + endpoint.path + params });
        }
    }
    list('connections', rows);
    const status = answer.off ? T['connectionsPanel.off'] : (answer.connections || []).length === 0 ? T['connectionsPanel.none'] : '';
    ed({ connectionsStatus: status, noConnectionsStatus: status === '', cannotManage: connectionsManage === null });
}
/**
 * The Shared data panel, in the library's place too: the datasets other owners shared with the app's workspace, from
 * GET /edit/<id>/shared-data. Pressing one asks the agent to show it in the app; Manage data opens the Data page
 */
function showSharedPanel(open) {
    sharedOpen = open;
    if (open && libraryOpen) showLibraryPanel(false, false);
    if (open && screensOpen) showScreensPanel(false);
    if (open && connectionsOpen) showConnectionsPanel(false);
    ed({ sharedHidden: !open, sharedLook: open ? 'soft' : 'ghost', sharedTone: open ? 'accent' : 'neutral' });
    if (open) void loadShared();
    if (fittedRail !== null) setTimeout(() => fit(true), 50);
}
let sharedManage = null;
const sharedById = new Map();
async function loadShared() {
    let answer = null;
    try {
        const response = await fetch(base + '/shared-data');
        if (response.ok) answer = await response.json();
    } catch { /* offline: the panel keeps what it had */ }
    if (!answer) return;
    sharedManage = typeof answer.manage === 'string' ? answer.manage : null;
    sharedById.clear();
    const rows = [];
    for (const [index, shared] of (Array.isArray(answer.datasets) ? answer.datasets : []).entries()) {
        const id = 'shared' + index;
        sharedById.set(id, { dataset: shared.dataset, name: shared.ownerName });
        const fields = shared.fields.length > 0 ? ' · ' + shared.fields.join(', ') : '';
        rows.push({ id, title: shared.dataset, subtitle: fill(T['sharedPanel.by'], { name: shared.ownerName }) + fields });
    }
    list('shared', rows);
    const status = rows.length === 0 ? T['sharedPanel.none'] : '';
    ed({ sharedStatus: status, noSharedStatus: status === '', cannotManageData: sharedManage === null });
}
function libraryAtFirst() {
    let kept = null;
    try { kept = localStorage.getItem('magnetic.library'); } catch { /* storage may be blocked */ }
    return kept === null ? !NARROW.matches : kept === '1';
}

/** The Share, choices and feedback sheets open under their buttons, one at a time */
function showSheet(name, open) {
    ed({ shareHidden: name === 'share' ? !open : true, prefsHidden: name === 'prefs' ? !open : true, feedbackHidden: name === 'feedback' ? !open : true });
}

// Feedback from the bug button: what kind and what was typed, sent to the server with where it was sent from
let feedbackKind = 'bug';
let feedbackText = '';
let feedbackSending = false;
async function sendFeedback() {
    const text = feedbackText.trim();
    if (text === '') { ed({ feedbackStatus: T['feedback.empty'] }); return; }
    if (feedbackSending) return;
    feedbackSending = true;
    ed({ feedbackStatus: T['feedback.sending'] });
    try {
        const refused = await post('/feedback', { kind: feedbackKind, text, context: { size, language: document.documentElement.lang } });
        if (refused !== undefined) { ed({ feedbackStatus: refused }); return; }
        feedbackText = '';
        ed({ feedbackText: '', feedbackStatus: T['feedback.thanks'] });
    } catch { ed({ feedbackStatus: T['feedback.failed'] }); } finally { feedbackSending = false; }
}

// The chat opens above the chat bar and closes with its button; the agent's activity shows in it while the agent works
// and a moment after, unless kept open
const CLOSE_AFTER_MS = 4000;
let chatOpen = false;
let drawerTimer = null;
/** The blank app's hint shows over the frame of a blank app with screens, while the chat is closed, in the Screens view */
function hintHidden() { return chatOpen || !editorState.blank || noScreens || appView; }
function showChat(open) {
    chatOpen = open;
    ed({ chatHidden: !open, hintHidden: hintHidden() });
}
function showDrawer(open) {
    clearTimeout(drawerTimer);
    ed({ drawerHidden: !open });
    if (open) showChat(true);
}
function scheduleDrawerClose() {
    clearTimeout(drawerTimer);
    if (running || editorState.keepOpen) return;
    drawerTimer = setTimeout(() => ed({ drawerHidden: true }), CLOSE_AFTER_MS);
}

async function choose(change) {
    try {
        const response = await fetch('/prefs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(change) });
        if (!response.ok) throw new Error('refused');
        location.reload();
    } catch { ed({ prefsStatus: T['prefs.failed'] }); }
}

emitListeners.push((name, payload) => {
    const value = valueOf(payload);
    switch (name) {
        case 'home': location.assign('/'); return;
        case 'open': window.open('/apps/' + encodeURIComponent(appId), '_blank', 'noopener'); return;
        case 'size': setSize(String(value), true); return;
        case 'turn': turned = !turned; setSize(size, true); saveView(); return;
        case 'zoomIn': zoomCentre(view.zoom * 1.25); return;
        case 'zoomOut': zoomCentre(view.zoom / 1.25); return;
        case 'zoomReset': zoomCentre(1); return;
        case 'zoomFit': fit(true); return;
        case 'tool': if (typeof value === 'string' && value) setTool(value); return;
        case 'share': if (editorState.shareHidden === false) { showSheet('share', false); return; } showSheet('share', true); shareSays(''); void loadLinks(); return;
        case 'shareClose': showSheet('share', false); return;
        case 'shareRight': if (typeof value === 'string') shareRight = value; return;
        case 'shareMake': void (async () => {
            const refused = await post('/share', { right: shareRight });
            if (refused !== undefined) { shareSays(refused); return; }
            shareSays(T['share.made']);
            await loadLinks();
        })(); return;
        case 'linkCopy': {
            const grant = grants.find((item) => item.id === value);
            if (grant) navigator.clipboard.writeText(grant.url).then(() => shareSays(T['share.copied']), () => shareSays(grant.url));
            return;
        }
        case 'linkRevoke': void (async () => {
            if (!confirm(T['share.revokeConfirm'])) return;
            const refused = await post('/share/' + encodeURIComponent(String(value)) + '/revoke', {});
            if (refused !== undefined) { shareSays(refused); return; }
            shareSays(T['share.revokedDone']);
            await loadLinks();
        })(); return;
        case 'prefs': ed({ prefsStatus: '' }); showSheet('prefs', editorState.prefsHidden !== false); return;
        case 'prefsClose': showSheet('prefs', false); return;
        case 'feedback': ed({ feedbackStatus: '' }); showSheet('feedback', editorState.feedbackHidden !== false); return;
        case 'feedbackClose': showSheet('feedback', false); return;
        case 'feedbackKind': if (typeof value === 'string') { feedbackKind = value; ed({ feedbackKind: value }); } return;
        // Kept in the editor's data too, so clearing it after sending clears the field
        case 'feedbackText': feedbackText = String(value || ''); ed({ feedbackText }); return;
        case 'feedbackSend': void sendFeedback(); return;
        case 'mode': if (typeof value === 'string' && value !== document.documentElement.dataset.mode) void choose({ mode: value }); return;
        case 'language': if (typeof value === 'string' && value !== document.documentElement.lang) void choose({ language: value }); return;
        case 'chat.send': void sendRequest(value); return;
        case 'chatToggle': showChat(!chatOpen); return;
        case 'chatClose': showChat(false); return;
        case 'keepOpen': ed({ keepOpen: Boolean(value) }); scheduleDrawerClose(); return;
        case 'model': if (typeof value === 'string') { model = value; try { localStorage.setItem('magnetic.model', model); } catch { /* storage may be blocked */ } } return;
        case 'stop': void post('/stop', {}); return;
        case 'idea1': case 'idea2': case 'idea3': void sendRequest(T['shell.' + name]); return;
        case 'focusClear': magneticShell.focus.length = 0; showFocus(); return;
        case 'focusRemove': if (typeof value === 'string') removeFocus(value); return;
        case 'tab': if (typeof value === 'string') editorState.tab = value; return;
        case 'library': showLibraryPanel(!libraryOpen, true); return;
        case 'libraryClose': showLibraryPanel(false, true); return;
        case 'screensPanel': showScreensPanel(!screensOpen); return;
        case 'screensClose': showScreensPanel(false); return;
        case 'connectionsPanel': showConnectionsPanel(!connectionsOpen); return;
        case 'connectionsClose': showConnectionsPanel(false); return;
        case 'connectionsManage': if (connectionsManage) window.open(connectionsManage, '_blank', 'noopener'); return;
        case 'connectionAsk': {
            const chosen = typeof value === 'string' ? endpointsById.get(value) : undefined;
            if (chosen) void sendRequest(fill(T['connectionsPanel.askText'], chosen));
            return;
        }
        case 'sharedPanel': showSharedPanel(!sharedOpen); return;
        case 'sharedClose': showSharedPanel(false); return;
        case 'sharedManage': if (sharedManage) window.open(sharedManage, '_blank', 'noopener'); return;
        case 'sharedAsk': {
            const chosen = typeof value === 'string' ? sharedById.get(value) : undefined;
            if (chosen) void sendRequest(fill(T['sharedPanel.askText'], chosen));
            return;
        }
    }
});

// The canvas: the app is a frame on a board that pans and zooms. Scrolling on the board pans it, Ctrl or a pinch
// zooms, and dragging the board pans it. Over the app, the app gets the pointer, unless the Move tool is on or Space
// is held: then a shield covers the frame and the pointer moves the board. The view is kept per app in this browser
const board = document.getElementById('board');
const world = document.getElementById('world');
const artboard = document.getElementById('artboard');
const shield = document.getElementById('shield');
const sizeLabel = document.getElementById('artboard-size');
const SIZES = { desktop: [1280, 800], tablet: [834, 1112], phone: [390, 844] };
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;
const VIEW_KEY = 'magnetic.view.' + appId;
const view = { x: 0, y: 0, zoom: 1 };
let size = 'desktop';
/** The frame is turned: its width and height swap, landscape to portrait or back */
let turned = false;
let tool = 'use';
let spaceHeld = false;
let saveTimer = null;
/** What the board fits instead of the live frame (the Statenet graph, set by views.js): a box in the frame's pixels. While
 * it is set the view is not kept, so the screens' view is the one a reload finds */
let fitBox = null;

function clampZoom(zoom) { return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)); }

function writeView() {
    saveTimer = null;
    if (fitBox !== null) return;
    try { localStorage.setItem(VIEW_KEY, JSON.stringify({ x: view.x, y: view.y, zoom: view.zoom, size, turned })); } catch { /* storage may be blocked */ }
}

function saveView() {
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = setTimeout(writeView, 300);
}

// A reload or a move away right after a change still keeps it
addEventListener('pagehide', () => {
    if (saveTimer === null) return;
    clearTimeout(saveTimer);
    writeView();
});

function render(glide) {
    world.classList.toggle('glide', Boolean(glide));
    world.style.transform = 'translate(' + view.x + 'px, ' + view.y + 'px) scale(' + view.zoom + ')';
    world.style.setProperty('--zoom', String(view.zoom));
    let step = 24 * view.zoom;
    while (step < 12) step *= 4;
    board.style.backgroundSize = step + 'px ' + step + 'px';
    board.style.backgroundPosition = view.x + 'px ' + view.y + 'px';
    ed({ zoom: Math.round(view.zoom * 100) + '%' });
    saveView();
}

// Where the frame can show without the floating panels covering it: right of the rail, below the corners, above the
// chat bar and the zoom, and left of the inspector when it is open and tall
function freeArea() {
    const box = (key) => panels.get(key);
    // The rail down the left, or below 760px the one along the top
    const rail = box('railTop') || box('rail');
    const upright = Boolean(rail) && rail.height > rail.width;
    const corner = box('nameCorner');
    const bar = box('chatBar');
    const zoomBox = box('zoom');
    const inspector = box('inspector');
    // The library beside the rail, when it shows down the side rather than as a sheet across the bottom
    const library = libraryOpen ? box('library') : screensOpen ? box('screens') : connectionsOpen ? box('connections') : sharedOpen ? box('shared') : null;
    const left = library && library.height > innerHeight / 2 && library.x < innerWidth / 2 ? library.x + library.width + 24 : upright ? rail.x + rail.width + 24 : 24;
    const top = Math.max(corner ? corner.y + corner.height : 0, rail && !upright ? rail.y + rail.height : 0) + 32;
    const right = (inspector && inspector.height > innerHeight / 2 ? inspector.x : innerWidth) - 24;
    const bottom = Math.min(bar ? bar.y : innerHeight, zoomBox ? zoomBox.y : innerHeight) - 24;
    return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

function frameWidth() { return artboard.offsetWidth; }
/** How far right and down the live frame's slot is on the board (screens.js sets them), in the frame's pixels */
function slotX() { return Number(artboard.dataset.slotX || 0); }
function slotY() { return Number(artboard.dataset.slotY || 0); }
const sizeListeners = [];
function frameHeight() { return artboard.offsetHeight; }

// The rail the last automatic fit went around, while the view is still that fit (no pan or zoom since): when the
// other rail shows instead (the window crossed 760px, or the editor showed its narrow rail after the first fit), the
// frame is fitted again
let fittedRail = null;
function railShown() { return panels.has('railTop') ? 'railTop' : 'rail'; }

// Fit the frame, or what the view shows in its place, into the free area, never past 100%
function fit(glide) {
    fittedRail = railShown();
    const area = freeArea();
    const box = fitBox !== null ? fitBox() : { x: slotX(), y: slotY(), width: frameWidth(), height: frameHeight() };
    view.zoom = clampZoom(Math.min(1, area.width / box.width, area.height / box.height));
    view.x = area.left + (area.width - box.width * view.zoom) / 2 - box.x * view.zoom;
    view.y = area.top + (area.height - box.height * view.zoom) / 2 - box.y * view.zoom;
    render(glide);
}

// Zoom keeping the board point under (cx, cy) where it is
function zoomAt(zoom, cx, cy, glide) {
    fittedRail = null;
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

function panBy(dx, dy) { fittedRail = null; view.x += dx; view.y += dy; render(false); }

/** The frame size, in the frame's pixels: the chosen size's, swapped when the frame is turned */
function frameSize() {
    const [width, height] = SIZES[size];
    return turned ? [height, width] : [width, height];
}

function setSize(id, refit) {
    size = SIZES[id] ? id : 'desktop';
    const [width, height] = frameSize();
    artboard.style.width = width + 'px';
    artboard.style.height = height + 'px';
    sizeLabel.textContent = width + ' × ' + height;
    ed({ size });
    for (const listener of sizeListeners) listener();
    if (refit) fit(true);
}

function moving() { return tool === 'move' || spaceHeld; }

function showTool() {
    board.classList.toggle('moving', moving());
    board.classList.toggle('selecting', !moving() && (tool === 'select' || tool === 'place'));
    shield.hidden = !moving() && tool === 'use' && !board.classList.contains('dragging');
    const shownTool = tool === 'place' ? 'select' : tool;
    const look = (on) => (on ? 'solid' : 'ghost');
    const tone = (on) => (on ? 'accent' : 'neutral');
    ed({
        tool: shownTool,
        toolLook: { use: look(shownTool === 'use'), move: look(shownTool === 'move'), select: look(shownTool === 'select') },
        toolTone: { use: tone(shownTool === 'use'), move: tone(shownTool === 'move'), select: tone(shownTool === 'select') }
    });
}

const toolListeners = [];
function setTool(name) { tool = name; showTool(); for (const listener of toolListeners) listener(name); }

board.addEventListener('wheel', (event) => {
    if (!editing()) return;
    event.preventDefault();
    const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1;
    const box = board.getBoundingClientRect();
    if (event.ctrlKey || event.metaKey) {
        const delta = Math.max(-30, Math.min(30, event.deltaY * scale));
        zoomAt(view.zoom * Math.exp(-delta * 0.01), event.clientX - box.left, event.clientY - box.top, false);
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
    if (!editing()) return;
    // The keyboard comes back to the page from the editor's frame, for the tools' keys
    if (document.activeElement !== board && !typing(document.activeElement)) board.focus({ preventScroll: true });
    const onBackground = event.target === board || event.target === world;
    if (!(onBackground || (event.target === shield && moving()) || event.button === 1)) return;
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
        const box = board.getBoundingClientRect();
        view.x += next.x - pinch.x;
        view.y += next.y - pinch.y;
        zoomAt(view.zoom * (next.distance / pinch.distance), next.x - box.left, next.y - box.top, false);
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

/** The editor's keys, the same from the page and, through the runtime, from the editor's frame */
const TOOL_KEYS = {
    v: () => setTool('use'),
    h: () => setTool('move'),
    s: () => setTool('select'),
    '=': () => zoomCentre(view.zoom * 1.25),
    '-': () => zoomCentre(view.zoom / 1.25),
    '0': () => zoomCentre(1),
    '1': () => fit(true),
    a: () => showLibraryPanel(!libraryOpen, true),
    p: () => showScreensPanel(!screensOpen),
    c: () => showConnectionsPanel(!connectionsOpen),
    d: () => showSharedPanel(!sharedOpen),
    escape: () => { for (const listener of escapeListeners) if (listener()) return true; if (chatOpen) { showChat(false); return true; } return false; }
};
/** What Escape lets go of, in turn: inspect.js adds placing and the selection, screens.js the selected screen */
const escapeListeners = [];

function typing(target) { return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)); }

document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'e') { event.preventDefault(); setEditing(!editing()); return; }
    if (!editing() || event.ctrlKey || event.metaKey || event.altKey || typing(event.target)) return;
    if (event.key === ' ') { event.preventDefault(); if (!spaceHeld) { spaceHeld = true; showTool(); } return; }
    // Escape on the page is inspect.js's, which runs the same turn as the escape key; from the editor's frame it comes as a key of the runtime
    const run = event.key === 'Escape' ? undefined : TOOL_KEYS[event.key.toLowerCase()] || (event.key === '+' ? TOOL_KEYS['='] : undefined);
    if (run) { event.preventDefault(); run(); }
});
document.addEventListener('keyup', (event) => { if (event.key === ' ' && spaceHeld) { event.preventDefault(); spaceHeld = false; showTool(); } });
addEventListener('blur', () => { if (spaceHeld) { spaceHeld = false; showTool(); } });

// The editor's frame shows only its floating panels: each child of the stage, where the frame says it is now, and the
// popovers open in it (a button's tip, a menu, an option list), which may reach past every panel. A click anywhere else
// falls through to the canvas
const panels = new Map();
const RADIUS = 12;
/** The corner radius of a panel: a pill is round at its ends, every other panel has the theme's 12px */
function radiusOf(key, rect) {
    const node = stageChild(key);
    return node && node.corners === 'pill' ? Math.min(rect.width, rect.height) / 2 : Math.min(RADIUS, rect.width / 2, rect.height / 2);
}
function stageChild(key) {
    for (const screen of Object.values(editorDocument.screens || {})) {
        let found;
        const visit = (node) => {
            if (found || !node || typeof node !== 'object') return;
            if (node.children && node.children[key] && node.layout && node.layout.type === 'adhoc') { found = node.children[key]; return; }
            for (const child of Object.values(node.children || {})) visit(child);
        };
        visit(screen.root);
        if (found) return found;
    }
    return undefined;
}
function roundedRect(rect, r) {
    const x = rect.x;
    const y = rect.y;
    const right = x + rect.width;
    const bottom = y + rect.height;
    return 'M' + (x + r) + ' ' + y + 'H' + (right - r) + 'A' + r + ' ' + r + ' 0 0 1 ' + right + ' ' + (y + r) + 'V' + (bottom - r) + 'A' + r + ' ' + r + ' 0 0 1 ' + (right - r) + ' ' + bottom +
        'H' + (x + r) + 'A' + r + ' ' + r + ' 0 0 1 ' + x + ' ' + (bottom - r) + 'V' + (y + r) + 'A' + r + ' ' + r + ' 0 0 1 ' + (x + r) + ' ' + y + 'Z';
}
const shadows = document.getElementById('shadows');
/** How far past a popover's box the clip reaches, so its own shadow shows */
const POPOVER_MARGIN = 8;
function clipEditor(nodes, floating) {
    panels.clear();
    const shapes = [];
    const casts = [];
    for (const node of nodes || []) {
        const key = node.path.slice(node.path.lastIndexOf('.') + 1);
        if (node.rect.width < 1 || node.rect.height < 1) continue;
        panels.set(key, node.rect);
        const radius = radiusOf(key, node.rect);
        shapes.push(roundedRect(node.rect, radius));
        const cast = document.createElement('div');
        cast.style.borderRadius = radius + 'px';
        cast.style.left = node.rect.x + 'px';
        cast.style.top = node.rect.y + 'px';
        cast.style.width = node.rect.width + 'px';
        cast.style.height = node.rect.height + 'px';
        casts.push(cast);
    }
    shadows.replaceChildren(...casts);
    for (const rect of floating || []) {
        if (rect.width < 1 || rect.height < 1) continue;
        const grown = { x: rect.x - POPOVER_MARGIN, y: rect.y - POPOVER_MARGIN, width: rect.width + 2 * POPOVER_MARGIN, height: rect.height + 2 * POPOVER_MARGIN };
        shapes.push(roundedRect(grown, POPOVER_MARGIN));
    }
    holder.style.clipPath = shapes.length === 0 ? '' : "path('" + shapes.join(' ') + "')";
    if (!fitted && panels.size > 0) { fitted = true; fit(false); }
    else if (fittedRail !== null && panels.size > 0 && railShown() !== fittedRail) fit(true);
    if (panels.size > 0) document.body.classList.remove('unfitted');
}
function watchStage() {
    const stage = pathOfKey('stage');
    if (!stage || !panel) return;
    const children = [];
    for (const screen of Object.values(editorDocument.screens || {})) {
        const visit = (node, at) => {
            if (!node || typeof node !== 'object') return;
            if (at === stage) { for (const name of Object.keys(node.children || {})) children.push(stage + '.children.' + name); return; }
            for (const [name, child] of Object.entries(node.children || {})) visit(child, at + '.children.' + name);
        };
        visit(screen.root, '$.screens.' + Object.keys(editorDocument.screens).find((name) => editorDocument.screens[name] === screen));
    }
    panel.watch(children, clipEditor);
}

// The editor shows and hides with Ctrl+Shift+E, from the page or, through the runtime, from the app or the editor
function editing() { return document.body.classList.contains('editing'); }

let fitted = false;

function setEditing(on) {
    document.body.classList.toggle('editing', on);
    history.replaceState(null, '', (on ? '/edit/' : '/apps/') + encodeURIComponent(appId) + location.search);
    if (on) {
        hideHint();
        if (panel && ready) watchStage();
        if (!fitted) { fitted = true; fit(false); } else render(false);
    } else {
        showSheet('share', false);
        if (spaceHeld) { spaceHeld = false; showTool(); }
        const frame = artboard.querySelector('iframe');
        if (frame) frame.focus();
    }
}

addEventListener('stateui:key', (event) => {
    const key = event.detail && event.detail.key;
    if (key === 'mod+shift+e') setEditing(!editing());
    else if (editing() && TOOL_KEYS[key]) TOOL_KEYS[key]();
});

// Editing the editor itself: each change shows in the editor around it, a moment after it is saved
let reloadTimer = null;
function editorChanged() {
    if (appId !== editorId) return;
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => void mountEditor('own').then(showAll), 800);
}

// What /assets/inspect.js uses of the editor: the tools, the editor and the paths the next turn is about
const magneticShell = {
    tool: () => tool,
    setTool,
    onTool: (listener) => toolListeners.push(listener),
    editing,
    focus: [],
    /** Points the next request at a path; the State tab opens the chat to ask, a node added to the chat leaves it as it is */
    ask(path, label, open = true) {
        if (label) focusLabels.set(path, label);
        if (!magneticShell.focus.includes(path)) magneticShell.focus.push(path);
        magneticShell.focus.splice(0, Math.max(0, magneticShell.focus.length - 5));
        showFocus();
        if (open) showChat(true);
    },
    refit: () => render(false),
    /** The app has screens (false) or none (true): screens.js says */
    noScreens(on) {
        if (noScreens === on) return;
        noScreens = on;
        ed({ hintHidden: hintHidden() });
    },
    canvas: {
        /** The frame size, in the frame's pixels */
        size: frameSize,
        /** Moves the board left by dx and up by dy of the frame's pixels: the live frame stays where it is on the screen when its slot moves by them */
        shift(dx, dy = 0) { view.x -= dx * view.zoom; view.y -= dy * view.zoom; render(false); },
        onSize: (listener) => sizeListeners.push(listener),
        fitted: () => fittedRail !== null,
        fit: () => fit(false),
        /** Where the board is, or null before it was placed */
        look: () => (fitted ? { x: view.x, y: view.y, zoom: view.zoom } : null),
        /** Puts the board back where a look had it */
        lookAt(look) { fittedRail = null; view.x = look.x; view.y = look.y; view.zoom = clampZoom(look.zoom); render(false); },
        /** What the board fits instead of the live frame: a function giving a box in the frame's pixels, or null for the frame */
        fitTo(box) { fitBox = box; },
        /** Moves the board by dx and dy screen pixels, gliding */
        pan(dx, dy) { fittedRail = null; view.x += dx; view.y += dy; render(true); }
    },
    editorChanged,
    onEscape: (listener) => escapeListeners.push(listener),
    /** Lets go of the first thing Escape lets go of; true when there was one */
    escape: () => TOOL_KEYS.escape(),
    showInspector: (open) => ed({ inspectorHidden: !open }),
    /** The Statenet, Theme or Logic view is shown (on) or the Screens view (off): the rail and the library go while one is */
    appView(on) {
        appView = on;
        ed({ hintHidden: hintHidden() });
        if (on) { showLibraryPanel(false, false); showScreensPanel(false); showConnectionsPanel(false); showSharedPanel(false); }
        showWidth();
    },
    /** What the next request tells the agent about, by what views.js shows: set by views.js */
    contextOf: null,
    /** Shows what the view sends the agent, as fixed chips before the focus, each a key and a text (views.js) */
    showContext(chips) {
        ed({ contextItems: Object.fromEntries(chips.map((chip) => [chip.key, { text: chip.text }])) });
    },
    editor: {
        set: ed,
        list,
        write,
        state: editorState,
        pathOf: pathOfKey,
        onEmit: (listener) => emitListeners.push(listener),
        onReady: (listener) => readyListeners.push(listener),
        frame: () => (panel ? panel.frame() : null),
        inspect: (query) => (panel ? panel.inspect(query) : Promise.resolve(undefined))
    }
};
window.magneticShell = magneticShell;

// Without the editor, a hint says once in this browser how to open it
const hint = document.getElementById('hint');
if (/Mac|iPhone|iPad/.test(navigator.platform)) hint.querySelector('kbd').textContent = 'Cmd';
function hideHint() { hint.classList.add('gone'); setTimeout(() => { hint.hidden = true; }, 400); }
let hinted = false;
try { hinted = localStorage.getItem('magnetic.hinted') === '1'; localStorage.setItem('magnetic.hinted', '1'); } catch { /* storage may be blocked */ }
if (!editing() && !hinted) { hint.hidden = false; setTimeout(hideHint, 5000); }

// Below 760px the rail runs along the top instead of down the left, as the old editor's did
const NARROW = window.matchMedia('(max-width: 759.98px)');
// Below 480px the chat bar has no room for the model beside the request, so the model menu goes (the last one chosen stays)
const PHONE = window.matchMedia('(max-width: 479.98px)');
// The rail shows in the Screens view only: the other views (views.js) have their tools in their sheet
let appView = false;
function showWidth() { ed({ narrowHidden: !NARROW.matches, wideHidden: NARROW.matches || appView, isNarrow: NARROW.matches, noModels: MODELS.length < 2 || PHONE.matches }); }
NARROW.addEventListener('change', () => { showWidth(); fitted = false; });
PHONE.addEventListener('change', showWidth);

/** Everything the editor shows, written again after it (re)loads */
function showAll() {
    const blank = document.body.dataset.blank === 'true' && messages.length === 0;
    ed({
        appName: document.body.dataset.appName || '',
        workspaceName: document.body.dataset.workspaceName || T['shell.ownWorkspace'],
        size,
        mode: document.documentElement.dataset.mode || 'system',
        language: document.documentElement.lang || 'en',
        blank,
        notBlank: !blank,
        hintHidden: !blank || chatOpen || noScreens || appView,
        models: Object.fromEntries(MODELS.map((item) => [item.id, { _label: item.label }])),
        model,
        noModels: MODELS.length < 2 || PHONE.matches
    });
    render(false);
    showTool();
    showMessages();
    showCalls();
    showFocus();
    setRunning(running);
    showChat(chatOpen);
    showWidth();
    showLibraryPanel(libraryOpen === null ? libraryAtFirst() : libraryOpen, false);
    if (editing()) watchStage();
}

if (document.body.classList.contains('editing')) document.body.classList.add('unfitted');
(function startCanvas() {
    let kept = null;
    try { kept = JSON.parse(localStorage.getItem(VIEW_KEY) || 'null'); } catch { /* storage may be blocked */ }
    turned = Boolean(kept && kept.turned === true);
    setSize((kept && kept.size) || (innerWidth < 760 ? 'phone' : 'desktop'), false);
    if (kept && [kept.x, kept.y, kept.zoom].every(Number.isFinite)) {
        view.x = kept.x;
        view.y = kept.y;
        view.zoom = clampZoom(kept.zoom);
        fitted = true;
    }
    render(false);
    showTool();
})();

if (host) {
    const asked = new URLSearchParams(location.search).get('editor');
    const which = asked === 'default' || asked === 'code' ? asked : 'own';
    mountEditor(which).then(showAll, () => { if (NEXT_EDITOR[which]) void mountEditor(NEXT_EDITOR[which]).then(showAll); });
}
`;
