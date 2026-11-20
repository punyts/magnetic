import { SCRIPT_TEXTS } from './text.js';

/**
 * `/assets/views.js`: the editor's views (docs/design/magnetic-show-views.md), after `/assets/shell.js`,
 * `/assets/inspect.js` and `/assets/screens.js`.
 *
 * The view selector at the top right (the editor app's `view` emit) picks what the canvas shows, kept per app in this
 * browser:
 *
 * - **Screens**: the board of screens, with the rail's tools. The rail's layers draw on every screen tile: Layout
 *   outlines each node that lays out others with its key and layout (measured in a mounted frame, a schematic drawn
 *   from the document on a name tile); Data lists the state paths the screen reads and writes down its right edge,
 *   `$.external` ones as from outside; Logic marks the nodes with handlers, lists the app's units that touch the
 *   screen down its left edge, each marked Server or Browser, and draws an arrow to each screen it leads to.
 * - **Statenet**: the owner's tree by state path from `GET /edit/<id>/views/graph`, shown by Magnetic's page
 *   `magnetic-statenet` (`src/statenet/StatenetPage.ts`) mounted on the board: a canvas that pans and zooms, `import { SCRIPT_TEXTS } from './text.js';

/**
 * `/assets/views.js`: the editor's views (docs/design/magnetic-show-views.md), after `/assets/shell.js`,
 * `/assets/inspect.js` and `/assets/screens.js`.
 *
 * The view selector at the top right (the editor app's `view` emit) picks what the canvas shows, kept per app in this
 * browser:
 *
 * - **Screens**: the board of screens, with the rail's tools. The rail's layers draw on every screen tile: Layout
 *   outlines each node that lays out others with its key and layout (measured in a mounted frame, a schematic drawn
 *   from the document on a name tile); Data lists the state paths the screen reads and writes down its right edge,
 *   `$.external` ones as from outside; Logic marks the nodes with handlers, lists the app's units that touch the
 *   screen down its left edge, each marked Server or Browser, and draws an arrow to each screen it leads to.
 with its
 *   branches on its right and left sides, every part with what the app does not use lying flat, and one level below a
 *   part. The editor's zoom runs the canvas's commands while it shows. Pressing a node opens its editor at the side: a dataset's records, a model's fields, a path of the state, a module's unit, a connection and
 *   its endpoints (for those who manage connections). A + on a branch or a part opens a form that makes what it holds
 *   and puts it to use in the app.
 * - **Theme**: the app's themes, and the chosen one as a specimen per mode above its tokens, each token's value for
 *   all modes and in each mode, edited in place. A theme other apps use asks first: edit it for all of them, or clone
 *   it for this app.
 * - **Logic**: the app's units in two lanes, Server and Browser, in the order they run: a machine as its states and
 *   transitions, a rule as when and do, a table and a compute by their inputs and outputs. Each is edited as JSON at
 *   the side, moved to the other lane or deleted; New makes one. The screens' handlers, which run in the browser, are
 *   listed below.
 *
 * Every change goes through the person's own tools on the server (`POST /edit/<id>/views/<what>`), as the agent's do;
 * a refusal shows the tool's message. The views' text is `T` (the page's texts), and the agent's next request is told
 * about the view shown (`magneticShell.contextOf`).
 */
/** `/assets/views.css`: the views' sheet, Statenet's frame, token table, lanes and tile layers (a file: the page's policy allows no inline style) */
export const VIEWS_CSS = [
    // The views are the editor's: with it hidden the app fills the window, whatever view was last shown
    'body.editing[data-view="theme"] #board, body.editing[data-view="logic"] #board { visibility: hidden; }',
    'body:not(.editing) .view-sheet, body:not(.editing) .statenet { display: none !important; }',
    // Statenet is its own page on the board, over the screens; its head and its editor float over it
    'body.editing[data-view="statenet"] #screens { visibility: hidden; }',
    '.view-sheet.on-canvas { z-index: 1; background: transparent; box-shadow: none; pointer-events: none; overflow: visible; }',
    '.view-sheet.on-canvas .view-head { pointer-events: auto; align-self: flex-start; max-width: 100%; box-sizing: border-box; border-bottom: 0; border-radius: 12px; background: var(--paper, #fff); box-shadow: var(--shadow, 0 1px 3px rgba(0,0,0,.2)); }',
    '.view-sheet.on-canvas .view-body { margin-top: 12px; }',
    '.view-sheet.on-canvas .view-head h2 { display: none; }',
    '.view-sheet.on-canvas .view-head:not(:has(.view-tools > *, .view-status:not(:empty), .view-back:not([hidden]))) { display: none; }',
    '.view-sheet.on-canvas .view-main { visibility: hidden; }',
    '@media (min-width: 760px) { .view-sheet.on-canvas .view-side { align-self: flex-start; max-height: 100%; } }',
    '.view-sheet.on-canvas .view-side { pointer-events: auto; border-left: 0; border-top: 0; border-radius: 12px; background: var(--paper, #fff); box-shadow: var(--shadow, 0 1px 3px rgba(0,0,0,.2)); }',
    '.view-sheet { position: fixed; z-index: 0; left: 12px; right: 12px; top: 64px; bottom: 96px; display: flex; flex-direction: column; background: var(--paper, #fff); color: var(--ink, #111); border-radius: 12px; box-shadow: var(--shadow, 0 1px 3px rgba(0,0,0,.2)); font: 14px/1.4 system-ui, sans-serif; overflow: hidden; }',
    '@media (max-width: 759.98px) { .view-sheet { top: 112px; left: 8px; right: 8px; bottom: 132px; } }',
    '.view-sheet[hidden] { display: none; }',
    '.view-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 12px 16px; border-bottom: 1px solid var(--line, #e3e3e3); }',
    '.view-head h2 { margin: 0 8px 0 0; font-size: 16px; }',
    '.view-tools { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }',
    '.view-status { margin-left: auto; color: var(--muted, #666); font-size: 13px; }',
    '.view-status.refused { color: #b3261e; }',
    '.view-body { flex: 1; display: flex; min-height: 0; }',
    '.view-main { flex: 1; overflow: auto; padding: 16px; position: relative; }',
    '.view-side { width: min(360px, 45%); overflow-x: hidden; overflow-y: auto; padding: 16px; border-left: 1px solid var(--line, #e3e3e3); }',
    '.view-side[hidden] { display: none; }',
    '.view-side-head { display: flex; align-items: flex-start; gap: 8px; } .view-side-head h3 { flex: 1; min-width: 0; margin-top: 0; overflow-wrap: anywhere; }',
    '.view-sheet .view-close, .view-close { flex: none; width: 32px; height: 32px; margin: -6px -6px 0 0; padding: 0; border: 0; display: grid; place-items: center; cursor: pointer; border-radius: 50%; color: inherit; background: transparent; }',
    '.glyph { display: block; width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }',
    '.view-close .glyph { width: 14px; height: 14px; }',
    '.view-sheet .view-close:hover, .view-close:hover { background: color-mix(in srgb, currentColor 14%, transparent); }',
    '@media (max-width: 759.98px) { .view-body { flex-direction: column; } .view-side { width: auto; border-left: 0; border-top: 1px solid var(--line, #e3e3e3); max-height: 50%; } }',
    '.view-sheet button, .view-sheet select, .view-sheet input, .view-sheet textarea { font: inherit; }',
    '.view-sheet button { border: 1px solid var(--line, #ccc); background: transparent; color: inherit; border-radius: 999px; padding: 3px 12px; cursor: pointer; }',
    '.view-sheet button.on { background: var(--accent, #3d5afe); border-color: var(--accent, #3d5afe); color: #fff; }',
    '.view-sheet button.danger { color: #b3261e; }',
    '.view-sheet input, .view-sheet select, .view-sheet textarea { border: 1px solid var(--line, #ccc); border-radius: 6px; padding: 3px 6px; background: var(--paper, #fff); color: inherit; }',
    '.view-sheet textarea { width: 100%; box-sizing: border-box; min-height: 220px; font-family: ui-monospace, monospace; font-size: 12px; }',
    '.view-sheet h3 { font-size: 14px; margin: 16px 0 8px; } .view-sheet h3:first-child { margin-top: 0; }',
    '.view-note { color: var(--muted, #666); font-size: 13px; margin: 4px 0; }',
    '.view-ask { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 10px 12px; margin-bottom: 12px; border-radius: 8px; background: color-mix(in srgb, var(--accent, #3d5afe) 10%, transparent); }',
    '.view-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 6px 0; }',
    // Statenet
    '.statenet { position: absolute; inset: 0; z-index: 2; } .statenet[hidden] { display: none; }',
    '.statenet > iframe { display: block; width: 100%; height: 100%; border: 0; }',
    '.view-schema { margin: 4px 0 8px; padding: 8px; overflow: auto; max-height: 220px; border-radius: 8px; font-size: 12px; background: color-mix(in srgb, currentColor 6%, transparent); }',
    // A record table scrolls on its own, sideways; the panel never does
    '.records-wrap { overflow-x: auto; max-width: 100%; margin: 8px 0; }',
    '.records tr.adding td { border-bottom: 0; padding-top: 8px; }',
    '.view-sheet button.remove { display: inline-grid; place-items: center; width: 28px; height: 28px; padding: 0; flex: none; vertical-align: middle; }',
    '.view-sheet button.remove .glyph { width: 10px; height: 10px; }',
    '.view-sheet button.remove:hover { background: color-mix(in srgb, currentColor 14%, transparent); }',
    '.view-field { display: grid; gap: 2px; margin: 8px 0; } .view-field > span { font-size: 12px; color: var(--muted, #666); }',
    '.view-output { white-space: pre-wrap; max-height: 200px; overflow: auto; }',
    '.view-back { font-weight: 600; }',
    '.view-link { color: var(--accent, #3d5afe); font-weight: 600; }',
    '.view-side .view-row button.screen { border-radius: 8px; }',
    '.records { border-collapse: collapse; font-size: 12px; } .records td, .records th { border-bottom: 1px solid var(--line, #eee); padding: 2px 4px; text-align: left; } .records input { width: 110px; }',
    // Theme
    '.specimens { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-bottom: 16px; }',
    '.specimen { border-radius: 12px; padding: 16px; border: 1px solid; }',
    '.specimen h4 { margin: 0 0 4px; font-size: 18px; } .specimen p { margin: 0 0 12px; } .specimen span { display: inline-block; padding: 4px 12px; border-radius: 999px; }',
    '.tokens { border-collapse: collapse; width: 100%; font-size: 13px; }',
    '.tokens th, .tokens td { border-bottom: 1px solid var(--line, #eee); padding: 4px 6px; text-align: left; vertical-align: middle; }',
    '.tokens th.group { padding-top: 16px; text-transform: uppercase; font-size: 11px; letter-spacing: .06em; color: var(--muted, #666); }',
    '.tokens .cell { cursor: text; border-radius: 4px; padding: 2px 4px; display: inline-flex; gap: 6px; align-items: center; }',
    '.tokens .cell:hover { background: color-mix(in srgb, var(--accent, #3d5afe) 8%, transparent); }',
    '.tokens .cell.set { font-weight: 600; }',
    '.swatch { width: 14px; height: 14px; border-radius: 4px; border: 1px solid rgba(0,0,0,.2); display: inline-block; }',
    // Logic
    '.lanes { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; } @media (max-width: 759.98px) { .lanes { grid-template-columns: 1fr; } }',
    '.lane h3 { display: flex; gap: 8px; align-items: center; }',
    '.unit { border: 1px solid var(--line, #ddd); border-radius: 10px; padding: 10px; margin-bottom: 10px; background: var(--paper, #fff); }',
    '.unit.chosen { outline: 2px solid var(--accent, #3d5afe); }',
    '.unit header { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }',
    '.unit-kind { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--accent, #3d5afe); }',
    '.unit-paths { font-family: ui-monospace, monospace; font-size: 11px; color: var(--muted, #666); overflow-wrap: anywhere; }',
    '.states { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0; } .state { border: 1px solid var(--line, #ccc); border-radius: 999px; padding: 1px 10px; font-size: 12px; } .state.initial { border-color: var(--accent, #3d5afe); }',
    '.flow { font-size: 12px; margin: 2px 0; overflow-wrap: anywhere; } .flow i { color: var(--muted, #666); font-style: normal; }',
    // The layers on the screen tiles, in the frame's pixels (they pan and zoom with the board)
    '.tile-layer { position: absolute; inset: 0; pointer-events: none; z-index: 3; font: calc(12px / var(--zoom, 1)) system-ui, sans-serif; }',
    '.tile-layer .lbox { position: absolute; border: calc(1.5px / var(--zoom, 1)) dashed #7c4dff; border-radius: calc(4px / var(--zoom, 1)); }',
    '.tile-layer .lbox > span { position: absolute; left: 0; top: 0; transform: translateY(-100%); background: #7c4dff; color: #fff; padding: 0 calc(4px / var(--zoom, 1)); border-radius: calc(3px / var(--zoom, 1)); white-space: nowrap; }',
    '.tile-layer .schematic { position: absolute; inset: 8%; display: flex; }',
    '.tile-layer .schematic div { flex: 1; display: flex; gap: 4%; padding: 3%; border: calc(1.5px / var(--zoom, 1)) dashed #7c4dff; border-radius: calc(4px / var(--zoom, 1)); min-height: 8%; position: relative; }',
    '.tile-layer .schematic span { position: absolute; left: 2px; top: 1px; color: #7c4dff; font-size: .9em; }',
    '.tile-layer .side { position: absolute; top: 0; display: flex; flex-direction: column; gap: calc(6px / var(--zoom, 1)); width: calc(220px / var(--zoom, 1)); pointer-events: auto; }',
    '.tile-layer .side.right { left: calc(100% + 12px / var(--zoom, 1)); } .tile-layer .side.left { right: calc(100% + 12px / var(--zoom, 1)); align-items: flex-end; }',
    '.tile-layer .chip { display: block; max-width: 100%; box-sizing: border-box; padding: calc(3px / var(--zoom, 1)) calc(8px / var(--zoom, 1)); border-radius: calc(999px / var(--zoom, 1)); background: var(--paper, #fff); border: calc(1px / var(--zoom, 1)) solid var(--line, #ccc); color: var(--ink, #111); font: inherit; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }',
    '.tile-layer .chip.outside { border-style: dashed; } .tile-layer .chip.data { border-color: #00897b; } .tile-layer .chip.unit { border-color: #f57c00; }',
    '.tile-layer .chip em { font-style: normal; opacity: .7; margin-left: .4em; }',
    '.tile-layer .badge { position: absolute; transform: translate(-50%, -50%); background: #f57c00; color: #fff; border-radius: 999px; padding: 0 calc(5px / var(--zoom, 1)); font-size: .9em; }',
    '.leads { position: absolute; left: 0; top: 0; width: 1px; height: 1px; overflow: visible; pointer-events: none; z-index: 3; }',
    '.leads path { fill: none; stroke: #f57c00; stroke-width: calc(3px / var(--zoom, 1)); }'
].join('\n');

