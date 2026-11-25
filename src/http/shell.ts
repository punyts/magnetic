import { escapeHtml } from '@punyts/stateui-mcp';
import { FAVICON_LINK } from './logo.js';
import { htmlOpen, schemeCss } from './pages.js';
import type { PageLook } from './pages.js';
import { LOGIC_APP } from '../logic/LogicPage.js';
import { SCREENS_APP } from '../screens/ScreensPage.js';
import { SIDE_APP } from '../side/SidePage.js';
import { STATENET_APP } from '../statenet/StatenetPage.js';
import { THEME_APP } from '../theme/ThemePage.js';
import { ZOOM_CSS } from './zoom.js';
import { SCRIPT_TEXTS, textBlock, textsOf } from './text.js';

export interface ShellPageOptions {
    readonly appId: string;
    readonly name: string;
    /** The runtime page the editor's panels load in their frames, on the runtime origin */
    readonly runtimeUrl: string;
    /** The hash of the page bundle (`/assets/page/<hash>.js`), which runs the app and the screens board in the page */
    readonly pageBundle: string;
    /** The hash of the 3D chunk, when the server has one */
    readonly chunk3d?: string;
    /**
     * The sync namespace of the page's instance: the test run's in the editor, the person's own (real use) for the running
     * app (docs/design/stateui-test-runs.md)
     */
    readonly namespace: string;
    /** The models the person may pick, the default first; no menu when there is one or none */
    readonly models?: readonly { readonly id: string; readonly label: string }[];
    /** True: the editor shows (`/edit/<appId>`); false: the app fills the window (`/apps/<appId>`) until Ctrl+Shift+- */
    readonly editing: boolean;
    /** True: the app has nothing on its screens yet, and the editor offers ideas to start from */
    readonly blank?: boolean;
    /** The person's language and mode */
    readonly look: PageLook;
    /** The org whose workspace holds the app, shown beside its name; absent for the person's own */
    readonly workspace?: string;
    /** The org whose workspace holds the app, by id; absent for the person's own. Zooming out of the editor goes to its board of apps */
    readonly org?: string;
}

/**
 * The chords that zoom between levels, as the runtime names them (`mod` is Ctrl, or Cmd on a Mac): Ctrl+Shift+= in,
 * from the editor to the running app, and Ctrl+Shift+- out, from the running app to the editor and from the editor to
 * the person's apps
 */
export const ZOOM_KEYS = { in: 'mod+shift+=', out: 'mod+shift+-' } as const;

/**
 * `GET /apps/<appId>` and `GET /edit/<appId>`: the running app, alone in the window with nothing over it and no editor
 * loaded, and the editor around it. Ctrl+Shift+- (Cmd on a Mac) in the running app loads the editor on the screen
 * showing, and Ctrl+Shift+= in the editor loads the running app on the screen worked on: each zoom is a page of its own,
 * so the running app is the app as anyone opens it, synced with the person's own instance, and the editor syncs with
 * the test run (docs/design/stateui-test-runs.md).
 *
 * The app runs in the page (`data-surface="page"` and the page bundle): alone in `#alone`, which fills the window, and
 * in the editor on the screens board (`/assets/screens.js`). The editor is a StateUI app of the person's own
 * (`/assets/editor.json`, their `magnetic-editor`), in the page too, and the canvas is part of it: Magnetic's pages
 * `magnetic-screens` (the board, every screen of the app on it and the live app on the screen worked on),
 * `magnetic-statenet`, `magnetic-theme` and `magnetic-logic` are live embeddedApps first on its stage, and its panels
 * float over them. The stage lets presses through (`panel`'s `passThrough`), so the rest of the window is the canvas's. The page drives the editor through its data and its emits. The body carries what the StateUI host script (`/assets/host.js`) reads to run the
 * app, so the app is live while the agent works on it
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
        '</head>',
        `<body class="view shell${options.editing ? ' editing' : ''}" data-host-keys="${ZOOM_KEYS.in} ${ZOOM_KEYS.out}" data-app-id="${escapeHtml(options.appId)}" data-app-name="${escapeHtml(options.name)}" data-board="${escapeHtml(boardOf(options))}"${options.workspace === undefined ? '' : ` data-workspace-name="${escapeHtml(options.workspace)}"`} data-runtime-url="${escapeHtml(options.runtimeUrl)}" data-surface="page"${options.chunk3d === undefined ? '' : ` data-chunk-3d="${escapeHtml(options.chunk3d)}"`} data-view-kind="browser" data-namespace="${escapeHtml(options.namespace)}"${options.editing ? ' data-run="test"' : ''} data-mode="${options.look.mode}" data-locale="${options.look.language}"${options.blank === true ? ' data-blank="true"' : ''} data-status="loading">`,
        '<div class="editor" id="editor"></div>',
        '<div class="alone" id="alone"></div>',
        `<p class="hint" id="hint" role="status" hidden>${escapeHtml(t['shell.hintBefore'])} <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>-</kbd> ${escapeHtml(t['shell.hintAfter'])}</p>`,
        `<script type="application/json" id="magnetic-models">${JSON.stringify(models).replace(/</g, '\\u003c')}</script>`,
        textBlock(options.look.language),
        `<script src="/assets/page/${escapeHtml(options.pageBundle)}.js"></script>`,
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

/** The board of apps of the app's workspace, with the app's tile selected: where zooming out of the editor goes */
function boardOf(options: ShellPageOptions): string {
    return '/orgs/' + (options.org === undefined ? 'me' : encodeURIComponent(options.org)) + '?app=' + encodeURIComponent(options.appId);
}

