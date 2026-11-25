import { SCREEN_COLUMNS } from '../editor/EditorApp.js';
import { SCREENS_APP, SCREENS_KEYS } from '../screens/ScreensPage.js';
import { SCRIPT_TEXTS } from './text.js';

/**
 * `/assets/screens.js`: the app's screens in the editor, after `/assets/shell.js` and `/assets/inspect.js`.
 *
 * - **The Screens panel** (the editor app's `screens`, beside the rail in the library's place) lists the screens from
 *   `GET /edit/<id>/screens`, marks the one worked on, and adds, renames, copies, deletes one and chooses the one the
 *   app opens on with `POST /edit/<id>/screens`, through the same tools as the agent's.
 * - **The board** is Magnetic's page `magnetic-screens` (`src/screens/ScreensPage.ts`, `/assets/screens.json`), which
 *   the editor places first on its stage, under its panels, and the shell hands over (`magneticShell.page`). This
 *   script drives it through `$.data.screens` and acts on its emits. Its canvas pans and zooms itself, and the editor's zoom runs the canvas's commands. Every screen
 *   is a card in rows of five (Screens in a row on the panel changes it, kept in this browser), 160px apart. The card
 *   of the screen worked on holds the live app (an `embeddedApp` with `live`, attached through `stateuiHost.apps`);
 *   every other card shows its screen's name. Pressing a card makes its screen the one worked on.
 * - **The view** is kept per person and app on the server (`GET` and `POST /edit/<id>/views/kept` with `view`
 *   `screens`), written as the canvas reports it. With none kept the board fits the live card into the area the
 *   editor's panels leave free, and fits it again while the view is still that fit and the panels move.
 * - **Weight:** one card at a time holds an app, the live one: every other card shows its name and mounts none. When a
 *   pan or zoom ends out of names, or the board opens on a kept view, the screen with the most of its card in view
 *   (`mostInView`; the screen worked on keeps a tie) becomes the one worked on, as a press on it would make it.
 * - **Names:** zoomed out (below both `NAMES_BELOW_ZOOM` and `NAMES_BELOW_FIT` of the zoom that fits a card), however
 *   many cards are in view, every card shows only its name (`names`), without its head's title,
 *   and no app is mounted; the cards can then be dragged. Pressing a card selects its screen: the
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
 * - **Zooming in** (Ctrl+Shift+=, the shell's `onZoomIn`) goes to the running app on the selected screen, or else the
 *   one with the most in view, which becomes the one worked on, in the same entry of the address.
 * - The live app moving to another screen itself (`navigated`) makes that screen the one worked on.
 * - **The address** (the shell's `address`): the screen worked on is `/screens/<name>` after the app's path, and the
 *   board's view `#x,y,zoom` while it is not the fit. A screen chosen, or the live app moving after the person pressed
 *   or typed, pushes an entry; the board following the view replaces it. Back and Forward choose the screen and set
 *   the view of their entry; an entry with no screen is the one the page opened on, with no view the fit. The page
 *   opens on the screen and view the address names, before the one the app is on and the view kept on the server.
 * - A new document (the body's `data-revision`) reloads the list.
 * - `window.magneticScreens.choose(name)` makes a screen the one worked on, for the views (`/assets/views.js`).
 *
 */
