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
 * - **Statenet**: the app's graph in four columns (outside, the parts it uses, the app, its own state), from
 *   `GET /edit/<id>/views/graph`. Pressing a node opens its editor at the side: a dataset's records, a model's fields,
 *   a path of the state, a connection and its endpoints (for those who manage connections).
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
/** `/assets/views.css`: the views' sheet, graph, token table, lanes and tile layers (a file: the page's policy allows no inline style) */
export const VIEWS_CSS = [
    'body[data-view]:not([data-view="screens"]) #board { visibility: hidden; }',
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
    '.view-side { width: min(360px, 45%); overflow: auto; padding: 16px; border-left: 1px solid var(--line, #e3e3e3); }',
    '.view-side[hidden] { display: none; }',
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
    '.graph { position: relative; display: grid; grid-template-columns: repeat(4, minmax(160px, 1fr)); gap: 48px; align-items: start; min-width: 760px; }',
    '.graph-column h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted, #666); margin: 0 0 8px; }',
    '.graph-node { position: relative; z-index: 1; display: block; width: 100%; text-align: left; margin: 0 0 12px; padding: 8px 10px !important; border-radius: 10px !important; background: var(--paper, #fff) !important; }',
    '.graph-node.outside { border-style: dashed !important; }',
    '.graph-node.unused { opacity: .45; }',
    '.graph-node.chosen { outline: 2px solid var(--accent, #3d5afe); }',
    '.graph-node b { display: block; overflow-wrap: anywhere; } .graph-node small { display: block; color: var(--muted, #666); overflow-wrap: anywhere; }',
    '.graph-kind { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--accent, #3d5afe); }',
    '.graph-edges { position: absolute; inset: 0; pointer-events: none; overflow: visible; }',
    '.graph-edges path { fill: none; stroke: var(--muted, #999); stroke-width: 1.5; }',
    '.graph-edges path.read, .graph-edges path.call { stroke-dasharray: 5 4; }',
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
const world = document.getElementById('world');
const artboard = document.getElementById('artboard');
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
    effects: { request: '$.data.request', run: 'http', status: '$.data.requestStatus' }
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

const sheet = element('section', { className: 'view-sheet', id: 'view-sheet', hidden: true, 'aria-live': 'polite' });
const heading = element('h2');
const tools = element('div', { className: 'view-tools' });
const status = element('p', { className: 'view-status', role: 'status' });
const main = element('div', { className: 'view-main' });
const side = element('aside', { className: 'view-side', hidden: true });
sheet.append(element('header', { className: 'view-head' }, [heading, tools, status]), element('div', { className: 'view-body' }, [main, side]));
document.body.append(sheet);

function says(text, refused) { status.textContent = text || ''; status.classList.toggle('refused', Boolean(refused)); }
function closeSide() { side.hidden = true; side.replaceChildren(); for (const chosen of main.querySelectorAll('.chosen')) chosen.classList.remove('chosen'); }

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
        layers: { ...layers },
        layerLook: Object.fromEntries(LAYERS.map((name) => [name, layers[name] ? 'solid' : 'ghost'])),
        layerTone: Object.fromEntries(LAYERS.map((name) => [name, layers[name] ? 'accent' : 'neutral']))
    });
    // The chat bar shows what the view sends the agent: the view, and in Screens each layer that is on
    const chips = [{ key: 'view', text: T['shell.view.' + view] }];
    if (view === 'screens') for (const name of LAYERS) if (layers[name]) chips.push({ key: name, text: T['shell.layer.' + name] });
    shell.showContext(chips);
}