/** `/assets/shell.css`, after the host's `page.css`: the canvas, and the editor's frame around it */
export const SHELL_CSS = `${schemeCss(
    '--ink: #1b1d22; --muted: #5d6470; --paper: #ffffff; --soft: #f3f4f7; --accent: #3047d8; --dot: #c9cdd6; --shadow: 0 2px 6px rgba(20, 24, 40, 0.08), 0 8px 24px rgba(20, 24, 40, 0.1);',
    '--ink: #e8eaee; --muted: #a2a8b3; --paper: #15171c; --soft: #1e2128; --accent: #8c9cff; --dot: #353a45; --shadow: 0 2px 6px rgba(0, 0, 0, 0.35), 0 8px 24px rgba(0, 0, 0, 0.35);'
)}
html, body.shell { height: 100%; margin: 0; overflow: hidden; }
body.view.shell { display: block; font-family: system-ui, sans-serif; color: var(--ink); background: var(--paper); }
/* The editor covers the window above the canvas and takes only the presses on its panels: its stage lets the rest
   through (passThrough), and so does the element it is mounted on. Without the editor it is out of sight but loaded,
   to come back at once */
.editor { position: fixed; inset: 0; z-index: 3; pointer-events: none; }
.editor > .stateui-panel { position: absolute; inset: 0; overflow: hidden; }
body.shell:not(.editing) .editor { visibility: hidden; }
body.shell:not(.editing) .editor * { pointer-events: none !important; }
/* Without the editor the app is all there is: it fills the window */
.alone { position: fixed; inset: 0; z-index: 1; overflow: auto; background: var(--paper); }
body.shell.editing .alone { display: none; }
/* The whole page is what a zoom to or from a board grows or shrinks (zoom.ts) */
body.shell { view-transition-name: zoom; }
/* A screen's menu, opened from its tile */
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
body.view.shell[data-status]::after { top: 0.9rem; right: auto; left: 50%; transform: translateX(-50%); padding: 0.3rem 0.7rem; border-radius: 1rem; background: var(--paper); box-shadow: var(--shadow); z-index: 3; }
.hint { position: fixed; z-index: 4; left: 50%; bottom: 1rem; transform: translateX(-50%); margin: 0; padding: 0.45rem 0.9rem; border-radius: 1rem; background: var(--ink); color: var(--paper); font: 0.85rem system-ui, sans-serif; box-shadow: var(--shadow); transition: opacity 0.4s; pointer-events: none; }
.hint[hidden] { display: none; }
.hint.gone { opacity: 0; }
.hint kbd { font: inherit; font-weight: 600; }
body.shell.editing .hint { display: none; }
${ZOOM_CSS}`;

/**
 * `/assets/layers.css`: the inspector's layer (`/assets/inspect.js`) and the views' layers (`/assets/views.js`) over
 * the board. They are drawn in the board page's own element, inside its embeddedApp's shadow root, where the page's
 * sheets do not reach: the shell links this sheet there (`magneticShell.boardLayer`). The colours are the page's custom
 * properties, which the shadow root inherits
 */
