import { SCREEN_COLUMNS } from '../editor/EditorApp.js';
import { SCRIPT_TEXTS } from './text.js';

/**
 * `/assets/screens.js`: the app's screens in the editor, after `/assets/shell.js` and `/assets/inspect.js`.
 *
 * - **The Screens panel** (the editor app's `screens`, beside the rail in the library's place) lists the screens from
 *   `GET /edit/<id>/screens`, marks the one worked on, and adds, renames, copies, deletes one and chooses the one the
 *   app opens on with `POST /edit/<id>/screens`, through the same tools as the agent's.
 * - **The canvas** shows every screen as a frame, in the order of the app's screens, in rows of five (Screens in a row
 *   on the panel changes it, kept in this browser), 160px apart. The live frame (the app itself, synced, inspected and
 *   edited) sits in the slot of the screen it shows. Every other screen is a preview: a panel of the host
 *   (`stateuiHost.mount`) loaded with the app's document opened on that screen, given the live frame's data and kept
 *   in step with it from `stateui:change`. A preview runs nothing of its own that is kept, and a cover over it takes
 *   the pointer: pressing it makes its screen the one worked on, so the live frame navigates there and the board moves
 *   so that it stays where it was on the screen.
 * - **Weight:** only previews in view are mounted; one scrolled out of view is disposed and shows its name.
 * - **Names:** with more than `MOST_IN_VIEW` screens in view, or the zoom below `NAMES_BELOW_ZOOM`, every screen is a
 *   tile with its name and nothing renders: no preview is mounted and the live frame is hidden, and its screen has a
 *   tile too. Pressing a tile selects its screen: the live frame goes there and shows; Escape, its × or a click on the
 *   empty board deselects it, back to its tile. Zooming back in ends the names and the selection.
 * - **Order:** a tile is dragged to another slot to move its screen there; a drop slot marks where it goes. The board
 *   moves at once and `POST /edit/<id>/screens` with `order` follows; a refusal puts it back.
 * - **Menu:** a tile's ⋯ button, a right click or the menu key opens its screen's menu: work on it, its title and name,
 *   move it earlier or later, open the app on it, copy or delete it. A tile's bin and the menu's Delete ask first, in the
 *   menu (a page's own dialog, since a browser may not show `confirm`).
 * - The live frame following a route the app moved to (a navigate in the app) moves to that screen's slot too.
 * - A new document (the body's `data-revision`) reloads the list and mounts the previews again with it.
 * - The live frame's screen is its `data-screen`, and `window.magneticScreens.panelOf(name)` gives a mounted
 *   preview's panel, for the views' layers (`/assets/views.js`).
 */