export const SCREENS_JS = String.raw`${SCRIPT_TEXTS}const shell = window.magneticShell;
const host = window.stateuiHost;
const editor = shell ? shell.editor : null;
const appId = document.body.dataset.appId;
const base = '/edit/' + encodeURIComponent(appId);
const SCREENS_APP = ${JSON.stringify(SCREENS_APP)};
/** The board page's element while it is mounted: the live embeddedApp's '.app' on the editor's stage */
let holder = null;
const alone = document.getElementById('alone');
const S = '$.data.screens';
const CANVAS_KEY = ${JSON.stringify(SCREENS_KEYS.canvas)};
/** The room between two cards, across and down, in the screens' pixels */
const GAP = 160;
/** The height of a card's head above its screen: its title, size and buttons */
const HEAD = 40;
/** The size of a card's ⋯ and × in names, over its screen, in the screens' pixels */
const CORNER = 96;
/** How far a card's head and its corner in names stand in from the screen's edges, in the screens' pixels */
const EDGE = 24;
/** The width of the border of a screen's frame on the board, in the screens' pixels */
const FRAME = 1;
/** The zoom below which every card shows only its name, however few are in view: a screen there is too small to read */
const NAMES_BELOW_ZOOM = 0.4;
/** The share of the zoom that fits a card below which every card shows only its name: on a small window, where the fit is under NAMES_BELOW_ZOOM, a step or two out from it still shows the apps */
const NAMES_BELOW_FIT = 0.6;
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
/** The screen worked on when the page opened: where an entry of the address without a screen goes back to */
let firstScreen;
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
/** Resolves once the editor has the board's page mounted */
let pageArrived = () => undefined;
let pageReady = new Promise((resolve) => { pageArrived = resolve; });
/** The view is the board's own fit of the live card, and fits again when the free area changes */
let fitted = false;
/** By screen name: its card's box on the board, in the screens' pixels, as last measured */
const places = new Map();
/** The live app in the window, without the editor */
let aloneApp = null;
/** Where the pointer last went down, where a menu opened from a card goes */
const pointer = { x: innerWidth / 2, y: innerHeight / 3 };
addEventListener('pointerdown', (event) => { pointer.x = event.clientX; pointer.y = event.clientY; touched = true; }, true);
/** The person has pressed or typed: before that, the live app moving screen is it opening where it was, not a step to go back from */
let touched = false;
addEventListener('keydown', () => { touched = true; }, true);

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
        // The screen the address names, else the one the app is on, else the one it opens on
        const asked = shell.address.now().screen;
        const route = routeScreen();
        current = asked && has(asked) ? asked : route && has(route) ? route : start || (screens[0] ? screens[0].name : null);
        if (current === asked && asked !== route && host && host.navigate) host.navigate(asked);
    }
    if (screens.length === 0) current = null;
    if (firstScreen === undefined) firstScreen = current;
    // A screen the address names that is gone (deleted, renamed, never there) gives way to the one worked on
    const named = shell.address.now().screen;
    if (named !== null && named !== current) shell.address.go({ screen: current });
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

/** The screen to zoom into from the editor: the selected one, else the one most in view, else the one worked on */
function zoomPick() {
    const name = selected ?? mostInView() ?? current;
    if (name !== null) choose(name, 'zoom');
    return name;
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

/** A card shows the live app: the screen worked on, outside names or selected in them, and only while the editor shows (without it the app is in #alone) */
function isLive(name) { return shell.editing() && name === current && (!names || selected === name); }

/** How much of a card's box is in the area the editor's panels leave free, at the view as it is, in the window's pixels */
function areaInView(box) {
    const free = shell.canvas.freeArea();
    const left = view.x + box.x * view.zoom;
    const top = view.y + box.y * view.zoom;
    const across = Math.min(left + box.width * view.zoom, free.left + free.width) - Math.max(left, free.left);
    const down = Math.min(top + box.height * view.zoom, free.top + free.height) - Math.max(top, free.top);
    return across > 0 && down > 0 ? across * down : 0;
}

/** Out of names, makes the screen with the most in view the one worked on */
function followView() {
    const most = names ? null : mostInView();
    if (most !== null && most !== current) choose(most, 'follow');
}

/** The screen whose card has the most in view, or null when none is in view; the current screen keeps a tie */
function mostInView() {
    const kept = current === null ? undefined : places.get(current);
    let most = kept === undefined ? null : current;
    let largest = kept === undefined ? 0 : areaInView(kept);
    if (largest === 0) most = null;
    for (const [name, box] of places) {
        const area = areaInView(box);
        if (area > largest) { largest = area; most = name; }
    }
    return most;
}

/** The cards, one per screen, or the one Add a screen card of an app with none */
function tiles() {
    const [width, height] = shell.canvas.size();
    if (screens.length === 0) {
        return [{ id: '-add', app: appId, title: T['screens.addFirst'], note: '', live: false, active: false, width, height, column: lane(0), row: 0, add: true, noAdd: false, noHead: true, noMore: true, noClose: true, moreLabel: '', closeLabel: '' }];
    }
    return screens.map((screen, index) => {
        const live = isLive(screen.name);
        // The one app mounted is the live one: out of names the screen worked on, in names the selected one
        const active = live;
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
            noHead: names,
            noMore: !names,
            noClose: !(names && selected === screen.name),
            moreLabel: fill(T['screens.more'], { name: screen.title }),
            closeLabel: T['screens.namesOnly']
        };
    });
}

/**
 * The board's own sizes: a column as wide as a screen with the gap between columns, a card's row as tall as its head, its
 * screen and the gap, and every row drawn. In names a card's name stays 20px on the screen at any zoom
 */
function boardTheme() {
    const [width, height] = shell.canvas.size();
    const card = height + HEAD + GAP;
    const rows = Math.ceil(Math.max(1, screens.length) / columns);
    return {
        // In names a card has no head, so its row's room under it is the head's and the gap: what a dragged card's place leaves out
        // A column holds a screen's frame: the screen and the frame's border on either side
        board: { column: (width + 2 * FRAME) + 'px', card: card + 'px', gap: (names ? HEAD + GAP : GAP) + 'px', height: (rows * card) + 'px' },
        space: { gap: { md: GAP + 'px' } },
        border: { width: { thin: FRAME + 'px' } },
        // The frame is square, as the app's own edges are: rounded corners would cover the app's corners
        embed: { radius: '0px' },
        // The corner over a card in names: a button of a size of the board's, which shrinks with the card
        size: { control: { lg: CORNER + 'px' }, icon: { lg: Math.round(CORNER / 2) + 'px' } },
        // A head's title and ⋯ stand in from the screen's edges
        // and a card's panels draw no border, so the frame is as wide as the card
        panel: { padding: '0px ' + EDGE + 'px', border: { width: '0px' } },
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
    if (!placedOnce) { placedOnce = true; place(); following = keptView !== null; }
    else if (refit) { refit = false; fit(); }
    settle();
    // The board opens where it was left: once the cards are placed, the screen with the most in view there is the one worked on
    if (following && places.size > 0) { following = false; followView(); }
}

/** The view the board opens on: where it was left, kept on the server, or the live card fitted */
let placedOnce = false;
/** The frame changed size while the view was the fit: fit again once the cards are measured at the new size */
let refit = false;
let keptView = null;
/** True from opening on a kept view until the cards are placed and the one most in view is worked on */
let following = false;
function place() {
    if (keptView) {
        Object.assign(view, keptView);
        pageWrite({ view: { ...view } });
        fitted = false;
    } else fit();
    if (holder) holder.style.visibility = '';
    shell.canvas.showZoom(view.zoom, 'base');
}

/** The zoom that fits a card into the stage area, never past 100%: a panel opening over the canvas does not shrink it */
function fitZoom(box) {
    const free = shell.canvas.stageArea();
    return Math.max(0.1, Math.min(1, free.width / box.width, free.height / box.height));
}

/** Fits the live card, or the first, into the stage area, never past 100% */
function fit() {
    const box = places.get(current || '') || places.values().next().value;
    if (!box) { pageCommand('fit'); fitted = false; return; }
    const free = shell.canvas.stageArea();
    const zoom = fitZoom(box);
    Object.assign(view, { x: free.left + (free.width - box.width * zoom) / 2 - box.x * zoom, y: free.top + (free.height - box.height * zoom) / 2 - box.y * zoom, zoom });
    pageWrite({ view: { ...view } });
    fitted = true;
    // The board's fit is no place of the person's: the address has no view, and opens on the fit again
    shell.address.go({ view: null });
    shell.canvas.showZoom(view.zoom, 'base');
    settle();
}

/** True when every card should show only its name: zoomed out, however many cards are in view */
function namesWanted() {
    const box = places.values().next().value;
    return view.zoom < (box ? Math.min(NAMES_BELOW_ZOOM, fitZoom(box) * NAMES_BELOW_FIT) : NAMES_BELOW_ZOOM);
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

/** The view kept on the server, read once: the board opens on it, or on the view the address names */
const keptLoaded = fetch(base + '/views/kept?view=screens')
    .then((answer) => (answer.ok ? answer.json() : {}))
    .then((answer) => {
        const kept = answer.place;
        keptView = kept && [kept.x, kept.y, kept.zoom].every(Number.isFinite) ? { x: kept.x, y: kept.y, zoom: kept.zoom } : null;
    }, () => undefined)
    .then(() => { if (shell && shell.address.now().view) keptView = { ...shell.address.now().view }; });

function boardEmit(event) {
    const { name, payload } = event.detail || {};
    if (typeof name === 'string') void onBoard(name, payload);
}

/**
 * The editor places the board's page; the shell hands it over once it is mounted, and each time it is mounted again.
 * The first time it waits out of sight until it has its view, rather than show at the wrong place
 */
function boardMounted(panel, element, doc) {
    holder = element;
    element.addEventListener('stateui:emit', boardEmit);
    const canvas = doc ? keyPath(doc, CANVAS_KEY) : null;
    page = { panel, canvas, board: canvas + '.content' };
    if (!placedOnce) element.style.visibility = 'hidden';
    void keptLoaded.then(() => {
        if (!page || page.panel !== panel) return;
        lastTiles = '';
        pageWrite({ inset: insetOf(), view: { ...(placedOnce || !keptView ? view : keptView) } });
        draw();
    });
    pageArrived();
}
function boardDisposed() {
    if (holder) holder.removeEventListener('stateui:emit', boardEmit);
    holder = null;
    page = null;
    pageReady = new Promise((resolve) => { pageArrived = resolve; });
}

/** True once the board's page is mounted; false, after saying so, when the editor has not mounted it in time */
function mountPage() {
    if (page) return Promise.resolve(true);
    return Promise.race([pageReady.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 10000))]).then((ready) => {
        if (!ready) says(T['views.refused']);
        return ready;
    });
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
    if (touched) shell.address.go({ screen }, { push: true });
    else if (shell.address.now().screen === null) firstScreen = screen;
    else shell.address.go({ screen });
    show();
    settle();
}

/** Back or Forward: the screen, and in the editor the view, the address names */
function addressMoved(address) {
    const screen = address.screen || firstScreen;
    if (screen && screen !== current && screens.some((candidate) => candidate.name === screen)) choose(screen, 'history');
    if (!shell.editing() || !page) return;
    if (address.view) {
        if (address.view.x === Math.round(view.x) && address.view.y === Math.round(view.y) && address.view.zoom === Number(view.zoom.toFixed(3))) return;
        Object.assign(view, address.view);
        pageWrite({ view: { ...view } });
        fitted = false;
        shell.canvas.showZoom(view.zoom, 'base');
        settle();
    } else if (!fitted) fit();
}

/** The view rested where the person left it: the address keeps it */
function viewInAddress() { shell.address.go({ view: { ...view } }); }

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

/**
 * Makes a screen the one the editor works on: the live app goes there. A screen chosen pushes an entry of the address;
 * how 'follow' (the board following the view) replaces it, and 'history' (Back or Forward) and 'zoom' (the shell
 * pushes the entry with the zoom) leave it as it is
 */
function choose(name, how) {
    if (!screens.some((screen) => screen.name === name)) return;
    says('');
    if (host && host.navigate) host.navigate(name);
    const moved = name !== current;
    current = name;
    if (moved && how !== 'history' && how !== 'zoom') shell.address.go({ screen: name }, { push: how !== 'follow' });
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
            viewInAddress();
            shell.canvas.showZoom(view.zoom, 'base');
            settle();
            followView();
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

/** Every element matching a selector below a root, through the shadow roots */
function deepAll(root, selector, out = []) {
    for (const element of root.querySelectorAll(selector)) out.push(element);
    for (const element of root.querySelectorAll('*')) if (element.shadowRoot) deepAll(element.shadowRoot, selector, out);
    return out;
}

/**
 * The live app on its card: the element the app host attached it to (the live embeddedApp's '.app') and its screen;
 * null while the editor is away or no card is live
 */
function liveApp() {
    if (!holder || !current || !shell.editing()) return null;
    for (const embedded of deepAll(holder, 'ui-embedded-app')) {
        const element = embedded.shadowRoot && embedded.shadowRoot.querySelector('.frame[data-own-gestures="all"] > .app');
        if (element && element.offsetWidth > 0) return { element, screen: current };
    }
    return null;
}

/**
 * The cards in the page, for the views' layers: each screen's name, the element its app shows in (the embeddedApp's
 * '.app' while an app is mounted there, else its frame), and whether it is the live app. A card is known by its place
 * on the board: the script reads no state of the page's components
 */
function cards() {
    const canvas = holder && shell.editing() ? deepFind(holder, 'ui-viewport') : null;
    const world = canvas && canvas.shadowRoot ? canvas.shadowRoot.querySelector('.world') : null;
    if (!world) return [];
    const origin = world.getBoundingClientRect();
    const zoom = origin.width / (world.offsetWidth || 1) || view.zoom;
    const found = [];
    for (const embedded of deepAll(holder, 'ui-embedded-app')) {
        const frame = embedded.shadowRoot && embedded.shadowRoot.querySelector('.frame');
        if (!frame || frame.offsetWidth === 0) continue;
        const box = frame.getBoundingClientRect();
        const x = (box.left + box.width / 2 - origin.left) / zoom;
        const y = (box.top + box.height / 2 - origin.top) / zoom;
        let name = null;
        for (const [candidate, place] of places) if (x >= place.x && x <= place.x + place.width && y >= place.y && y <= place.y + place.height) name = candidate;
        if (name === null || found.some((card) => card.name === name)) continue;
        const app = frame.querySelector('.app');
        found.push({ name, element: app && app.offsetWidth > 0 ? app : frame, live: frame.dataset.ownGestures === 'all' });
    }
    return found;
}

/** Moves the board by a drag of the hand over the live app, which the canvas leaves to the app */
function panBy(dx, dy) {
    if (!page || !(Number.isFinite(dx) && Number.isFinite(dy))) return;
    Object.assign(view, { x: view.x + dx, y: view.y + dy });
    fitted = false;
    pageWrite({ view: { ...view } });
    keepView();
    viewInAddress();
    settle();
}

/** What /assets/views.js and /assets/inspect.js ask of the screens */
window.magneticScreens = { choose: (name) => choose(name), liveApp, cards, panBy };

if (shell && editor && host) {
    editor.onEmit((name, payload) => void onEmit(name, payload));
    editor.onReady(() => show());
    shell.page(SCREENS_APP, { mounted: boardMounted, disposed: boardDisposed });
    shell.canvas.base({ zoomIn: () => pageCommand('zoomIn'), zoomOut: () => pageCommand('zoomOut'), zoomReset: () => pageCommand('zoomReset'), fit: () => fit() });
    // A new frame size (Desktop follows the stage area) draws the board again; a view that is still the fit fits again once the cards are measured
    shell.canvas.onSize(() => { refit = refit || fitted; draw(); });
    // The editor's panels moved: what they cover goes to the canvas, and a view that is still the board's fit fits again
    shell.canvas.onArea(() => {
        pageWrite({ inset: insetOf() });
        if (fitted) fit();
    });
    addEventListener('resize', () => { pageWrite({ inset: insetOf() }); settle(); });
    shell.onEscape(() => deselect());
    shell.onZoomIn(zoomPick);
    shell.address.onChange((address) => addressMoved(address));
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
