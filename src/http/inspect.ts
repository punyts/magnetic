import { SCRIPT_TEXTS } from './text.js';

/**
 * `/assets/inspect.js`: the editor's inspector, after `/assets/host.js` and `/assets/shell.js`.
 *
 * The inspector's tabs are part of the editor app (`magneticShell.editor`): this script writes what they show into the
 * editor's data (`$.data.editor` and the lists `components`, `paths`, `feed`), fills its `propertyFields` panel with
 * a field per property, and acts on its emits. It asks the live app about its nodes with `stateuiHost.inspect` and
 * draws the hover, the selection and where a node lands on an overlay above it, in the app's own pixels: a layer that
 * follows the live app's element on its card (`magneticScreens.liveApp`) and scales with the canvas. With the Move
 * tool a drag on the layer pans the board (`magneticScreens.panBy`), which leaves the live app's own presses to it.
 * Every change goes to the server as one checked
 * `ui_nodes_write` (`POST /edit/<id>/nodes`), and the app follows through its sync, as it does for the agent.
 *
 * - Select (S): hover outlines a node, a click selects it; the breadcrumb selects a parent; Escape lets go.
 * - Properties: a field per property of the node's component, saved as a `set`; Delete removes the node. A node
 *   that lays out parts has a Layout section (its type, then that type's settings, from stateui-app's `LAYOUTS`), and
 *   a node inside a layout has a Placement section (the fields its parent's layout gives a child). Changing the type
 *   keeps the settings both types share and drops the rest, and clears the children's placements the new type lacks,
 *   all in one write.
 * - The library (a panel of the editor beside the rail): drag a component onto the app, or press it and then click
 *   where it goes. A card holds the pointer while it is dragged and emits `grab`, `dragMove` and `dragEnd` with the
 *   pointer in the editor's frame, which covers the window, so in the page's own pixels: over the app frame the drop
 *   shows where it would land, let go there it lands, and anywhere else (or Escape) it is cancelled. Dragging the
 *   selected node moves it; Alt+Arrow moves it before or after its sibling. Where it lands: between the children of a column or row, beside the nearest child in a
 *   grid, at the point in an `adhoc` layout (its placement in pixels). While a component is placed or a part moved,
 *   every layout section of the screen is outlined with its name and layout, so the places it can go show.
 * - State: `$.data` as a tree, what shows, reads and writes each path, and the changes as they happen.
 */