function setView(name) {
    if (!VIEWS.includes(name)) return;
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
    if (name === 'view' && typeof value === 'string') { setView(value); return; }
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

let graph = null;
function kindText(node) { return T['views.kind.' + node.kind] || node.kind; }
function noteText(node) {
    switch (node.kind) {
        case 'app': return T['views.note.authority'] + (node.count ? ' · ' + fill(T['views.note.shared'], { count: node.count }) : '');
        case 'theme': return node.isDefault ? T['views.note.defaultTheme'] : '';
        case 'persona': return fill(T['views.note.persona'], { model: node.note });
        case 'shared': return fill(T['views.note.sharedBy'], { name: node.note || T['views.note.anotherOwner'] });
        case 'otherApp': return fill(T['views.note.otherApp'], { path: node.note });
        case 'endpoint': return node.missing ? fill(T['views.note.missing'], { connection: node.note }) : node.note;
        case 'state': return T['views.note.state'];
        case 'server': return T['views.note.server'];
        default: return node.note;
    }
}

async function loadGraph() {
    try { graph = await getJson('/graph'); } catch (error) { says(error.message, true); return; }
    if (view !== 'statenet') return;
    tools.replaceChildren(button(T['views.refresh'], () => void loadGraph()));
    const columns = [0, 1, 2, 3].map((column) => element('div', { className: 'graph-column' }, [element('h3', { text: T['views.column' + column] })]));
    const cards = new Map();
    for (const node of graph.nodes) {
        const card = element('button', { type: 'button', className: 'graph-node' + (node.outside ? ' outside' : '') + (node.used ? '' : ' unused'), 'data-node': node.id }, [
            element('span', { className: 'graph-kind', text: kindText(node) }),
            element('b', { text: node.label }),
            noteText(node) ? element('small', { text: noteText(node) }) : null
        ]);
        card.addEventListener('click', () => void openNode(node, card));
        cards.set(node.id, card);
        columns[node.column].append(card);
    }
    const edges = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    edges.setAttribute('class', 'graph-edges');
    const board = element('div', { className: 'graph' }, [edges, ...columns]);
    main.replaceChildren(board);
    // The lines join the cards' sides, once the cards are laid out
    requestAnimationFrame(() => {
        const origin = board.getBoundingClientRect();
        for (const edge of graph.edges) {
            const from = cards.get(edge.from);
            const to = cards.get(edge.to);
            if (!from || !to) continue;
            const a = from.getBoundingClientRect();
            const b = to.getBoundingClientRect();
            const leftToRight = a.left <= b.left;
            const x1 = (leftToRight ? a.right : a.left) - origin.left;
            const x2 = (leftToRight ? b.left : b.right) - origin.left;
            const y1 = a.top + a.height / 2 - origin.top;
            const y2 = b.top + b.height / 2 - origin.top;
            const bend = Math.max(24, Math.abs(x2 - x1) / 2) * (leftToRight ? 1 : -1);
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', 'M' + x1 + ',' + y1 + ' C' + (x1 + bend) + ',' + y1 + ' ' + (x2 - bend) + ',' + y2 + ' ' + x2 + ',' + y2);
            path.setAttribute('class', edge.kind);
            if (edge.label) { const title = document.createElementNS('http://www.w3.org/2000/svg', 'title'); title.textContent = edge.label; path.append(title); }
            edges.append(path);
        }
    });
}

function sideOpen(card, title, children) {
    for (const chosen of main.querySelectorAll('.chosen')) chosen.classList.remove('chosen');
    if (card) card.classList.add('chosen');
    side.replaceChildren(element('h3', { text: title }), ...children);
    side.hidden = false;
}

async function openNode(node, card) {
    const name = node.id.slice(node.id.indexOf(':') + 1);
    try {
        switch (node.kind) {
            case 'dataset': return datasetEditor(await getJson('/part?kind=data&name=' + encodeURIComponent(name)), card);
            case 'model': return modelEditor(await getJson('/part?kind=models&name=' + encodeURIComponent(name)), card);
            case 'persona': case 'state': return stateEditor(node.kind === 'persona' ? '$.data.' + name : name, card);
            case 'connection': return connectionEditor(await getJson('/part?kind=connections&name=' + encodeURIComponent(name)), card);
            case 'endpoint': return connectionEditor(await getJson('/part?kind=connections&name=' + encodeURIComponent(name.split('/')[0])), card, name.split('/')[1]);
            case 'theme': chosenTheme = name; setView('theme'); return;
            case 'module': setView('logic'); return;
            default: sideOpen(card, node.label, [element('p', { className: 'view-note', text: kindText(node) + (noteText(node) ? ' · ' + noteText(node) : '') })]);
        }
    } catch (error) { says(error.message, true); }
}

function datasetEditor(part, card) {
    const fields = Object.keys(part.fields || {});
    const keys = Object.keys(part.records || {});
    const columns = fields.length > 0 ? fields : [...new Set(keys.flatMap((key) => Object.keys(part.records[key] || {})))];
    const table = element('table', { className: 'records' }, [element('tr', {}, [element('th', { text: '' }), ...columns.map((field) => element('th', { text: field })), element('th')])]);
    let revision = part.revision;
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
        const remove = button('×', async () => {
            const answer = await change('data', { dataset: part.name, revision, operations: [{ op: 'remove', path: key }] });
            if (answer) datasetEditor(await getJson('/part?kind=data&name=' + encodeURIComponent(part.name)), card);
        }, 'danger');
        remove.setAttribute('aria-label', T['views.removeRecord'] + ' ' + key);
        table.append(element('tr', {}, [element('td', { text: key }), ...cells, element('td', {}, [remove])]));
    }
    const add = button(T['views.addRecord'], async () => {
        const value = Object.fromEntries(columns.map((field) => [field, typed(prompt(field) ?? '')]));
        const answer = await change('data', { dataset: part.name, revision, operations: [{ op: 'add', value }] });
        if (answer) datasetEditor(await getJson('/part?kind=data&name=' + encodeURIComponent(part.name)), card);
    });
    const more = part.count > keys.length ? element('p', { className: 'view-note', text: fill(T['views.moreRecords'], { shown: keys.length, count: part.count }) }) : null;
    sideOpen(card, part.name, [element('p', { className: 'view-note', text: part.model ? fill(T['views.ofModel'], { model: part.model }) : '' }), element('div', { style: 'overflow:auto' }, [table]), more, add]);
}