export const VIEWS_JS = String.raw`${SCRIPT_TEXTS}(function views() {
const shell = window.magneticShell;
const host = window.stateuiHost;
if (!shell) return;
const editor = shell.editor;
const appId = document.body.dataset.appId;
const base = '/edit/' + encodeURIComponent(appId) + '/views';
// The board's content and the live app's element: detached until the layers reach the apps through their embeddedApp (B3c)
const world = document.createElement('div');
const artboard = document.createElement('div');
const VIEWS = ['screens', 'statenet', 'theme', 'logic'];
const LAYERS = ['layout', 'data', 'logic'];
const VIEW_KEY = 'magnetic.editorView.' + appId;
const LAYERS_KEY = 'magnetic.layers';
const UNIT_KINDS = { machines: 'machine', rules: 'rule', tables: 'table', computes: 'compute', effects: 'effect' };
/** What a new unit starts as, by group: the smallest the logic accepts */
const UNIT_TEMPLATES = {
    machines: { state: '$.data.status', initial: 'idle', transitions: [] },
    rules: { when: { path: '$.data.example' }, do: [] },
    tables: { inputs: [], outputs: [], rows: [] },
    computes: { inputs: [], run: '', outputs: [] },
    effects: { request: '$.data.request', run: '$.functions.host.http', status: '$.data.requestStatus' }
};

function stored(key, fallback) { try { const value = localStorage.getItem(key); return value === null ? fallback : JSON.parse(value); } catch { return fallback; } }
function store(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage may be blocked */ } }

let view = VIEWS.includes(stored(VIEW_KEY, 'screens')) ? stored(VIEW_KEY, 'screens') : 'screens';
const layers = Object.assign({ layout: false, data: false, logic: false }, stored(LAYERS_KEY, {}));

// ---- Elements ------------------------------------------------------------------------------------------------------


function element(tag, attributes, children) {
    const made = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes || {})) {
        if (value === undefined || value === null || value === false) continue;
        if (name === 'text') made.textContent = String(value);
        else if (name === 'onclick') made.addEventListener('click', value);
        else if (name === 'className') made.className = value;
        else made.setAttribute(name, value === true ? '' : String(value));
    }
    for (const child of children || []) if (child) made.append(child);
    return made;
}
function button(text, run, className) { const made = element('button', { type: 'button', text, className }); made.addEventListener('click', run); return made; }
/** Plus and cross drawn as strokes, so they sit at the centre of a round button whatever the font */
const GLYPHS = { plus: 'M6 1v10M1 6h10', cross: 'M2 2l8 8M10 2l-8 8' };
function glyph(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 12 12');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'glyph');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', GLYPHS[name]);
    svg.append(path);
    return svg;
}
/** A round button showing a glyph; label is its accessible name */
function glyphButton(name, label, run, className) {
    const made = element('button', { type: 'button', className }, [glyph(name)]);
    made.setAttribute('aria-label', label);
    made.addEventListener('click', run);
    return made;
}

const sheet = element('section', { className: 'view-sheet', id: 'view-sheet', hidden: true, 'aria-live': 'polite' });
const heading = element('h2');
const tools = element('div', { className: 'view-tools' });
const status = element('p', { className: 'view-status', role: 'status' });
const main = element('div', { className: 'view-main' });
const side = element('aside', { className: 'view-side', hidden: true });
/** Back to Statenet, shown in Theme or Logic when a card of the graph led there */
const back = element('button', { type: 'button', className: 'view-back', hidden: true, text: T['views.backToGraph'] });
back.addEventListener('click', () => setView('statenet'));
sheet.append(element('header', { className: 'view-head' }, [back, heading, tools, status]), element('div', { className: 'view-body' }, [main, side]));
document.body.append(sheet);

function says(text, refused) { status.textContent = text || ''; status.classList.toggle('refused', Boolean(refused)); }
function unchoose() { for (const chosen of document.querySelectorAll('.view-main .chosen')) chosen.classList.remove('chosen'); }
function closeSide() {
    side.hidden = true;
    side.replaceChildren();
    unchoose();
    chosenBox = null;
    if (view === 'statenet') netWrite({ selected: '', inset: insetOf() });
}

async function getJson(path) {
    const response = await fetch(base + path);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || T['views.loadFailed']);
    return body;
}
/** A change through the person's tools; the answer, or undefined after saying why it was refused */
async function change(what, body) {
    says(T['views.saving']);
    try {
        const response = await fetch(base + '/' + what, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const answer = await response.json().catch(() => ({}));
        if (!response.ok) {
            const first = Array.isArray(answer.errors) ? answer.errors.find((error) => error && error.severity !== 'warning') || answer.errors[0] : undefined;
            says((first && first.message) || answer.message || T['views.refused'], true);
            return undefined;
        }
        says(T['views.saved']);
        setTimeout(() => { if (status.textContent === T['views.saved']) says(''); }, 1500);
        return answer;
    } catch { says(T['views.refused'], true); return undefined; }
}
/** A typed value as JSON when it reads as JSON (a number, true, an object), else as the text typed */
function typed(text) { try { return JSON.parse(text); } catch { return text; } }
function shown(value) { return value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value); }

// ---- The view selector ---------------------------------------------------------------------------------------------

function contextOf() {
    if (view === 'theme') return ['theme'];
    if (view === 'statenet') return ['data'];
    if (view === 'logic') return ['logic'];
    return ['screens', ...LAYERS.filter((name) => layers[name])];
}
shell.contextOf = contextOf;

function showSelector() {
    editor.set({
        view,
        notScreensView: view !== 'screens',
        noBoard: view === 'theme' || view === 'logic',
        layers: { ...layers },
        layerLook: Object.fromEntries(LAYERS.map((name) => [name, layers[name] ? 'solid' : 'ghost'])),
        layerTone: Object.fromEntries(LAYERS.map((name) => [name, layers[name] ? 'accent' : 'neutral']))
    });
    // The chat bar shows what the view sends the agent: the view, and in Screens each layer that is on
    const chips = [{ key: 'view', text: T['shell.view.' + view] }];
    if (view === 'screens') for (const name of LAYERS) if (layers[name]) chips.push({ key: name, text: T['shell.layer.' + name] });
    shell.showContext(chips);
}

/** Shows a view; fromGraph when a card of Statenet led there, so the head offers the way back */
function setView(name, fromGraph) {
    if (!VIEWS.includes(name)) return;
    back.hidden = !(fromGraph && view === 'statenet' && (name === 'theme' || name === 'logic'));
    if (name !== 'statenet') leaveGraph();
    view = name;
    store(VIEW_KEY, view);
    document.body.dataset.view = view;
    showSelector();
    shell.appView(view !== 'screens');
    if (view === 'screens') {
        sheet.hidden = true;
        void drawLayers();
        return;
    }
    shell.setTool('use');
    shell.showInspector(false);
    sheet.hidden = false;
    sheet.classList.toggle('on-canvas', view === 'statenet');
    closeSide();
    says('');
    heading.textContent = T['shell.view.' + view];
    void load();
}

function load() {
    if (view === 'statenet') return loadGraph();
    if (view === 'theme') return loadTheme(chosenTheme);
    if (view === 'logic') return loadLogic();
    return Promise.resolve();
}

editor.onEmit((name, payload) => {
    const value = payload && typeof payload === 'object' && 'value' in payload ? payload.value : payload;
    // The selector echoes a view set from here: only a different view is a change
    if (name === 'view' && typeof value === 'string') { if (value !== view) setView(value); return; }
    const layer = /^layer(Layout|Data|Logic)$/.exec(name);
    if (layer) {
        const key = layer[1].toLowerCase();
        layers[key] = !layers[key];
        store(LAYERS_KEY, layers);
        showSelector();
        void drawLayers();
    }
});
shell.onEscape(() => { if (view !== 'screens' && !side.hidden) { closeSide(); return true; } return false; });

// ---- Statenet ------------------------------------------------------------------------------------------------------

/*
 * Statenet is Magnetic's page magnetic-statenet (src/statenet/StatenetPage.ts), mounted on the board while the view
 * shows: a canvas that pans and zooms around the owner's tree. This script writes its $.data.statenet (the cards, the
 * links, the chosen card, the view and what the panels cover), acts on its emits, and runs the commands of its canvas
 * (the node keyed canvas) for the editor's zoom
 */
const NET = '$.data.statenet';
/** Keeping where the person left the view waits this long after a pan or a zoom ends, so a run of them keeps one */
const NET_KEEP_MS = 500;
let netKeeping = 0;
const netHolder = element('div', { className: 'statenet', id: 'statenet', hidden: true });
document.getElementById('board').append(netHolder);
let graph = null;
/** The mounted page: its panel and the path of its canvas; null while Statenet does not show */
let net = null;
/** The mount under way, so a second load waits for it */
let netMounting = null;
/** The view is fitted to the tree once its cards are placed, when the person kept no view of the app's Statenet */
let netFitted = false;
/** The nodes and links last written, so a reload that left the tree as it was writes nothing */
let netDrawn = '';
/** The card a press chose, with its box in the tree, to bring into view beside the panel it opens */
let chosenBox = null;

/** The state path of the node a key names in a document, as shell.js finds the editor's stage */
function keyPath(doc, key) {
    const visit = (node, at) => {
        if (!node || typeof node !== 'object') return null;
        for (const [name, child] of Object.entries(node.children || {})) {
            if (name === key) return at + '.children.' + name;
            const found = visit(child, at + '.children.' + name);
            if (found) return found;
        }
        return null;
    };
    for (const [name, screen] of Object.entries(doc.screens || {})) {
        const found = visit(screen.root, '$.screens.' + name);
        if (found) return found;
    }
    return null;
}
function netWrite(fields) {
    if (net) net.panel.write(Object.entries(fields).map(([name, value]) => ({ path: NET + '.' + name, value })));
}
function netCommand(command, value) {
    if (net && net.canvas) net.panel.command(net.canvas, command, value);
}
/** What covers the canvas, in pixels from each edge: the editor's panels, and the side panel when it is open */
function insetOf() {
    const free = shell.canvas.freeArea();
    const inset = { top: free.top, left: free.left, right: Math.max(0, innerWidth - free.left - free.width), bottom: Math.max(0, innerHeight - free.top - free.height) };
    if (!side.hidden) {
        const over = side.getBoundingClientRect();
        // At 760px and wider the panel is at the right, below that along the bottom (as the sheet's CSS lays it out)
        if (matchMedia('(min-width: 760px)').matches) inset.right = Math.max(inset.right, innerWidth - over.left);
        else inset.bottom = Math.max(inset.bottom, innerHeight - over.top);
    }
    return inset;
}
addEventListener('resize', () => { if (net) netWrite({ inset: insetOf() }); });

/** Mounts Statenet's page on the board and gives it the editor's zoom */
function enterGraph() {
    netHolder.hidden = false;
    shell.canvas.drive({ zoomIn: () => netCommand('zoomIn'), zoomOut: () => netCommand('zoomOut'), zoomReset: () => netCommand('zoomReset'), fit: () => netCommand('fit') });
    if (net) return Promise.resolve(true);
    if (netMounting) return netMounting;
    netMounting = (async () => {
        try {
            // Where the person left the view is theirs on the server (GET kept), so it follows them to any browser
            const [response, kept] = await Promise.all([
                fetch('/assets/statenet.json', { headers: { Accept: 'application/json' } }),
                getJson('/kept?view=statenet').then((answer) => answer.place, () => null)
            ]);
            if (!response.ok) throw new Error(T['views.refused']);
            const page = await response.json();
            if (view !== 'statenet') return false;
            netHolder.replaceChildren();
            net = { panel: host.mount(netHolder, { document: page.document, icons: page.icons, keys: ['escape'] }, T['shell.view.statenet']), canvas: keyPath(page.document, 'canvas') };
            netDrawn = '';
            const look = kept && typeof kept.x === 'number' && typeof kept.y === 'number' && typeof kept.zoom === 'number' ? { x: kept.x, y: kept.y, zoom: kept.zoom } : null;
            netFitted = look !== null;
            netWrite({ view: look || { x: 0, y: 0, zoom: 1 }, inset: insetOf(), selected: '' });
            shell.canvas.showZoom(look ? look.zoom : 1);
            return true;
        } catch (error) {
            says(error.message, true);
            return false;
        } finally {
            netMounting = null;
        }
    })();
    return netMounting;
}
function leaveGraph() {
    if (net) net.panel.dispose();
    net = null;
    chosenBox = null;
    netHolder.replaceChildren();
    netHolder.hidden = true;
    shell.canvas.drive(null);
}

netHolder.addEventListener('stateui:emit', (event) => {
    const { name, payload } = event.detail || {};
    const id = payload && typeof payload === 'object' && typeof payload.id === 'string' ? payload.id : typeof payload === 'string' ? payload : '';
    const box = payload && typeof payload === 'object' ? payload.box : undefined;
    switch (name) {
        // A press on the chosen card lets it go, as the panel's x, a press on the empty canvas and Escape do
        case 'select': if (id) choose(id, box); else closeSide(); return;
        case 'open': if (id) choose(id, box); return;
        case 'press': closeSide(); return;
        case 'add': {
            const node = graph && graph.nodes.find((each) => each.id === id);
            if (node && node.add) { chosenBox = null; void addUnder(node, null); }
            return;
        }
        case 'view':
            if (payload && typeof payload.zoom === 'number') { keepNetView({ x: payload.x, y: payload.y, zoom: payload.zoom }); shell.canvas.showZoom(payload.zoom); }
            return;
        case 'layout': if (!netFitted) { netFitted = true; netCommand('fit'); } return;
        default:
    }
});

/** Keeps where the person left the view, once a run of pans and zooms ends; a refusal only loses the place */
function keepNetView(place) {
    clearTimeout(netKeeping);
    netKeeping = setTimeout(() => {
        void fetch(base + '/kept', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ view: 'statenet', place }) }).catch(() => undefined);
    }, NET_KEEP_MS);
}

/** A card was pressed: a part's editor opens beside it; the pill at the end of a branch shows all of its parts, or fewer */
function choose(id, box) {
    if (!graph) return;
    if (id.endsWith('#more')) {
        const branch = id.slice(0, -'#more'.length);
        if (graphOpened.has(branch)) graphOpened.delete(branch); else graphOpened.add(branch);
        netWrite({ selected: '' });
        drawGraph();
        return;
    }
    const node = graph.nodes.find((each) => each.id === id);
    if (!node) return;
    chosenBox = box && typeof box === 'object' ? { id, box } : null;
    if (node.kind === 'branch' || node.kind === 'owner') sideOpen(null, node.label, [element('p', { className: 'view-note', text: node.id })], node.id);
    else void openNode(node, null);
}

function kindText(node) { return T['views.kind.' + node.kind] || node.kind; }
function noteText(node) {
    const unused = node.used ? '' : T['views.note.unused'];
    const joined = (text) => [text, unused].filter(Boolean).join(' · ');
    switch (node.kind) {
        case 'app': return node.current ? T['views.note.authority'] + (node.count ? ' · ' + fill(T['views.note.shared'], { count: node.count }) : '') : T['views.note.anotherApp'];
        case 'theme': return joined(node.isDefault ? T['views.note.defaultTheme'] : '');
        case 'binding': return '$.data.' + node.note;
        case 'personal': return fill(T['views.note.personal'], { model: node.note });
        case 'dataset': return joined(node.note ? fill(T['views.note.ofModel'], { model: node.note }) : '');
        case 'record': return '';
        case 'unit': return T['views.unit.' + (UNIT_KINDS[node.note] || '')] || node.note;
        case 'shared': return fill(T['views.note.sharedBy'], { name: node.note || T['views.note.anotherOwner'] });
        case 'otherApp': return fill(T['views.note.otherApp'], { path: node.note });
        case 'persona': return T['views.note.persona'];
        case 'instance': return fill(T['views.note.lastUsed'], { date: new Date(node.updatedAt).toLocaleDateString(document.documentElement.lang || undefined) });
        case 'endpoint': return node.missing ? fill(T['views.note.missing'], { connection: node.note }) : node.note;
        case 'function': return joined(fill(T['views.note.function'], { kind: T['views.fn.' + node.note] || node.note, runs: node.fn.runs.map((side) => T['views.fn.' + side] || side).join(', ') }));
        case 'library': return joined('');
        case 'model': case 'module': case 'component': case 'connection': case 'pattern': return joined(node.note);
        default: return node.note;
    }
}
/** The leaves below a part: the diagram wraps them in one block beside it */
const LEAVES = ['screen', 'binding', 'personal', 'state', 'record', 'field', 'unit', 'endpoint', 'shared', 'otherApp', 'instance'];

/** How many parts a branch shows that the app does not use, before a pill for the rest */
const UNUSED_SHOWN = 6;
/** The branches whose every part shows, this visit */
const graphOpened = new Set();

/**
 * The nodes drawn: every branch, each part the app uses, and the first UNUSED_SHOWN others of a branch (all of them
 * once the branch is opened). A part the app does not use is drawn without what it holds; its editor shows that. The
 * server's tree lists a parent before its children, so one pass decides
 */
function shownNodes() {
    const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
    const shown = new Set();
    const unused = new Map();
    const hidden = new Map();
    for (const node of graph.nodes) {
        const parent = node.parent === null ? null : nodes.get(node.parent);
        if (parent && !shown.has(parent.id)) continue;
        const isPart = parent && parent.kind === 'branch' && parent.parent === '$';
        if (isPart && !node.used && !graphOpened.has(parent.id)) {
            const count = (unused.get(parent.id) || 0) + 1;
            unused.set(parent.id, count);
            if (count > UNUSED_SHOWN) { hidden.set(parent.id, (hidden.get(parent.id) || 0) + 1); continue; }
        }
        if (parent && parent.kind !== 'branch' && parent.kind !== 'owner' && !parent.used) continue;
        shown.add(node.id);
    }
    return { shown, hidden };
}

/** The load under way, whether another was asked for meanwhile, and the revision the last one read */
let graphLoading = null;
let graphAgain = false;
let graphRevision = null;

/**
 * Reads the tree and draws it, one load at a time: a load asked for while one runs runs once after it. The tree is
 * fetched while the page mounts
 */
async function loadGraph() {
    if (graphLoading) { graphAgain = true; return graphLoading; }
    graphLoading = (async () => {
        graphRevision = document.body.dataset.revision || null;
        const fetched = getJson('/graph');
        fetched.catch(() => undefined);
        if (!(await enterGraph())) return;
        try { graph = await fetched; } catch (error) { says(error.message, true); return; }
        drawGraph();
    })();
    try { await graphLoading; } finally { graphLoading = null; }
    if (graphAgain) { graphAgain = false; return loadGraph(); }
}

/** One card of the page: the record its template draws */
function cardOf(node, note) {
    const pill = node.kind === 'branch' || node.kind === 'owner';
    return {
        id: node.id,
        parent: node.parent || '',
        wrap: LEAVES.includes(node.kind),
        label: node.label,
        kind: pill ? '' : kindText(node),
        note,
        noKind: pill,
        noNote: !note,
        noAdd: !node.add,
        addLabel: node.add ? fill(T['views.addTo'], { path: node.id }) : '',
        // A part has room around its texts; a pill and a leaf of a block less
        padding: pill || LEAVES.includes(node.kind) ? 'sm' : 'md',
        corners: pill ? 'pill' : 'rounded',
        // A part the app does not use, or one outside the owner's, lies flat; the app being edited is selected
        elevation: pill || !node.used || node.outside ? 'flat' : 'raised',
        current: Boolean(node.current),
        muted: !pill && !node.used
    };
}

/** Writes the tree to Statenet's page: the cards shown, a pill at the end of each branch with parts left out, the links */
function drawGraph() {
    if (view !== 'statenet' || !graph || !net) return;
    tools.replaceChildren();
    const { shown, hidden } = shownNodes();
    const nodes = [];
    const pills = [];
    for (const node of graph.nodes) {
        if (!shown.has(node.id)) continue;
        const pill = node.kind === 'branch' || node.kind === 'owner';
        const note = pill ? '' : [noteText(node), node.more ? fill(T['views.note.more'], { count: node.more }) : ''].filter(Boolean).join(' · ');
        nodes.push(cardOf(node, note));
        // A branch with parts left out ends in a pill that shows them all; an opened one in a pill that shows fewer
        if (!pill || node.parent !== '$') continue;
        const left = hidden.get(node.id) || 0;
        if (left === 0 && !graphOpened.has(node.id)) continue;
        pills.push({ ...cardOf({ id: node.id + '#more', parent: node.id, kind: 'branch', label: left > 0 ? fill(T['views.note.more'], { count: left }) : T['views.showFewer'], used: true }, ''), wrap: false, noAdd: true });
    }
    const links = graph.edges.filter((edge) => shown.has(edge.from) && shown.has(edge.to)).map((edge) => ({ from: edge.from, to: edge.to, kind: edge.kind, label: edge.label || '' }));
    const drawn = JSON.stringify({ nodes: [...nodes, ...pills], links });
    // A new revision that left the tree as it was (a screen's layout, a token) writes nothing
    if (drawn === netDrawn) return;
    netDrawn = drawn;
    netWrite({ nodes: [...nodes, ...pills], links, selected: side.hidden ? '' : side.dataset.node || '' });
}

function sideOpen(card, title, children, id) {
    unchoose();
    if (card) card.classList.add('chosen');
    side.dataset.node = id || '';
    const close = glyphButton('cross', T['views.close'], closeSide, 'view-close');
    side.replaceChildren(element('div', { className: 'view-side-head' }, [element('h3', { text: title }), close]), ...children.filter(Boolean));
    side.hidden = false;
    if (view !== 'statenet' || !net) return;
    // The chosen card is lit, and brought into view beside the panel, which now covers part of the canvas
    netWrite({ selected: id || '', inset: insetOf() });
    if (chosenBox && chosenBox.id === id) netCommand('lookAt', chosenBox.box);
}

/** A row of buttons, one per screen, each showing that screen in the Screens view */
function screenButtons(names) {
    return element('div', { className: 'view-row' }, names.map((name) => button(name, () => {
        setView('screens');
        if (window.magneticScreens) window.magneticScreens.choose(name);
    }, 'screen')));
}

/** The last segment of a node's path: the part's or record's own name */
function nameOf(node) { return node.id.slice(node.id.lastIndexOf('.') + 1); }
/** The node a node hangs from, so many levels up */
function above(node, levels) {
    let at = node;
    for (let index = 0; index < levels && at; index++) at = graph.nodes.find((each) => each.id === at.parent);
    return at;
}
/** A + made something: the tree again, and the app's views, as its document may have changed */
async function added() { closeSide(); shell.editorChanged(); await loadGraph(); }
async function post(path, body) {
    says(T['views.saving']);
    try {
        const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
        const answer = await response.json().catch(() => ({}));
        if (!response.ok) { says(answer.message || T['views.refused'], true); return undefined; }
        says(T['views.saved']);
        return answer;
    } catch { says(T['views.refused'], true); return undefined; }
}
/** A labelled field of a + form */
function field(label, control) { return element('label', { className: 'view-field' }, [element('span', { text: label }), control]); }
function nameInput(label) { return element('input', { 'aria-label': label, placeholder: 'lower-case-name', autocomplete: 'off', spellcheck: 'false' }); }
function choice(label, values, texts) { return element('select', { 'aria-label': label }, values.map((value, index) => element('option', { value, text: texts ? texts[index] : value }))); }
function namesOf(kind) { return graph.nodes.filter((node) => node.kind === kind && node.parent && node.parent.split('.').length === 2).map(nameOf); }
/** A + form at the side: its fields, and a button that runs it (Enter in a field too) */
function addForm(card, node, title, fields, run) {
    const go = button(T['views.create'], async () => { go.disabled = true; try { await run(); } finally { go.disabled = false; } }, 'on');
    for (const each of fields) for (const control of each.querySelectorAll('input')) control.addEventListener('keydown', (event) => { if (event.key === 'Enter') go.click(); });
    sideOpen(card, title, [element('p', { className: 'view-note', text: fill(T['views.addTo'], { path: node.id }) }), ...fields, element('div', { className: 'view-row' }, [go])], node.id);
    const first = side.querySelector('input, select');
    if (first) first.focus();
}

/** What the + of a node does: a form for a new part, or the editor of the part with its add row */
async function addUnder(node, card) {
    try {
        switch (node.add) {
            case 'app': {
                const name = nameInput(T['views.name']);
                return addForm(card, node, T['views.new.app'], [field(T['views.name'], name)], async () => {
                    const response = await fetch('/new', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: new URLSearchParams({ name: name.value }) });
                    const answer = await response.json().catch(() => ({}));
                    if (!response.ok || !answer.id) { says(answer.message || T['views.refused'], true); return; }
                    location.href = '/edit/' + encodeURIComponent(answer.id);
                });
            }
            case 'screen': {
                const name = nameInput(T['views.name']);
                return addForm(card, node, T['views.new.screen'], [field(T['views.name'], name)], async () => {
                    if (await post('/edit/' + encodeURIComponent(appId) + '/screens', { action: 'add', name: name.value.trim() })) await added();
                });
            }
            case 'binding': {
                const bound = new Set(graph.nodes.filter((each) => each.kind === 'binding').map((each) => each.note));
                const free = namesOf('dataset').filter((name) => !bound.has(name));
                if (free.length === 0) return sideOpen(card, T['views.new.binding'], [element('p', { className: 'view-note', text: T['views.noFreeDataset'] })], node.id);
                const dataset = choice(T['views.dataset'], free);
                const binding = element('input', { 'aria-label': T['views.bindingName'], placeholder: T['views.bindingAuto'], autocomplete: 'off' });
                return addForm(card, node, T['views.new.binding'], [field(T['views.dataset'], dataset), field(T['views.bindingName'], binding)], async () => {
                    if (await change('add', { what: 'binding', dataset: dataset.value, binding: binding.value.trim() })) await added();
                });
            }
            case 'theme': {
                const name = nameInput(T['views.themeName']);
                const presets = ['clean', 'moody', 'playful', 'professional'];
                const preset = choice(T['views.preset'], presets, presets.map((each) => T['views.preset.' + each]));
                return addForm(card, node, T['views.newTheme'], [field(T['views.name'], name), field(T['views.preset'], preset)], async () => {
                    if (await change('theme', { action: 'create', theme: name.value.trim(), preset: preset.value })) await added();
                });
            }
            case 'dataset': {
                const models = namesOf('model');
                if (models.length === 0) return sideOpen(card, T['views.new.dataset'], [element('p', { className: 'view-note', text: T['views.needModel'] })], node.id);
                const name = nameInput(T['views.name']);
                const model = choice(T['views.model'], models);
                const record = element('div', { className: 'view-record' });
                const showFields = () => {
                    const fields = graph.nodes.filter((each) => each.kind === 'field' && each.parent === '$.models.' + model.value);
                    record.replaceChildren(element('p', { className: 'view-note', text: T['views.firstRecord'] }), ...fields.map((each) => field(each.label, element('input', { 'aria-label': each.label, 'data-field': each.label, 'data-type': each.note }))));
                };
                model.addEventListener('change', showFields);
                showFields();
                return addForm(card, node, T['views.new.dataset'], [field(T['views.name'], name), field(T['views.model'], model), record], async () => {
                    const value = {};
                    for (const input of record.querySelectorAll('input')) if (input.value !== '') value[input.dataset.field] = input.dataset.type === 'string' ? input.value : typed(input.value);
                    if (await change('add', { what: 'dataset', name: name.value.trim(), model: model.value, record: value })) await added();
                });
            }
            case 'record': {
                await datasetEditor(await getJson('/part?kind=data&name=' + encodeURIComponent(nameOf(node))), card, node.id);
                const first = side.querySelector('tr.adding input');
                if (first) first.focus();
                return;
            }
            case 'model': {
                const name = nameInput(T['views.name']);
                const first = element('input', { 'aria-label': T['views.fieldName'], autocomplete: 'off' });
                const type = choice(T['views.fieldType'], FIELD_TYPES);
                return addForm(card, node, T['views.new.model'], [field(T['views.name'], name), field(T['views.fieldName'], first), field(T['views.fieldType'], type)], async () => {
                    if (!first.value.trim()) { says(T['views.fieldNameNeeded'], true); first.focus(); return; }
                    if (await change('add', { what: 'model', name: name.value.trim(), field: first.value.trim(), type: type.value })) await added();
                });
            }
            case 'field': {
                modelEditor(await getJson('/part?kind=models&name=' + encodeURIComponent(nameOf(node))), card, node.id);
                const first = side.querySelector('input');
                if (first) first.focus();
                return;
            }
            case 'module': {
                // A module works on data it needs: one of the app's dataset bindings
                const bindings = graph.nodes.filter((each) => each.kind === 'binding').map((each) => each.label);
                if (bindings.length === 0) return sideOpen(card, T['views.new.module'], [element('p', { className: 'view-note', text: T['views.needBinding'] })], node.id);
                const name = nameInput(T['views.name']);
                const need = choice(T['views.worksOn'], bindings);
                return addForm(card, node, T['views.new.module'], [field(T['views.name'], name), field(T['views.worksOn'], need)], async () => {
                    if (await change('add', { what: 'module', name: name.value.trim(), need: need.value })) await added();
                });
            }
            case 'unit': {
                // A module's unit works on what the module needs: the form starts from one on its first need's fields
                const module = await getJson('/part?kind=logic&name=' + encodeURIComponent(nameOf(node)));
                const groups = ['rules', 'machines', 'tables'];
                const group = choice(T['views.unitKind'], groups, groups.map((each) => T['views.unit.' + UNIT_KINDS[each]]));
                const name = element('input', { 'aria-label': T['views.unitName'], autocomplete: 'off' });
                const text = element('textarea', { 'aria-label': T['views.unitBody'], spellcheck: 'false' });
                const template = () => { text.value = JSON.stringify(moduleTemplate(module.body, group.value), null, 2); };
                group.addEventListener('change', template);
                template();
                return addForm(card, node, T['views.new.unit'], [field(T['views.unitKind'], group), field(T['views.unitName'], name), field(T['views.unitBody'], text)], async () => {
                    let value;
                    try { value = JSON.parse(text.value); } catch { says(T['views.notJson'], true); return; }
                    const unit = group.value + '.' + name.value.trim();
                    if (await change('logic', { module: nameOf(node), unit, revision: module.revision, value })) {
                        await loadGraph();
                        const made = graph.nodes.find((each) => each.id === node.id + '.' + unit);
                        if (made) await moduleUnitEditor(made, null);
                    }
                });
            }
            case 'connection':
                return sideOpen(card, T['views.kind.connection'], [element('p', { className: 'view-note', text: T['views.connectionsPage'] }), element('div', { className: 'view-row' }, [element('a', { className: 'view-link', href: '/settings/connections', text: T['views.openConnections'] })])], node.id);
            default:
                return undefined;
        }
    } catch (error) { says(error.message, true); }
}

/** A unit to start from in a module, on its first need: a rule, a machine or a table over that need's fields */
function moduleTemplate(body, group) {
    const needs = body && body.needs ? body.needs : {};
    const need = Object.keys(needs)[0] || 'items';
    const model = needs[need] && needs[need].model;
    const fields = graph.nodes.filter((each) => each.kind === 'field' && each.parent === '$.models.' + model).map((each) => each.label);
    const first = fields[0] || 'name';
    const second = fields[1] || first + 'Copy';
    const at = (name) => '$.data.' + need + '.{id}.' + name;
    if (group === 'machines') return { state: '$.data.' + need + '.status', initial: 'idle', transitions: [{ from: 'idle', when: { path: at(first), is: 'example' }, to: 'done' }] };
    if (group === 'tables') return { inputs: { value: at(first) }, outputs: { copy: at(second) }, rows: [{ copy: '{{ $value }}' }] };
    return { when: { path: at(first), is: 'example' }, do: [{ command: 'set', target: at(first), value: '' }] };
}

/** A part the app does not use: a button that puts it to use */
function useButton(run) { return element('div', { className: 'view-row' }, [button(T['views.useInApp'], async () => { if (await run()) await added(); }, 'on')]); }

function appEditor(node, card) {
    if (!node.current) {
        return sideOpen(card, node.label, [
            element('p', { className: 'view-note', text: T['views.note.anotherApp'] }),
            element('div', { className: 'view-row' }, [element('a', { className: 'view-link', href: '/edit/' + encodeURIComponent(node.appId), text: T['views.openApp'] })])
        ], node.id);
    }
    const screens = node.screens || [];
    const counts = new Map();
    for (const each of graph.nodes) if (each.used && ['theme', 'dataset', 'model', 'module', 'component', 'connection'].includes(each.kind)) counts.set(each.kind, (counts.get(each.kind) || 0) + 1);
    sideOpen(card, node.label, [
        element('p', { className: 'view-note', text: noteText(node) }),
        element('h3', { text: T['views.screens'] }),
        screens.length > 0 ? screenButtons(screens) : element('p', { className: 'view-note', text: T['views.noScreens'] }),
        counts.size > 0 ? element('h3', { text: T['views.uses'] }) : null,
        counts.size > 0 ? element('ul', { className: 'view-note' }, [...counts].map(([kind, count]) => element('li', { text: (T['views.kind.' + kind] || kind) + ': ' + count }))) : null
    ], node.id);
}

function themeEditor(node, card) {
    const name = nameOf(node);
    const act = (action) => async () => {
        const answer = await change('theme', { action, theme: name });
        if (answer) await added();
    };
    if (!node.used) return sideOpen(card, name, [element('p', { className: 'view-note', text: T['views.note.unused'] }), useButton(() => change('theme', { action: 'add', theme: name }))], node.id);
    sideOpen(card, name, [
        element('p', { className: 'view-note', text: node.isDefault ? T['views.note.defaultTheme'] : T['views.kind.theme'] }),
        element('div', { className: 'view-row' }, [
            button(T['views.editTheme'], () => { chosenTheme = name; setView('theme', true); }, 'on'),
            node.isDefault ? null : button(T['views.makeDefault'], act('default'))
        ]),
        element('div', { className: 'view-row' }, [button(T['views.removeTheme'], () => { if (confirm(fill(T['views.removeThemeConfirm'], { name }))) void act('remove')(); }, 'danger')])
    ], node.id);
}

function componentEditor(node, card) {
    const screens = node.screens || [];
    sideOpen(card, node.label, [
        element('p', { className: 'view-note', text: T['views.componentNote'] }),
        element('h3', { text: T['views.placedOn'] }),
        screens.length > 0 ? screenButtons(screens) : element('p', { className: 'view-note', text: T['views.notPlaced'] })
    ], node.id);
}

function moduleEditor(node, card) {
    if (!node.used) return sideOpen(card, node.label, [element('p', { className: 'view-note', text: T['views.moduleNote'] }), useButton(() => change('add', { what: 'useModule', name: node.label }))], node.id);
    sideOpen(card, node.label, [
        element('p', { className: 'view-note', text: T['views.moduleNote'] }),
        element('div', { className: 'view-row' }, [button(T['views.openLogic'], () => setView('logic', true), 'on')])
    ], node.id);
}

/** A unit of a logic module as JSON, saved or removed through the module's own writes */
async function moduleUnitEditor(node, card) {
    const moduleName = nameOf(above(node, 1));
    const module = await getJson('/part?kind=logic&name=' + encodeURIComponent(moduleName));
    const unit = node.note + '.' + node.label;
    const records = module.body[node.note] || {};
    const text = element('textarea', { 'aria-label': unit, spellcheck: 'false' });
    text.value = JSON.stringify(records[node.label] || {}, null, 2);
    const save = button(T['views.save'], async () => {
        let value;
        try { value = JSON.parse(text.value); } catch { says(T['views.notJson'], true); return; }
        if (await change('logic', { module: moduleName, unit, revision: module.revision, value })) await loadGraph();
    }, 'on');
    const remove = removeButton(T['views.removeUnit'], fill(T['views.removeUnitAsk'], { unit }), async () => {
        if (await change('logic', { module: moduleName, unit, revision: module.revision, remove: true })) { closeSide(); await loadGraph(); }
    });
    sideOpen(card, unit, [element('p', { className: 'view-note', text: fill(T['views.fromModule'], { module: moduleName }) }), text, element('div', { className: 'view-row' }, [save, remove])], node.id);
}

async function openNode(node, card) {
    const part = (kind, name) => getJson('/part?kind=' + kind + '&name=' + encodeURIComponent(name));
    try {
        switch (node.kind) {
            case 'app': return appEditor(node, card);
            case 'screen': setView('screens'); if (window.magneticScreens) window.magneticScreens.choose(node.label); return undefined;
            case 'binding': return datasetEditor(await part('data', node.note), card, node.id);
            case 'personal': return stateEditor('$.data.' + node.label, card, node.id);
            case 'state': return stateEditor(node.note, card, node.id);
            case 'dataset': {
                await datasetEditor(await part('data', nameOf(node)), card, node.id);
                if (!node.used) side.append(useButton(() => change('add', { what: 'binding', dataset: nameOf(node) })));
                return undefined;
            }
            case 'record': return datasetEditor(await part('data', nameOf(above(node, 1))), card, node.id);
            case 'model': return modelEditor(await part('models', nameOf(node)), card, node.id);
            case 'field': return modelEditor(await part('models', nameOf(above(node, 1))), card, node.id);
            case 'theme': return themeEditor(node, card);
            case 'module': return moduleEditor(node, card);
            case 'unit': return moduleUnitEditor(node, card);
            case 'component': return componentEditor(node, card);
            case 'connection': return connectionEditor(await part('connections', nameOf(node)), card, undefined, node.id);
            case 'persona': return sideOpen(card, node.label, [element('p', { className: 'view-note', text: T['views.personaNote'] })], node.id);
            case 'instance': return sideOpen(card, node.label, [
                element('p', { className: 'view-note', text: T['views.instanceNote'] }),
                element('p', { className: 'view-note', text: noteText(node) }),
                node.current ? null : element('div', { className: 'view-row' }, [element('a', { className: 'view-link', href: '/edit/' + encodeURIComponent(node.appId), text: T['views.openApp'] })])
            ], node.id);
            case 'function': return functionPanel(node, card);
            case 'library': {
                // What it holds, which the board leaves out when the app does not place it
                const functions = graph.nodes.filter((each) => each.parent === node.id && each.kind === 'function');
                return sideOpen(card, node.label, [
                    element('p', { className: 'view-note', text: T['views.libraryNote'] }),
                    node.screens && node.screens.length > 0 ? element('p', { className: 'view-note', text: node.screens.join(', ') }) : null,
                    element('div', { className: 'view-row' }, functions.map((each) => button(each.label, () => functionPanel(each, card))))
                ], node.id);
            }
            case 'endpoint': {
                const connection = node.missing ? node.note : nameOf(above(node, 1));
                return connectionEditor(await part('connections', connection), card, node.label, node.id);
            }
            default: return sideOpen(card, node.label, [element('p', { className: 'view-note', text: kindText(node) + (noteText(node) ? ' · ' + noteText(node) : '') })], node.id);
        }
    } catch (error) { says(error.message, true); }
}

/** A function's panel: what it is and does, where it runs, and its schemas; nothing to edit */
function functionPanel(node, card) {
    const schema = (title, value) => value === undefined ? null : element('div', {}, [element('h4', { text: title }), element('pre', { className: 'view-schema', text: JSON.stringify(value, null, 2) })]);
    const owner = node.fn.fixed ? node.parent.split('.')[2] : '';
    return sideOpen(card, node.label, [
        element('p', { className: 'view-note', text: kindText(node) + ' · ' + noteText(node) }),
        element('p', { text: node.fn.summary }),
        element('p', { className: 'view-note', text: node.fn.fixed ? fill(T['views.fn.fixed'], { component: owner }) : T['views.functionNote'] }),
        element('p', { className: 'view-note', text: node.id }),
        schema(T['views.fn.inputs'], node.fn.inputs),
        schema(T['views.fn.outputs'], node.fn.outputs)
    ], node.id);
}

/** A × that asks first: the question names what goes */
function removeButton(label, question, run) {
    return glyphButton('cross', label, () => { if (confirm(question)) void run(); }, 'danger remove');
}

function datasetEditor(part, card, id) {
    const fields = Object.keys(part.fields || {});
    const keys = Object.keys(part.records || {});
    const columns = fields.length > 0 ? fields : [...new Set(keys.flatMap((key) => Object.keys(part.records[key] || {})))];
    const table = element('table', { className: 'records' }, [element('tr', {}, [element('th', { text: '' }), ...columns.map((field) => element('th', { text: field })), element('th')])]);
    let revision = part.revision;
    const reopen = async () => datasetEditor(await getJson('/part?kind=data&name=' + encodeURIComponent(part.name)), card, id);
    for (const key of keys) {
        const record = part.records[key] || {};
        const cells = columns.map((field) => {
            const input = element('input', { value: shown(record[field]), 'aria-label': key + ' ' + field });
            input.addEventListener('change', async () => {
                const answer = await change('data', { dataset: part.name, revision, operations: [{ op: 'set', path: key + '.' + field, value: typed(input.value) }] });
                if (answer) revision = answer.revision;
            });
            return element('td', {}, [input]);
        });
        const remove = removeButton(T['views.removeRecord'] + ' ' + key, fill(T['views.removeRecordAsk'], { key }), async () => {
            const answer = await change('data', { dataset: part.name, revision, operations: [{ op: 'remove', path: key }] });
            if (answer) await reopen();
        });
        table.append(element('tr', {}, [element('td', { text: key }), ...cells, element('td', {}, [remove])]));
    }
    // A new record is typed in the last row, not asked for field by field
    const fresh = columns.map((field) => element('input', { placeholder: field, 'aria-label': T['views.newRecord'] + ' ' + field }));
    const add = button(T['views.add'], async () => {
        if (fresh.every((input) => input.value.trim() === '')) { says(T['views.recordEmpty'], true); fresh[0].focus(); return; }
        const value = Object.fromEntries(columns.map((field, index) => [field, fresh[index].value.trim() === '' ? undefined : typed(fresh[index].value)]).filter((entry) => entry[1] !== undefined));
        const answer = await change('data', { dataset: part.name, revision, operations: [{ op: 'add', value }] });
        if (answer) await reopen();
    }, 'on');
    for (const input of fresh) input.addEventListener('keydown', (event) => { if (event.key === 'Enter') add.click(); });
    if (columns.length > 0) table.append(element('tr', { className: 'adding' }, [element('td', { text: '+' }), ...fresh.map((input) => element('td', {}, [input])), element('td', {}, [add])]));
    const more = part.count > keys.length ? element('p', { className: 'view-note', text: fill(T['views.moreRecords'], { shown: keys.length, count: part.count }) }) : null;
    sideOpen(card, part.name, [
        part.model ? element('p', { className: 'view-note', text: fill(T['views.ofModel'], { model: part.model }) }) : null,
        element('div', { className: 'records-wrap' }, [table]),
        more,
        columns.length === 0 ? element('p', { className: 'view-note', text: T['views.noFields'] }) : null
    ], id);
}

const FIELD_TYPES = ['string', 'number', 'integer', 'boolean', 'array', 'object', 'any', 'url'];
function modelEditor(part, card, id) {
    let revision = part.revision;
    const reopen = async () => modelEditor(await getJson('/part?kind=models&name=' + encodeURIComponent(part.name)), card, id);
    const rows = Object.entries(part.fields || {}).map(([field, declaration]) => {
        const type = element('select', { 'aria-label': field }, FIELD_TYPES.map((name) => element('option', { value: name, text: name })));
        type.value = declaration && declaration.type;
        type.addEventListener('change', async () => {
            const answer = await change('data', { model: part.name, revision, operations: [{ op: 'set', field, type: type.value }] });
            if (answer) revision = answer.revision;
        });
        const remove = removeButton(T['views.removeField'] + ' ' + field, fill(T['views.removeFieldAsk'], { field, model: part.name }), async () => {
            const answer = await change('data', { model: part.name, revision, operations: [{ op: 'remove', field }] });
            if (answer) await reopen();
        });
        return element('div', { className: 'view-row' }, [element('b', { text: field }), type, remove]);
    });
    const name = element('input', { placeholder: T['views.fieldName'], 'aria-label': T['views.fieldName'] });
    const type = element('select', { 'aria-label': T['views.fieldType'] }, FIELD_TYPES.map((each) => element('option', { value: each, text: each })));
    const add = button(T['views.addField'], async () => {
        const field = name.value.trim();
        if (!field) { says(T['views.fieldNameNeeded'], true); name.focus(); return; }
        const answer = await change('data', { model: part.name, revision, operations: [{ op: 'set', field, type: type.value }] });
        if (answer) await reopen();
    }, 'on');
    name.addEventListener('keydown', (event) => { if (event.key === 'Enter') add.click(); });
    sideOpen(card, part.name, [...rows, element('div', { className: 'view-row' }, [name, type, add])], id);
}

async function stateEditor(path, card, id) {
    const read = await getJson('/state?path=' + encodeURIComponent(path));
    const text = element('textarea', { 'aria-label': path });
    text.value = JSON.stringify(read.value, null, 2);
    const save = button(T['views.save'], async () => {
        let value;
        try { value = JSON.parse(text.value); } catch { says(T['views.notJson'], true); return; }
        await change('state', { path, value });
    });
    sideOpen(card, path, [element('p', { className: 'view-note', text: T['views.stateNote'] }), text, element('div', { className: 'view-row' }, [save])], id);
}

function connectionEditor(info, card, endpointName, id) {
    const parts = [element('p', { className: 'view-note', text: info.baseUrl + ' · ' + T['views.auth.' + info.auth.kind] + (info.auth.kind === 'none' ? '' : ' · ' + (info.keySet || info.clientSecretSet ? T['views.secretSet'] : T['views.secretNotSet'])) })];
    const form = async (fields) => {
        const answer = await change('connections', { id: info.id, ...fields });
        if (answer && answer.continueTo) { window.open(answer.continueTo.url, '_blank', 'noopener'); return answer; }
        if (answer && !answer.tried) connectionEditor(await getJson('/part?kind=connections&name=' + encodeURIComponent(info.name)), card, endpointName, id);
        return answer;
    };
    if (info.manages) {
        const baseUrl = element('input', { value: info.baseUrl, 'aria-label': T['views.baseUrl'] });
        parts.push(element('div', { className: 'view-row' }, [baseUrl, button(T['views.save'], () => void form({ do: 'update', baseUrl: baseUrl.value, kind: info.auth.kind, ...authFields(info.auth) }))]));
        if (info.auth.kind !== 'none') {
            const secret = element('input', { type: 'password', autocomplete: 'off', placeholder: T['views.newSecret'], 'aria-label': T['views.newSecret'] });
            parts.push(element('div', { className: 'view-row' }, [secret, button(T['views.keep'], () => { void form({ do: 'secret', field: info.auth.kind === 'key' ? 'key' : 'clientSecret', value: secret.value }); secret.value = ''; })]));
        }
        if (info.auth.kind === 'oauth-code') parts.push(button(T['views.connect'], () => void form({ do: 'connect' })));
    } else {
        parts.push(element('p', { className: 'view-note', text: T['views.noManage'] }));
    }
    parts.push(element('h3', { text: T['views.endpoints'] }));
    for (const endpoint of info.endpoints) {
        const output = element('pre', { className: 'view-note view-output' });
        const row = element('div', { className: 'view-row', 'data-endpoint': endpoint.name }, [element('b', { text: endpoint.name }), element('span', { className: 'view-note', text: endpoint.method + ' ' + endpoint.path })]);
        if (info.manages) {
            row.append(button(T['views.try'], async () => {
                const answer = await form({ do: 'try', endpoint: endpoint.name, params: '' });
                if (answer && answer.tried) output.textContent = answer.tried.status + '\n' + answer.tried.body;
            }));
            row.append(removeButton(T['views.removeEndpoint'] + ' ' + endpoint.name, fill(T['views.removeEndpointAsk'], { name: endpoint.name }), () => form({ do: 'removeEndpoint', endpoint: endpoint.name })));
        }
        if (endpoint.name === endpointName) row.style.fontWeight = '600';
        parts.push(row, output);
    }
    if (info.manages) {
        const name = element('input', { placeholder: T['views.endpointName'], 'aria-label': T['views.endpointName'], size: 10 });
        const method = element('select', { 'aria-label': T['views.method'] }, ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((each) => element('option', { value: each, text: each })));
        const path = element('input', { placeholder: '/path', 'aria-label': T['views.endpointPath'], size: 12 });
        parts.push(element('div', { className: 'view-row' }, [name, method, path, button(T['views.addEndpoint'], () => void form({ do: 'endpoint', name: name.value.trim(), method: method.value, path: path.value.trim() }))]));
    }
    sideOpen(card, info.name, parts, id);
}
function authFields(auth) {
    const fields = {};
    for (const key of ['tokenUrl', 'clientId', 'scope', 'authorizeUrl']) if (typeof auth[key] === 'string') fields[key] = auth[key];
    if (auth.kind === 'key') Object.assign(fields, { keyIn: auth.in, keyName: auth.name, keyPrefix: auth.prefix || '' });
    return fields;
}

// ---- Theme ---------------------------------------------------------------------------------------------------------

let chosenTheme = null;
let theme = null;
/** The shared themes this person chose to edit for every app that uses them, this visit */
const editShared = new Set();

function colorish(value) { return typeof value === 'string' && /^(#|rgb|hsl|oklch|color-mix)/.test(value); }
function valueIn(mode, path) { const token = theme.tokens.find((each) => each.path === path); return token ? token.values[mode] : undefined; }

async function loadTheme(name) {
    try { theme = await getJson('/theme' + (name ? '?theme=' + encodeURIComponent(name) : '')); } catch (error) { says(error.message, true); return; }
    if (view !== 'theme') return;
    chosenTheme = theme.theme;
    themeTools();
    if (!theme.theme) { main.replaceChildren(element('p', { className: 'view-note', text: T['views.noTheme'] })); return; }
    const shared = theme.usedBy.length > 0 && !editShared.has(theme.theme);
    const ask = shared ? element('div', { className: 'view-ask', role: 'alert' }, [
        element('span', { text: fill(T['views.sharedTheme'], { apps: theme.usedBy.join(', ') }) }),
        button(T['views.editForAll'], () => { editShared.add(theme.theme); void loadTheme(theme.theme); }),
        button(T['views.cloneForApp'], () => void cloneTheme())
    ]) : null;
    const specimens = element('div', { className: 'specimens' }, theme.modes.map((mode) => {
        const card = element('div', { className: 'specimen' }, [
            element('h4', { text: T['views.mode.' + mode] || mode }),
            element('p', { text: T['views.specimenText'] }),
            element('span', { text: T['views.specimenButton'] })
        ]);
        card.style.background = shown(valueIn(mode, 'color.surface.base'));
        card.style.color = shown(valueIn(mode, 'color.text.base'));
        card.style.borderColor = shown(valueIn(mode, 'color.border.base'));
        const pill = card.querySelector('span');
        pill.style.background = shown(valueIn(mode, 'color.accent.base'));
        pill.style.color = shown(valueIn(mode, 'color.accent.on'));
        const family = theme.tokens.find((token) => token.type === 'fontFamily');
        if (family) card.style.fontFamily = shown(family.values[mode]);
        return card;
    }));
    const table = element('table', { className: 'tokens' }, [element('tr', {}, [element('th', { text: T['views.token'] }), element('th', { text: T['views.allModes'] }), ...theme.modes.map((mode) => element('th', { text: T['views.mode.' + mode] || mode }))])]);
    let group = '';
    for (const token of theme.tokens) {
        if (token.group !== group) { group = token.group; table.append(element('tr', {}, [element('th', { className: 'group', colspan: 2 + theme.modes.length, text: group })])); }
        table.append(element('tr', { 'data-token': token.path }, [
            element('td', { text: token.path.slice(group.length + 1) || token.path }),
            element('td', {}, [cell(token, null, shared)]),
            ...theme.modes.map((mode) => element('td', {}, [cell(token, mode, shared)]))
        ]));
    }
    main.replaceChildren(...[ask, specimens, table].filter(Boolean));
}

/** One token's value for all modes (mode null) or in one mode: what it shows, and pressed, a field that writes it */
function cell(token, mode, locked) {
    const set = mode === null ? 'own' in token : Object.hasOwn(token.modes, mode);
    const value = mode === null ? (set ? token.own : '') : token.values[mode];
    const box = element('span', { className: 'cell' + (set ? ' set' : ''), tabindex: locked ? undefined : 0, role: locked ? undefined : 'button', 'aria-label': token.path + ' ' + (mode || T['views.allModes']) });
    const plain = mode === null ? (set ? valueIn(theme.modes[0], token.path) : '') : value;
    if (colorish(plain)) { const swatch = element('i', { className: 'swatch' }); swatch.style.background = plain; box.append(swatch); }
    box.append(document.createTextNode(mode === null ? shown(value) || '·' : shown(set ? token.modes[mode] : value)));
    if (locked) return box;
    const edit = () => {
        const input = element('input', { value: shown(mode === null ? token.own : set ? token.modes[mode] : value), 'aria-label': token.path });
        box.replaceWith(input);
        input.focus();
        input.select();
        let done = false;
        const finish = async (save) => {
            if (done) return;
            done = true;
            if (save && input.value.trim() !== '') await writeToken(token, mode, typed(input.value.trim()));
            else if (save && mode === null && 'own' in token) await writeTheme([{ op: 'remove', path: token.path }]);
            else input.replaceWith(box);
        };
        input.addEventListener('keydown', (event) => { if (event.key === 'Enter') void finish(true); if (event.key === 'Escape') { event.stopPropagation(); void finish(false); } });
        input.addEventListener('blur', () => void finish(false));
    };
    box.addEventListener('click', edit);
    box.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); edit(); } });
    return box;
}

/**
 * Writes a token for all modes or in one. The base wins over a mode's overlay (as the runtime merges them), so a
 * value for one mode of a token the base sets moves it into every mode: the others keep what they showed
 */
async function writeToken(token, mode, value) {
    if (mode === null) return writeTheme([{ op: 'set', path: token.path, value }]);
    const operations = [];
    const overlay = (name) => { if (!theme.overlays[name] && !operations.some((each) => each.op === 'add-overlay' && each.overlay === name)) operations.push({ op: 'add-overlay', overlay: name, kind: 'mode' }); };
    if ('own' in token) {
        operations.push({ op: 'remove', path: token.path });
        for (const other of theme.modes) {
            if (other === mode || Object.hasOwn(token.modes, other)) continue;
            overlay(other);
            operations.push({ op: 'set', path: token.path, value: token.own, overlay: other });
        }
    }
    overlay(mode);
    operations.push({ op: 'set', path: token.path, value, overlay: mode });
    return writeTheme(operations);
}

async function writeTheme(operations) {
    const answer = await change('theme', { action: 'write', theme: theme.theme, revision: theme.revision, operations });
    if (!answer) { void loadTheme(theme.theme); return; }
    const failing = (answer.contrast || []).filter((pair) => pair.passesAA === false);
    await loadTheme(theme.theme);
    if (failing.length > 0) says(fill(T['views.contrast'], { count: failing.length, pairs: failing.slice(0, 3).map((pair) => pair.mode + ': ' + pair.text + ' / ' + pair.surface + ' ' + pair.ratio.toFixed(1)).join(', ') }), true);
}

function freeThemeName(stem) {
    const names = new Set([...theme.workspaceThemes, ...theme.themes.map((each) => each.name)]);
    let name = stem;
    for (let count = 2; names.has(name); count++) name = stem + '-' + count;
    return name;
}
async function cloneTheme() {
    const name = prompt(T['views.cloneName'], freeThemeName(theme.theme + '-' + (document.body.dataset.appName || 'app').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')));
    if (!name) return;
    const answer = await change('theme', { action: 'clone', theme: theme.theme, to: name.trim() });
    if (answer) { shell.editorChanged(); await loadTheme(answer.theme); }
}

function themeTools() {
    const items = theme.themes.map((each) => {
        const pick = button((each.isDefault ? '★ ' : '') + each.name, () => void loadTheme(each.name), each.name === theme.theme ? 'on' : '');
        pick.setAttribute('aria-pressed', String(each.name === theme.theme));
        return pick;
    });
    const act = (action, extra) => async () => {
        const answer = await change('theme', { action, theme: theme.theme, ...extra });
        if (answer) await loadTheme(answer.theme || null);
    };
    const current = theme.themes.find((each) => each.name === theme.theme);
    if (current && !current.isDefault) items.push(button(T['views.makeDefault'], act('default')));
    if (current && theme.usedBy.length > 0) items.push(button(T['views.cloneForApp'], () => void cloneTheme()));
    if (current) items.push(button(T['views.removeTheme'], () => { if (confirm(fill(T['views.removeThemeConfirm'], { name: theme.theme }))) void act('remove')(); }, 'danger'));
    const others = theme.workspaceThemes.filter((name) => !theme.themes.some((each) => each.name === name));
    if (others.length > 0) {
        const add = element('select', { 'aria-label': T['views.addTheme'] }, [element('option', { value: '', text: T['views.addTheme'] }), ...others.map((name) => element('option', { value: name, text: name }))]);
        add.addEventListener('change', async () => { if (!add.value) return; const answer = await change('theme', { action: 'add', theme: add.value }); if (answer) await loadTheme(answer.theme); });
        items.push(add);
    }
    const preset = element('select', { 'aria-label': T['views.preset'] }, theme.presets.map((name) => element('option', { value: name, text: T['views.preset.' + name] || name })));
    items.push(preset, button(T['views.newTheme'], async () => {
        const name = prompt(T['views.themeName'], freeThemeName(preset.value));
        if (!name) return;
        const answer = await change('theme', { action: 'create', theme: name.trim(), preset: preset.value });
        if (answer) await loadTheme(answer.theme);
    }));
    tools.replaceChildren(...items);
}

// ---- Logic ---------------------------------------------------------------------------------------------------------

let logic = null;
function triggerText(trigger) {
    if (!trigger || typeof trigger !== 'object') return shown(trigger);
    const at = trigger.path || (trigger.result ? '→ ' + trigger.result : '');
    const parts = [at];
    if ('is' in trigger) parts.push('= ' + shown(trigger.is));
    if ('was' in trigger) parts.push(T['views.was'] + ' ' + shown(trigger.was));
    if (trigger.after) parts.push(T['views.after'] + ' ' + shown(trigger.after));
    return parts.filter(Boolean).join(' ');
}
function commandsText(commands) {
    const list = Array.isArray(commands) ? commands : commands ? [commands] : [];
    return list.map((command) => command && typeof command === 'object' ? [command.command, command.target || command.path || command.name].filter(Boolean).join(' ') : shown(command)).join(', ') || '—';
}

function unitBody(unit) {
    const value = unit.value || {};
    if (unit.group === 'machines') {
        const states = new Set([value.initial]);
        for (const transition of value.transitions || []) { if (transition.from) [].concat(transition.from).forEach((name) => states.add(name)); if (transition.to) states.add(transition.to); }
        return [
            element('div', { className: 'states' }, [...states].filter(Boolean).map((name) => element('span', { className: 'state' + (name === value.initial ? ' initial' : ''), text: name }))),
            ...(value.transitions || []).map((transition) => element('p', { className: 'flow' }, [
                document.createTextNode([].concat(transition.from || '*').join('|') + ' → ' + (transition.to || '·') + ' '),
                element('i', { text: T['views.when'] + ' ' + triggerText(transition.when) + (transition.do ? ' · ' + commandsText(transition.do) : '') })
            ]))
        ];
    }
    if (unit.group === 'rules') return [element('p', { className: 'flow' }, [element('i', { text: T['views.when'] + ' ' }), document.createTextNode(triggerText(value.when) + ' → ' + commandsText(value.do))])];
    if (unit.group === 'effects') return [element('p', { className: 'flow', text: triggerText({ path: value.request }) + ' → ' + commandsText(value.run) })];
    return [element('p', { className: 'flow', text: shown(value.inputs) + ' → ' + shown(value.outputs) })];
}

async function loadLogic() {
    try { logic = await getJson('/logic'); } catch (error) { says(error.message, true); return; }
    if (view !== 'logic') return;
    const group = element('select', { 'aria-label': T['views.unitKind'] }, Object.keys(UNIT_KINDS).map((name) => element('option', { value: name, text: T['views.unit.' + UNIT_KINDS[name]] })));
    tools.replaceChildren(group, button(T['views.newUnit'], () => {
        const name = prompt(T['views.unitName'], '');
        if (!name) return;
        unitEditor({ group: group.value, kind: UNIT_KINDS[group.value], name: name.trim(), value: UNIT_TEMPLATES[group.value], own: true, isNew: true }, null);
    }));
    const lane = (runs) => element('section', { className: 'lane', 'data-runs': runs }, [
        element('h3', { text: T['views.runs.' + runs] }),
        element('p', { className: 'view-note', text: T['views.lane.' + runs] }),
        ...logic.units.filter((unit) => unit.runs === runs).map((unit) => {
            const card = element('article', { className: 'unit', 'data-unit': unit.group + '.' + unit.name }, [
                element('header', {}, [element('span', { className: 'unit-kind', text: T['views.unit.' + unit.kind] || unit.kind }), element('b', { text: unit.name }), unit.position !== undefined ? element('span', { className: 'view-note', text: '#' + (unit.position + 1) }) : null]),
                ...unitBody(unit),
                element('p', { className: 'unit-paths', text: (unit.reads.length ? T['views.reads'] + ' ' + unit.reads.join(', ') : '') + (unit.writes.length ? '  ' + T['views.writes'] + ' ' + unit.writes.join(', ') : '') })
            ]);
            card.addEventListener('click', () => unitEditor(unit, card));
            return card;
        })
    ]);
    const handlers = element('section', {}, [
        element('h3', { text: T['views.handlers'] }),
        element('p', { className: 'view-note', text: T['views.handlersNote'] }),
        ...logic.handlers.map((handler) => element('p', { className: 'flow' }, [element('b', { text: handler.screen + ' ' }), document.createTextNode(handler.node.replace(/^\$\.screens\.[^.]+\.root/, '') + ' · ' + handler.event + ' → ' + commandsText(handler.commands))]))
    ]);
    main.replaceChildren(element('div', { className: 'lanes' }, [lane('server'), lane('browser')]), handlers);
    if (logic.units.length === 0) main.prepend(element('p', { className: 'view-note', text: T['views.noUnits'] }));
}

/** The server keeps what a browser cannot be trusted with: a guard, an effect, a call, a $.server path */
function serverOnly(unit) {
    const text = JSON.stringify(unit.value || {});
    return unit.kind === 'guard' || unit.group === 'effects' || text.includes('"call"') || text.includes('$.server');
}

function unitEditor(unit, card) {
    const text = element('textarea', { 'aria-label': unit.group + '.' + unit.name });
    text.value = JSON.stringify(unit.value, null, 2);
    const id = unit.group + '.' + unit.name;
    const write = async (value) => {
        const answer = await change('logic', { unit: id, revision: logic.revision, ...(value === null ? { remove: true } : { value }) });
        if (answer) { shell.editorChanged(); closeSide(); await loadLogic(); }
    };
    const parsed = () => { try { return JSON.parse(text.value); } catch { says(T['views.notJson'], true); return undefined; } };
    const parts = [element('p', { className: 'view-note', text: (T['views.unit.' + unit.kind] || unit.kind) + ' · ' + T['views.runs.' + (unit.runs || 'server')] })];
    if (!unit.own) {
        parts.push(element('p', { className: 'view-note', text: fill(T['views.fromModule'], { module: unit.module || '' }) }), text);
        text.readOnly = true;
    } else {
        parts.push(text);
        const row = element('div', { className: 'view-row' }, [button(T['views.save'], () => { const value = parsed(); if (value !== undefined) void write(value); })]);
        if (!unit.isNew) {
            const browser = unit.runs === 'browser';
            const move = button(browser ? T['views.moveToServer'] : T['views.moveToBrowser'], () => {
                const value = parsed();
                if (value === undefined) return;
                if (browser) delete value.runs; else value.runs = 'browser';
                void write(value);
            });
            if (!browser && serverOnly(unit)) { move.disabled = true; move.title = T['views.mustServer']; }
            row.append(move, button(T['views.delete'], () => { if (confirm(fill(T['views.deleteUnitConfirm'], { name: unit.name }))) void write(null); }, 'danger'));
        }
        parts.push(row);
    }
    sideOpen(card, unit.name, parts);
}

// ---- The layers on the screen tiles --------------------------------------------------------------------------------

const infos = new Map();
let infoRevision = null;
let drawing = 0;
const leads = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
leads.setAttribute('class', 'leads');
world.append(leads);

/** The screens' tiles: the live frame and every preview, with where each is on the board */
function tiles() {
    const found = [];
    const live = artboard.dataset.screen;
    if (live && !artboard.hidden && getComputedStyle(artboard).display !== 'none') found.push({ name: live, element: artboard, inspect: (query) => host.inspect(query), x: Number(artboard.dataset.slotX || 0), y: Number(artboard.dataset.slotY || 0) });
    for (const preview of world.querySelectorAll('.preview[data-screen]')) {
        const name = preview.dataset.screen;
        if (found.some((tile) => tile.name === name)) continue;
        const panel = window.magneticScreens && window.magneticScreens.panelOf ? window.magneticScreens.panelOf(name) : null;
        found.push({ name, element: preview, inspect: panel ? (query) => panel.inspect(query) : null, x: parseFloat(preview.style.left) || 0, y: parseFloat(preview.style.top) || 0 });
    }
    return found;
}

async function infoOf(name) {
    const revision = document.body.dataset.revision || '';
    if (revision !== infoRevision) { infos.clear(); infoRevision = revision; }
    if (!infos.has(name)) infos.set(name, getJson('/screen?screen=' + encodeURIComponent(name)).catch(() => null));
    return infos.get(name);
}

function boxesOf(layout, out = []) {
    if (layout.layout !== null) out.push(layout);
    for (const child of layout.children) boxesOf(child, out);
    return out;
}

function schematic(layout) {
    const box = element('div');
    box.style.flexDirection = layout.layout === 'row' ? 'row' : 'column';
    if (layout.layout === 'grid') { box.style.flexWrap = 'wrap'; box.style.flexDirection = 'row'; }
    box.append(element('span', { text: layout.key }));
    for (const child of layout.children) if (child.layout !== null) box.append(schematic(child));
    return box;
}

async function drawTile(tile, run) {
    for (const old of tile.element.querySelectorAll(':scope > .tile-layer')) old.remove();
    if (view !== 'screens' || !LAYERS.some((name) => layers[name])) return;
    const info = await infoOf(tile.name);
    if (!info || run !== drawing) return;
    const layer = element('div', { className: 'tile-layer', 'data-layer-screen': tile.name });
    tile.element.append(layer);
    const mounted = tile.inspect !== null && !document.body.classList.contains('screen-names');
    let rects = new Map();
    const wanted = [...(layers.layout ? boxesOf(info.layout).map((box) => box.path) : []), ...(layers.logic ? info.handlers.map((handler) => handler.node) : [])];
    if (mounted && wanted.length > 0) {
        const answer = await tile.inspect({ paths: [...new Set(wanted)] }).catch(() => undefined);
        if (run !== drawing) return;
        rects = new Map(((answer && answer.nodes) || []).filter((node) => node.rect).map((node) => [node.path, node.rect]));
    }
    if (layers.layout) {
        if (rects.size > 0) {
            for (const box of boxesOf(info.layout)) {
                const rect = rects.get(box.path);
                if (!rect) continue;
                const outline = element('div', { className: 'lbox', title: box.note }, [element('span', { text: box.key + ' · ' + box.layout })]);
                Object.assign(outline.style, { left: rect.x + 'px', top: rect.y + 'px', width: rect.width + 'px', height: rect.height + 'px' });
                layer.append(outline);
            }
        } else {
            layer.append(element('div', { className: 'schematic' }, [schematic(info.layout)]));
        }
    }
    if (layers.data && info.paths.length > 0) {
        layer.append(element('div', { className: 'side right' }, info.paths.map((path) => {
            const marks = (path.reads ? T['views.reads'] : '') + (path.reads && path.writes ? ' · ' : '') + (path.writes ? T['views.writes'] : '');
            const chip = element('button', { type: 'button', className: 'chip data' + (path.outside ? ' outside' : ''), title: path.path }, [document.createTextNode(path.path), element('em', { text: marks })]);
            chip.addEventListener('click', () => shell.ask(path.path, path.path));
            return chip;
        })));
    }
    if (layers.logic) {
        for (const handler of info.handlers) {
            const rect = rects.get(handler.node);
            if (!rect) continue;
            const badge = element('span', { className: 'badge', title: handler.event + ' → ' + commandsText(handler.commands), text: '⚡' });
            Object.assign(badge.style, { left: rect.x + rect.width + 'px', top: rect.y + 'px' });
            layer.append(badge);
        }
        const chips = info.units.map((unit) => {
            const chip = element('button', { type: 'button', className: 'chip unit', title: unit.reads.concat(unit.writes).join(', ') }, [document.createTextNode((T['views.unit.' + unit.kind] || unit.kind) + ' ' + unit.name), element('em', { text: T['views.runs.' + unit.runs] })]);
            chip.addEventListener('click', () => { setView('logic'); });
            return chip;
        });
        if (info.handlers.length > 0) chips.unshift(element('span', { className: 'chip', text: fill(T['views.handlerCount'], { count: info.handlers.length }) + ' · ' + T['views.runs.browser'] }));
        if (chips.length > 0) layer.append(element('div', { className: 'side left' }, chips));
    }
}

function drawLeads(all) {
    leads.replaceChildren();
    if (view !== 'screens' || !layers.logic) return;
    const [width, height] = shell.canvas.size();
    const at = new Map(all.map((tile) => [tile.name, tile]));
    void Promise.all(all.map((tile) => infoOf(tile.name))).then((list) => {
        list.forEach((info) => {
            if (!info) return;
            const from = at.get(info.screen);
            for (const lead of new Set(info.navigates.filter((each) => each.to !== info.screen).map((each) => each.to))) {
                const to = at.get(lead);
                if (!from || !to) continue;
                const x1 = from.x + width / 2;
                const y1 = from.y + height;
                const x2 = to.x + width / 2;
                const y2 = to.y;
                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                const dip = Math.max(120, Math.abs(x2 - x1) / 3);
                path.setAttribute('d', 'M' + x1 + ',' + y1 + ' C' + x1 + ',' + (y1 + dip) + ' ' + x2 + ',' + (y2 - dip) + ' ' + x2 + ',' + y2);
                path.setAttribute('data-lead', info.screen + '>' + lead);
                leads.append(path);
            }
        });
    });
}

let layerTimer = null;
function drawLayers() {
    clearTimeout(layerTimer);
    return new Promise((resolve) => {
        layerTimer = setTimeout(() => {
            const run = ++drawing;
            const all = tiles();
            drawLeads(all);
            void Promise.all(all.map((tile) => drawTile(tile, run))).then(resolve, resolve);
        }, 120);
    });
}

// Drawn again when the screens move, a frame mounts, the document changes or the app navigates
function layersShown() { return view === 'screens' && LAYERS.some((name) => layers[name]); }
new MutationObserver(() => { if (layersShown()) void drawLayers(); }).observe(world, { childList: true });
new MutationObserver(() => { if (layersShown()) void drawLayers(); }).observe(artboard, { attributes: true, attributeFilter: ['data-screen', 'data-slot-x', 'data-slot-y', 'style', 'hidden'] });
let names = document.body.classList.contains('screen-names');
new MutationObserver(() => {
    const now = document.body.classList.contains('screen-names');
    if (now !== names) { names = now; if (layersShown()) void drawLayers(); }
}).observe(document.body, { attributes: true, attributeFilter: ['class'] });
// A change to the app redraws the view; while a field of the sheet is being edited, once it is left
let reloadWaiting = false;
const editing = () => sheet.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
new MutationObserver(() => {
    if (view === 'screens') { if (layersShown()) void drawLayers(); return; }
    // The revision is written again as it was (a reconnect): Statenet's tree is read only for a new one
    if (view === 'statenet' && graph && (document.body.dataset.revision || null) === graphRevision) return;
    if (editing()) reloadWaiting = true; else void load();
}).observe(document.body, { attributes: true, attributeFilter: ['data-revision'] });
sheet.addEventListener('focusout', () => setTimeout(() => { if (reloadWaiting && !editing()) { reloadWaiting = false; if (view !== 'screens') void load(); } }, 0));
addEventListener('stateui:change', (event) => {
    const path = event.detail && typeof event.detail.path === 'string' ? event.detail.path : '';
    if (path.startsWith('$.route') && view === 'screens') void drawLayers();
});

editor.onReady(() => showSelector());
setTimeout(() => setView(view), 0);
window.magneticViews = { setView, view: () => view, drawLayers };
})();
`;
