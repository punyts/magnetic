/**
 * `/assets/inspect.js`: the editor's inspector, after `/assets/shell.js` and `/assets/host.js`.
 *
 * The inspector is a StateUI app (`/assets/inspector.json`) the page mounts beside the app with `stateuiHost.mount`
 * and fills itself: the page writes its records and whole nodes into it and acts on its emits. The page asks the app
 * frame about its nodes with `stateuiHost.inspect` and draws the hover, the selection and where a node lands on an
 * overlay above the frame, in the frame's own pixels (the overlay is inside the artboard, so it pans and zooms with
 * it). Every change goes to the server as one checked `ui_nodes_write` (`POST /edit/<id>/nodes`), and the app
 * follows through its sync, as it does for the agent.
 *
 * - Select (S): hover outlines a node, a click selects it; the breadcrumb selects a parent; Escape lets go.
 * - Properties: a field per property of the node's component, saved as a `set`; Delete removes the node.
 * - Add: pick a component, then click where it goes; dragging the selected node moves it; Alt+Arrow moves it before
 *   or after its sibling. Where it lands: between the children of a column or row, beside the nearest child in a
 *   grid, at the point in an `adhoc` layout (its placement in pixels).
 * - State: `$.data` as a tree, what shows, reads and writes each path, and the changes as they happen.
 */