export const INSPECT_JS = String.raw`${SCRIPT_TEXTS}const appId = document.body.dataset.appId;
const base = '/edit/' + encodeURIComponent(appId);
const shell = window.magneticShell;
const host = window.stateuiHost;
// The inspector's layer over the live app: the shield takes the tools' presses and the overlay draws, both in the app's
// own pixels. The layer follows the element the live app runs on, on its card (magneticScreens.liveApp), and scales
// with the canvas around it
const layer = document.createElement('div');
layer.className = 'inspect-layer';
layer.hidden = true;
const shield = document.createElement('div');
shield.className = 'shield';
shield.hidden = true;
const overlay = document.createElement('div');
overlay.className = 'overlay';
overlay.setAttribute('aria-hidden', 'true');
layer.append(shield, overlay);
// On the board, which fills the window: the layer is part of the canvas, under the editor's panels
(document.getElementById('board') || document.body).append(layer);
/** How many frames the live app's element is kept before it is looked for again */
const LOOK_AGAIN_FRAMES = 20;
/** The live app: its element and screen, or null while none is on the board */
let live = null;
let looked = 0;
let placed = '';
function follow() {
    if (!live || !live.element.isConnected || ++looked >= LOOK_AGAIN_FRAMES) {
        looked = 0;
        live = window.magneticScreens ? window.magneticScreens.liveApp() : null;
    }
    let next = 'none';
    if (live) {
        const box = live.element.getBoundingClientRect();
        const scale = box.width / (live.element.offsetWidth || 1) || 1;
        next = [box.left, box.top, live.element.offsetWidth, live.element.offsetHeight, scale].join(' ');
        if (next !== placed) {
            layer.style.width = live.element.offsetWidth + 'px';
            layer.style.height = live.element.offsetHeight + 'px';
            layer.style.transform = 'translate(' + box.left + 'px, ' + box.top + 'px) scale(' + scale + ')';
            layer.style.setProperty('--zoom', String(scale));
        }
    }
    if (next !== placed) { placed = next; layer.hidden = live === null; }
    requestAnimationFrame(follow);
}
requestAnimationFrame(follow);
/** The live app's element, or the layer while there is none (its box is then empty) */
function appElement() { return live ? live.element : layer; }
const editor = shell ? shell.editor : null;
const TEXT_SAVE_MS = 600;
const FLASH_MS = 1200;
const MAX_PATHS = 400;
const MAX_FEED = 40;

let selected = null;
let hover = null;
/** Where the pointer was when hover was found: over the gaps of a layout rather than one of its children, the layout shows */
let hoverAt = null;
let placing = null;
let drop = null;
/** While a component is placed or a part moved: the screen's layout sections, each a box with its name and layout */
let sections = [];
/** Bumped by each start and stop of placing, so a late answer for an earlier one is dropped */
let sectionsRun = 0;
let crumbPaths = [];
let fieldNames = [];
let library = [];
/** stateui-app's layouts, by type: each with its settings and the placement fields of a child */
let layouts = {};
let layoutFieldNames = [];
let placeFieldNames = [];
/** The key of a select's "not set" choice */
const UNSET = '_unset';
let search = '';
let category = 'all';
let stateInfo = null;
let pathKeys = [];
let chosenPath = null;
const flashing = new Map();
const feed = [];
let feedCount = 0;
const saveTimers = new Map();

function says(message) {
    editor.set({ inspectorStatus: message || '' });
}

/** Shows a tab of the editor's sidebar, also when it shows it already */
function showTab(name) {
    editor.set({ tab: '' });
    editor.set({ tab: name });
}

function lastKey(path) { return path.slice(path.lastIndexOf('.') + 1); }
function parentOf(path) { const match = /^(.*)\.children\.[^.]+$/.exec(path); return match ? match[1] : null; }
function clip(text, size) { return text.length > size ? text.slice(0, size - 1) + '…' : text; }
function preview(value) { return clip(value === undefined ? T['inspect.nothing'] : JSON.stringify(value), 48); }
function labelFor(name) {
    const words = name.replace(/^_/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
    return words.charAt(0).toUpperCase() + words.slice(1);
}
function nodeLabel(node) { return node.component + ' · ' + lastKey(node.path); }

async function getJson(path) {
    const response = await fetch(base + path);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || T['inspect.requestFailed']);
    return body;
}

async function writeNodes(operations) {
    says(T['inspect.saving']);
    const response = await fetch(base + '/nodes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operations }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        const first = Array.isArray(body.errors) ? body.errors.find((error) => error.severity !== 'warning') || body.errors[0] : undefined;
        says((first && first.message) || body.message || T['inspect.changeRefused'], true);
        return undefined;
    }
    says(T['inspect.saved']);
    shell.editorChanged();
    setTimeout(() => { if (editor.state.inspectorStatus === T['inspect.saved']) says(''); }, 1500);
    return body;
}

// The app's own pixels: the overlay fills the layer, which is the live app's element scaled as the canvas scales it
function zoom() { const element = appElement(); return element.getBoundingClientRect().width / element.offsetWidth || 1; }
function framePoint(event) {
    const box = appElement().getBoundingClientRect();
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
    if (!placing && hover && overLayout(hover, hoverAt)) drawLayout(hover);
    else if (!placing && hover && !(selected && hover.path === selected.path)) addBox(hover.rect, 'hover', nodeLabel(hover));
    if (placing) for (const section of sections) addBox(section.rect, 'section', section.label);
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

// A layout shows itself when the pointer is over the layout and not over one of its children: in a gap, an empty
// track or the empty part of the area. Its area is outlined, its children are boxes, its gaps hatched and, in a grid,
// every cell outlined, filled or not; the tag says the layout and its settings
function overLayout(node, point) {
    return Boolean(node.area && point && inside(node.area.rect, point) && !node.children.some((child) => inside(child.rect, point)));
}

function layoutLabel(node) {
    const settings = Object.entries(node.area.settings).map(([name, value]) => (value === '' || value === 'true' ? name : name + ' ' + value));
    return [nodeLabel(node), [node.layout || 'column', ...settings].join(' ')].join(' · ');
}

function piece(className, rect) {
    if (!(rect.width > 0.5 && rect.height > 0.5)) return;
    const element = document.createElement('div');
    element.className = className;
    rectStyle(element, rect);
    overlay.append(element);
}

function drawLayout(node) {
    const { rect, flow, gap, columns, rows } = node.area;
    addBox(rect, 'layout', layoutLabel(node));
    if (flow === 'grid' && columns) {
        const heights = rows && rows.length > 0 ? rows : [rect.height];
        let y = rect.y;
        heights.forEach((height, row) => {
            if (row > 0) piece('gutter', { x: rect.x, y: y - gap.row, width: rect.width, height: gap.row });
            let x = rect.x;
            columns.forEach((width, column) => {
                if (column > 0 && row === 0) piece('gutter', { x: x - gap.column, y: rect.y, width: gap.column, height: rect.height });
                piece('cell', { x, y, width, height });
                x += width + gap.column;
            });
            y += height + gap.row;
        });
    } else if (flow === 'row' || flow === 'column') {
        const across = flow === 'row';
        const items = node.children.map((child) => child.rect).sort((a, b) => (across ? a.x - b.x : a.y - b.y));
        for (let index = 1; index < items.length; index++) {
            const a = items[index - 1];
            const b = items[index];
            // Only between neighbours on the same line: a wrapped row starts a new line
            if (across && (b.y >= a.y + a.height || a.y >= b.y + b.height)) continue;
            if (!across && (b.x >= a.x + a.width || a.x >= b.x + b.width)) continue;
            if (across) piece('gutter', { x: a.x + a.width, y: Math.min(a.y, b.y), width: b.x - a.x - a.width, height: Math.max(a.y + a.height, b.y + b.height) - Math.min(a.y, b.y) });
            else piece('gutter', { x: Math.min(a.x, b.x), y: a.y + a.height, width: Math.max(a.x + a.width, b.x + b.width) - Math.min(a.x, b.x), height: b.y - a.y - a.height });
        }
    }
    for (const child of node.children) piece('item', child.rect);
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
            else {
                hover = answer && answer.nodes[0] ? answer.nodes[0] : null;
                hoverAt = at;
            }
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
    says(what.component ? fill(T['inspect.placeComponent'], { component: what.component }) : T['inspect.placeDrop']);
    draw();
    void showSections();
}

/** The nodes of a layout tree that lay out others, and the screen's root even while it is empty */
function sectionsOf(box, out = [], root = true) {
    if (root || box.layout !== null) out.push(box);
    for (const child of box.children) sectionsOf(child, out, false);
    return out;
}

/**
 * Shows where a component can go: every layout section of the screen worked on, outlined with its name and layout,
 * from the screen's layout tree (/views/screen) measured in the live frame
 */
async function showSections() {
    const run = ++sectionsRun;
    sections = [];
    const screen = live ? live.screen : null;
    if (!screen) return;
    try {
        const response = await fetch(base + '/views/screen?screen=' + encodeURIComponent(screen));
        if (!response.ok || run !== sectionsRun) return;
        const info = await response.json();
        if (!info.layout || run !== sectionsRun) return;
        const boxes = sectionsOf(info.layout).slice(0, MAX_PATHS);
        const answer = await host.inspect({ paths: boxes.map((box) => box.path) });
        if (!answer || run !== sectionsRun) return;
        const rects = new Map(answer.nodes.filter((node) => node.rect && node.rect.width > 0 && node.rect.height > 0).map((node) => [node.path, node.rect]));
        sections = boxes.filter((box) => rects.has(box.path)).map((box) => ({ rect: rects.get(box.path), label: box.layout === null ? box.key : box.key + ' · ' + box.layout }));
        draw();
    } catch { /* the drop still works without the outlines */ }
}

function stopPlacing(message) {
    placing = null;
    drop = null;
    sections = [];
    sectionsRun += 1;
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
    if (!where) { stopPlacing(); says(T['inspect.pointInside'], true); return; }
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

// A component dragged from the library: where the pointer is, in the page's pixels, as a point of the app frame when
// it is over it
function overFrame(payload) {
    if (!payload || typeof payload.x !== 'number' || typeof payload.y !== 'number') return null;
    if (!live) return null;
    const box = live.element.getBoundingClientRect();
    if (payload.x < box.left || payload.x > box.right || payload.y < box.top || payload.y > box.bottom) return null;
    return framePoint({ clientX: payload.x, clientY: payload.y });
}
function dragMoved(payload) {
    if (!placing || !placing.dragged) return;
    const point = overFrame(payload);
    if (point) void inspectAt(point);
    else if (drop) { drop = null; draw(); }
}
async function dragEnded(payload) {
    if (!placing || !placing.dragged) return;
    const point = payload && payload.cancelled !== true ? overFrame(payload) : null;
    if (!point) { stopPlacing(T['inspect.cancelled']); return; }
    dropAt(await host.inspect({ at: point }), point);
    await commitDrop();
}

// The Select tool works on the shield over the live app, and the Move tool pans the board from it
function selecting() { const tool = shell.tool(); return tool === 'select' || tool === 'place'; }
let press = null;
let pan = null;
function showShield() {
    const tool = shell.tool();
    shield.hidden = tool === 'use';
    layer.classList.toggle('moving', tool === 'move');
    layer.classList.toggle('selecting', tool === 'select' || tool === 'place');
}
shield.addEventListener('pointerdown', (event) => {
    if (shell.tool() === 'move' && event.button === 0) {
        event.preventDefault();
        shield.setPointerCapture(event.pointerId);
        pan = { x: event.clientX, y: event.clientY };
        layer.classList.add('dragging');
        return;
    }
    if (!selecting() || event.button !== 0) return;
    event.preventDefault();
    shield.setPointerCapture(event.pointerId);
    press = { x: event.clientX, y: event.clientY, point: framePoint(event), dragging: false };
});
shield.addEventListener('pointermove', (event) => {
    if (pan) {
        window.magneticScreens.panBy(event.clientX - pan.x, event.clientY - pan.y);
        pan = { x: event.clientX, y: event.clientY };
        return;
    }
    if (!selecting()) return;
    const point = framePoint(event);
    if (press && !press.dragging && !placing && selected && selected.rect && inside(selected.rect, press.point) && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 5) {
        press.dragging = true;
        startPlacing({ move: selected.path });
    }
    void inspectAt(point);
});
function endPan() { pan = null; layer.classList.remove('dragging'); }
shield.addEventListener('pointercancel', endPan);
shield.addEventListener('pointerup', async (event) => {
    if (pan) { endPan(); return; }
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

// The Select tool opens the inspector. Closing it, or going back to using the app, lets the selection go too: nothing
// stays outlined in an app you are using. Panning with the hand keeps both, to move around what you inspect
function closeInspector() {
    shell.showInspector(false);
    if (selected) unselect();
}

showShield();
shell.onTool((tool) => {
    showShield();
    if (tool !== 'place' && placing) { placing = null; drop = null; }
    if (tool !== 'select' && tool !== 'place') hover = null;
    if (tool === 'select') shell.showInspector(true);
    if (tool === 'use') closeInspector();
    draw();
});

function crumbsOf(path) {
    const steps = path.slice(2).split('.');
    const list = [];
    let at;
    let rest;
    if (steps[0] === 'app') { at = '$.app'; list.push({ path: at, label: T['inspect.app'] }); rest = steps.slice(1); }
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
        if (typeof linked === 'string') children[key] = { component: 'textField', size: 'sm', _label: fill(T['inspect.linked'], { label }), value: linked, readonly: true };
        else if (shape.type === 'boolean') children[key] = { component: 'switchField', size: 'sm', _label: label, checked: value === true, on };
        else if (Array.isArray(shape.values) && shape.values.every((option) => typeof option === 'string' && option !== '')) children[key] = { component: 'selectField', size: 'sm', _label: label, options: Object.fromEntries(shape.values.map((option) => [option, { _label: option }])), value: typeof value === 'string' ? value : '', on };
        else if (shape.type === 'number' || shape.type === 'integer') children[key] = { component: 'numberField', size: 'sm', _label: label, value: typeof value === 'number' ? value : '', on };
        else children[key] = { component: 'textField', size: 'sm', _label: label, value: typeof value === 'string' ? value : '', on };
    }
    // Layout and placement first, where they are found without scrolling past the component's own properties
    const sections = layoutSections(info);
    if (Object.keys(sections).length === 0) return { component: 'panel', padding: 'none', children };
    return { component: 'panel', padding: 'none', children: { ...sections, propertiesTitle: { component: 'text', textRole: 'label', _text: T['inspector.properties'] }, ...children } };
}

/** A field for a setting of a layout or a placement (a FieldSpec of stateui-app), emitting target */
function specField(label, spec, value, target) {
    const on = { change: { command: 'emit', target } };
    if (spec.type === 'enum' && Array.isArray(spec.values)) {
        const options = { [UNSET]: { _label: T['inspector.notSet'] }, ...Object.fromEntries(spec.values.map((option) => [option, { _label: option }])) };
        return { component: 'selectField', size: 'sm', _label: label, options, value: typeof value === 'string' && spec.values.includes(value) ? value : UNSET, on };
    }
    if (spec.type === 'boolean') return { component: 'switchField', size: 'sm', _label: label, checked: value === true, on };
    if (spec.type === 'integer' || spec.type === 'number') return { component: 'numberField', size: 'sm', _label: label, value: typeof value === 'number' ? value : '', ...(typeof spec.min === 'number' && { min: spec.min }), ...(typeof spec.max === 'number' && { max: spec.max }), on };
    return { component: 'textField', size: 'sm', _label: label, value: typeof value === 'string' ? value : '', on };
}

/** The type a node lays its parts out with, or null when it lays none out */
function layoutTypeOf(info) {
    const layout = info.settings && info.settings.layout;
    if (layout && typeof layout === 'object' && typeof layout.type === 'string') return layout.type;
    return info.component && info.component.layout ? 'column' : null;
}

function layoutSections(info) {
    const children = {};
    layoutFieldNames = [];
    placeFieldNames = [];
    const type = layoutTypeOf(info);
    if (type && layouts[type]) {
        const current = info.settings.layout && typeof info.settings.layout === 'object' ? info.settings.layout : {};
        children.layoutTitle = { component: 'text', textRole: 'label', _text: T['inspector.layout'] };
        children.layoutType = {
            component: 'selectField',
            size: 'sm',
            _label: T['inspector.layoutType'],
            options: Object.fromEntries(Object.keys(layouts).map((name) => [name, { _label: name }])),
            value: type,
            on: { change: { command: 'emit', target: 'layoutType' } }
        };
        for (const [name, spec] of Object.entries(layouts[type].settings || {})) {
            const index = layoutFieldNames.length;
            layoutFieldNames.push(name);
            children['lay' + index] = specField(labelFor(name), spec, current[name], 'lay' + index);
        }
    }
    const parent = info.parentLayout;
    if (parent && layouts[parent] && Object.keys(layouts[parent].placement || {}).length > 0) {
        const placement = info.settings.placement && typeof info.settings.placement === 'object' ? info.settings.placement : {};
        children.placeTitle = { component: 'text', textRole: 'label', _text: T['inspector.placement'] };
        for (const [name, spec] of Object.entries(layouts[parent].placement)) {
            const index = placeFieldNames.length;
            placeFieldNames.push(name);
            children['place' + index] = specField(labelFor(name), spec, placement[name], 'place' + index);
        }
    }
    return children;
}

/** An object with one key set, or taken out when the value is empty */
function withValue(object, name, value) {
    const next = { ...object };
    if (value === undefined || value === null || value === '' || value === UNSET || (typeof value === 'number' && !Number.isFinite(value))) delete next[name];
    else next[name] = value;
    return next;
}

/** Writes the selected node's layout (and the children's placements it clears), then shows its fields again */
async function saveLayout(next, operations, redraw) {
    if (!selected) return;
    const node = selected;
    if (await writeNodes([{ op: 'set', path: node.path + '.layout', value: next }, ...operations])) {
        node.info.settings.layout = next;
        if (redraw && selected === node) writeFields(fieldsOf(node.info));
        settle();
    }
}

function changeLayoutType(type) {
    if (!selected || !layouts[type]) return;
    const info = selected.info;
    const current = info.settings.layout && typeof info.settings.layout === 'object' ? info.settings.layout : {};
    if (layoutTypeOf(info) === type) return;
    const next = { type };
    for (const [name, value] of Object.entries(current)) if (name !== 'type' && name in (layouts[type].settings || {})) next[name] = value;
    // A child keeps only the placement fields the new layout gives a child
    const operations = [];
    const fields = layouts[type].placement || {};
    for (const [key, placement] of Object.entries(info.childPlacements || {})) {
        const kept = Object.fromEntries(Object.entries(placement).filter(([name]) => name in fields));
        if (Object.keys(kept).length === Object.keys(placement).length) continue;
        operations.push({ op: 'set', path: selected.path + '.children.' + key + '.placement', value: kept });
        info.childPlacements[key] = kept;
    }
    void saveLayout(next, operations, true);
}

function changeLayoutSetting(name, value, wait) {
    if (!selected) return;
    const node = selected;
    const current = node.info.settings.layout && typeof node.info.settings.layout === 'object' ? node.info.settings.layout : {};
    const next = withValue({ type: layoutTypeOf(node.info), ...current }, name, value);
    if (JSON.stringify(next) === JSON.stringify({ type: layoutTypeOf(node.info), ...current })) return;
    const key = node.path + '.layout';
    clearTimeout(saveTimers.get(key));
    saveTimers.set(key, setTimeout(() => {
        saveTimers.delete(key);
        if (selected === node) void saveLayout(next, [], false);
    }, wait));
}

function changePlacement(name, value, wait) {
    if (!selected) return;
    const node = selected;
    const current = node.info.settings.placement && typeof node.info.settings.placement === 'object' ? node.info.settings.placement : {};
    const next = withValue(current, name, value);
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    const key = node.path + '.placement';
    clearTimeout(saveTimers.get(key));
    saveTimers.set(key, setTimeout(async () => {
        saveTimers.delete(key);
        if (await writeNodes([{ op: 'set', path: key, value: next }])) {
            node.info.settings.placement = next;
            settle();
        }
    }, wait));
}

/** Fills the editor's propertyFields panel, wherever the editor keeps it */
function writeFields(node) {
    const at = editor.pathOf('propertyFields');
    if (at) editor.write([{ path: at, value: node }]);
}

function showProperties(info) {
    const crumbs = crumbsOf(info.path);
    crumbPaths = crumbs.map((crumb) => crumb.path);
    const items = Object.fromEntries(crumbs.map((crumb, index) => ['c' + index, { _label: crumb.label }]));
    const summary = info.component && info.component.summary ? '. ' + info.component.summary : '';
    editor.set({ crumbs: items, crumb: 'c' + (crumbs.length - 1), noSelection: false, heading: info.settings.component + summary, cannotRemove: parentOf(info.path) === null });
    writeFields(fieldsOf(info));
}

function clearProperties() {
    crumbPaths = [];
    fieldNames = [];
    editor.set({ crumbs: {}, crumb: '', noSelection: true, heading: T['inspect.pressS'], cannotRemove: true });
    writeFields({ component: 'panel', padding: 'none', children: {} });
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
    showProperties(info);
    shell.showInspector(true);
    showTab('properties');
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
    const words = search.trim().toLowerCase();
    const shown = library.filter((component) => (category === 'all' || component.category === category) && (words === '' || (component.name + ' ' + component.summary).toLowerCase().includes(words))).slice(0, 60);
    editor.write([{ path: '$.data.components', value: Object.fromEntries(shown.map((component, index) => ['k' + index, { id: 'k' + index, name: component.name, summary: brief(component.summary) }])) }]);
}

/** A component's summary cut to what fits two lines of a card: its first clause, at most 64 characters on a word */
function brief(summary) {
    const clause = String(summary || '').split(/[:;(]/)[0].trim().replace(/,$/, '');
    if (clause.length <= 64) return clause;
    return clause.slice(0, 64).replace(/[\s,]+\S*$/, '') + '…';
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
    if (!stateInfo) return;
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
    editor.write([{ path: '$.data.paths', value: records }]);
}

function showDetail(path) {
    if (!stateInfo) return;
    chosenPath = path;
    const names = (list) => (list.length === 0 ? T['inspect.nothing'] : (list.length > 8 ? fill(T['inspect.andMore'], { list: list.slice(0, 8).join(', '), count: list.length - 8 }) : list.join(', ')));
    const shownBy = stateInfo.bindings.filter((binding) => related(binding.path, path)).map((binding) => lastKey(binding.node) + '.' + binding.property);
    const readBy = stateInfo.logic.filter((unit) => unit.reads.some((read) => related(read, path))).map((unit) => unit.kind + ' ' + unit.name);
    const writtenBy = stateInfo.logic.filter((unit) => unit.writes.some((write) => related(write, path))).map((unit) => unit.kind + ' ' + unit.name);
    editor.set({
        noDetail: false,
        detailPath: path,
        detailValue: fill(T['inspect.value'], { value: clip(JSON.stringify(valueAt(path)) || T['inspect.nothing'], 300) }),
        detailShown: fill(T['inspect.shownBy'], { names: names(shownBy) }),
        detailRead: fill(T['inspect.readBy'], { names: names(readBy) }),
        detailWritten: fill(T['inspect.writtenBy'], { names: names(writtenBy) })
    });
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
    editor.write([{ path: '$.data.feed', value: Object.fromEntries(feed.map((entry) => [entry.id, entry])) }]);
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
    addFeed(fill(change.origin === 'user' ? T['inspect.youSet'] : T['inspect.appSet'], { path: change.path, value: preview(change.value) }));
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

// The Data switch shows the shape of the data under the chat
async function showDataLine(on) {
    if (!on) { editor.set({ dataLine: '', noDataLine: true }); return; }
    try {
        const state = await getJson('/state');
        const parts = Object.entries(state.data || {}).map(([name, value]) => name + (value && typeof value === 'object' ? ' (' + Object.keys(value).length + ')' : ': ' + preview(value)));
        editor.set({ dataLine: 'Data: ' + (parts.length === 0 ? 'none yet' : parts.slice(0, 12).join(' · ')), noDataLine: false });
    } catch {
        editor.set({ dataLine: '', noDataLine: true });
    }
}

function onEmit(name, payload) {
    if (typeof name !== 'string') return;
    // The page has already turned the toggle over (its listener runs first): show what it says now
    if (name === 'showData') { void showDataLine(Boolean(editor.state.show && editor.state.show.data)); return; }
    const prop = /^prop(\d+)$/.exec(name);
    if (prop) {
        const field = fieldNames[Number(prop[1])];
        if (field === undefined) return;
        const shape = selected && selected.info.component && selected.info.component.properties[field];
        const typed = shape && (shape.type === 'string' || shape.type === 'icon') && !Array.isArray(shape.values);
        void saveProperty(field, valueOf(payload), typed ? TEXT_SAVE_MS : 0);
        return;
    }
    const lay = /^lay(\d+)$/.exec(name);
    if (lay) {
        const field = layoutFieldNames[Number(lay[1])];
        const type = selected && layoutTypeOf(selected.info);
        const spec = field && type && layouts[type] ? layouts[type].settings[field] : undefined;
        if (spec) changeLayoutSetting(field, valueOf(payload), spec.type === 'size' ? TEXT_SAVE_MS : 0);
        return;
    }
    const place = /^place(\d+)$/.exec(name);
    if (place) {
        const field = placeFieldNames[Number(place[1])];
        const parent = selected && selected.info.parentLayout;
        const spec = field && parent && layouts[parent] ? layouts[parent].placement[field] : undefined;
        if (spec) changePlacement(field, valueOf(payload), spec.type === 'size' ? TEXT_SAVE_MS : 0);
        return;
    }
    switch (name) {
        case 'layoutType': changeLayoutType(String(valueOf(payload))); return;
        case 'crumb': {
            const index = Number(String(valueOf(payload)).replace(/^c/, ''));
            if (crumbPaths[index]) void select(crumbPaths[index]);
            return;
        }
        case 'remove': void removeSelected(); return;
        case 'search': search = String(valueOf(payload) ?? ''); showLibrary(); return;
        case 'category': category = String(valueOf(payload) ?? 'all'); showLibrary(); return;
        case 'place': if (typeof payload === 'string') startPlacing({ component: payload }); return;
        case 'grab': if (typeof payload === 'string') startPlacing({ component: payload, dragged: true }); return;
        case 'dragMove': dragMoved(payload); return;
        case 'dragEnd': void dragEnded(payload); return;
        case 'path': {
            const chosen = valueOf(payload);
            const key = Array.isArray(chosen) ? chosen[0] : chosen;
            const path = pathKeys[Number(String(key).replace(/^p/, ''))];
            if (path) showDetail(path);
            return;
        }
        case 'ask': if (chosenPath) shell.ask(chosenPath); return;
        case 'addToChat': addSelectedToChat(); return;
        case 'tab': if (String(valueOf(payload)) === 'state') void loadState(); return;
        case 'inspectorClose': closeInspector(); if (shell.tool() !== 'use') shell.setTool('use'); return;
    }
}

/** Gives the selected node to the agent with the next request: it shows on the chat bar by its label, such as "button · save" */
function addSelectedToChat() {
    if (!selected) return;
    shell.ask(selected.path, selected.label, false);
    says(T['inspect.addedToChat']);
}

function typing(target) { return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)); }
// Escape lets go of what is being placed, then of the selection, from the page or from the editor's frame
function letGo() {
    if (placing) { stopPlacing(T['inspect.cancelled']); return true; }
    if (selected) { unselect(); return true; }
    return false;
}
shell.onEscape(letGo);
document.addEventListener('keydown', (event) => {
    if (!shell.editing() || event.ctrlKey || event.metaKey || typing(event.target)) return;
    if (event.key === 'Escape') {
        if (shell.escape()) event.preventDefault();
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

(async function start() {
    if (!host || !shell) return;
    editor.onEmit(onEmit);
    // The editor writes again what it shows each time it (re)loads
    editor.onReady(() => { showLibrary(); showFeed(); if (selected) showProperties(selected.info); else clearProperties(); });
    try {
        const listed = await getJson('/components');
        library = listed.components || [];
        layouts = listed.layouts || {};
        showLibrary();
    } catch {
        says(T['inspect.failed']);
    }
})();
`;
