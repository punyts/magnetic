import { SCREEN_COLUMNS } from '../editor/EditorApp.js';
import { SCREENS_KEYS } from '../screens/ScreensPage.js';
import { SCRIPT_TEXTS } from './text.js';

/**
 * `/assets/screens.js`: the app's screens in the editor, after `/assets/shell.js` and `/assets/inspect.js`.
 *
 * - **The Screens panel** (the editor app's `screens`, beside the rail in the library's place) lists the screens from
 *   `GET /edit/<id>/screens`, marks the one worked on, and adds, renames, copies, deletes one and chooses the one the
 *   app opens on with `POST /edit/<id>/screens`, through the same tools as the agent's.
 * - **The board** is Magnetic's page `magnetic-screens` (`src/screens/ScreensPage.ts`, `/assets/screens.json`), mounted
 *   in the page on `#screens` (`stateuiHost.mount` with `inPage`). This script drives it through `$.data.screens` and
 *   acts on its emits. Its canvas pans and zooms itself, and the editor's zoom runs the canvas's commands. Every screen
 *   is a card in rows of five (Screens in a row on the panel changes it, kept in this browser), 160px apart. The card
 *   of the screen worked on holds the live app (an `embeddedApp` with `live`, attached through `stateuiHost.apps`);
 *   every other card a preview of it on its screen, which follows the live app's store. Pressing a preview makes its
 *   screen the one worked on.
 * - **The view** is kept per person and app on the server (`GET` and `POST /edit/<id>/views/kept` with `view`
 *   `screens`), written as the canvas reports it. With none kept the board fits the live card into the area the
 *   editor's panels leave free, and fits it again while the view is still that fit and the panels move.
 * - **Weight:** only the cards in view are active: a card out of view shows its name and mounts no app.
 * - **Names:** with more than `MOST_IN_VIEW` cards in view, or the zoom below `NAMES_BELOW_ZOOM`, every card shows only
 *   its name (`names`) and no app is mounted; the cards can then be dragged. Pressing a card selects its screen: the
 *   live app goes there and shows; Escape, its × or a press on the empty canvas deselects it. Zooming back in ends the
 *   names and the selection.
 * - **Order:** a card dragged to another place in names moves its screen there (the board's `move`). The board moves at
 *   once and `POST /edit/<id>/screens` with `order` follows; a refusal puts it back.
 * - **Menu:** a card's ⋯ button, a right click or the menu key opens its screen's menu by the pointer: work on it, its
 *   title and name, move it earlier or later, open the app on it, copy or delete it. Delete asks first, in the menu (a
 *   page's own dialog, since a browser may not show `confirm`). Any screen may be deleted: the app then opens on the
 *   next one.
 * - **No screens:** with the last one deleted the board holds one card, Add a screen, which adds `home` (the app opens
 *   on it) and works on it.
 * - **Without the editor** the live app fills the window, attached in `#alone`; the editor showing attaches it on its
 *   card again.
 * - The live app moving to another screen itself (`navigated`) makes that screen the one worked on.
 * - A new document (the body's `data-revision`) reloads the list. Each mount of the live app raises `stateui:ready`,
 *   and the previews are opened again on its new store.
 * - `window.magneticScreens.choose(name)` makes a screen the one worked on, for the views (`/assets/views.js`).
 *
 */