export const INSPECT_JS = String.raw`const appId = document.body.dataset.appId;
const base = '/edit/' + encodeURIComponent(appId);
const shell = window.magneticShell;
const host = window.stateuiHost;
const artboard = document.getElementById('artboard');
const shield = document.getElementById('shield');
const overlay = document.getElementById('overlay');
const inspectorPanel = document.getElementById('inspector');
const holder = document.getElementById('inspector-frame');
const statusLine = document.getElementById('inspector-status');
const dataLine = document.getElementById('data-line');
const TEXT_SAVE_MS = 600;
const FLASH_MS = 1200;
const MAX_PATHS = 400;
const MAX_FEED = 40;

let panel = null;
let P = null;
let selected = null;
let hover = null;
let placing = null;
let drop = null;
let crumbPaths = [];
let fieldNames = [];
let library = [];
let search = '';
let category = 'all';
let stateInfo = null;
let pathKeys = [];
let chosenPath = null;
const flashing = new Map();
const feed = [];
let feedCount = 0;
const saveTimers = new Map();

function says(message, bad) {
    statusLine.textContent = message || '';
    statusLine.className = 'small muted status' + (bad ? ' bad' : '');
}

function lastKey(path) { return path.slice(path.lastIndexOf('.') + 1); }
function parentOf(path) { const match = /^(.*)\.children\.[^.]+$/.exec(path); return match ? match[1] : null; }
function clip(text, size) { return text.length > size ? text.slice(0, size - 1) + '…' : text; }
function preview(value) { return clip(value === undefined ? 'nothing' : JSON.stringify(value), 48); }
function labelFor(name) {
    const words = name.replace(/^_/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
    return words.charAt(0).toUpperCase() + words.slice(1);
}
function nodeLabel(node) { return node.component + ' · ' + lastKey(node.path); }

async function getJson(path) {
    const response = await fetch(base + path);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || 'The request failed.');
    return body;
}

async function writeNodes(operations) {
    says('Saving…');
    const response = await fetch(base + '/nodes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operations }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        const first = Array.isArray(body.errors) ? body.errors.find((error) => error.severity !== 'warning') || body.errors[0] : undefined;
        says((first && first.message) || body.message || 'The change was refused.', true);
        return undefined;
    }
    says('Saved');
    setTimeout(() => { if (statusLine.textContent === 'Saved') says(''); }, 1500);
    return body;
}

// The frame's own pixels: the overlay and the frame both fill the artboard, which the canvas scales
function zoom() { return artboard.getBoundingClientRect().width / artboard.offsetWidth || 1; }
function framePoint(event) {
    const box = artboard.getBoundingClientRect();
    const scale = zoom();
    return { x: (event.clientX - box.left) / scale, y: (event.clientY - box.top) / scale };
}
function inside(rect, point) { return point.x >= rect.x && point.y >= rect.y && point.x <= rect.x + rect.width && point.y <= rect.y + rect.height; }

function rectStyle(element, rect) {
    element.style.left = rect.x + 'px';
    element.style.top = rect.y + 'px';
    element.style.width = rect.width + 'px';
    element.style.height = rect.height + 'px';
}

function addBox(rect, className, label) {
    const box = document.createElement('div');
    box.className = 'box ' + className;
    rectStyle(box, rect);
    if (label) {
        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = label;
        box.append(tag);
    }
    overlay.append(box);
}

function draw() {
    overlay.replaceChildren();
    if (selected && selected.rect && !(placing && placing.move)) addBox(selected.rect, 'selected', selected.label);
    if (!placing && hover && !(selected && hover.path === selected.path)) addBox(hover.rect, 'hover', nodeLabel(hover));
    if (placing && drop) {
        addBox(drop.target.rect, 'target', 'into ' + nodeLabel(drop.target));
        if (drop.line) {
            const line = document.createElement('div');
            line.className = 'drop';
            rectStyle(line, drop.line);
            overlay.append(line);
        }
        if (drop.kind === 'adhoc') {
            const dot = document.createElement('div');
            dot.className = 'dot';
            dot.style.left = drop.point.x + 'px';
            dot.style.top = drop.point.y + 'px';
            overlay.append(dot);
        }
    }
}

// One question to the frame at a time; the last point asked for wins
let asking = false;
let waiting = null;
async function inspectAt(point) {
    waiting = point;
    if (asking) return;
    asking = true;
    try {
        while (waiting) {
            const at = waiting;
            waiting = null;
            const answer = await host.inspect({ at });
            if (placing) dropAt(answer, at);
            else hover = answer && answer.nodes[0] ? answer.nodes[0] : null;
            draw();
        }
    } finally {
        asking = false;
    }
}

// Where a node lands: the innermost node under the pointer that lays out children, but never the node being moved
function dropAt(answer, point) {
    drop = null;
    if (!answer) return;
    const moving = placing.move;
    for (const node of answer.nodes) {
        if (moving && (node.path === moving || node.path.startsWith(moving + '.'))) continue;
        if (!node.layout && node.children.length === 0) continue;
        if (node.layout === 'region') continue;
        drop = landing(node, point, moving);
        return;
    }
}

function landing(node, point, moving) {
    const kind = node.layout || 'column';
    const children = node.children.filter((child) => child.path !== moving);
    if (kind === 'adhoc') return { target: node, kind, point, x: Math.round(point.x - node.rect.x), y: Math.round(point.y - node.rect.y) };
    if (children.length === 0) return { target: node, kind, line: { x: node.rect.x + 4, y: node.rect.y + 4, width: Math.max(8, node.rect.width - 8), height: 3 } };
    if (kind === 'grid') {
        let nearest = children[0];
        let best = Infinity;
        for (const child of children) {
            const distance = Math.hypot(child.rect.x + child.rect.width / 2 - point.x, child.rect.y + child.rect.height / 2 - point.y);
            if (distance < best) { best = distance; nearest = child; }
        }
        const before = point.x < nearest.rect.x + nearest.rect.width / 2;
        const edge = before ? nearest.rect.x - 3 : nearest.rect.x + nearest.rect.width;
        return { target: node, kind, ...(before ? { before: lastKey(nearest.path) } : { after: lastKey(nearest.path) }), line: { x: edge, y: nearest.rect.y, width: 3, height: nearest.rect.height } };
    }
    const across = kind === 'row';
    for (const child of children) {
        const middle = across ? child.rect.x + child.rect.width / 2 : child.rect.y + child.rect.height / 2;
        if ((across ? point.x : point.y) < middle) {
            const line = across ? { x: child.rect.x - 3, y: child.rect.y, width: 3, height: child.rect.height } : { x: child.rect.x, y: child.rect.y - 3, width: child.rect.width, height: 3 };
            return { target: node, kind, before: lastKey(child.path), line };
        }
    }
    const last = children[children.length - 1];
    const line = across ? { x: last.rect.x + last.rect.width, y: last.rect.y, width: 3, height: last.rect.height } : { x: last.rect.x, y: last.rect.y + last.rect.height, width: last.rect.width, height: 3 };
    return { target: node, kind, after: lastKey(last.path), line };
}

function startPlacing(what) {
    placing = what;
    drop = null;
    hover = null;
    shell.setTool('place');
    says(what.component ? 'Click where the ' + what.component + ' goes. Escape cancels.' : 'Drop it where it goes. Escape cancels.');
    draw();
}

function stopPlacing(message) {
    placing = null;
    drop = null;
    if (shell.tool() === 'place') shell.setTool('select');
    if (message !== undefined) says(message);
    draw();
}

function addedKey(result) {
    const added = Array.isArray(result.added) ? result.added[0] : result.added;
    if (typeof added === 'string') return lastKey(added);
    if (added && typeof added.key === 'string') return added.key;
    if (added && typeof added.path === 'string') return lastKey(added.path);
    return null;
}

async function commitDrop() {
    const what = placing;
    const where = drop;
    if (!where) { stopPlacing(); says('Point at a place inside a layout.', true); return; }
    const position = where.before ? { before: where.before } : where.after ? { after: where.after } : {};
    stopPlacing();
    if (what.component) {
        const value = { component: what.component };
        if (where.kind === 'adhoc') value.placement = { x: where.x + 'px', y: where.y + 'px' };
        const result = await writeNodes([{ op: 'add', path: where.target.path, value, ...position }]);
        const key = result ? addedKey(result) : null;
        if (key) setTimeout(() => select(where.target.path + '.children.' + key), 300);
        return;
    }
    const key = lastKey(what.move);
    const operations = [{ op: 'move', path: what.move, to: where.target.path + '.children', ...position }];
    if (where.kind === 'adhoc') operations.push({ op: 'merge', path: where.target.path + '.children.' + key, value: { placement: { x: where.x + 'px', y: where.y + 'px' } } });
    if (await writeNodes(operations)) setTimeout(() => select(where.target.path + '.children.' + key), 300);
}

// The Select tool works on the shield over the frame
function selecting() { const tool = shell.tool(); return tool === 'select' || tool === 'place'; }
let press = null;
shield.addEventListener('pointerdown', (event) => {
    if (!selecting() || event.button !== 0) return;
    event.preventDefault();
    shield.setPointerCapture(event.pointerId);
    press = { x: event.clientX, y: event.clientY, point: framePoint(event), dragging: false };
});
shield.addEventListener('pointermove', (event) => {
    if (!selecting()) return;
    const point = framePoint(event);
    if (press && !press.dragging && !placing && selected && selected.rect && inside(selected.rect, press.point) && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 5) {
        press.dragging = true;
        startPlacing({ move: selected.path });
    }
    void inspectAt(point);
});
shield.addEventListener('pointerup', async (event) => {
    if (!press) return;
    const was = press;
    press = null;
    const point = framePoint(event);
    if (placing) {
        dropAt(await host.inspect({ at: point }), point);
        await commitDrop();
        return;
    }
    if (was.dragging) return;
    const answer = await host.inspect({ at: point });
    if (answer && answer.at) void select(answer.at);
});
shield.addEventListener('pointerleave', () => { if (!press) { hover = null; draw(); } });

shell.onTool((tool) => {
    if (tool !== 'place' && placing) { placing = null; drop = null; }
    if (tool !== 'select' && tool !== 'place') hover = null;
    if (tool === 'select') inspectorPanel.hidden = false;
    draw();
});

function crumbsOf(path) {
    const steps = path.slice(2).split('.');
    const list = [];
    let at;
    let rest;
    if (steps[0] === 'app') { at = '$.app'; list.push({ path: at, label: 'App' }); rest = steps.slice(1); }
    else { at = '$.screens.' + steps[1]; list.push({ path: at, label: steps[1] + ' screen' }); rest = steps.slice(2); }
    for (const step of rest) {
        at += '.' + step;
        if (step !== 'children') list.push({ path: at, label: step });
    }
    return list;
}

const FIELD_TYPES = ['string', 'number', 'integer', 'boolean', 'icon'];

function fieldsOf(info) {
    const properties = (info.component && info.component.properties) || {};
    const settings = info.settings || {};
    const entries = Object.entries(properties).filter(([, shape]) => shape && FIELD_TYPES.includes(shape.type));
    entries.sort((a, b) => Number(b[1].kind === 'content') - Number(a[1].kind === 'content'));
    const children = {};
    fieldNames = [];
    for (const [name, shape] of entries.slice(0, 30)) {
        const index = fieldNames.length;
        fieldNames.push(name);
        const key = 'f' + index;
        const label = labelFor(name);
        const linked = settings['<-' + name] || settings['<->' + name];
        const value = name in settings ? settings[name] : shape.default;
        const on = { change: { command: 'emit', target: 'prop' + index } };
        if (typeof linked === 'string') children[key] = { component: 'textField', size: 'sm', _label: label + ' (linked)', value: linked, readonly: true };
        else if (shape.type === 'boolean') children[key] = { component: 'switchField', size: 'sm', _label: label, checked: value === true, on };
        else if (Array.isArray(shape.values) && shape.values.every((option) => typeof option === 'string' && option !== '')) children[key] = { component: 'selectField', size: 'sm', _label: label, options: Object.fromEntries(shape.values.map((option) => [option, { _label: option }])), value: typeof value === 'string' ? value : '', on };
        else if (shape.type === 'number' || shape.type === 'integer') children[key] = { component: 'numberField', size: 'sm', _label: label, value: typeof value === 'number' ? value : '', on };
        else children[key] = { component: 'textField', size: 'sm', _label: label, value: typeof value === 'string' ? value : '', on };
    }
    return { component: 'panel', padding: 'none', children };
}

function showProperties(info) {
    const crumbs = crumbsOf(info.path);
    crumbPaths = crumbs.map((crumb) => crumb.path);
    const items = Object.fromEntries(crumbs.map((crumb, index) => ['c' + index, { _label: crumb.label }]));
    const summary = info.component && info.component.summary ? '. ' + info.component.summary : '';
    panel.write([
        { path: P.crumbs, value: { component: 'breadcrumb', items, current: 'c' + (crumbs.length - 1), on: { select: { command: 'emit', target: 'crumb' } } } },
        { path: P.heading + '._text', value: info.settings.component + summary },
        { path: P.fields, value: fieldsOf(info) },
        { path: P.remove + '.hidden', value: parentOf(info.path) === null }
    ]);
}

function clearProperties() {
    if (!panel) return;
    crumbPaths = [];
    fieldNames = [];
    panel.write([
        { path: P.crumbs, value: { component: 'breadcrumb', items: {}, current: '', on: { select: { command: 'emit', target: 'crumb' } } } },
        { path: P.heading + '._text', value: 'Press S, then click a part of the app to see its properties.' },
        { path: P.fields, value: { component: 'panel', padding: 'none', children: {} } },
        { path: P.remove + '.hidden', value: true }
    ]);
}

async function refreshRect() {
    if (!selected) return;
    const answer = await host.inspect({ paths: [selected.path] });
    const node = answer && answer.nodes.find((candidate) => candidate.path === selected.path);
    if (!selected) return;
    selected.rect = node ? node.rect : null;
    draw();
}

// The app re-renders through its sync a moment after a write: measure the selection again as it settles
function settle() {
    for (const wait of [300, 1000, 2500]) setTimeout(refreshRect, wait);
}

async function select(path) {
    hover = null;
    let info;
    try {
        info = await getJson('/node?path=' + encodeURIComponent(path));
    } catch (error) {
        says(error.message, true);
        return;
    }
    selected = { path, info, rect: null, label: info.settings.component + ' · ' + lastKey(path) };
    inspectorPanel.hidden = false;
    if (panel) {
        showProperties(info);
        panel.command(P.tabs, 'select', 'properties');
    }
    await refreshRect();
    if (selected && !selected.rect) settle();
}

function unselect() {
    selected = null;
    clearProperties();
    draw();
}

async function removeSelected() {
    if (!selected || parentOf(selected.path) === null) return;
    const path = selected.path;
    if (await writeNodes([{ op: 'remove', path }])) unselect();
}

async function nudge(step) {
    if (!selected) return;
    const parent = parentOf(selected.path);
    if (parent === null) return;
    const answer = await host.inspect({ paths: [parent] });
    const node = answer && answer.nodes[0];
    if (!node) return;
    const keys = node.children.map((child) => lastKey(child.path));
    const from = keys.indexOf(lastKey(selected.path));
    const to = from + step;
    if (from < 0 || to < 0 || to >= keys.length) return;
    if (await writeNodes([{ op: 'move', path: selected.path, ...(step < 0 ? { before: keys[to] } : { after: keys[to] }) }])) settle();
}

function valueOf(payload) {
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        if ('value' in payload) return payload.value;
        if ('checked' in payload) return payload.checked;
        if ('key' in payload) return payload.key;
        if ('selected' in payload) return payload.selected;
    }
    return payload;
}

// A field also reports its value when it is first written into the inspector: only a different value is saved
function currentValue(name) {
    const settings = selected.info.settings;
    if (name in settings) return settings[name];
    const shape = selected.info.component && selected.info.component.properties[name];
    return shape ? shape.default : undefined;
}

function saveProperty(name, value, wait) {
    if (!selected) return;
    const path = selected.path + '.' + name;
    clearTimeout(saveTimers.get(path));
    if (value === undefined || JSON.stringify(value) === JSON.stringify(currentValue(name)) || ((value === '' || value === null) && currentValue(name) === undefined)) return;
    const node = selected;
    saveTimers.set(path, setTimeout(async () => {
        saveTimers.delete(path);
        if (await writeNodes([{ op: 'set', path, value }])) {
            node.info.settings[name] = value;
            settle();
        }
    }, wait));
}

// The component library, filtered by the search and the category
function showLibrary() {
    if (!panel) return;
    const words = search.trim().toLowerCase();
    const shown = library.filter((component) => (category === 'all' || component.category === category) && (words === '' || (component.name + ' ' + component.summary).toLowerCase().includes(words))).slice(0, 60);
    panel.write([{ path: '$.data.components', value: Object.fromEntries(shown.map((component, index) => ['k' + index, { id: 'k' + index, name: component.name, summary: component.summary }])) }]);
}

// The State tab: $.data as a tree, and what uses the chosen path
function related(pattern, path) {
    const a = pattern.split('.');
    const b = path.split('.');
    for (let index = 0; index < Math.min(a.length, b.length); index++) {
        if (a[index] === '*' || /^\{.*\}$/.test(a[index])) continue;
        if (a[index] !== b[index]) return false;
    }
    return true;
}

function valueAt(path) {
    let value = stateInfo ? { data: stateInfo.data } : {};
    for (const step of path.slice(2).split('.')) value = value && typeof value === 'object' ? value[step] : undefined;
    return value;
}

function setValueAt(path, value) {
    if (!stateInfo) return;
    const steps = path.slice(2).split('.').slice(1);
    if (steps.length === 0) { stateInfo.data = value || {}; return; }
    let at = stateInfo.data;
    for (const step of steps.slice(0, -1)) {
        if (!at[step] || typeof at[step] !== 'object') at[step] = {};
        at = at[step];
    }
    if (value === undefined) delete at[steps[steps.length - 1]];
    else at[steps[steps.length - 1]] = value;
}

function showPaths() {
    if (!panel || !stateInfo) return;
    const records = {};
    const keyOf = new Map();
    pathKeys = [];
    const visit = (value, path, parent, depth) => {
        if (pathKeys.length >= MAX_PATHS) return;
        const key = 'p' + pathKeys.length;
        pathKeys.push(path);
        keyOf.set(path, key);
        const branch = value !== null && typeof value === 'object';
        const size = branch ? Object.keys(value).length : 0;
        const label = (flashing.has(path) ? '● ' : '') + (parent === null ? 'data' : lastKey(path)) + (branch ? ' (' + size + ')' : ': ' + preview(value));
        records[key] = { id: key, label, hasChildren: branch && size > 0, ...(parent !== null && { parentId: keyOf.get(parent) }) };
        if (branch && depth < 6) for (const [name, inner] of Object.entries(value).slice(0, 100)) visit(inner, path + '.' + name, path, depth + 1);
    };
    visit(stateInfo.data, '$.data', null, 0);
    panel.write([{ path: '$.data.paths', value: records }]);
}

function showDetail(path) {
    if (!panel || !stateInfo) return;
    chosenPath = path;
    const names = (list) => (list.length === 0 ? 'nothing' : list.slice(0, 8).join(', ') + (list.length > 8 ? ' and ' + (list.length - 8) + ' more' : ''));
    const shownBy = stateInfo.bindings.filter((binding) => related(binding.path, path)).map((binding) => lastKey(binding.node) + '.' + binding.property);
    const readBy = stateInfo.logic.filter((unit) => unit.reads.some((read) => related(read, path))).map((unit) => unit.kind + ' ' + unit.name);
    const writtenBy = stateInfo.logic.filter((unit) => unit.writes.some((write) => related(write, path))).map((unit) => unit.kind + ' ' + unit.name);
    panel.write([
        {
            path: P.detail,
            value: {
                component: 'panel',
                padding: 'none',
                children: {
                    path: { component: 'text', textRole: 'label', _text: path },
                    value: { component: 'text', _text: 'Value: ' + clip(JSON.stringify(valueAt(path)) || 'nothing', 300) },
                    shown: { component: 'text', _text: 'Shown by: ' + names(shownBy) },
                    read: { component: 'text', _text: 'Read by: ' + names(readBy) },
                    written: { component: 'text', _text: 'Written by: ' + names(writtenBy) },
                    ask: { component: 'button', size: 'sm', variant: 'soft', _title: 'Ask the agent about it', on: { press: { command: 'emit', target: 'ask' } } }
                }
            }
        }
    ]);
}

async function loadState() {
    try {
        stateInfo = await getJson('/state');
    } catch (error) {
        says(error.message, true);
        return;
    }
    showPaths();
    if (chosenPath) showDetail(chosenPath);
}

function showFeed() {
    if (!panel) return;
    panel.write([{ path: '$.data.feed', value: Object.fromEntries(feed.map((entry) => [entry.id, entry])) }]);
}

function addFeed(line) {
    feedCount += 1;
    feed.unshift({ id: 'e' + feedCount, line: new Date().toLocaleTimeString() + '  ' + line });
    feed.length = Math.min(feed.length, MAX_FEED);
    showFeed();
}

let treeTimer = null;
let traceTimer = null;
const seenRuns = new Set();
async function readTrace() {
    let trace;
    try { trace = await getJson('/trace'); } catch { return; }
    for (const run of (trace.runs || []).slice().reverse()) {
        const id = JSON.stringify(run);
        if (seenRuns.has(id)) continue;
        seenRuns.add(id);
        const name = run.unit || run.name || run.rule || run.machine || 'logic';
        addFeed('Logic ran: ' + (typeof name === 'string' ? name : JSON.stringify(name)) + (run.trigger ? ' on ' + run.trigger : ''));
    }
}

addEventListener('stateui:change', (event) => {
    const change = event.detail;
    if (!change || typeof change.path !== 'string' || !change.path.startsWith('$.data')) return;
    addFeed((change.origin === 'user' ? 'You set ' : 'The app set ') + change.path + ' = ' + preview(change.value));
    if (!stateInfo) return;
    setValueAt(change.path, change.value);
    flashing.set(change.path, Date.now());
    setTimeout(() => {
        if (Date.now() - (flashing.get(change.path) || 0) >= FLASH_MS) { flashing.delete(change.path); showPaths(); }
    }, FLASH_MS);
    clearTimeout(treeTimer);
    treeTimer = setTimeout(() => { showPaths(); if (chosenPath) showDetail(chosenPath); }, 150);
    clearTimeout(traceTimer);
    traceTimer = setTimeout(readTrace, 800);
});

// The Data toggle shows the shape of the data above the chat bar
async function showDataLine() {
    const toggle = document.querySelector('.toggle[data-context="data"]');
    if (!toggle || toggle.getAttribute('aria-pressed') !== 'true') { dataLine.hidden = true; return; }
    try {
        const state = await getJson('/state');
        const parts = Object.entries(state.data || {}).map(([name, value]) => name + (value && typeof value === 'object' ? ' (' + Object.keys(value).length + ')' : ': ' + preview(value)));
        dataLine.textContent = 'Data: ' + (parts.length === 0 ? 'none yet' : parts.slice(0, 12).join(' · '));
        dataLine.hidden = false;
    } catch {
        dataLine.hidden = true;
    }
}
for (const toggle of document.querySelectorAll('.toggle[data-context="data"]')) toggle.addEventListener('click', () => setTimeout(showDataLine, 0));

function onEmit(event) {
    const { name, payload } = event.detail || {};
    if (typeof name !== 'string') return;
    const prop = /^prop(\d+)$/.exec(name);
    if (prop) {
        const field = fieldNames[Number(prop[1])];
        if (field === undefined) return;
        const shape = selected && selected.info.component && selected.info.component.properties[field];
        const typed = shape && (shape.type === 'string' || shape.type === 'icon') && !Array.isArray(shape.values);
        void saveProperty(field, valueOf(payload), typed ? TEXT_SAVE_MS : 0);
        return;
    }
    switch (name) {
        case 'crumb': {
            const index = Number(String(valueOf(payload)).replace(/^c/, ''));
            if (crumbPaths[index]) void select(crumbPaths[index]);
            return;
        }
        case 'remove': void removeSelected(); return;
        case 'search': search = String(valueOf(payload) ?? ''); showLibrary(); return;
        case 'category': category = String(valueOf(payload) ?? 'all'); showLibrary(); return;
        case 'place': if (typeof payload === 'string') startPlacing({ component: payload }); return;
        case 'path': {
            const chosen = valueOf(payload);
            const key = Array.isArray(chosen) ? chosen[0] : chosen;
            const path = pathKeys[Number(String(key).replace(/^p/, ''))];
            if (path) showDetail(path);
            return;
        }
        case 'ask': if (chosenPath) shell.ask(chosenPath); return;
        case 'tab': if (String(valueOf(payload)) === 'state') void loadState(); return;
    }
}

function typing(target) { return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)); }
document.addEventListener('keydown', (event) => {
    if (!shell.editing() || event.ctrlKey || event.metaKey || typing(event.target)) return;
    if (event.key === 'Escape') {
        if (placing) { event.preventDefault(); stopPlacing('Cancelled.'); }
        else if (selected) { event.preventDefault(); unselect(); }
        return;
    }
    if (!selected) return;
    if (event.altKey && /^Arrow(Up|Left|Down|Right)$/.test(event.key)) {
        event.preventDefault();
        void nudge(event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 1);
    } else if (!event.altKey && (event.key === 'Delete' || event.key === 'Backspace')) {
        event.preventDefault();
        void removeSelected();
    }
});

document.getElementById('inspector-close').addEventListener('click', () => { inspectorPanel.hidden = true; if (shell.tool() !== 'use') shell.setTool('use'); });

(async function start() {
    if (!host || !shell) return;
    try {
        const response = await fetch('/assets/inspector.json');
        if (!response.ok) throw new Error('not served');
        const app = await response.json();
        P = app.paths;
        holder.addEventListener('stateui:emit', onEmit);
        holder.addEventListener('stateui:ready', () => { showLibrary(); showFeed(); if (selected) showProperties(selected.info); });
        panel = host.mount(holder, app, 'Inspector');
        const listed = await getJson('/components');
        library = listed.components || [];
        showLibrary();
    } catch {
        says('The inspector could not load.', true);
    }
})();
`;
