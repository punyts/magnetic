import { SCRIPT_TEXTS } from './text.js';

/**
 * `/assets/views.js`: the editor's views (docs/design/magnetic-show-views.md), after `/assets/shell.js`,
 * `/assets/inspect.js` and `/assets/screens.js`.
 *
 * The view selector at the top right (the editor app's `view` emit) picks what the canvas shows, kept per app in this
 * browser:
 *
 * - **Screens**: the board of screens, with the rail's tools. The rail's layers draw on every screen card, each in a
 *   layer that follows its card (`magneticScreens.cards`) and scales with the canvas: Layout outlines each node that
 *   lays out others with its key and layout (measured in the live app, a schematic drawn from the document on a
 *   preview); Data lists the state paths the screen reads and writes down its right edge, `$.external` ones as from
 *   outside; Logic marks the nodes with handlers, lists the app's units that touch the screen down its left edge,
 *   each marked Server or Browser, and draws an arrow to each screen it leads to.
 * - **Statenet**: the owner's tree by state path from `GET /edit/<id>/views/graph`, shown by Magnetic's page
 *   `magnetic-statenet` (`src/statenet/StatenetPage.ts`) mounted on the board: a canvas that pans and zooms, with its
 *   branches on its right and left sides, every part with what the app does not use lying flat, and one level below a
 *   part. The editor's zoom runs the canvas's commands while it shows. Pressing a node opens its editor at the side:
 *   a dataset's records, a model's fields, a path of the state, a module's unit, a connection and its endpoints (for
 *   those who manage connections). A + on a branch or a part opens a form that makes what it holds and puts it to use
 *   in the app.
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
    'body:not(.editing) .view-sheet, body:not(.editing) .statenet, body:not(.editing) .view-page { display: none !important; }',
    // Statenet, Theme and Logic are pages of their own on the board, over the screens; the side panel floats over them
    'body.editing[data-view="statenet"] #screens, body.editing[data-view="theme"] #screens, body.editing[data-view="logic"] #screens { visibility: hidden; }',
    '.view-page { position: absolute; z-index: 2; overflow: auto; } .view-page[hidden] { display: none; }',
    '.view-sheet.on-canvas { z-index: 1; background: transparent; box-shadow: none; pointer-events: none; overflow: visible; }',
    '.view-sheet.on-canvas .view-head { pointer-events: auto; align-self: flex-start; max-width: 100%; box-sizing: border-box; border-bottom: 0; border-radius: 12px; background: var(--paper, #fff); box-shadow: var(--shadow, 0 1px 3px rgba(0,0,0,.2)); }',
    '.view-sheet.on-canvas .view-body { margin-top: 12px; }',
    '.view-sheet.on-canvas .view-head:not(:has(.view-status:not(:empty))) { display: none; }',
    '@media (min-width: 760px) { .view-sheet.on-canvas .view-side { align-self: flex-start; max-height: 100%; margin-left: auto; } }',
    '.view-sheet.on-canvas .view-side { pointer-events: auto; border-left: 0; border-top: 0; border-radius: 12px; background: var(--paper, #fff); box-shadow: var(--shadow, 0 1px 3px rgba(0,0,0,.2)); }',
    '.view-sheet { position: fixed; z-index: 0; left: 12px; right: 12px; top: 64px; bottom: 96px; display: flex; flex-direction: column; background: var(--paper, #fff); color: var(--ink, #111); border-radius: 12px; box-shadow: var(--shadow, 0 1px 3px rgba(0,0,0,.2)); font: 14px/1.4 system-ui, sans-serif; overflow: hidden; }',
    '@media (max-width: 759.98px) { .view-sheet { top: 112px; left: 8px; right: 8px; bottom: 132px; } }',
    '.view-sheet[hidden] { display: none; }',
    '.view-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 12px 16px; border-bottom: 1px solid var(--line, #e3e3e3); }',
    '.view-status { margin-left: auto; color: var(--muted, #666); font-size: 13px; }',
    '.view-status.refused { color: #b3261e; }',
    '.view-body { flex: 1; display: flex; min-height: 0; }',
    '.view-side { width: min(360px, 45%); overflow-x: hidden; overflow-y: auto; padding: 16px; border-left: 1px solid var(--line, #e3e3e3); }',
    '.view-side[hidden] { display: none; }',
    '.view-side-head { display: flex; align-items: flex-start; gap: 8px; } .view-side-head h3 { flex: 1; min-width: 0; margin-top: 0; overflow-wrap: anywhere; }',
    '.view-sheet .view-close, .view-close { flex: none; width: 32px; height: 32px; margin: -6px -6px 0 0; padding: 0; border: 0; display: grid; place-items: center; cursor: pointer; border-radius: 50%; color: inherit; background: transparent; }',
    '.glyph { display: block; width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }',
    '.view-close .glyph { width: 14px; height: 14px; }',
    '.view-sheet .view-close:hover, .view-close:hover { background: color-mix(in srgb, currentColor 14%, transparent); }',
    '@media (max-width: 759.98px) { .view-body { flex-direction: column; } .view-side { width: auto; border-left: 0; border-top: 1px solid var(--line, #e3e3e3); max-height: 50%; } .view-sheet.on-canvas .view-side { margin-top: auto; } }',
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
    '.statenet > .stateui-panel { position: absolute; inset: 0; }',
    '.view-schema { margin: 4px 0 8px; padding: 8px; overflow: auto; max-height: 220px; border-radius: 8px; font-size: 12px; background: color-mix(in srgb, currentColor 6%, transparent); }',
    // A record table scrolls on its own, sideways; the panel never does
    '.records-wrap { overflow-x: auto; max-width: 100%; margin: 8px 0; }',
    '.records tr.adding td { border-bottom: 0; padding-top: 8px; }',
    '.view-sheet button.remove { display: inline-grid; place-items: center; width: 28px; height: 28px; padding: 0; flex: none; vertical-align: middle; }',
    '.view-sheet button.remove .glyph { width: 10px; height: 10px; }',
    '.view-sheet button.remove:hover { background: color-mix(in srgb, currentColor 14%, transparent); }',
    '.view-field { display: grid; gap: 2px; margin: 8px 0; } .view-field > span { font-size: 12px; color: var(--muted, #666); }',
    '.view-output { white-space: pre-wrap; max-height: 200px; overflow: auto; }',
    '.view-link { color: var(--accent, #3d5afe); font-weight: 600; }',
    '.view-side .view-row button.screen { border-radius: 8px; }',
    '.records { border-collapse: collapse; font-size: 12px; } .records td, .records th { border-bottom: 1px solid var(--line, #eee); padding: 2px 4px; text-align: left; } .records input { width: 110px; }',
    // The layers on the screen cards: each in its app's own pixels, following the card and scaled as the canvas scales it
    '.views-layer { position: absolute; inset: 0; z-index: 2; pointer-events: none; overflow: hidden; }',
    '.views-layer[hidden] { display: none; }',
    '.tile-layer { position: absolute; left: 0; top: 0; transform-origin: 0 0; pointer-events: none; font: calc(12px / var(--zoom, 1)) system-ui, sans-serif; }',
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
    '.leads { position: absolute; left: 0; top: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }',
    '.leads path { fill: none; stroke: #f57c00; stroke-width: 3px; }'
].join('\n');

export const VIEWS_JS = String.raw`${SCRIPT_TEXTS}(function views() {
const shell = window.magneticShell;
const host = window.stateuiHost;
if (!shell) return;
const editor = shell.editor;
const appId = document.body.dataset.appId;
const base = '/edit/' + encodeURIComponent(appId) + '/views';
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
const status = element('p', { className: 'view-status', role: 'status' });
const side = element('aside', { className: 'view-side', hidden: true });
sheet.append(element('header', { className: 'view-head' }, [status]), element('div', { className: 'view-body' }, [side]));
document.body.append(sheet);

/** What the view says last: a change saved, or why it was refused. Theme and Logic show it in their page */
let said = '';
function says(text, refused) {
    said = text || '';
    if (page) { pageWrite({ status: refused ? '' : said, refusal: refused ? said : '', noRefusal: !refused || !said }); return; }
    status.textContent = said;
    status.classList.toggle('refused', Boolean(refused));
}
function unchoose() { if (chosenUnit !== null) { chosenUnit = null; drawLogic(); } }
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
        setTimeout(() => { if (said === T['views.saved']) says(''); }, 1500);
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