export const SCREENS_JS = String.raw`${SCRIPT_TEXTS}const shell = window.magneticShell;
const host = window.stateuiHost;
const editor = shell ? shell.editor : null;
const appId = document.body.dataset.appId;
const base = '/edit/' + encodeURIComponent(appId);
const holder = document.getElementById('screens');
const alone = document.getElementById('alone');
const S = '$.data.screens';
const CANVAS_KEY = ${JSON.stringify(SCREENS_KEYS.canvas)};
/** The room between two cards, across and down, in the screens' pixels */
const GAP = 160;
/** The height of a card's head above its screen: its title, size and buttons */
const HEAD = 40;
/** Cards in view, the live one among them, above which every card shows only its name */
const MOST_IN_VIEW = 4;
/** The zoom below which every card shows only its name, however few are in view */
const NAMES_BELOW_ZOOM = 0.15;
/** How long the view rests before it is kept on the server */
const KEEP_MS = 600;
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
/** Whether every card shows only its name */
let names = false;
/** In names, the screen chosen to show: the live app is there; null shows none */
let selected = null;
/** The board's view, as the canvas last reported it: where its content's origin is in the window, and its zoom */
const view = { x: 0, y: 0, zoom: 1 };
/** The board's page: its panel, the paths of its canvas and of the board in it; null until mounted */
let page = null;
let mounting = null;
/** The view is the board's own fit of the live card, and fits again when the free area changes */
let fitted = false;
/** By screen name: its card's box on the board, in the screens' pixels, as last measured */
const places = new Map();
/** The previews are closed for a moment, to open again on the live app's new store */
let reopening = false;
/** The live app in the window, without the editor */
let aloneApp = null;
/** Where the pointer last went down, where a menu opened from a card goes */
const pointer = { x: innerWidth / 2, y: innerHeight / 3 };
addEventListener('pointerdown', (event) => { pointer.x = event.clientX; pointer.y = event.clientY; }, true);

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
    if (screens.length === 0) current = null;
    if (selected !== null && !has(selected)) selected = null;
    shell.noScreens(screens.length === 0);
    show();
    draw();
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

/** The board's column of a place in a row: c0, c1, … (a key of an ordered map is never integer-like) */
function lane(index) { return 'c' + index; }

/** The page's data at a path below $.data.screens */
function pageWrite(fields) {
    if (!page) return;
    page.panel.write(Object.entries(fields).map(([name, value]) => ({ path: S + '.' + name, value })));
}
function pageCommand(command, value) {
    if (page && page.canvas) page.panel.command(page.canvas, command, value);
}

/** A card shows the live app: the screen worked on, outside names or selected in them */
function isLive(name) { return name === current && (!names || selected === name); }

/** Whether a card's box is in the area the editor's panels leave free, at the view as it is */
function inView(box) {
    const free = shell.canvas.freeArea();
    const left = view.x + box.x * view.zoom;
    const top = view.y + box.y * view.zoom;
    return left < free.left + free.width && left + box.width * view.zoom > free.left && top < free.top + free.height && top + box.height * view.zoom > free.top;
}

/** The cards, one per screen, or the one Add a screen card of an app with none */
function tiles() {
    const [width, height] = shell.canvas.size();
    if (screens.length === 0) {
        return [{ id: '-add', app: appId, title: T['screens.addFirst'], note: '', live: false, active: false, width, height, column: lane(0), row: 0, add: true, noAdd: false, noHead: true, noMore: true, noClose: true, moreLabel: '', closeLabel: '' }];
    }
    return screens.map((screen, index) => {
        const live = isLive(screen.name);
        const box = places.get(screen.name);
        // Out of names an app is mounted on each card in view (the live one always); in names only the selected one
        const active = !reopening || live ? live || (!names && box !== undefined && inView(box)) : false;
        return {
            id: screen.name,
            app: appId,
            title: screen.title,
            note: live ? width + ' × ' + height : '',
            live,
            active,
            width,
            height,
            column: lane(index % columns),
            row: Math.floor(index / columns),
            add: false,
            noAdd: true,
            noHead: false,
            noMore: !names,
            noClose: !(names && selected === screen.name),
            moreLabel: fill(T['screens.more'], { name: screen.title }),
            closeLabel: T['screens.namesOnly']
        };
    });
}

/**
 * The board's own sizes: a column as wide as a screen and the gap, a card as tall as its head, its screen and the gap,
 * and every row drawn. In names a card's name stays 20px on the screen at any zoom
 */
function boardTheme() {
    const [width, height] = shell.canvas.size();
    const card = height + HEAD + GAP;
    const rows = Math.ceil(Math.max(1, screens.length) / columns);
    return {
        board: { column: (width + GAP) + 'px', card: card + 'px', height: (rows * card) + 'px' },
        ...(names && { text: { title: { size: Math.round(20 / Math.max(0.01, view.zoom)) + 'px' } } })
    };
}

/** Writes the cards, the columns and the board's sizes into the page */
function draw() {
    if (!page) return;
    const used = Math.min(columns, Math.max(1, screens.length));
    page.panel.write([
        { path: S + '.lanes', value: Object.fromEntries(Array.from({ length: used }, (_, index) => [lane(index), { _title: '' }])) },
        { path: S + '.tiles', value: tiles() },
        { path: S + '.names', value: names },
        { path: page.board + '.theme', value: boardTheme() }
    ]);
    requestAnimationFrame(() => requestAnimationFrame(measure));
}

/** The board's element in the page, through the shadow roots of the page's nodes */
function deepFind(root, selector) {
    const found = root.querySelector(selector);
    if (found) return found;
    for (const element of root.querySelectorAll('*')) {
        if (!element.shadowRoot) continue;
        const inner = deepFind(element.shadowRoot, selector);
        if (inner) return inner;
    }
    return null;
}

/**
 * Where each card is on the board, in the screens' pixels: from the boxes of the board's columns, its content's origin
 * and the height of a card. The script measures; the page's components never do
 */
function measure() {
    if (!page) return;
    const canvas = deepFind(holder, 'ui-viewport');
    const world = canvas && canvas.shadowRoot ? canvas.shadowRoot.querySelector('.world') : null;
    const boardElement = world ? deepFind(canvas.shadowRoot, 'ui-board') : null;
    if (!world || !boardElement || !boardElement.shadowRoot) return;
    const origin = world.getBoundingClientRect();
    const zoom = origin.width / (world.offsetWidth || 1) || view.zoom;
    const [, height] = shell.canvas.size();
    const card = height + HEAD + GAP;
    places.clear();
    const lanes = new Map();
    for (const section of boardElement.shadowRoot.querySelectorAll('section.column[data-key]')) {
        const body = section.querySelector('.body') || section;
        const box = body.getBoundingClientRect();
        lanes.set(section.dataset.key, { x: (box.left - origin.left) / zoom, y: (box.top - origin.top) / zoom });
    }
    const [width] = shell.canvas.size();
    screens.forEach((screen, index) => {
        const at = lanes.get(lane(index % columns));
        if (at) places.set(screen.name, { x: at.x, y: at.y + Math.floor(index / columns) * card, width, height: HEAD + height });
    });
    if (!placedOnce) { placedOnce = true; place(); }
    settle();
}

/** The view the board opens on: where it was left, kept on the server, or the live card fitted */
let placedOnce = false;
let keptView = null;
function place() {
    if (keptView) {
        Object.assign(view, keptView);
        pageWrite({ view: { ...view } });
        fitted = false;
    } else fit();
    holder.classList.remove('unplaced');
    shell.canvas.showZoom(view.zoom, 'base');
}

/** Fits the live card, or the first, into the free area, never past 100% */
function fit() {
    const box = places.get(current || '') || places.values().next().value;
    if (!box) { pageCommand('fit'); fitted = false; return; }
    const free = shell.canvas.freeArea();
    const zoom = Math.max(0.1, Math.min(1, free.width / box.width, free.height / box.height));
    Object.assign(view, { x: free.left + (free.width - box.width * zoom) / 2 - box.x * zoom, y: free.top + (free.height - box.height * zoom) / 2 - box.y * zoom, zoom });
    pageWrite({ view: { ...view } });
    fitted = true;
    shell.canvas.showZoom(view.zoom, 'base');
    settle();
}

/** True when every card should show only its name: zoomed far out, or more than MOST_IN_VIEW cards in view */
function namesWanted() {
    if (view.zoom < NAMES_BELOW_ZOOM) return true;
    let count = 0;
    for (const box of places.values()) if (inView(box)) count += 1;
    return count > MOST_IN_VIEW;
}

/** Names on or off, and the cards in view active: written when they change. Names ending ends the selection */
let lastTiles = '';
function settle() {
    if (!page) return;
    const wanted = namesWanted();
    if (wanted !== names) {
        names = wanted;
        if (!names) selected = null;
    }
    const next = tiles();
    const theme = boardTheme();
    const text = JSON.stringify([next, names, theme]);
    if (text === lastTiles) return;
    lastTiles = text;
    page.panel.write([{ path: S + '.tiles', value: next }, { path: S + '.names', value: names }, { path: page.board + '.theme', value: theme }]);
}

/** Mounts the board's page, once; the view it opens on comes with it */
function mountPage() {
    if (page) return Promise.resolve(true);
    if (mounting) return mounting;
    holder.classList.add('unplaced');
    mounting = (async () => {
        try {
            const [response, kept] = await Promise.all([
                fetch('/assets/screens.json', { headers: { Accept: 'application/json' } }),
                fetch(base + '/views/kept?view=screens').then((answer) => (answer.ok ? answer.json() : {})).then((answer) => answer.place, () => null)
            ]);
            if (!response.ok) throw new Error(T['views.refused']);
            const doc = await response.json();
            keptView = kept && [kept.x, kept.y, kept.zoom].every(Number.isFinite) ? { x: kept.x, y: kept.y, zoom: kept.zoom } : null;
            holder.replaceChildren();
            const panel = host.mount(holder, { document: doc.document, icons: doc.icons, keys: ['escape'], inPage: true }, T['screens.board']);
            const canvas = keyPath(doc.document, CANVAS_KEY);
            page = { panel, canvas, board: canvas + '.content' };
            pageWrite({ inset: insetOf(), view: { ...(keptView || view) } });
            draw();
            return true;
        } catch (error) {
            says(error.message);
            holder.classList.remove('unplaced');
            return false;
        } finally {
            mounting = null;
        }
    })();
    return mounting;
}

/** The state path of the node a key names in a document */
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

/** What the editor's panels cover of the canvas, in pixels from each edge */
function insetOf() {
    const free = shell.canvas.freeArea();
    return { top: free.top, left: free.left, right: Math.max(0, innerWidth - free.left - free.width), bottom: Math.max(0, innerHeight - free.top - free.height) };
}

/** Keeps the view on the server once it rests */
let keeping = null;
function keepView() {
    clearTimeout(keeping);
    keeping = setTimeout(() => {
        void fetch(base + '/views/kept', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ view: 'screens', place: { ...view } }) }).catch(() => undefined);
    }, KEEP_MS);
}

/** The live app in the window without the editor, or on its card with it */
function placeLive(editing) {
    if (editing) {
        if (aloneApp) { aloneApp.dispose(); aloneApp = null; }
        void mountPage().then(() => { lastTiles = ''; settle(); });
        return;
    }
    // The board lets go of the live app first: no card is live while the editor is away
    if (page) { lastTiles = ''; pageWrite({ tiles: tiles().map((tile) => ({ ...tile, live: false, active: false })) }); }
    if (!host || !host.apps) return;
    void host.apps.open({ app: appId, live: true }).then((opened) => {
        if (shell.editing() || aloneApp) return;
        aloneApp = opened.attach({
            element: alone,
            ...(current && { screen: current }),
            onEmit: () => undefined,
            onNavigate: (screen) => followed(screen)
        });
    }, () => undefined);
}

/** The live app moved to another screen itself: that screen becomes the one worked on */
function followed(screen) {
    if (!screen || screen === current || !screens.some((candidate) => candidate.name === screen)) return;
    if (selected !== null) selected = screen;
    current = screen;
    show();
    settle();
}

/** Pressing a card: in names it selects the screen, so it shows; otherwise the screen becomes the one worked on */
function press(name) {
    if (names) {
        selected = name;
        choose(name);
        return;
    }
    choose(name);
}

/** Back to names only: the selected screen goes back to its card */
function deselect() {
    if (selected === null) return false;
    selected = null;
    settle();
    return true;
}

/** The screens' names with one moved to an index */
function movedTo(name, index) {
    const order = screens.map((screen) => screen.name).filter((other) => other !== name);
    order.splice(Math.max(0, Math.min(index, order.length)), 0, name);
    return order;
}

/** Moves the screens on the board at once; the server's answer follows, and a refusal puts them back */
async function reorder(order) {
    if (order.join() === screens.map((screen) => screen.name).join()) return;
    const before = screens;
    screens = order.map((name) => before.find((screen) => screen.name === name)).filter(Boolean);
    show();
    draw();
    if (!(await change({ action: 'order', order }))) {
        screens = before;
        show();
        draw();
    }
}

/** The menu of one screen, opened from its card or the panel */
const menu = { element: null, status: null, name: null };

function closeMenu() {
    if (!menu.element) return;
    menu.element.remove();
    menu.element = null;
    menu.name = null;
    removeEventListener('pointerdown', outside, true);
    removeEventListener('keydown', escape, true);
}
function outside(event) { if (menu.element && !event.composedPath().includes(menu.element)) closeMenu(); }
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

/** Deletes a screen; the one worked on goes to the screen the app opens on now, or to none with the last one gone */
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
    parts.push(menuButton(T['screens.delete'], () => { fillMenu(name, true); }, 'danger'));
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

/** Makes a screen the one the editor works on: the live app goes there */
function choose(name) {
    if (!screens.some((screen) => screen.name === name)) return;
    says('');
    if (host && host.navigate) host.navigate(name);
    current = name;
    show();
    settle();
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

/** The screen an emit of a card is about: its ⋯ and × send the card's id, its app { app, screen } */
function screenOf(payload) {
    if (typeof payload === 'string') return payload;
    return payload && typeof payload.screen === 'string' ? payload.screen : null;
}

/** What the board's page emits */
async function onBoard(name, payload) {
    switch (name) {
        case 'press': { const screen = screenOf(payload); if (screen) press(screen); return; }
        case 'menu': { const screen = screenOf(payload); if (screen) openMenu(screen, pointer.x, pointer.y); return; }
        case 'deselect': deselect(); return;
        case 'canvas': deselect(); return;
        case 'navigated': followed(screenOf(payload)); return;
        case 'add': {
            const added = freeName('home');
            if (await change({ action: 'add', name: added })) choose(added);
            return;
        }
        case 'move': {
            if (!payload || typeof payload.key !== 'string' || typeof payload.to !== 'string') return;
            const column = Number(payload.to.slice(1));
            const index = Number(payload.index);
            if (!Number.isInteger(column) || !Number.isInteger(index)) return;
            await reorder(movedTo(payload.key, index * columns + column));
            return;
        }
        case 'view': {
            if (!payload || ![payload.x, payload.y, payload.zoom].every(Number.isFinite)) return;
            Object.assign(view, { x: payload.x, y: payload.y, zoom: payload.zoom });
            fitted = false;
            keepView();
            shell.canvas.showZoom(view.zoom, 'base');
            settle();
            return;
        }
    }
}

/** What the editor's Screens panel emits */
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
            draw();
            return;
        }
        case 'screenDelete': {
            // The question is the page's own, by the middle of the window: a browser may not show confirm
            if (!current) return;
            openMenu(current, innerWidth / 2 - 130, innerHeight / 3, true);
            return;
        }
    }
}

/** What /assets/views.js asks of the screens */
window.magneticScreens = { choose: (name) => choose(name) };

if (shell && editor && host && holder) {
    editor.onEmit((name, payload) => void onEmit(name, payload));
    editor.onReady(() => show());
    holder.addEventListener('stateui:emit', (event) => {
        const { name, payload } = event.detail || {};
        if (typeof name === 'string') void onBoard(name, payload);
    });
    shell.canvas.base({ zoomIn: () => pageCommand('zoomIn'), zoomOut: () => pageCommand('zoomOut'), zoomReset: () => pageCommand('zoomReset'), fit: () => fit() });
    shell.canvas.onSize(() => draw());
    // The editor's panels moved: what they cover goes to the canvas, and a view that is still the board's fit fits again
    shell.canvas.onArea(() => {
        pageWrite({ inset: insetOf() });
        if (fitted) fit();
    });
    addEventListener('resize', () => { pageWrite({ inset: insetOf() }); settle(); });
    shell.onEscape(() => deselect());
    shell.onEditing((on) => placeLive(on));
    // Each mount of the live app has a new store: the previews close and open again on it
    addEventListener('stateui:ready', () => {
        if (!page) return;
        reopening = true;
        settle();
        requestAnimationFrame(() => { reopening = false; settle(); });
    });
    // A new document: the list again
    new MutationObserver(() => {
        const next = document.body.dataset.revision || '';
        if (next === revision) return;
        revision = next;
        void load();
    }).observe(document.body, { attributes: true, attributeFilter: ['data-revision'] });
    void load().then(() => placeLive(shell.editing()));
}
`;