const FIELD_TYPES = ['string', 'number', 'integer', 'boolean', 'array', 'object', 'any', 'url'];
function modelEditor(part, card) {
    let revision = part.revision;
    const rows = Object.entries(part.fields || {}).map(([field, declaration]) => {
        const type = element('select', { 'aria-label': field }, FIELD_TYPES.map((name) => element('option', { value: name, text: name })));
        type.value = declaration && declaration.type;
        type.addEventListener('change', async () => {
            const answer = await change('data', { model: part.name, revision, operations: [{ op: 'set', field, type: type.value }] });
            if (answer) revision = answer.revision;
        });
        const remove = button('×', async () => {
            const answer = await change('data', { model: part.name, revision, operations: [{ op: 'remove', field }] });
            if (answer) modelEditor(await getJson('/part?kind=models&name=' + encodeURIComponent(part.name)), card);
        }, 'danger');
        remove.setAttribute('aria-label', T['views.removeField'] + ' ' + field);
        return element('div', { className: 'view-row' }, [element('b', { text: field }), type, remove]);
    });
    const name = element('input', { placeholder: T['views.fieldName'], 'aria-label': T['views.fieldName'] });
    const type = element('select', { 'aria-label': T['views.fieldType'] }, FIELD_TYPES.map((each) => element('option', { value: each, text: each })));
    const add = button(T['views.addField'], async () => {
        const answer = await change('data', { model: part.name, revision, operations: [{ op: 'set', field: name.value.trim(), type: type.value }] });
        if (answer) modelEditor(await getJson('/part?kind=models&name=' + encodeURIComponent(part.name)), card);
    });
    sideOpen(card, part.name, [...rows, element('div', { className: 'view-row' }, [name, type, add])]);
}

async function stateEditor(path, card) {
    const read = await getJson('/state?path=' + encodeURIComponent(path));
    const text = element('textarea', { 'aria-label': path });
    text.value = JSON.stringify(read.value, null, 2);
    const save = button(T['views.save'], async () => {
        let value;
        try { value = JSON.parse(text.value); } catch { says(T['views.notJson'], true); return; }
        await change('state', { path, value });
    });
    sideOpen(card, path, [element('p', { className: 'view-note', text: T['views.stateNote'] }), text, element('div', { className: 'view-row' }, [save])]);
}

function connectionEditor(info, card, endpointName) {
    const parts = [element('p', { className: 'view-note', text: info.baseUrl + ' · ' + T['views.auth.' + info.auth.kind] + (info.auth.kind === 'none' ? '' : ' · ' + (info.keySet || info.clientSecretSet ? T['views.secretSet'] : T['views.secretNotSet'])) })];
    const form = async (fields) => {
        const answer = await change('connections', { id: info.id, ...fields });
        if (answer && answer.continueTo) { window.open(answer.continueTo.url, '_blank', 'noopener'); return answer; }
        if (answer && !answer.tried) connectionEditor(await getJson('/part?kind=connections&name=' + encodeURIComponent(info.name)), card, endpointName);
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
        const output = element('pre', { className: 'view-note', style: 'white-space:pre-wrap;max-height:200px;overflow:auto' });
        const row = element('div', { className: 'view-row', 'data-endpoint': endpoint.name }, [element('b', { text: endpoint.name }), element('span', { className: 'view-note', text: endpoint.method + ' ' + endpoint.path })]);
        if (info.manages) {
            row.append(button(T['views.try'], async () => {
                const answer = await form({ do: 'try', endpoint: endpoint.name, params: '' });
                if (answer && answer.tried) output.textContent = answer.tried.status + '\n' + answer.tried.body;
            }));
            row.append(button('×', () => void form({ do: 'removeEndpoint', endpoint: endpoint.name }), 'danger'));
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
    sideOpen(card, info.name, parts);
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
        const panel = window.magneticScreens ? window.magneticScreens.panelOf(name) : null;
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