/** Shows a view; led when a card of Statenet led there, so the page offers the way back */
function setView(name, led) {
    if (!VIEWS.includes(name)) return;
    fromGraph = Boolean(led && view === 'statenet' && (name === 'theme' || name === 'logic'));
    if (name !== 'statenet') leaveGraph();
    if (name !== 'theme' && name !== 'logic') leavePage();
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
    sheet.classList.add('on-canvas');
    closeSide();
    says('');
    pageWrite({ noBack: !fromGraph });
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
            net = { panel: host.mount(netHolder, { document: page.document, icons: page.icons, inPage: true }, T['shell.view.statenet']), canvas: keyPath(page.document, 'canvas') };
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

// ---- Theme and Logic: pages of Magnetic's on the board ---------------------------------------------------------------

/*
 * Theme and Logic are Magnetic's pages magnetic-theme (src/theme/ThemePage.ts) and magnetic-logic
 * (src/logic/LogicPage.ts), mounted on the board while their view shows, in the area the editor's panels leave free.
 * This script writes their $.data.theme or $.data.logic and acts on their emits; the side panel opens beside them
 */
const pageHolder = element('div', { className: 'view-page', id: 'view-page', hidden: true });
document.getElementById('board').append(pageHolder);
/** The mounted page: its view and its panel; null while neither Theme nor Logic shows */
let page = null;
let pageMounting = null;
/** Whether a card of Statenet led to the view shown, so the page offers the way back */
let fromGraph = false;

/** The page's data, below $.data.<view> */
function pageWrite(fields) {
    if (page) page.panel.write(Object.entries(fields).map(([name, value]) => ({ path: '$.data.' + page.view + '.' + name, value })));
}
/** Places the page in the area the editor's panels leave free */
function placePage() {
    const free = shell.canvas.freeArea();
    Object.assign(pageHolder.style, { left: free.left + 'px', top: free.top + 'px', width: Math.max(0, free.width) + 'px', height: Math.max(0, free.height) + 'px' });
}
addEventListener('resize', () => { if (page) placePage(); });

/** Mounts the view's page on the board; true once it is there */
function enterPage(name) {
    pageHolder.hidden = false;
    placePage();
    if (page && page.view === name) return Promise.resolve(true);
    if (pageMounting) return pageMounting.then(() => enterPage(name));
    leavePage();
    pageHolder.hidden = false;
    pageMounting = (async () => {
        try {
            const response = await fetch('/assets/' + name + '.json', { headers: { Accept: 'application/json' } });
            if (!response.ok) throw new Error(T['views.refused']);
            const served = await response.json();
            if (view !== name) return false;
            pageHolder.replaceChildren();
            page = { view: name, panel: host.mount(pageHolder, { document: served.document, icons: served.icons, inPage: true }, T['shell.view.' + name]) };
            pageWrite({ noBack: !fromGraph });
            return true;
        } catch (error) {
            says(error.message, true);
            return false;
        } finally {
            pageMounting = null;
        }
    })();
    return pageMounting;
}
function leavePage() {
    if (page) page.panel.dispose();
    page = null;
    pageHolder.replaceChildren();
    pageHolder.hidden = true;
}

pageHolder.addEventListener('stateui:emit', (event) => {
    const { name, payload } = event.detail || {};
    if (!page) return;
    if (name === 'back') { setView('statenet'); return; }
    if (page.view === 'theme') void themeEmit(name, payload);
    else if (page.view === 'logic') void logicEmit(name, payload);
});

// ---- Theme ---------------------------------------------------------------------------------------------------------

/** The modes the page has a column and a specimen for (THEME_MODES) */
const THEME_MODES = ['light', 'dark', 'contrast'];
let chosenTheme = null;
let theme = null;
/** The token records last written to the page, by path: what a changed record is compared with */
let themeRows = new Map();
/** The shared themes this person chose to edit for every app that uses them, this visit */
const editShared = new Set();

function valueIn(mode, path) { const token = theme.tokens.find((each) => each.path === path); return token ? token.values[mode] : undefined; }

/** The reads of the Theme and Logic views in flight: only the last one started draws, so a read that began before a write cannot undo what the write showed */
let readTurn = 0;
async function loadTheme(name) {
    const turn = ++readTurn;
    let answer;
    try { answer = await getJson('/theme' + (name ? '?theme=' + encodeURIComponent(name) : '')); } catch (error) { if (turn === readTurn) says(error.message, true); return; }
    if (turn !== readTurn) return;
    theme = answer;
    if (view !== 'theme' || !(await enterPage('theme')) || view !== 'theme') return;
    chosenTheme = theme.theme;
    const current = theme.themes.find((each) => each.name === theme.theme);
    const others = theme.workspaceThemes.filter((each) => !theme.themes.some((used) => used.name === each));
    const fields = {
        themes: Object.fromEntries(theme.themes.map((each) => [each.name, { _label: (each.isDefault ? '★ ' : '') + each.name }])),
        chosen: theme.theme || '',
        others: Object.fromEntries(others.map((each) => [each, { _label: each }])),
        adding: '',
        noTheme: !theme.theme,
        hasTheme: Boolean(theme.theme),
        noDefault: !current || current.isDefault,
        noClone: !current || theme.usedBy.length === 0,
        noRemove: !current,
        noOthers: others.length === 0
    };
    if (!theme.theme) { themeRows = new Map(); pageWrite({ ...fields, tokens: [], notShared: true }); return; }
    const locked = theme.usedBy.length > 0 && !editShared.has(theme.theme);
    const specimens = Object.fromEntries(THEME_MODES.map((mode) => [mode, {
        surface: shown(valueIn(mode, 'color.surface.base')),
        border: shown(valueIn(mode, 'color.border.base')),
        text: shown(valueIn(mode, 'color.text.base')),
        accent: shown(valueIn(mode, 'color.accent.base')),
        accentOn: shown(valueIn(mode, 'color.accent.on'))
    }]));
    let group = '';
    const tokens = theme.tokens.map((token) => {
        const first = token.group !== group;
        group = token.group;
        const row = { id: token.path, group: first ? group : '', name: token.path.slice(group.length + 1) || token.path, locked };
        const own = 'own' in token;
        row.all = own ? shown(token.own) : '';
        row.allShown = '';
        row.allLabel = token.path + ' ' + T['views.allModes'];
        for (const mode of THEME_MODES) {
            const set = Object.hasOwn(token.modes, mode);
            row[mode] = set ? shown(token.modes[mode]) : '';
            row[mode + 'Shown'] = theme.modes.includes(mode) ? shown(token.values[mode]) : '';
            row[mode + 'Label'] = token.path + ' ' + (T['views.mode.' + mode] || mode);
        }
        return row;
    });
    themeRows = new Map(tokens.map((row) => [row.id, row]));
    pageWrite({ ...fields, specimens, tokens, notShared: !locked, sharedText: locked ? fill(T['views.sharedTheme'], { apps: theme.usedBy.join(', ') }) : '' });
}

async function themeEmit(name, payload) {
    // A button's emit sends the value it is given; a field's change sends { value }
    const value = typeof payload === 'string' ? payload : payload && typeof payload.value === 'string' ? payload.value : '';
    const act = async (action, extra) => {
        const answer = await change('theme', { action, theme: theme && theme.theme, ...extra });
        if (answer) await loadTheme(answer.theme || null);
    };
    switch (name) {
        case 'choose': if (value && (!theme || value !== theme.theme)) await loadTheme(value); return;
        case 'token': if (payload && typeof payload === 'object') await tokenChanged(payload); return;
        case 'editAll': if (theme && theme.theme) { editShared.add(theme.theme); await loadTheme(theme.theme); } return;
        case 'clone': if (theme && theme.theme) await cloneTheme(); return;
        case 'default': if (theme && theme.theme) await act('default'); return;
        case 'remove': if (theme && theme.theme && confirm(fill(T['views.removeThemeConfirm'], { name: theme.theme }))) await act('remove'); return;
        case 'add': if (value) { const answer = await change('theme', { action: 'add', theme: value }); if (answer) await loadTheme(answer.theme); else pageWrite({ adding: '' }); } return;
        case 'create': {
            const preset = theme && theme.presets.includes(value) ? value : 'clean';
            const chosen = prompt(T['views.themeName'], freeThemeName(preset));
            if (!chosen) return;
            const answer = await change('theme', { action: 'create', theme: chosen.trim(), preset });
            if (answer) await loadTheme(answer.theme);
            return;
        }
        default:
    }
}

/**
 * A token's record came back with a value changed in one column: all modes, or one mode. A value cleared for all modes
 * takes the theme's own value away; one cleared in a mode, or a record that changed nothing, is shown as it was
 */
async function tokenChanged(record) {
    const before = themeRows.get(record.id);
    const token = theme && theme.tokens.find((each) => each.path === record.id);
    if (!before || !token) return;
    const column = ['all', ...THEME_MODES].find((each) => typeof record[each] === 'string' && record[each] !== before[each]);
    if (column === undefined) return;
    const text = record[column].trim();
    if (text !== '') await writeToken(token, column === 'all' ? null : column, typed(text));
    else if (column === 'all' && 'own' in token) await writeTheme([{ op: 'remove', path: token.path }]);
    else await loadTheme(theme.theme);
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
    if (!answer) { await loadTheme(theme.theme); return; }
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

// ---- Logic ---------------------------------------------------------------------------------------------------------

let logic = null;
/** The unit open in the side panel, lit in its lane */
let chosenUnit = null;
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

/** What a unit does, in a line: a machine's transitions, a rule's when and do, an effect's request, a table's or compute's inputs and outputs */
function doesText(unit) {
    const value = unit.value || {};
    if (unit.group === 'machines') return (value.transitions || []).map((transition) => [].concat(transition.from || '*').join('|') + ' → ' + (transition.to || '·')).join(', ') || shown(value.initial);
    if (unit.group === 'rules') return T['views.when'] + ' ' + triggerText(value.when) + ' → ' + commandsText(value.do);
    if (unit.group === 'effects') return triggerText({ path: value.request }) + ' → ' + commandsText(value.run);
    return shown(value.inputs) + ' → ' + shown(value.outputs);
}

/** The server keeps what a browser cannot be trusted with: a guard, an effect, a call, a $.server path */
function serverOnly(unit) {
    const text = JSON.stringify(unit.value || {});
    return unit.kind === 'guard' || unit.group === 'effects' || text.includes('"call"') || text.includes('$.server');
}

function unitId(unit) { return unit.group + '.' + unit.name; }

async function loadLogic() {
    const turn = ++readTurn;
    let answer;
    try { answer = await getJson('/logic'); } catch (error) { if (turn === readTurn) says(error.message, true); return; }
    if (turn !== readTurn) return;
    logic = answer;
    if (view !== 'logic' || !(await enterPage('logic')) || view !== 'logic') return;
    drawLogic();
}

function drawLogic() {
    if (!logic || !page || page.view !== 'logic') return;
    const units = logic.units.map((unit, index) => ({
        id: unitId(unit),
        runs: unit.runs === 'browser' ? 'browser' : 'server',
        order: index + 1,
        kind: T['views.unit.' + unit.kind] || unit.kind,
        title: unit.name + (unit.position !== undefined ? ' #' + (unit.position + 1) : ''),
        does: doesText(unit),
        paths: (unit.reads.length ? T['views.reads'] + ' ' + unit.reads.join(', ') : '') + (unit.writes.length ? '  ' + T['views.writes'] + ' ' + unit.writes.join(', ') : ''),
        chosen: unitId(unit) === chosenUnit,
        fixed: !unit.own,
        noServer: !unit.own || unit.runs !== 'browser',
        noBrowser: !unit.own || unit.runs === 'browser' || serverOnly(unit)
    }));
    const handlers = logic.handlers.map((handler, index) => ({ id: 'h' + index, screen: handler.screen, does: handler.node.replace(/^\$\.screens\.[^.]+\.root/, '') + ' · ' + handler.event + ' → ' + commandsText(handler.commands) }));
    pageWrite({ units, handlers, hasUnits: units.length > 0, noHandlers: handlers.length === 0 });
}

async function logicEmit(name, payload) {
    const id = typeof payload === 'string' ? payload : payload && typeof payload === 'object' && typeof payload.key === 'string' ? payload.key : '';
    const unit = logic && logic.units.find((each) => unitId(each) === id);
    switch (name) {
        case 'open': if (unit) unitEditor(unit); return;
        case 'move': {
            if (!unit) return;
            // The button moves a unit to the other lane; a drag says which lane it was dropped in
            const to = typeof payload === 'string' ? (unit.runs === 'browser' ? 'server' : 'browser') : payload.to;
            if (to === (unit.runs === 'browser' ? 'browser' : 'server')) { drawLogic(); return; }
            if (!unit.own) { says(fill(T['views.fromModule'], { module: unit.module || '' }), true); drawLogic(); return; }
            if (to === 'browser' && serverOnly(unit)) { says(T['views.mustServer'], true); drawLogic(); return; }
            const value = JSON.parse(JSON.stringify(unit.value || {}));
            if (to === 'browser') value.runs = 'browser'; else delete value.runs;
            if (!(await writeUnit(id, value))) drawLogic();
            return;
        }
        case 'delete': if (unit && unit.own && confirm(fill(T['views.deleteUnitConfirm'], { name: unit.name }))) await writeUnit(id, null); return;
        case 'create': {
            const group = Object.hasOwn(UNIT_KINDS, payload) ? payload : 'rules';
            const unitName = prompt(T['views.unitName'], '');
            if (!unitName) return;
            unitEditor({ group, kind: UNIT_KINDS[group], name: unitName.trim(), value: UNIT_TEMPLATES[group], own: true, isNew: true });
            return;
        }
        default:
    }
}

/** Sets a unit, or removes it (value null), through the person's tools; true when it was written */
async function writeUnit(id, value) {
    const answer = await change('logic', { unit: id, revision: logic.revision, ...(value === null ? { remove: true } : { value }) });
    if (!answer) return false;
    shell.editorChanged();
    closeSide();
    await loadLogic();
    return true;
}

/** A unit as JSON at the side: saved when it is the app's own, shown when it comes from a logic module */
function unitEditor(unit) {
    const text = element('textarea', { 'aria-label': unit.group + '.' + unit.name });
    text.value = JSON.stringify(unit.value, null, 2);
    const id = unitId(unit);
    const parts = [element('p', { className: 'view-note', text: (T['views.unit.' + unit.kind] || unit.kind) + ' · ' + T['views.runs.' + (unit.runs || 'server')] })];
    if (!unit.own) {
        parts.push(element('p', { className: 'view-note', text: fill(T['views.fromModule'], { module: unit.module || '' }) }), text);
        text.readOnly = true;
    } else {
        parts.push(text, element('div', { className: 'view-row' }, [button(T['views.save'], () => {
            let value;
            try { value = JSON.parse(text.value); } catch { says(T['views.notJson'], true); return; }
            void writeUnit(id, value);
        })]));
    }
    sideOpen(null, unit.name, parts, id);
    chosenUnit = unit.isNew ? null : id;
    drawLogic();
}

// ---- The layers on the screen tiles --------------------------------------------------------------------------------

const infos = new Map();
let infoRevision = null;
let drawing = 0;
// The layers sit in one fixed layer above the board; each follows its card (see follow below)
const holder = document.createElement('div');
holder.className = 'views-layer';
holder.hidden = true;
const leads = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
leads.setAttribute('class', 'leads');
holder.append(leads);
(document.getElementById('board') || document.body).append(holder);
/** The layers drawn, each on the element of its card */
let drawn = [];
/** The leads between screens, by the names of the screens they join */
let leadPairs = [];

/** The screens' cards in the page (magneticScreens.cards): the live app is asked about its nodes, a preview is not */
function tiles() {
    const cards = window.magneticScreens && window.magneticScreens.cards ? window.magneticScreens.cards() : [];
    return cards.map((card) => ({ name: card.name, element: card.element, inspect: card.live && host ? (query) => host.inspect(query) : null }));
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
    if (view !== 'screens' || !LAYERS.some((name) => layers[name])) return;
    const info = await infoOf(tile.name);
    if (!info || run !== drawing) return;
    const layer = element('div', { className: 'tile-layer', 'data-layer-screen': tile.name });
    holder.append(layer);
    drawn.push({ tile, layer, at: '' });
    const mounted = tile.inspect !== null;
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

/** Which screens lead to which, for the logic layer: drawn between the cards by placeLeads */
function drawLeads(all, run) {
    leadPairs = [];
    if (view !== 'screens' || !layers.logic) { placeLeads(); return; }
    const names = new Set(all.map((tile) => tile.name));
    void Promise.all(all.map((tile) => infoOf(tile.name))).then((list) => {
        if (run !== drawing) return;
        list.forEach((info) => {
            if (!info) return;
            for (const lead of new Set(info.navigates.filter((each) => each.to !== info.screen).map((each) => each.to))) {
                if (names.has(info.screen) && names.has(lead)) leadPairs.push([info.screen, lead]);
            }
        });
        placeLeads();
    });
}

/** The leads in the page's pixels, from the bottom of a card to the top of the one it leads to */
function placeLeads() {
    leads.replaceChildren();
    const boxes = new Map(drawn.map((each) => [each.tile.name, each.tile.element.getBoundingClientRect()]));
    for (const [fromName, toName] of leadPairs) {
        const from = boxes.get(fromName);
        const to = boxes.get(toName);
        if (!from || !to) continue;
        const x1 = from.left + from.width / 2;
        const y1 = from.bottom;
        const x2 = to.left + to.width / 2;
        const y2 = to.top;
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const dip = Math.max(40, Math.abs(x2 - x1) / 3);
        path.setAttribute('d', 'M' + x1 + ',' + y1 + ' C' + x1 + ',' + (y1 + dip) + ' ' + x2 + ',' + (y2 - dip) + ' ' + x2 + ',' + y2);
        path.setAttribute('data-lead', fromName + '>' + toName);
        leads.append(path);
    }
}

let layerTimer = null;
function drawLayers() {
    clearTimeout(layerTimer);
    return new Promise((resolve) => {
        layerTimer = setTimeout(() => {
            const run = ++drawing;
            for (const each of drawn) each.layer.remove();
            drawn = [];
            const all = tiles();
            cardsSeen = signature(all);
            holder.hidden = !layersShown();
            void Promise.all(all.map((tile) => drawTile(tile, run))).then(() => { placed(); drawLeads(all, run); resolve(); }, resolve);
        }, 120);
    });
}

// Drawn again when the cards change (one mounts, names start or end, the screens change), the document changes or
// the app navigates; between, each layer follows its card as the canvas pans and zooms
function layersShown() { return view === 'screens' && LAYERS.some((name) => layers[name]); }
/** How many frames pass between two looks at which cards are in the page */
const LOOK_AGAIN_FRAMES = 20;
let cardsSeen = '';
let looked = 0;
function signature(all) { return all.map((tile) => tile.name + (tile.inspect ? '*' : '') + (tile.element.className || '')).join(' '); }
/** Puts each layer on its card: its app's own size, moved and scaled as the card is; true when one moved */
function placed() {
    let moved = false;
    for (const each of drawn) {
        const element = each.tile.element;
        const box = element.getBoundingClientRect();
        const scale = box.width / (element.offsetWidth || 1) || 1;
        const at = [box.left, box.top, element.offsetWidth, element.offsetHeight, scale].join(' ');
        if (at === each.at) continue;
        each.at = at;
        moved = true;
        Object.assign(each.layer.style, { width: element.offsetWidth + 'px', height: element.offsetHeight + 'px', transform: 'translate(' + box.left + 'px, ' + box.top + 'px) scale(' + scale + ')' });
        each.layer.style.setProperty('--zoom', String(scale));
    }
    return moved;
}
function follow() {
    if (layersShown()) {
        if (++looked >= LOOK_AGAIN_FRAMES) {
            looked = 0;
            if (signature(tiles()) !== cardsSeen) void drawLayers();
        }
        if (placed()) placeLeads();
    }
    requestAnimationFrame(follow);
}
requestAnimationFrame(follow);
// A change to the app redraws the view; while a field of the sheet is being edited, once it is left
let reloadWaiting = false;
/** Whether the person types in a field of the side panel or of the page shown, whose shadow roots hold the field */
const editing = () => {
    let active = document.activeElement;
    if (!active || !(sheet.contains(active) || pageHolder.contains(active))) return false;
    while (active.shadowRoot && active.shadowRoot.activeElement) active = active.shadowRoot.activeElement;
    return /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName);
};
new MutationObserver(() => {
    if (view === 'screens') { if (layersShown()) void drawLayers(); return; }
    // The revision is written again as it was (a reconnect): Statenet's tree is read only for a new one
    if (view === 'statenet' && graph && (document.body.dataset.revision || null) === graphRevision) return;
    if (editing()) reloadWaiting = true; else void load();
}).observe(document.body, { attributes: true, attributeFilter: ['data-revision'] });
const reloadLeft = () => setTimeout(() => { if (reloadWaiting && !editing()) { reloadWaiting = false; if (view !== 'screens') void load(); } }, 0);
sheet.addEventListener('focusout', reloadLeft);
pageHolder.addEventListener('focusout', reloadLeft);
addEventListener('stateui:change', (event) => {
    const path = event.detail && typeof event.detail.path === 'string' ? event.detail.path : '';
    if (path.startsWith('$.route') && view === 'screens') void drawLayers();
});

editor.onReady(() => showSelector());
setTimeout(() => setView(view), 0);
window.magneticViews = { setView, view: () => view, drawLayers };
})();
`;