export const SCREENS_JS = String.raw`${SCRIPT_TEXTS}const shell = window.magneticShell;
const host = window.stateuiHost;
const editor = shell ? shell.editor : null;
const appId = document.body.dataset.appId;
const base = '/edit/' + encodeURIComponent(appId);
const world = document.getElementById('world');
const board = document.getElementById('board');
const artboard = document.getElementById('artboard');
const GAP = 160;
/** Screens in view, the live frame among them, above which every screen shows only its name */
const MOST_IN_VIEW = 4;
/** The zoom below which every screen shows only its name, however few are in view */
const NAMES_BELOW_ZOOM = 0.15;
const COLUMNS_KEY = 'magnetic.screenColumns';
const COLUMN_CHOICES = ${JSON.stringify(SCREEN_COLUMNS)};

/** How many screens a row holds: what this browser chose, five at first */
function storedColumns() {
    try {
        const kept = Number(localStorage.getItem(COLUMNS_KEY));
        return COLUMN_CHOICES.includes(kept) ? kept : 5;
    } catch { return 5; }
}
let columns = storedColumns();
const NAME = /^[a-z][a-z0-9-]*$/;

let screens = [];
let start = null;
let current = null;
let typedNew = '';
let typedRename = '';
/** The screen typedRename was typed for: a list reloaded under it (a new revision) keeps what was typed */
let renameFor = null;
let revision = document.body.dataset.revision || '';
/** By screen name: the tile's element, its frame holder, and its panel while mounted */
const previews = new Map();
/** Whether the live frame is in view: it counts toward MOST_IN_VIEW */
let liveInView = true;
/** Whether every screen shows only its name */
let names = false;
/** In names, the screen chosen to show: the live frame is there and visible; null shows none */
let selected = null;

function says(message) {
    editor.set({ screensStatus: message || '', noScreensStatus: !message });
    if (menu.element) menu.status.textContent = message || '';
}

function routeScreen() {
    const snapshot = host && host.snapshot ? host.snapshot() : undefined;
    const route = snapshot && snapshot.route;
    return route && typeof route.screen === 'string' ? route.screen : null;
}

function titleOf(name) {
    const screen = screens.find((candidate) => candidate.name === name);
    return screen ? screen.title : name;
}

async function load() {
    try {
        const response = await fetch(base + '/screens');
        if (response.ok) apply(await response.json());
    } catch { /* offline: the panel keeps what it had */ }
}

function apply(answer) {
    screens = Array.isArray(answer.screens) ? answer.screens : [];
    start = typeof answer.start === 'string' ? answer.start : null;
    const has = (name) => screens.some((screen) => screen.name === name);
    if (!current || !has(current)) {
        const route = routeScreen();
        current = route && has(route) ? route : start || (screens[0] ? screens[0].name : null);
    }
    if (selected !== null && !has(selected)) selected = null;
    show();
    layout();
    settle();
}

/** The panel: the list, the screen worked on and what can be done to it */
function show() {
    editor.list('screens', screens.map((screen) => ({
        id: screen.name,
        name: screen.name,
        title: screen.title,
        note: screen.name === start ? screen.name + ' · ' + T['screens.isHome'] : screen.name,
        current: screen.name === current
    })));
    if (current !== renameFor) { renameFor = current; typedRename = current || ''; }
    editor.set({ screenName: current || '', screenRename: current || '', isHome: current === start, notHome: current !== start, screenColumns: 'n' + columns });
}

function slotOf(name) { return Math.max(0, screens.findIndex((screen) => screen.name === name)); }

/** Where a slot is on the board, in the frame's pixels: across its row, and down the rows */
function placeOf(index, width, height) { return { x: (index % columns) * (width + GAP), y: Math.floor(index / columns) * (height + GAP) }; }

/** Whether the live frame shows: always outside names, and in names only while a screen is selected */
function liveShown() { return !names || selected !== null; }

/**
 * Puts the live frame in its screen's slot and a tile in every other, and in the live frame's slot too while it is
 * hidden. With keep, the board moves so the live frame stays where it was on the screen (the app navigated); without,
 * the board stays and the live frame takes the place of the tile pressed
 */
function layout(keep) {
    if (!current) return;
    const [width, height] = shell.canvas.size();
    const beforeX = Number(artboard.dataset.slotX || 0);
    const beforeY = Number(artboard.dataset.slotY || 0);
    const slot = placeOf(slotOf(current), width, height);
    artboard.dataset.screen = current;
    artboard.dataset.slotX = String(slot.x);
    artboard.dataset.slotY = String(slot.y);
    artboard.style.setProperty('--slot-x', slot.x + 'px');
    artboard.style.setProperty('--slot-y', slot.y + 'px');
    if (keep && (slot.x !== beforeX || slot.y !== beforeY) && document.body.classList.contains('editing')) shell.canvas.shift(slot.x - beforeX, slot.y - beforeY);
    const label = artboard.querySelector('.artboard-label span');
    if (label) label.textContent = (document.body.dataset.appName || '') + (screens.length > 1 ? ' · ' + titleOf(current) : '');
    const tiled = (name) => screens.some((screen) => screen.name === name) && (name !== current || !liveShown());
    for (const [name, preview] of previews) if (!tiled(name)) dropPreview(name, preview);
    screens.forEach((screen, index) => {
        if (!tiled(screen.name)) return;
        const preview = previews.get(screen.name) || makePreview(screen.name);
        const place = placeOf(index, width, height);
        preview.element.style.left = place.x + 'px';
        preview.element.style.top = place.y + 'px';
        preview.element.style.width = width + 'px';
        preview.element.style.height = height + 'px';
        preview.label.textContent = screen.title;
        preview.cover.setAttribute('aria-label', fill(T['screens.workOn'], { name: screen.title }));
        preview.idle.textContent = screen.title;
        preview.more.setAttribute('aria-label', fill(T['screens.more'], { name: screen.title }));
        preview.more.title = fill(T['screens.more'], { name: screen.title });
        preview.bin.setAttribute('aria-label', T['screens.delete'] + ' ' + screen.title);
        preview.bin.title = T['screens.delete'];
        preview.bin.hidden = screen.name === start;
    });
    // The × that deselects sits at the live frame's top right while it shows a selected screen
    Object.assign(unselect.style, { left: slot.x + width + 'px', top: slot.y + 'px' });
    unselect.hidden = !(names && selected !== null);
}

/** An outline icon, 24×24, from path data */
function icon(paths) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    for (const d of paths) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', d);
        svg.append(path);
    }
    return svg;
}

function toolButton(className, paths, run) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'preview-tool ' + className;
    button.append(icon(paths));
    button.addEventListener('pointerdown', (event) => event.stopPropagation());
    button.addEventListener('click', (event) => {
        event.stopPropagation();
        const box = button.getBoundingClientRect();
        run(box.left, box.bottom + 4);
    });
    return button;
}

function makePreview(name) {
    const element = document.createElement('div');
    element.className = 'preview';
    element.dataset.screen = name;
    const label = document.createElement('p');
    label.className = 'artboard-label';
    label.setAttribute('aria-hidden', 'true');
    const labelText = document.createElement('span');
    label.append(labelText);
    const holder = document.createElement('div');
    holder.className = 'preview-frame';
    const idle = document.createElement('div');
    idle.className = 'preview-idle';
    const cover = document.createElement('button');
    cover.type = 'button';
    cover.className = 'preview-cover';
    cover.addEventListener('click', () => { if (dragged) { dragged = false; return; } press(name); });
    cover.addEventListener('pointerdown', (event) => grab(event, name));
    cover.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        const box = cover.getBoundingClientRect();
        const keyboard = event.clientX === 0 && event.clientY === 0;
        openMenu(name, keyboard ? box.left + 8 : event.clientX, keyboard ? box.top + 8 : event.clientY);
    });
    const tools = document.createElement('div');
    tools.className = 'preview-tools';
    const more = toolButton('more', ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'], (x, y) => openMenu(name, x, y));
    const bin = toolButton('bin', ['M4 7h16', 'M10 11v6', 'M14 11v6', 'M6 7l1 13h10l1-13', 'M9 7V4h6v3'], (x, y) => openMenu(name, x, y, true));
    tools.append(more, bin);
    element.append(label, idle, holder, cover, tools);
    world.append(element);
    const preview = { element, label: labelText, holder, cover, idle, more, bin, panel: null, visible: false };
    previews.set(name, preview);
    seen.observe(element);
    return preview;
}

function dropPreview(name, preview) {
    seen.unobserve(preview.element);
    unmount(preview);
    preview.element.remove();
    previews.delete(name);
}

/** Mounts every preview in view again, with the document and data as they are now */
function remount() {
    for (const preview of previews.values()) unmount(preview);
    settle();
}

function zoomNow() { return Number(getComputedStyle(world).getPropertyValue('--zoom')) || 1; }

/** True when every screen should show only its name: zoomed far out, or more than MOST_IN_VIEW screens in view */
function namesWanted() {
    if (zoomNow() < NAMES_BELOW_ZOOM) return true;
    let count = liveInView ? 1 : 0;
    // The live frame's own tile, while it is hidden, is the live frame: counted once
    for (const [name, preview] of previews) if (preview.visible && name !== current) count += 1;
    return count > MOST_IN_VIEW;
}

/**
 * Names on or off, the live frame shown or hidden, and the previews in view mounted (outside names) or disposed. Names
 * ending ends the selection
 */
function settle() {
    const wanted = namesWanted();
    if (wanted !== names) {
        names = wanted;
        if (!names) selected = null;
        layout();
    }
    document.body.classList.toggle('screen-names', names);
    document.body.classList.toggle('live-hidden', !liveShown());
    for (const [name, preview] of previews) {
        if (preview.visible && !names) mount(name, preview);
        else unmount(preview);
    }
}

function mount(name, preview) {
    if (preview.panel || !host || !host.mount) return;
    const snapshot = host.snapshot ? host.snapshot() : undefined;
    if (!snapshot) return;
    const documentOn = Object.assign({}, snapshot.document, { start: name });
    preview.panel = host.mount(preview.holder, { document: documentOn, icons: snapshot.icons }, titleOf(name));
    const writes = Object.entries(snapshot.data || {}).map(([key, value]) => ({ path: '$.data.' + key, value }));
    if (writes.length > 0) preview.panel.write(writes);
    preview.idle.hidden = true;
    // The views' layers measure the preview once it has rendered
    setTimeout(() => { if (window.magneticViews) window.magneticViews.drawLayers(); }, 800);
}

/** What /assets/views.js asks of the previews: a mounted preview's panel, to measure its nodes */
window.magneticScreens = { panelOf: (name) => (previews.get(name) || {}).panel || null };

function unmount(preview) {
    if (!preview.panel) return;
    preview.panel.dispose();
    preview.panel = null;
    preview.holder.replaceChildren();
    preview.idle.hidden = false;
}

// Only the previews in view are mounted, and none while every screen shows its name
const seen = new IntersectionObserver((entries) => {
    for (const entry of entries) {
        if (entry.target === artboard) { liveInView = entry.isIntersecting; continue; }
        const preview = previews.get(entry.target.dataset.screen);
        if (preview) preview.visible = entry.isIntersecting;
    }
    settle();
}, { root: null, rootMargin: '0px' });
if (artboard) seen.observe(artboard);
// A zoom changes the world's transform: names may start or end without a screen entering or leaving the view
if (world) new MutationObserver(() => { if (namesWanted() !== names) settle(); }).observe(world, { attributes: true, attributeFilter: ['style'] });

/** Pressing a tile: in names it selects the screen, so it shows; otherwise the screen becomes the one worked on */
function press(name) {
    if (names) {
        selected = name;
        choose(name);
        layout();
        settle();
        // The pressed tile is gone: focus its ×, so Escape and Enter reach the page rather than the live frame
        unselect.focus({ preventScroll: true });
        return;
    }
    choose(name);
}

/** Back to names only: the selected screen goes back to its tile */
function deselect() {
    if (selected === null) return false;
    selected = null;
    layout();
    settle();
    return true;
}

const unselect = document.createElement('button');
unselect.type = 'button';
unselect.className = 'live-close';
unselect.hidden = true;
unselect.setAttribute('aria-label', T['screens.namesOnly']);
unselect.title = T['screens.namesOnly'];
unselect.append(icon(['M6 6l12 12', 'M18 6L6 18']));
unselect.addEventListener('pointerdown', (event) => event.stopPropagation());
unselect.addEventListener('click', () => deselect());
if (world) world.append(unselect);

/** The board's zoom and where the world's origin is on the page, to turn a pointer into the frame's pixels */
function toWorld(clientX, clientY) {
    const box = world.getBoundingClientRect();
    const zoom = zoomNow();
    return { x: (clientX - box.left) / zoom, y: (clientY - box.top) / zoom, zoom };
}

/** The slot a point of the board falls in, as an index into the screens */
function slotAt(x, y) {
    const [width, height] = shell.canvas.size();
    const column = Math.min(columns - 1, Math.max(0, Math.floor((x + GAP / 2) / (width + GAP))));
    const row = Math.max(0, Math.floor((y + GAP / 2) / (height + GAP)));
    return Math.min(screens.length - 1, row * columns + column);
}

/** The screens' names with one moved to an index */
function movedTo(name, index) {
    const names = screens.map((screen) => screen.name).filter((other) => other !== name);
    names.splice(Math.max(0, Math.min(index, names.length)), 0, name);
    return names;
}

/** Moves the screens on the board at once; the server's answer follows, and a refusal puts them back */
async function reorder(order) {
    if (order.join() === screens.map((screen) => screen.name).join()) return;
    const before = screens;
    screens = order.map((name) => before.find((screen) => screen.name === name)).filter(Boolean);
    show();
    layout();
    if (!(await change({ action: 'order', order }))) {
        screens = before;
        show();
        layout();
    }
}

/** A press on a tile that moves past a few pixels drags it: the drop slot follows, and letting go moves the screen */
let dragged = false;
const dropSlot = document.createElement('div');
dropSlot.className = 'drop-slot';
dropSlot.hidden = true;
if (world) world.append(dropSlot);

function grab(event, name) {
    if (event.button !== 0 || !names) return;
    const preview = previews.get(name);
    if (!preview) return;
    event.stopPropagation();
    const cover = preview.cover;
    cover.setPointerCapture(event.pointerId);
    const from = { x: event.clientX, y: event.clientY };
    let moving = false;
    let target = slotOf(name);
    const move = (next) => {
        const dx = next.clientX - from.x;
        const dy = next.clientY - from.y;
        if (!moving && Math.hypot(dx, dy) < 5) return;
        if (!moving) { moving = true; preview.element.classList.add('lifted'); dropSlot.hidden = false; }
        const point = toWorld(next.clientX, next.clientY);
        preview.element.style.transform = 'translate(' + dx / point.zoom + 'px, ' + dy / point.zoom + 'px)';
        target = slotAt(point.x, point.y);
        const [width, height] = shell.canvas.size();
        const place = placeOf(target, width, height);
        Object.assign(dropSlot.style, { left: place.x + 'px', top: place.y + 'px', width: width + 'px', height: height + 'px' });
    };
    const end = (last) => {
        cover.removeEventListener('pointermove', move);
        cover.removeEventListener('pointerup', end);
        cover.removeEventListener('pointercancel', end);
        if (!moving) return;
        dragged = true;
        preview.element.classList.remove('lifted');
        preview.element.style.transform = '';
        dropSlot.hidden = true;
        if (last.type === 'pointerup') void reorder(movedTo(name, target));
    };
    cover.addEventListener('pointermove', move);
    cover.addEventListener('pointerup', end);
    cover.addEventListener('pointercancel', end);
}

/** The menu of one screen, opened from its tile or the panel */
const menu = { element: null, status: null, name: null };

function closeMenu() {
    if (!menu.element) return;
    const name = menu.name;
    menu.element.remove();
    menu.element = null;
    menu.name = null;
    removeEventListener('pointerdown', outside, true);
    removeEventListener('keydown', escape, true);
    const preview = previews.get(name);
    if (preview) preview.cover.focus({ preventScroll: true });
}
function outside(event) { if (menu.element && !menu.element.contains(event.target)) closeMenu(); }
function escape(event) { if (event.key === 'Escape') { event.stopPropagation(); closeMenu(); } }

function menuButton(text, run, className) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    if (className) button.className = className;
    button.addEventListener('click', () => void run());
    return button;
}

function menuField(label, value, save) {
    const form = document.createElement('form');
    const caption = document.createElement('label');
    const input = document.createElement('input');
    caption.textContent = label;
    input.value = value;
    const go = document.createElement('button');
    go.type = 'submit';
    go.textContent = T['screens.save'];
    caption.append(input);
    form.append(caption, go);
    form.addEventListener('submit', (event) => { event.preventDefault(); void save(input.value.trim()); });
    return form;
}

/** Deletes a screen; the one worked on goes to the screen the app opens on */
async function remove(name) {
    const wasCurrent = name === current;
    if (!(await change({ action: 'delete', name }))) return false;
    if (wasCurrent) choose(start || (screens[0] ? screens[0].name : ''));
    return true;
}

/** The menu's parts: its actions, or, when confirming, the question and Delete or Cancel */
function menuParts(name, confirming) {
    const screen = screens.find((candidate) => candidate.name === name);
    if (confirming) {
        const question = document.createElement('p');
        question.className = 'screen-menu-question';
        question.textContent = fill(T['screens.deleteConfirm'], { name: screen.title });
        const row = document.createElement('div');
        row.className = 'screen-menu-row';
        row.append(
            menuButton(T['screens.delete'], async () => { if (await remove(name)) closeMenu(); }, 'danger'),
            menuButton(T['screens.cancel'], () => closeMenu())
        );
        return [question, row];
    }
    const index = slotOf(name);
    const parts = [
        menuButton(fill(T['screens.workOn'], { name: screen.title }), () => { closeMenu(); press(name); }),
        menuField(T['screens.titleLabel'], screen.title, async (title) => {
            if (!title) { says(T['screens.titleRule']); return; }
            if (title !== screen.title && await change({ action: 'title', name, title })) closeMenu();
        }),
        menuField(T['screens.nameLabel'], name, async (to) => {
            if (to === name) return;
            if (!NAME.test(to)) { says(T['screens.nameRule']); return; }
            const wasCurrent = current === name;
            const wasSelected = selected === name;
            if (await change({ action: 'rename', name, to })) {
                if (wasSelected) selected = to;
                if (wasCurrent) choose(to);
                closeMenu();
            }
        })
    ];
    if (index > 0) parts.push(menuButton(T['screens.earlier'], async () => { closeMenu(); await reorder(movedTo(name, index - 1)); }));
    if (index < screens.length - 1) parts.push(menuButton(T['screens.later'], async () => { closeMenu(); await reorder(movedTo(name, index + 1)); }));
    if (name !== start) parts.push(menuButton(T['screens.makeHome'], async () => { if (await change({ action: 'home', name })) closeMenu(); }));
    parts.push(menuButton(T['screens.copy'], async () => { if (await change({ action: 'copy', name, to: freeName(name + '-copy') })) closeMenu(); }));
    if (name !== start) parts.push(menuButton(T['screens.delete'], () => { fillMenu(name, true); }, 'danger'));
    return parts;
}

function fillMenu(name, confirming) {
    const status = document.createElement('p');
    status.className = 'screen-menu-status';
    status.setAttribute('role', 'status');
    const parts = menuParts(name, confirming);
    menu.element.replaceChildren(...parts, status);
    menu.status = status;
    const first = menu.element.querySelector('button');
    if (first) first.focus({ preventScroll: true });
}

function openMenu(name, x, y, confirming = false) {
    closeMenu();
    const screen = screens.find((candidate) => candidate.name === name);
    if (!screen) return;
    const element = document.createElement('div');
    element.className = 'screen-menu';
    element.setAttribute('role', 'dialog');
    element.setAttribute('aria-label', fill(T['screens.menu'], { name: screen.title }));
    document.body.append(element);
    Object.assign(menu, { element, name });
    fillMenu(name, confirming);
    // Inside the window, by the pointer
    const box = element.getBoundingClientRect();
    element.style.left = Math.max(8, Math.min(x, innerWidth - box.width - 8)) + 'px';
    element.style.top = Math.max(8, Math.min(y, innerHeight - box.height - 8)) + 'px';
    addEventListener('pointerdown', outside, true);
    addEventListener('keydown', escape, true);
}

/** Makes a screen the one the editor works on: the live frame goes there */
function choose(name) {
    if (!screens.some((screen) => screen.name === name)) return;
    says('');
    if (host && host.navigate) host.navigate(name);
    current = name;
    show();
    layout();
}

/** One change to the screens; the answer is the new list */
async function change(body) {
    says('');
    try {
        const response = await fetch(base + '/screens', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const answer = await response.json().catch(() => ({}));
        if (!response.ok) { says(answer.message || T['inspect.changeRefused']); return false; }
        apply(answer);
        return true;
    } catch {
        says(T['inspect.requestFailed']);
        return false;
    }
}

function freeName(stem) {
    let name = stem;
    for (let n = 2; screens.some((screen) => screen.name === name); n += 1) name = stem + '-' + n;
    return name;
}

function valueOf(payload) { return payload && typeof payload === 'object' && 'value' in payload ? payload.value : payload; }

async function onEmit(name, payload) {
    switch (name) {
        case 'screenGo': if (typeof payload === 'string') press(payload); return;
        case 'screenNew': typedNew = String(valueOf(payload) || '').trim(); return;
        case 'screenRenameText': typedRename = String(valueOf(payload) || '').trim(); return;
        case 'screenAdd': {
            const name = typedNew;
            if (!NAME.test(name)) { says(T['screens.nameRule']); return; }
            if (await change({ action: 'add', name })) { typedNew = ''; editor.set({ screenNew: '' }); press(name); }
            return;
        }
        case 'screenRename': {
            const to = typedRename;
            if (!current || to === current) return;
            if (!NAME.test(to)) { says(T['screens.nameRule']); return; }
            const from = current;
            current = to;
            if (selected === from) selected = to;
            if (await change({ action: 'rename', name: from, to })) choose(to);
            else { current = from; if (selected === to) selected = from; show(); }
            return;
        }
        case 'screenCopy': {
            if (!current) return;
            const to = freeName(current + '-copy');
            if (await change({ action: 'copy', name: current, to })) press(to);
            return;
        }
        case 'screenHome': if (current) await change({ action: 'home', name: current }); return;
        case 'screenColumns': {
            const chosen = Number(String(valueOf(payload) || '').replace(/^n/, ''));
            if (!COLUMN_CHOICES.includes(chosen) || chosen === columns) return;
            columns = chosen;
            try { localStorage.setItem(COLUMNS_KEY, String(chosen)); } catch { /* not kept: this page still uses it */ }
            show();
            // The live frame keeps its place on the screen; the others move around it
            layout(true);
            return;
        }
        case 'screenDelete': {
            // The question is the page's own, by the middle of the window: a browser may not show confirm
            if (!current || current === start) return;
            openMenu(current, innerWidth / 2 - 130, innerHeight / 3, true);
            return;
        }
    }
}

if (shell && editor && host) {
    editor.onEmit((name, payload) => void onEmit(name, payload));
    editor.onReady(() => show());
    shell.canvas.onSize(() => { layout(); remount(); });
    shell.onEscape(() => deselect());
    // A click on the empty board, not a pan, deselects
    let downAt = null;
    board.addEventListener('pointerdown', (event) => { downAt = event.target === board || event.target === world ? { x: event.clientX, y: event.clientY } : null; });
    board.addEventListener('pointerup', (event) => {
        if (downAt && Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) < 5) deselect();
        downAt = null;
    });
    // The live frame's data reaches the previews; a route the app moved to moves the live frame's slot
    addEventListener('stateui:change', (event) => {
        const detail = event.detail || {};
        const path = typeof detail.path === 'string' ? detail.path : '';
        if (path === '$.data' || path.startsWith('$.data.')) {
            for (const preview of previews.values()) {
                if (!preview.panel) continue;
                if (path === '$.data') preview.panel.write(Object.entries(detail.value || {}).map(([key, value]) => ({ path: '$.data.' + key, value })));
                else if (detail.value !== undefined) preview.panel.write([{ path, value: detail.value }]);
            }
        }
        if (path === '$.route' || path.startsWith('$.route.')) {
            const screen = routeScreen();
            if (screen && screen !== current && screens.some((candidate) => candidate.name === screen)) {
                if (selected !== null) selected = screen;
                current = screen;
                show();
                layout(true);
            }
        }
    });
    // A new document: the list again, and the previews mounted again with it
    new MutationObserver(() => {
        const next = document.body.dataset.revision || '';
        if (next === revision) return;
        revision = next;
        void load().then(remount);
    }).observe(document.body, { attributes: true, attributeFilter: ['data-revision'] });
    void load();
}
`;