export const LAYERS_CSS = `.inspect-layer { position: absolute; left: 0; top: 0; z-index: 2; transform-origin: 0 0; pointer-events: none; }
.inspect-layer[hidden], .inspect-layer .shield[hidden] { display: none; }
.inspect-layer .shield { position: absolute; inset: 0; z-index: 1; pointer-events: auto; }
.inspect-layer.selecting .shield { cursor: crosshair; }
.inspect-layer.moving .shield { cursor: grab; }
.inspect-layer.dragging .shield { cursor: grabbing; }
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

/*
 * Magnetic's pages the editor places by name, as an embeddedApp's app: the page's app host opens each from its asset,
 * and the script that drives it takes its panel with magneticShell.page(name, { mounted, disposed }). Registered before
 * the editor mounts, so its embeddedApps find them
 */
const PLACED_PAGES = {
    [${JSON.stringify(SIDE_APP)}]: { url: '/assets/side.json', title: T['views.side'] },
    [${JSON.stringify(SCREENS_APP)}]: { url: '/assets/screens.json', title: T['screens.board'], keys: ['escape'] },
    [${JSON.stringify(STATENET_APP)}]: { url: '/assets/statenet.json', title: T['shell.view.statenet'] },
    [${JSON.stringify(THEME_APP)}]: { url: '/assets/theme.json', title: T['shell.view.theme'] },
    [${JSON.stringify(LOGIC_APP)}]: { url: '/assets/logic.json', title: T['shell.view.logic'] }
};
const BOARD_PAGE = ${JSON.stringify(SCREENS_APP)};
/** The documents of the placed pages, by name, as last opened: a script finds its nodes in it */
const placedDocuments = {};
/** The placed pages mounted now, by name: { panel, element } */
const placed = {};
/** What each placed page's script does when it is mounted and let go, by name */
const placedScripts = {};
host.pages({
    open(name) {
        const page = PLACED_PAGES[name];
        if (!page) return undefined;
        return fetch(page.url, { headers: { Accept: 'application/json' } })
            .then((response) => { if (!response.ok) throw new Error(T['views.refused']); return response.json(); })
            .then((served) => {
                placedDocuments[name] = served.document;
                return { document: served.document, icons: served.icons, title: page.title, ...(page.keys && { keys: page.keys }) };
            });
    },
    mounted(name, panel, element) {
        placed[name] = { panel, element };
        if (name === BOARD_PAGE) holdLayers();
        if (placedScripts[name]) placedScripts[name].mounted(panel, element, placedDocuments[name]);
    },
    // An editor mounted again may mount the page again before the old one is let go: only the page mounted now counts
    disposed(name, panel) {
        if (!placed[name] || placed[name].panel !== panel) return;
        delete placed[name];
        if (placedScripts[name] && placedScripts[name].disposed) placedScripts[name].disposed();
    }
});

/*
 * The layers drawn over the board (the inspector's, the views'): in the board page's own element, after its panel, so
 * they lie over its canvas and under the editor's panels. The element is in its embeddedApp's shadow root, where the
 * page's sheets do not reach: layers.css is linked there. A board mounted again takes the layers again
 */
const boardLayers = [];
function holdLayers() {
    const board = placed[BOARD_PAGE];
    if (!board) return;
    const root = board.element.getRootNode();
    if (root instanceof ShadowRoot && !root.querySelector('link[data-layers]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = '/assets/layers.css';
        link.dataset.layers = '';
        root.prepend(link);
    }
    board.element.style.position = 'relative';
    for (const layer of boardLayers) if (layer.parentNode !== board.element) board.element.append(layer);
}

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
    panel = host.mount(holder, { document: editor.document, icons: editor.icons, inPage: true }, T['editor.title']);
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
        const body = await response.json();
        grants = body.grants || [];
        // An app in an org: whether everyone in the org may open and use it
        ed({ notInOrg: !body.org, orgOpen: Boolean(body.org && body.org.open) });
        showLinks();
    } catch { shareSays(T['share.loadFailed']); }
}
/**
 * The component library beside the rail: shown when the editor opens on a wide window, and after that as the person
 * last left it in this browser. The rail's button is soft while it shows. A fitted board fits again around it (screens.js)
 */
let libraryOpen = null;
let screensOpen = false;
let connectionsOpen = false;
let sharedOpen = false;
function showLibraryPanel(open, remember) {
    const before = openStart();
    libraryOpen = open;
    if (open && screensOpen) showScreensPanel(false);
    if (open && connectionsOpen) showConnectionsPanel(false);
    if (open && sharedOpen) showSharedPanel(false);
    ed({ libraryHidden: !open, libraryLook: open ? 'soft' : 'ghost', libraryTone: open ? 'accent' : 'neutral' });
    if (remember) { try { localStorage.setItem('magnetic.library', open ? '1' : '0'); } catch { /* storage may be blocked */ } }
    openEnd(before);
}
/** The Screens panel takes the library's place beside the rail: opening one closes the other */
function showScreensPanel(open) {
    const before = openStart();
    screensOpen = open;
    if (open && libraryOpen) showLibraryPanel(false, false);
    if (open && connectionsOpen) showConnectionsPanel(false);
    if (open && sharedOpen) showSharedPanel(false);
    ed({ screensHidden: !open, screensLook: open ? 'soft' : 'ghost', screensTone: open ? 'accent' : 'neutral' });
    openEnd(before);
}
/**
 * The Connections panel, in the library's place too: the outside APIs the app's workspace has and their endpoints, from
 * GET /edit/<id>/connections (never a key or secret). Pressing an endpoint asks the agent to show what it answers in
 * the app; Manage opens the Connections page of the workspace, for those who manage it
 */
function showConnectionsPanel(open) {
    const before = openStart();
    connectionsOpen = open;
    if (open && libraryOpen) showLibraryPanel(false, false);
    if (open && screensOpen) showScreensPanel(false);
    if (open && sharedOpen) showSharedPanel(false);
    ed({ connectionsHidden: !open, connectionsLook: open ? 'soft' : 'ghost', connectionsTone: open ? 'accent' : 'neutral' });
    if (open) void loadConnections();
    openEnd(before);
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
    const before = openStart();
    sharedOpen = open;
    if (open && libraryOpen) showLibraryPanel(false, false);
    if (open && screensOpen) showScreensPanel(false);
    if (open && connectionsOpen) showConnectionsPanel(false);
    ed({ sharedHidden: !open, sharedLook: open ? 'soft' : 'ghost', sharedTone: open ? 'accent' : 'neutral' });
    if (open) void loadShared();
    openEnd(before);
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
let sheet = null;
function showSheet(name, open) {
    const before = openStart();
    sheet = open ? name : sheet === name ? null : sheet;
    ed({ shareHidden: name === 'share' ? !open : true, prefsHidden: name === 'prefs' ? !open : true, feedbackHidden: name === 'feedback' ? !open : true });
    openEnd(before);
}
/** Opens or closes a sheet or a panel the address names, as its button would */
function openNamed(name, open) {
    switch (name) {
        case 'share': showSheet('share', open); if (open) { shareSays(''); void loadLinks(); } return;
        case 'prefs': ed({ prefsStatus: '' }); showSheet('prefs', open); return;
        case 'feedback': ed({ feedbackStatus: '' }); showSheet('feedback', open); return;
        case 'screens': showScreensPanel(open); return;
        case 'connections': showConnectionsPanel(open); return;
        case 'shared': showSharedPanel(open); return;
    }
}

/*
 * Where the person is, in the address (docs/design/magnetic-zoom.md, "Where you are is in the URL"), so Back, Forward,
 * a reload and a shared link go there:
 * - the editor or the app alone: /edit/<id> or /apps/<id>; zooming between them pushes an entry;
 * - the screen: /screens/<name> after it, once it changes (a bare /edit/<id> is the screen the app is on); a screen
 *   chosen pushes an entry, the board following the view replaces it (screens.js);
 * - the board's view in the editor: #x,y,zoom while it is the person's own and not the board's fit, replaced as it rests;
 * - what is open in the editor: ?open= with the panel beside the rail (screens, connections, shared) and the sheet
 *   (share, prefs, feedback). Opening one pushes an entry; closing it right after goes back to the entry before it.
 * The library, the inspector and the views are not in it: the library is a layout kept in this browser, the
 * inspector follows the selection, and a view is kept per app.
 */
const SCREEN_NAME = /^[a-z][a-z0-9-]*$/;
const OPEN_NAMES = ['screens', 'connections', 'shared', 'share', 'prefs', 'feedback'];
/** The address read: { editing, screen, view, open } */
function addressNow() {
    const parts = location.pathname.split('/');
    const screen = parts[3] === 'screens' && SCREEN_NAME.test(parts[4] || '') ? parts[4] : null;
    const numbers = location.hash.slice(1).split(',').map((part) => (part.trim() === '' ? NaN : Number(part)));
    const view = numbers.length === 3 && numbers.every(Number.isFinite) && numbers[2] > 0 ? { x: numbers[0], y: numbers[1], zoom: numbers[2] } : null;
    const asked = (new URLSearchParams(location.search).get('open') || '').split(',');
    return { editing: parts[1] === 'edit', screen, view, open: OPEN_NAMES.filter((name) => asked.includes(name)) };
}
/** The address of a place: the view and what is open only with the editor, other query parameters kept */
function addressOf(at) {
    const query = new URLSearchParams(location.search);
    if (at.editing && at.open.length > 0) query.set('open', at.open.join(','));
    else query.delete('open');
    const search = query.toString().replace(/%2C/g, ',');
    const view = at.editing && at.view ? '#' + Math.round(at.view.x) + ',' + Math.round(at.view.y) + ',' + Number(at.view.zoom.toFixed(3)) : '';
    return (at.editing ? '/edit/' : '/apps/') + encodeURIComponent(appId) + (at.screen ? '/screens/' + at.screen : '') + (search ? '?' + search : '') + view;
}
let address = addressNow();
/** Who hears Back and Forward: (address, the address before) */
const addressListeners = [];
/** Moves the address to a place: a new entry (push, with state as the entry's), or this one replaced */
function go(change, how = {}) {
    address = { ...address, ...change };
    const url = addressOf(address);
    if (url === location.pathname + location.search + location.hash) return;
    if (how.push) history.pushState(how.state || null, '', url);
    else history.replaceState(history.state, '', url);
}
/** What is open now, as the address names it */
function openNow() {
    return OPEN_NAMES.filter((name) => (name === 'screens' ? screensOpen : name === 'connections' ? connectionsOpen : name === 'shared' ? sharedOpen : sheet === name));
}
/** A panel or sheet opening closes others: only the outermost change is remembered, once, and none made from the address */
let openDepth = 0;
let applying = false;
function openStart() { openDepth += 1; return openNow(); }
function openEnd(before) {
    openDepth -= 1;
    if (openDepth > 0 || applying) return;
    const after = openNow();
    if (after.join() === before.join()) return;
    const opened = after.find((name) => !before.includes(name));
    if (opened) { go({ open: after }, { push: true, state: { opened, before: location.pathname + location.search + location.hash } }); return; }
    // Closing what the last entry opened, with nothing else changed since, goes back to the entry before it
    const entry = history.state;
    if (entry && before.includes(entry.opened) && !after.includes(entry.opened) && entry.before === addressOf({ ...address, open: after })) {
        address = { ...address, open: after };
        history.back();
        return;
    }
    go({ open: after });
}
/** Opens and closes what the address names, without remembering it again */
function applyOpen(names) {
    applying = true;
    try {
        for (const name of OPEN_NAMES) if (names.includes(name) !== openNow().includes(name)) openNamed(name, names.includes(name));
    } finally { applying = false; }
}
addEventListener('popstate', () => {
    const was = address;
    address = addressNow();
    if (editing()) applyOpen(address.open);
    for (const listener of addressListeners) listener(address, was);
});

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
        const refused = await post('/feedback', { kind: feedbackKind, text, context: { size: size + ' ' + frameSize().join('×'), language: document.documentElement.lang } });
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
/** The person closed the blank app's hint: it stays closed until the page loads again */
let hintClosed = false;
/** The blank app's hint shows over the frame of a blank app with screens, while the chat is closed, in the Screens view, until closed */
function hintHidden() { return hintClosed || chatOpen || !editorState.blank || noScreens || appView; }
/** Something was put on the app (inspect.js): it is no longer blank, and the hint goes */
function appChanged() { if (editorState.blank) ed({ blank: false, notBlank: true, hintHidden: true }); }
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
        // The choice is made: the page loads again without the choices sheet open
        go({ open: address.open.filter((name) => name !== 'prefs') });
        location.reload();
    } catch { ed({ prefsStatus: T['prefs.failed'] }); }
}

emitListeners.push((name, payload) => {
    const value = valueOf(payload);
    switch (name) {
        case 'home': location.assign('/'); return;
        case 'open': window.open(addressOf({ ...address, editing: false }), '_blank', 'noopener'); return;
        case 'size': setSize(String(value)); return;
        case 'frame': setSize(size, String(value)); return;
        case 'turn': turned = !turned; setSize(size); return;
        case 'zoomIn': case 'zoomOut': case 'zoomReset': case 'zoomFit': zoom(name); return;
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
        case 'orgOpen': void (async () => {
            const open = Boolean(value);
            const refused = await post('/share/org', { open });
            if (refused !== undefined) { shareSays(refused); ed({ orgOpen: !open }); return; }
            ed({ orgOpen: open });
            shareSays(open ? T['share.orgOpened'] : T['share.orgClosed']);
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
        case 'hintClose': hintClosed = true; ed({ hintHidden: true }); return;
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

// The canvas is the screens board's (screens.js), a page the editor places that pans and zooms itself. The page keeps the size the app's
// screens have on it, kept per app in this browser, and the tools; the zoom control and its keys drive the board, or
// Statenet while it shows (views.js)
// The common sizes of each device, in CSS pixels, landscape for Desktop and portrait for Tablet and Phone; the first is
// the device's default. The board fits the frame into the canvas, so a frame keeps its device's shape on any window
const SIZES = {
    desktop: ['1280x800', '1366x768', '1440x900', '1536x864', '1920x1080', '2560x1440'],
    tablet: ['834x1112', '768x1024', '810x1080', '820x1180', '800x1280', '1024x1366'],
    phone: ['390x844', '360x800', '375x667', '393x852', '412x915', '430x932']
};
const FRAME_KEY = 'magnetic.frame.' + appId;
let size = 'desktop';
/** The frame's size among its device's (SIZES), as <width>x<height> before it is turned */
let frame = SIZES.desktop[0];
/** The frame is turned: its width and height swap, landscape to portrait or back */
let turned = false;
let tool = 'use';
let spaceHeld = false;
/** What the zoom control and its keys drive: the board (base, screens.js), or Statenet while it shows (driver, views.js); each { zoomIn, zoomOut, zoomReset, fit } */
let baseDriver = null;
let driver = null;
/** The board's zoom, shown again when Statenet hands the zoom back */
let baseZoom = 1;

function keepFrame() {
    try { localStorage.setItem(FRAME_KEY, JSON.stringify({ size, frame, turned })); } catch { /* storage may be blocked */ }
}

// Where the frame can show without the floating panels covering it: right of the rail, below the corners, above the
// chat bar and the zoom, and left of the inspector when it is open and tall. Without overlays it leaves out the panels
// that open over the canvas (the inspector and the library or screens list beside the rail): the stage area
function freeArea(overlays = true) {
    const box = (key) => panels.get(key);
    // The rail down the left, or below 760px the one along the top
    const rail = box('railTop') || box('rail');
    const upright = Boolean(rail) && rail.height > rail.width;
    const corner = box('nameCorner');
    const bar = box('chatBar');
    const zoomBox = box('zoom');
    const inspector = overlays ? box('inspector') : null;
    // The library beside the rail, when it shows down the side rather than as a sheet across the bottom
    const library = !overlays ? null : libraryOpen ? box('library') : screensOpen ? box('screens') : connectionsOpen ? box('connections') : sharedOpen ? box('shared') : null;
    const left = library && library.height > innerHeight / 2 && library.x < innerWidth / 2 ? library.x + library.width + 24 : upright ? rail.x + rail.width + 24 : 24;
    const top = Math.max(corner ? corner.y + corner.height : 0, rail && !upright ? rail.y + rail.height : 0) + 32;
    const right = (inspector && inspector.height > innerHeight / 2 ? inspector.x : innerWidth) - 24;
    const bottom = Math.min(bar ? bar.y : innerHeight, zoomBox ? zoomBox.y : innerHeight) - 24;
    return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

const sizeListeners = [];
/** Who is told when the free area changes (the editor's panels moved), and when the editor shows or goes */
const areaListeners = [];
/** The stage area: what the editor's fixed panels leave of the canvas, which the panels that open over it do not change */
function stageArea() { return freeArea(false); }

let lastArea = '';
let lastStage = '';
function areaChanged() {
    const area = JSON.stringify(freeArea());
    const stage = JSON.stringify(stageArea());
    if (area === lastArea && stage === lastStage) return;
    lastArea = area;
    lastStage = stage;
    for (const listener of areaListeners) listener();
}

/** Zooms the board, or what drives the zoom in its place */
function zoom(kind) {
    const to = driver || baseDriver;
    if (to) to[kind === 'zoomFit' ? 'fit' : kind]();
}

/** The frame size, in the frame's pixels: the chosen size of its device, swapped when the frame is turned */
function frameSize() {
    const [width, height] = frame.split('x').map(Number);
    return turned ? [height, width] : [width, height];
}

/**
 * Chooses the frame's device and its size among the device's common sizes: a size the device does not have (another
 * device's, or none) gives the device's default. The size picker lists the device's sizes
 */
function setSize(id, dimensions = frame) {
    size = id in SIZES ? id : 'desktop';
    frame = SIZES[size].includes(dimensions) ? dimensions : SIZES[size][0];
    keepFrame();
    ed({ size, frame, frames: Object.fromEntries(SIZES[size].map((key) => [key, { _label: key.replace('x', ' × ') }])) });
    for (const listener of sizeListeners) listener();
}

function moving() { return tool === 'move' || spaceHeld; }

function showTool() {
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

/** The editor's keys: pressed on the page, or raised by an app in it that names them (the board's Escape) */
const TOOL_KEYS = {
    v: () => setTool('use'),
    h: () => setTool('move'),
    s: () => setTool('select'),
    '=': () => zoom('zoomIn'),
    '-': () => zoom('zoomOut'),
    '0': () => zoom('zoomReset'),
    '1': () => zoom('zoomFit'),
    a: () => showLibraryPanel(!libraryOpen, true),
    p: () => showScreensPanel(!screensOpen),
    c: () => showConnectionsPanel(!connectionsOpen),
    d: () => showSharedPanel(!sharedOpen),
    escape: () => { for (const listener of escapeListeners) if (listener()) return true; if (chatOpen) { showChat(false); return true; } return false; }
};
/** What Escape lets go of, in turn: inspect.js adds placing and the selection, screens.js the selected screen */
const escapeListeners = [];

/** The person is typing: the key's own target, inside any app's shadow DOM, is a field */
function typing(event) { const target = event.composedPath()[0]; return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)); }

document.addEventListener('keydown', (event) => {
    const level = zoomChord(event);
    if (level) { event.preventDefault(); if (level === 'in') zoomIn(); else zoomOut(); return; }
    if (!editing() || event.ctrlKey || event.metaKey || event.altKey || typing(event)) return;
    if (event.key === ' ') { event.preventDefault(); if (!spaceHeld) { spaceHeld = true; showTool(); } return; }
    // Escape on the page is inspect.js's
    const run = event.key === 'Escape' ? undefined : TOOL_KEYS[event.key.toLowerCase()] || (event.key === '+' ? TOOL_KEYS['='] : undefined);
    if (run) { event.preventDefault(); run(); }
});
document.addEventListener('keyup', (event) => { if (event.key === ' ' && spaceHeld) { event.preventDefault(); spaceHeld = false; showTool(); } });
addEventListener('blur', () => { if (spaceHeld) { spaceHeld = false; showTool(); } });

// Where the editor's floating panels are (each child of the stage, as the editor says now and whenever they move), so
// the canvas knows what of the window they cover
const panels = new Map();
function placePanels(nodes) {
    panels.clear();
    for (const node of nodes || []) {
        const key = node.path.slice(node.path.lastIndexOf('.') + 1);
        if (node.rect.width < 1 || node.rect.height < 1) continue;
        panels.set(key, node.rect);
    }
    if (panels.size > 0) areaChanged();
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
    panel.watch(children, placePanels);
}

// The editor shows and hides by zooming (Ctrl+Shift+= and Ctrl+Shift+-), from the page or, through the runtime, from
// the app or the editor
function editing() { return document.body.classList.contains('editing'); }

/** 'in' for Ctrl+Shift+= (Ctrl+Shift++ on the keypad), 'out' for Ctrl+Shift+-, else null; Cmd on a Mac */
function zoomChord(event) {
    if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.altKey) return null;
    if (event.key === '+' || event.key === '=' || event.code === 'NumpadAdd') return 'in';
    if (event.key === '_' || event.key === '-' || event.code === 'NumpadSubtract') return 'out';
    return null;
}

/** What screens.js picks to zoom into: the selected screen, else the one most in view; null leaves the screen as it is */
let zoomPick = () => null;

/** Zooming in: from the editor to the running app's own page, on the screen picked; the running app goes no further */
function zoomIn() {
    if (!editing()) return;
    location.assign(addressOf({ ...address, editing: false, screen: zoomPick() || address.screen, view: null, open: [] }));
}

/** Zooming out: from the running app to the editor's page, on the screen that was showing; from the editor to the board of apps of its workspace, on its tile */
function zoomOut() {
    if (!editing()) location.assign(addressOf({ ...address, editing: true, view: null, open: [] }));
    else location.assign(document.body.dataset.board || '/');
}


// A chord an app in the page names comes as stateui:key: the live app's zoom chords (data-host-keys), the board's Escape
addEventListener('stateui:key', (event) => {
    const key = event.detail && event.detail.key;
    if (key === ${JSON.stringify(ZOOM_KEYS.in)}) zoomIn();
    else if (key === ${JSON.stringify(ZOOM_KEYS.out)}) zoomOut();
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
    /**
     * A placed page's script: mounted(panel, element, document) now if it is mounted, and each time it is; disposed()
     * when it goes
     */
    page(name, script) {
        placedScripts[name] = script;
        if (placed[name]) script.mounted(placed[name].panel, placed[name].element, placedDocuments[name]);
    },
    /** Draws a layer over the board, now and whenever the board is mounted again (inspect.js, views.js) */
    boardLayer(node) {
        boardLayers.push(node);
        holdLayers();
    },
    /** Where the board's element is in the window, which the layers in it are placed from: { left, top } */
    boardOrigin() {
        const board = placed[BOARD_PAGE];
        const box = board ? board.element.getBoundingClientRect() : null;
        return box ? { left: box.left, top: box.top } : { left: 0, top: 0 };
    },
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
    /** The app has screens (false) or none (true): screens.js says */
    noScreens(on) {
        if (noScreens === on) return;
        noScreens = on;
        ed({ hintHidden: hintHidden() });
    },
    /** The editor shows (true) or goes (false): screens.js moves the live app between the board and the window */
    /** screens.js: picks the screen to zoom into from the editor and makes it the one worked on; returns its name */
    onZoomIn: (pick) => { zoomPick = pick; },
    canvas: {
        /** The size of the app's screens, in their own pixels */
        size: frameSize,
        onSize: (listener) => sizeListeners.push(listener),
        /** Where the board shows without the editor's panels covering it, in window pixels: { left, top, width, height } */
        freeArea,
        /** Where the board fits: the free area without the panels that open over the canvas, so they cover the app rather than shrink it */
        stageArea,
        /** Calls back when the free area changes: the editor's panels showed, moved or went */
        onArea: (listener) => areaListeners.push(listener),
        /** The board's zoom (screens.js): { zoomIn, zoomOut, zoomReset, fit }, what the zoom control drives when nothing else does */
        base(next) { baseDriver = next; },
        /**
         * Hands the zoom control and its keys to Statenet (views.js): { zoomIn, zoomOut, zoomReset, fit }, or null to give
         * them back to the board
         */
        drive(next) { driver = next; if (!driver) ed({ zoom: Math.round(baseZoom * 100) + '%' }); },
        /** Shows a zoom (1 is 100%) on the zoom control: the board's (from 'base'), or Statenet's while it drives */
        showZoom(value, from) {
            if (from === 'base') baseZoom = value;
            if ((from === 'base') === !driver) ed({ zoom: Math.round(value * 100) + '%' });
        }
    },
    /**
     * The address (screens.js): now() is { editing, screen, view, open }; go(change, { push }) moves it; onChange(listener)
     * hears Back and Forward with the address and the one before
     */
    address: {
        now: () => address,
        go,
        onChange: (listener) => addressListeners.push(listener)
    },
    editorChanged,
    appChanged,
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
NARROW.addEventListener('change', showWidth);
PHONE.addEventListener('change', showWidth);

/** Everything the editor shows, written again after it (re)loads */
function showAll() {
    const blank = document.body.dataset.blank === 'true' && messages.length === 0;
    ed({
        appName: document.body.dataset.appName || '',
        workspaceName: document.body.dataset.workspaceName || T['shell.ownWorkspace'],
        size,
        frame,
        frames: Object.fromEntries(SIZES[size].map((key) => [key, { _label: key.replace('x', ' × ') }])),
        mode: document.documentElement.dataset.mode || 'system',
        language: document.documentElement.lang || 'en',
        blank,
        notBlank: !blank,
        hintHidden: hintClosed || !blank || chatOpen || noScreens || appView,
        models: Object.fromEntries(MODELS.map((item) => [item.id, { _label: item.label }])),
        model,
        noModels: MODELS.length < 2 || PHONE.matches
    });
    showTool();
    showMessages();
    showCalls();
    showFocus();
    setRunning(running);
    showChat(chatOpen);
    showWidth();
    showLibraryPanel(libraryOpen === null ? libraryAtFirst() : libraryOpen, false);
    if (editing()) { applyOpen(address.open); watchStage(); }
}

(function startCanvas() {
    let kept = null;
    try { kept = JSON.parse(localStorage.getItem(FRAME_KEY) || 'null'); } catch { /* storage may be blocked */ }
    turned = Boolean(kept && kept.turned === true);
    setSize((kept && kept.size) || (innerWidth < 760 ? 'phone' : 'desktop'), kept && typeof kept.frame === 'string' ? kept.frame : undefined);
    showTool();
})();

// The running app's page loads no editor: Ctrl+Shift+- loads the editor's page
if (host && editing()) {
    const asked = new URLSearchParams(location.search).get('editor');
    const which = asked === 'default' || asked === 'code' ? asked : 'own';
    mountEditor(which).then(showAll, () => { if (NEXT_EDITOR[which]) void mountEditor(NEXT_EDITOR[which]).then(showAll); });
}
`;
