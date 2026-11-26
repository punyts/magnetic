import { hiddenBy } from '../pages/own.js';
import { pageSpec } from '../pages/PageSpec.js';
import type { Services, UiToolDefinition } from '@punyts/stateui-mcp';
import { LOGO_SVG } from '../http/logo.js';
import { textsOf } from '../http/text.js';
import type { Texts } from '../http/text.js';
import { COMPONENT_CATEGORIES } from '../inspector/constants.js';
import type { PageSpec } from '../pages/PageSpec.js';
import type { Hearing } from '../http/raised.js';
import { CODE_SOURCE, PersonPages } from '../pages/PersonPages.js';
import type { PageSource } from '../pages/PersonPages.js';
import { LOGIC_APP } from '../logic/LogicPage.js';
import { LANGUAGE_NAMES, LANGUAGES, MODES } from '../prefs/Preferences.js';
import { SCREENS_APP } from '../screens/ScreensPage.js';
import { SIDE_APP } from '../side/SidePage.js';
import { STATENET_APP } from '../statenet/StatenetPage.js';
import { THEME_APP } from '../theme/ThemePage.js';
import type { Stamps } from '../storage/Stamps.js';
import { alone } from '../storage/exclusive.js';
import type { Exclusive } from '../storage/exclusive.js';

/** The name of each person's editor, an app of their own in their workspace */
export const EDITOR_APP = 'magnetic-editor';

/**
 * The editor as a StateUI app: panels floating over the canvas, as Magnetic's editor has always looked. The page lays
 * the editor over the whole window, above the canvas, in the page itself; its screen and stage let presses through
 * (`passThrough`), it and its app draw no surface (`seeThrough`), and its panels take the presses, so the canvas shows
 * and a click anywhere else reaches it and the app on it.
 *
 * The page drives the editor through its data and the ids of its nodes only, never through the paths of its nodes, so a person (or
 * the agent) can move, restyle, add or drop any panel and the rest keeps working:
 *
 * - The page writes the editor's data, a record per namespace (`$.data.app`, `chat`, `inspector`, `sharing`,
 *   `preferences`, `feedback`, `canvas`, `rail`, `screensPanel`, `connectionsPanel`, `sharedPanel`: `RECORDS`), and the
 *   lists `messages`, `calls`, `links`, `components`, `screens`, `connections`, `shared`, `paths` and `feed`.
 * - The page hears what the person does through the ids of the editor's nodes (`EDITOR_HEARING`) and acts on it.
 * - Two parts are found by their key wherever they are: `stage`, the full-window area whose children float (each is
 *   let through), and `propertyFields`, the panel the page fills with a field per property of the selected node. The
 *   inspector's tabs follow `$.data.inspector.tab`.
 */
export const EDITOR_KEYS = { stage: 'stage', propertyFields: 'propertyFields' } as const;

/**
 * What the page's script hears of the editor (src/http/raised.ts): `<id>.<event>` to the name its code acts on. A
 * node's id is mostly that name; the narrow rail's copies of the wide rail's buttons end in `Top`
 */
export const EDITOR_HEARING: Hearing = {
    'home.press': { name: 'home' },
    'share.press': { name: 'share' },
    'zoomReset.press': { name: 'zoomReset' },
    'focusRemove.remove': { name: 'focusRemove' },
    'model.change': { name: 'model' },
    'keepOpen.change': { name: 'keepOpen' },
    'stop.press': { name: 'stop' },
    'crumb.select': { name: 'crumb' },
    'addToChat.press': { name: 'addToChat' },
    'remove.press': { name: 'remove' },
    'connectionAsk.press': { name: 'connectionAsk', from: 'row.id' },
    'sharedAsk.press': { name: 'sharedAsk', from: 'row.id' },
    'screenColumns.change': { name: 'screenColumns' },
    'screenGo.press': { name: 'screenGo', from: 'row.name' },
    'category.change': { name: 'category' },
    'path.select': { name: 'path' },
    'ask.press': { name: 'ask' },
    'tab.change': { name: 'tab' },
    'orgOpen.change': { name: 'orgOpen' },
    'shareRight.change': { name: 'shareRight' },
    'shareMake.press': { name: 'shareMake' },
    'linkCopy.press': { name: 'linkCopy', from: 'row.id' },
    'linkRevoke.press': { name: 'linkRevoke', from: 'row.id' },
    'mode.change': { name: 'mode' },
    'language.change': { name: 'language' },
    'feedbackKind.change': { name: 'feedbackKind' },
    'feedbackText.change': { name: 'feedbackText' },
    'size.change': { name: 'size' },
    'sizeTop.change': { name: 'size' },
    'frame.change': { name: 'frame' },
    'frameTop.change': { name: 'frame' },
    'views.change': { name: 'view' },
    'viewMenu.change': { name: 'view' },
    'toolUse.press': { name: 'tool', send: 'use' },
    'toolMove.press': { name: 'tool', send: 'move' },
    'toolSelect.press': { name: 'tool', send: 'select' },
    'layerLayout.press': { name: 'layerLayout' },
    'layerData.press': { name: 'layerData' },
    'layerLogic.press': { name: 'layerLogic' },
    'library.press': { name: 'library' },
    'screensPanel.press': { name: 'screensPanel' },
    'connectionsPanel.press': { name: 'connectionsPanel' },
    'sharedPanel.press': { name: 'sharedPanel' },
    'toolUseTop.press': { name: 'tool', send: 'use' },
    'toolMoveTop.press': { name: 'tool', send: 'move' },
    'toolSelectTop.press': { name: 'tool', send: 'select' },
    'layerLayoutTop.press': { name: 'layerLayout' },
    'layerDataTop.press': { name: 'layerData' },
    'layerLogicTop.press': { name: 'layerLogic' },
    'libraryTop.press': { name: 'library' },
    'screensPanelTop.press': { name: 'screensPanel' },
    'connectionsPanelTop.press': { name: 'connectionsPanel' },
    'sharedPanelTop.press': { name: 'sharedPanel' },
    'idea1.press': { name: 'idea1' },
    'idea2.press': { name: 'idea2' },
    'idea3.press': { name: 'idea3' },
    'turn.press': { name: 'turn' },
    'open.press': { name: 'open' },
    'feedback.press': { name: 'feedback' },
    'prefs.press': { name: 'prefs' },
    'zoomOut.press': { name: 'zoomOut' },
    'zoomIn.press': { name: 'zoomIn' },
    'zoomFit.press': { name: 'zoomFit' },
    'focusClear.press': { name: 'focusClear' },
    'chatToggle.press': { name: 'chatToggle' },
    'request.send': { name: 'chat.send' },
    'chatClose.press': { name: 'chatClose' },
    'hintClose.press': { name: 'hintClose' },
    'connectionsClose.press': { name: 'connectionsClose' },
    'connectionsManage.press': { name: 'connectionsManage' },
    'sharedClose.press': { name: 'sharedClose' },
    'sharedManage.press': { name: 'sharedManage' },
    'libraryClose.press': { name: 'libraryClose' },
    'screensClose.press': { name: 'screensClose' },
    'screenNew.change': { name: 'screenNew' },
    'screenRenameText.change': { name: 'screenRenameText' },
    'screenAdd.press': { name: 'screenAdd' },
    'screenRename.press': { name: 'screenRename' },
    'screenCopy.press': { name: 'screenCopy' },
    'screenHome.press': { name: 'screenHome' },
    'screenDelete.press': { name: 'screenDelete' },
    'search.input': { name: 'search' },
    'search.change': { name: 'search' },
    'libraryCard.press': { name: 'place', from: 'row.name' },
    'libraryCard.dragStart': { name: 'grab', from: 'row.name' },
    'libraryCard.dragMove': { name: 'dragMove' },
    'libraryCard.dragEnd': { name: 'dragEnd' },
    'inspectorClose.press': { name: 'inspectorClose' },
    'shareClose.press': { name: 'shareClose' },
    'prefsClose.press': { name: 'prefsClose' },
    'feedbackClose.press': { name: 'feedbackClose' },
    'feedbackSend.press': { name: 'feedbackSend' }
};

/** The fields of the editor's data that are true until the page says otherwise: what starts hidden */
const HIDDEN_AT_FIRST = [
    'noSelection', 'noDetail', 'noFocus', 'noDataLine', 'noNotice', 'cannotRemove', 'notWorking', 'notBlank', 'noStatus', 'noModels', 'noMessages',
    'isHome', 'notHome', 'noScreensStatus', 'notInOrg', 'noConnectionsStatus', 'cannotManage', 'noSharedStatus', 'cannotManageData', 'noBudget'
];

/**
 * The editor's panes, each shown and hidden by its own `hidden` (docs/design/state-definitions-and-instances.md, the
 * editor's record): whether a panel is open is the panel's state, kept in the person's instance, not data. The page
 * script still names them by the flag it sets (`chatHidden`), and writes the pane's `hidden` by its `@id`
 */
export const EDITOR_PANES: Readonly<Record<string, string>> = Object.fromEntries(
    ['chat', 'inspector', 'share', 'prefs', 'hint', 'drawer', 'narrow', 'library', 'screens', 'connections', 'shared', 'feedback', 'side', 'statenet', 'theme', 'logic', 'wide', 'board'].map((name) => [`${name}Hidden`, `${name}Pane`])
);

type Operation = Record<string, unknown>;
const texts = (...fields: string[]): Operation[] => fields.map((field) => ({ op: 'set', field, type: 'string', default: '' }));
const flags = (...fields: string[]): Operation[] => fields.map((field) => ({ op: 'set', field, type: 'boolean', default: HIDDEN_AT_FIRST.includes(field) }));

/**
 * The editor's data by namespace: each is one record at `$.data.<namespace>` with a model of its own
 * (`magnetic-editor-<namespace>`, `magnetic-editor-screens-panel`), named for the part of the editor its fields are about. A field's name is unique
 * across the namespaces, so the page script names a field alone and `EDITOR_FIELDS` says where it is
 */
const RECORDS: Readonly<Record<string, readonly Operation[]>> = {
    // The app worked on and the window it is edited in: its name and workspace, a notice over everything, and whether
    // the window is narrow (below 760px) and the app blank
    app: [...texts('appName', 'workspaceName', 'notice'), ...flags('noNotice', 'isNarrow', 'blank', 'notBlank')],
    // The chat bar and the chat: the status and data lines, what the next request is about, the model, the agent's
    // activity and the person's agent use
    chat: [
        ...texts('status', 'dataLine', 'note', 'budgetLine'),
        // What the next request is about: a chip per thing, keyed by an id the page gives it
        { op: 'set', field: 'focusItems', type: 'object', default: {} },
        // What the view shown sends the agent: a fixed chip per part (the view, and in Screens each layer that is on)
        { op: 'set', field: 'contextItems', type: 'object', default: {} },
        { op: 'set', field: 'model', type: 'string', default: '' },
        { op: 'set', field: 'models', type: 'object', default: {} },
        // The person's agent use, in cents of their whole budget, and the ring's tone (accent, then warning, then danger)
        { op: 'set', field: 'budgetUsed', type: 'number', default: 0 },
        { op: 'set', field: 'budgetTotal', type: 'number', default: 1 },
        { op: 'set', field: 'budgetTone', type: 'string', default: 'accent' },
        ...flags('working', 'hasMessages', 'keepOpen', 'chatOff', 'notWorking', 'noStatus', 'noDataLine', 'noFocus', 'noModels', 'noMessages', 'noBudget')
    ],
    // The inspector: what it is doing, the selection's breadcrumb and heading, the open tab, and the state path chosen
    inspector: [
        ...texts('inspectorStatus', 'heading', 'detailPath', 'detailValue', 'detailShown', 'detailRead', 'detailWritten', 'crumb'),
        { op: 'set', field: 'crumbs', type: 'object', default: {} },
        { op: 'set', field: 'tab', type: 'string', default: 'properties' },
        ...flags('noSelection', 'cannotRemove', 'noDetail')
    ],
    // The Share sheet: what a new link allows, whether the org may open the app, and what the last change said
    sharing: [...texts('shareStatus'), { op: 'set', field: 'shareRight', type: 'string', default: 'use' }, ...flags('orgOpen', 'notInOrg')],
    // The person's choices: light or dark, and the language
    preferences: [...texts('prefsStatus'), { op: 'set', field: 'mode', type: 'string', default: 'system' }, { op: 'set', field: 'language', type: 'string', default: 'en' }],
    // The feedback sheet: what is being written, and what sending it said
    feedback: [...texts('feedbackText', 'feedbackStatus'), { op: 'set', field: 'feedbackKind', type: 'string', default: 'bug' }],
    // The canvas: the view it shows (Screens, Statenet, Theme, Logic), the frame's device and size, and the zoom
    canvas: [
        ...texts('zoom'),
        { op: 'set', field: 'view', type: 'string', default: 'screens' },
        { op: 'set', field: 'size', type: 'string', default: 'desktop' },
        // The frame's size among the common sizes of the device chosen (`1280x800`), and those sizes as options
        { op: 'set', field: 'frame', type: 'string', default: '1280x800' },
        { op: 'set', field: 'frames', type: 'object', default: {} },
        ...flags('notScreensView', 'noBoard')
    ],
    // The rail: the pointer tool, the layers on the screen tiles, and how its buttons look: solid while on, ghost while
    // off, the accent while on, the ink while off (the page writes the looks with the tool, the layers and the panels)
    rail: [
        { op: 'set', field: 'tool', type: 'string', default: 'use' },
        { op: 'set', field: 'layers', type: 'object', default: { layout: false, data: false, logic: false } },
        { op: 'set', field: 'toolLook', type: 'object', default: { use: 'solid', move: 'ghost', select: 'ghost' } },
        { op: 'set', field: 'toolTone', type: 'object', default: { use: 'accent', move: 'neutral', select: 'neutral' } },
        { op: 'set', field: 'layerLook', type: 'object', default: { layout: 'ghost', data: 'ghost', logic: 'ghost' } },
        { op: 'set', field: 'layerTone', type: 'object', default: { layout: 'neutral', data: 'neutral', logic: 'neutral' } },
        ...['library', 'screens', 'connections', 'shared'].flatMap((panel) => [
            { op: 'set', field: `${panel}Look`, type: 'string', default: 'ghost' },
            { op: 'set', field: `${panel}Tone`, type: 'string', default: 'neutral' }
        ])
    ],
    // The Screens panel: the screen worked on, the names typed, what the last change said, and how many screens the
    // canvas lays side by side before it starts a new row
    screensPanel: [...texts('screenName', 'screenRename', 'screenNew', 'screensStatus'), { op: 'set', field: 'screenColumns', type: 'string', default: 'n5' }, ...flags('isHome', 'notHome', 'noScreensStatus')],
    // The Connections panel: what it says of the workspace's connections, and whether the person may manage them
    connectionsPanel: [...texts('connectionsStatus'), ...flags('noConnectionsStatus', 'cannotManage')],
    // The Shared data panel: the same for the datasets shared with the workspace
    sharedPanel: [...texts('sharedStatus'), ...flags('noSharedStatus', 'cannotManageData')]
};

/** The model of a namespace of the editor's data */
const modelOf = (namespace: string): string => `magnetic-editor-${namespace.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;

/**
 * Where each field the page script names is: a field of the editor's data to its data path (`status` to
 * `$.data.chat.status`), made from the models, and each pane's flag (`chatHidden`) to a path under `$.data.panes`, which
 * is no data: a pane's flag is the pane's own `hidden`, and `EDITOR.own` takes a write there to the pane by its id. The
 * script (src/http/shell.ts, `ed`) keeps the field names and writes each at its path here
 */
export const EDITOR_FIELDS: Readonly<Record<string, string>> = (() => {
    const paths: Record<string, string> = {};
    const add = (field: string, path: string): void => {
        if (paths[field] !== undefined) throw new Error(`The editor's field ${field} is in two namespaces`);
        paths[field] = path;
    };
    for (const [namespace, operations] of Object.entries(RECORDS)) for (const operation of operations) add(String(operation['field']), `$.data.${namespace}.${String(operation['field'])}`);
    for (const flag of Object.keys(EDITOR_PANES)) add(flag, `$.data.panes.${flag}`);
    return paths;
})();

/** The data path of a field of the editor, or of a part of one (`toolLook.use`) */
function e(field: string): string {
    const [name, ...rest] = field.split('.');
    const path = EDITOR_FIELDS[name as string];
    if (path === undefined) throw new Error(`The editor has no field ${String(name)}`);
    return [path, ...rest].join('.');
}

/** The models of the editor's data */
const MODELS: Record<string, readonly Record<string, unknown>[]> = {
    ...Object.fromEntries(Object.entries(RECORDS).map(([namespace, operations]) => [modelOf(namespace), operations])),
    'magnetic-message': [
        { op: 'set', field: 'id', type: 'string', required: true },
        { op: 'set', field: 'author', type: 'string', required: true },
        { op: 'set', field: 'text', type: 'string' },
        { op: 'set', field: 'time', type: 'string' }
    ],
    'magnetic-call': [
        { op: 'set', field: 'id', type: 'string', required: true },
        { op: 'set', field: 'line', type: 'string', required: true }
    ],
    'magnetic-link': [
        { op: 'set', field: 'id', type: 'string', required: true },
        { op: 'set', field: 'title', type: 'string', required: true },
        { op: 'set', field: 'note', type: 'string' },
        { op: 'set', field: 'url', type: 'string' },
        { op: 'set', field: 'revoked', type: 'boolean' }
    ],
    'magnetic-connection': [
        { op: 'set', field: 'id', type: 'string', required: true },
        { op: 'set', field: 'title', type: 'string', required: true },
        { op: 'set', field: 'subtitle', type: 'string' }
    ],
    'magnetic-screen': [
        { op: 'set', field: 'id', type: 'string', required: true },
        { op: 'set', field: 'name', type: 'string', required: true },
        { op: 'set', field: 'title', type: 'string' },
        { op: 'set', field: 'note', type: 'string' },
        { op: 'set', field: 'current', type: 'boolean' }
    ],
    'inspector-component': [
        { op: 'set', field: 'id', type: 'string', required: true },
        { op: 'set', field: 'name', type: 'string', required: true },
        { op: 'set', field: 'summary', type: 'string' }
    ],
    'inspector-path': [
        { op: 'set', field: 'id', type: 'string', required: true },
        { op: 'set', field: 'label', type: 'string', required: true },
        { op: 'set', field: 'parentId', type: 'string' },
        { op: 'set', field: 'hasChildren', type: 'boolean' }
    ],
    'inspector-change': [
        { op: 'set', field: 'id', type: 'string', required: true },
        { op: 'set', field: 'line', type: 'string', required: true }
    ]
};

/**
 * The editor's own icons: the glyphs of the old hand-written editor, as 24×24 outline path data the app carries of its
 * own (ui_icons_write's format), so its buttons draw them rather than the nearest icons of the set. `minus` and `plus`
 * win over the set's icons of those names. The old `prefs` circle is a path here, since an app icon is path data only
 */
export const EDITOR_ICONS = {
    chat: { outline: ['M4 5h16v11H9l-5 4z'] },
    send: { outline: ['M12 19V5M5 12l7-7 7 7'] },
    pointer: { outline: ['M5 3l14 8-6 2-3 6z'] },
    select: { outline: ['M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4', 'M10 10l7 3-3 1-1 3z'] },
    hand: {
        outline: ['M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10.5v-6a1.5 1.5 0 0 1 3 0V11M14 6.5a1.5 1.5 0 0 1 3 0V11M17 8.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-2a6 6 0 0 1-5-2.7L4.3 14a1.5 1.5 0 0 1 2.4-1.8L8 14']
    },
    minus: { outline: ['M5 12h14'] },
    plus: { outline: ['M12 5v14M5 12h14'] },
    fit: { outline: ['M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'] },
    components: { outline: ['M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z', 'M17 14v6M14 17h6'] },
    screens: { outline: ['M3 6h7v12H3zM14 6h7v12h-7z'] },
    connections: { outline: ['M9 7V3M15 7V3M7 7h10v4a5 5 0 0 1-10 0z', 'M12 16v5'] },
    'shared-data': { outline: ['M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z', 'M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6', 'M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3'] },
    bug: { outline: ['M9 9h6a3 3 0 0 1 3 3v3a6 6 0 0 1-12 0v-3a3 3 0 0 1 3-3z', 'M9 9V8a3 3 0 0 1 6 0v1M12 12v9M6 13H3M21 13h-3M6.5 18L4 20M17.5 18l2.5 2M7 10L5 8M17 10l2-2'] },
    prefs: { outline: ['M4 12a8 8 0 1 0 16 0a8 8 0 1 0 -16 0', { d: 'M12 4a8 8 0 0 0 0 16z', fill: true }] }
} as const;

/** A small ghost button the page hears by `id` */
const button = (title: string, id: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ component: 'button', size: 'sm', variant: 'ghost', _title: title, '@id': id, ...extra });
const icon = (title: string, id: string, name: string, extra: Record<string, unknown> = {}): Record<string, unknown> => button(title, id, { icon: name, iconPosition: 'only', corners: 'pill', tone: 'neutral', ...extra });
const caption = (text: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ component: 'text', textRole: 'caption', _text: text, ...extra });
const bound = (path: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ component: 'text', '<-_text': path, ...extra });

/** A panel floating over the canvas, at its place on the stage, as tight as the old editor's */
function float(placement: Record<string, string>, children: Record<string, unknown>, extra: Record<string, unknown> = {}): Record<string, unknown> {
    return { component: 'panel', elevation: 'raised', bordered: true, padding: 'sm', density: 'compact', placement, layout: { type: 'column', gap: 'sm' }, children, ...extra };
}

/** Lengths that follow the window, as the old editor's CSS did: never wider than the window less its margins */
const fit = (width: string): string => `min(${width}, calc(100% - 24px))`;
/** Below 760px the rail runs along the top, so what opens under the top corners starts lower */
const BELOW_RAIL = 'clamp(64px, (760px - 100vw) * 1000, 116px)';
/**
 * The inspector: at the right, below the corners, 320px wide; below 760px a sheet across the bottom, 45% of the height,
 * as the old editor's was, so the app stays in sight above it
 */
const INSPECTOR = {
    right: '12px',
    // Above the chat bar, also when it shows what the next request is about on a line of its own
    bottom: '100px',
    // (760px - 100vw) * 1000 is far below the lower bound from 760px up and far above the upper one below it
    y: 'clamp(64px, (760px - 100vw) * 1000, calc(55vh - 100px))',
    width: `clamp(${fit('320px')}, (760px - 100vw) * 1000, calc(100% - 24px))`
};
/**
 * The side panel of the views (Statenet, Theme, Logic): at the right, below the corners, down to above the chat bar,
 * 360px wide but never more than 45% of the window; below 760px a sheet across the bottom half, as the old sheet's was
 */
const SIDE_PLACEMENT = {
    right: '12px',
    bottom: 'clamp(96px, (760px - 100vw) * 1000, 132px)',
    y: 'clamp(64px, (760px - 100vw) * 1000, 50vh)',
    width: 'clamp(min(360px, 45%), (760px - 100vw) * 1000, calc(100% - 24px))'
};
/** The whole window, under every panel: where the board and Statenet are placed */
const WHOLE = { x: '0px', y: '0px', width: '100%', height: '100%' };
/**
 * Where Theme and Logic show: right of the rail, below the corners, down to above the chat bar; below 760px under the
 * rail along the top, down to above the chat bar and the zoom
 */
const VIEW_PLACEMENT = {
    x: 'clamp(12px, (100vw - 760px) * 1000, 96px)',
    y: 'clamp(76px, (760px - 100vw) * 1000, 116px)',
    right: '12px',
    bottom: 'clamp(96px, (760px - 100vw) * 1000, 132px)'
};
/** A canvas page has no frame of its own: no border, no corners, nothing behind it but its page */
const CANVAS_FRAME = { embed: { border: 'transparent', radius: '0px', fill: 'transparent' } };
/**
 * The canvas: Magnetic's pages the view selector shows (`$.data.canvas.view`), each a live embeddedApp the page's app
 * host opens by name, first on the stage so every panel lies over it. The screens board and Statenet take the whole
 * window, Theme and Logic the area the panels leave. Each stays mounted while hidden, so it keeps where the person left
 * it; the page script shows one at a time through their own `hidden` (`boardPane`, `statenetPane`, `themePane`, `logicPane`). Each is
 * a stack of its own (`z: 0`), so what is drawn over a page's app, such as the inspector's layer, stays under the panels
 */
function canvasPages(t: Texts): Record<string, unknown> {
    const page = (app: string, label: string, placement: Record<string, string>, pane: string): Record<string, unknown> => ({
        component: 'embeddedApp', app, live: true, fill: true, _label: label, placement: { ...placement, z: 0 }, theme: CANVAS_FRAME, hidden: pane !== 'boardPane', '@id': pane
    });
    return {
        board: page(SCREENS_APP, t['screens.board'], WHOLE, 'boardPane'),
        statenet: page(STATENET_APP, t['shell.view.statenet'], WHOLE, 'statenetPane'),
        theme: page(THEME_APP, t['shell.view.theme'], VIEW_PLACEMENT, 'themePane'),
        logic: page(LOGIC_APP, t['shell.view.logic'], VIEW_PLACEMENT, 'logicPane')
    };
}

/**
 * The side panel: Magnetic's page magnetic-side in a live embeddedApp that fills the float. The app host opens it by
 * name and hands views.ts its panel; it stays mounted while hidden, so what it shows is kept
 */
function sidePanel(t: Texts): Record<string, unknown> {
    return float(SIDE_PLACEMENT, { page: { component: 'embeddedApp', app: SIDE_APP, live: true, fill: true, _label: t['views.side'] } }, { padding: 'none', hidden: true, '@id': 'sidePane' });
}

/**
 * The component library: right of the rail, below the corners, 288px wide and down to the bottom of the window less its
 * margin; while the centred chat bar (640px) would reach under it, below 1432px, it stops above the chat bar. Below 760px
 * a sheet across the bottom, as the inspector is
 */
const LIBRARY = {
    x: 'clamp(12px, (100vw - 760px) * 1000, 96px)',
    bottom: 'clamp(12px, (1432px - 100vw) * 1000, 100px)',
    y: 'clamp(76px, (760px - 100vw) * 1000, calc(55vh - 100px))',
    width: `clamp(${fit('288px')}, (760px - 100vw) * 1000, calc(100% - 24px))`
};
/** Below 1120px the chat bar reaches the zoom's corner, so the zoom sits above it */
const ABOVE_CHAT = 'clamp(12px, (1120px - 100vw) * 1000, 80px)';

/** A row inside a floating panel; a spacer that grows pushes what follows it to the end */
function row(children: Record<string, unknown>, extra: Record<string, unknown> = {}): Record<string, unknown> {
    return { component: 'panel', padding: 'none', layout: { type: 'row', gap: 'sm', align: 'center' }, children, ...extra };
}
const spacer = (): Record<string, unknown> => ({ component: 'panel', padding: 'none', placement: { grow: 1 }, children: {} });

/** Magnetic's logo, as the frame (which has no network) can show it */
const LOGO = `data:image/svg+xml;base64,${Buffer.from(LOGO_SVG).toString('base64')}`;

/** The row of a top corner: the gap between its parts as wide as the corner's own padding, so the spaces are even */
const CORNER_ROW = { layout: { type: 'row', gap: 'md', align: 'center' } };

/** The device of the frame: Desktop, Tablet or Phone; in the name corner, or below 760px on the top rail */
function frameSize(t: Texts, id: string, extra: Record<string, unknown>): Record<string, unknown> {
    return {
        component: 'selectField',
        size: 'sm',
        variant: 'soft',
        width: 'auto',
        titlePosition: 'hidden',
        _label: t['shell.frameSize'],
        options: { desktop: { _label: t['shell.size.desktop'] }, tablet: { _label: t['shell.size.tablet'] }, phone: { _label: t['shell.size.phone'] } },
        '<-value': e('size'),
        '@id': id,
        ...extra
    };
}

/** The frame's size among the common sizes of its device (the page writes them to `frames`), beside the device */
function frameDimensions(t: Texts, id: string, extra: Record<string, unknown>): Record<string, unknown> {
    return {
        component: 'selectField',
        size: 'sm',
        variant: 'soft',
        width: 'auto',
        titlePosition: 'hidden',
        _label: t['shell.frameDimensions'],
        '<-options': e('frames'),
        '<-value': e('frame'),
        '@id': id,
        ...extra
    };
}

/** The corner at the top left: Magnetic's logo (back to the apps), the app's name, the frame size, its turn and Open, on one line; below 760px only the logo, the name and Open */
function nameCorner(t: Texts): Record<string, unknown> {
    // Up to half the window, or all but the share corner when that is more; below 760px all but the share corner (its
    // bug, appearance and Share buttons, about 140px, and the gaps)
    return float({ x: '12px', y: '12px', maxWidth: 'clamp(calc(100% - 176px), (100vw - 760px) * 1000, max(calc(50% - 32px), calc(100% - 120px)))' }, {
        bar: row({
            home: { component: 'image', src: LOGO, _alt: t['shell.allApps'], interactive: true, backdrop: false, ratio: '1:1', fit: 'contain', placement: { height: '28px' }, '@id': 'home' },
            name: bound(e('appName'), { textRole: 'heading', truncate: 1, placement: { grow: 1 } }),
            // The workspace the app is in: the person's own, or an org's. Below 760px the corner has room only for the logo, the
            // name and Open, all on one line: the workspace and the frame size are on the top rail
            workspace: bound(e('workspaceName'), { textRole: 'caption', muted: true, truncate: 1, 'own:hidden': e('isNarrow') }),
            size: frameSize(t, 'size', { 'own:hidden': e('isNarrow') }),
            frame: frameDimensions(t, 'frame', { 'own:hidden': e('isNarrow') }),
            // Turns the frame between landscape and portrait: its width and height swap. Below 760px the corner has no room
            turn: icon(t['shell.turn'], 'turn', 'rotate-rectangle', { 'own:hidden': e('isNarrow') }),
            // Soft, so its box shows: every part of the bar is then a box with the same space either side
            open: button(t['shell.open'], 'open', { tone: 'accent', variant: 'soft' })
        }, { layout: { ...CORNER_ROW.layout, wrap: false } })
    });
}

/** The editor's views, in the order the selector shows them (docs/design/magnetic-show-views.md) */
export const EDITOR_VIEWS = ['screens', 'statenet', 'theme', 'logic'] as const;

/**
 * The corner at the top right: the view selector (a segmented control; below 760px a menu on the top rail instead),
 * the bug button (feedback), the person's choices and Share
 */
function shareCorner(t: Texts): Record<string, unknown> {
    return float({ right: '12px', y: '12px' }, {
        bar: row({
            views: { component: 'segmented', size: 'sm', _label: t['shell.view'], options: viewOptions(t), '<-value': e('view'), 'own:hidden': e('isNarrow'), '@id': 'views' },
            feedback: icon(t['feedback.open'], 'feedback', 'bug'),
            prefs: icon(t['prefs.open'], 'prefs', 'prefs'),
            share: { component: 'button', size: 'sm', _title: t['shell.share'], '@id': 'share' }
        }, CORNER_ROW)
    });
}

/** The views by name, for the selector */
const viewOptions = (t: Texts): Record<string, unknown> => Object.fromEntries(EDITOR_VIEWS.map((name) => [name, { _label: t[`shell.view.${name}`] }]));

/**
 * The rail at the left, in the Screens view: the pointer tools and panels, one above the other, a line, then the layers
 * the screen tiles show (layout, data, logic). Each is a button that is solid while on (`toolLook`, `layerLook`); a
 * press is heard as `tool` with the tool's name, or as the layer's `layer…` (ids `toolUse`…, `layerLayout`…, the narrow
 * rail's with `Top` after them, `EDITOR_HEARING`). Below 760px the page shows the same rail along the top
 * instead (`narrow`), led by the view menu, which stays there in the other views when the tools hide
 */
function rail(t: Texts, narrow = false): Record<string, unknown> {
    const top = narrow ? 'Top' : '';
    const tool = (name: 'use' | 'move' | 'select', key: 'shell.useKey' | 'shell.moveKey' | 'shell.selectKey', glyph: string): Record<string, unknown> => ({
        component: 'button',
        size: 'sm',
        icon: glyph,
        iconPosition: 'only',
        _title: t[key],
        'own:variant': e(`toolLook.${name}`),
        'own:tone': e(`toolTone.${name}`),
        '@id': `tool${name.charAt(0).toUpperCase()}${name.slice(1)}${top}`
    });
    const layer = (name: 'layout' | 'data' | 'logic', id: string): Record<string, unknown> => ({
        component: 'button',
        size: 'sm',
        fill: !narrow,
        _title: t[`shell.layer.${name}`],
        'own:variant': e(`layerLook.${name}`),
        'own:tone': e(`layerTone.${name}`),
        '@id': id + top
    });
    const line = narrow ? 'row' : 'column';
    // Below 760px, the rail's tools are the Screens view's; the view menu shows in every view
    const screensOnly = narrow ? { 'own:hidden': e('notScreensView') } : {};
    return float(narrow ? { x: '12px', y: '64px', maxWidth: 'calc(100% - 24px)' } : { x: '12px', center: 'y' }, {
        ...(narrow && {
            viewMenu: { component: 'selectField', size: 'sm', variant: 'soft', width: 'auto', titlePosition: 'hidden', _label: t['shell.view'], options: viewOptions(t), '<-value': e('view'), '@id': 'viewMenu' }
        }),
        tools: {
            ...screensOnly,
            component: 'panel',
            padding: 'none',
            layout: { type: line, gap: 'sm', align: 'center' },
            children: {
                use: tool('use', 'shell.useKey', 'pointer'),
                move: tool('move', 'shell.moveKey', 'hand'),
                select: tool('select', 'shell.selectKey', 'select'),
                // Solid while the library shows, as a tool is while it is on
                library: { component: 'button', size: 'sm', icon: 'components', iconPosition: 'only', _title: t['library.open'], 'own:variant': e('libraryLook'), 'own:tone': e('libraryTone'), '@id': 'library' + top },
                screens: { component: 'button', size: 'sm', icon: 'screens', iconPosition: 'only', _title: t['screens.open'], 'own:variant': e('screensLook'), 'own:tone': e('screensTone'), '@id': 'screensPanel' + top },
                connections: { component: 'button', size: 'sm', icon: 'connections', iconPosition: 'only', _title: t['connectionsPanel.open'], 'own:variant': e('connectionsLook'), 'own:tone': e('connectionsTone'), '@id': 'connectionsPanel' + top },
                shared: { component: 'button', size: 'sm', icon: 'shared-data', iconPosition: 'only', _title: t['sharedPanel.open'], 'own:variant': e('sharedLook'), 'own:tone': e('sharedTone'), '@id': 'sharedPanel' + top }
            }
        },
        line: { component: 'divider', orientation: narrow ? 'vertical' : 'horizontal', ...screensOnly },
        layersLabel: caption(t['shell.layers'], { caps: true, muted: true, align: 'center', ...screensOnly }),
        layers: {
            ...screensOnly,
            component: 'panel',
            padding: 'none',
            layout: { type: line, gap: 'sm', align: 'stretch' },
            children: { layerLayout: layer('layout', 'layerLayout'), layerData: layer('data', 'layerData'), layerLogic: layer('logic', 'layerLogic') }
        },
        // Below 760px the name corner has no room for the workspace and the frame size
        ...(narrow && { workspace: bound(e('workspaceName'), { textRole: 'caption', muted: true, truncate: 1 }), size: frameSize(t, 'sizeTop', screensOnly), frame: frameDimensions(t, 'frameTop', screensOnly) })
    // The divider and the Layers label get the room the buttons' own padding gives their icons, not the tools' tight gap
    }, narrow ? { hidden: true, '@id': 'narrowPane', layout: { type: 'row', gap: 'sm', align: 'center' } } : { hidden: false, '@id': 'widePane', layout: { type: 'column', gap: 'md' } });
}

/** The zoom at the bottom right, above the chat bar when the window is too narrow for both; hidden in the views without the board (Theme, Logic) */
function zoom(t: Texts): Record<string, unknown> {
    return float({ right: '12px', bottom: ABOVE_CHAT }, {
        bar: row({
            out: icon(t['shell.zoomOutKey'], 'zoomOut', 'minus'),
            reset: { component: 'button', size: 'sm', variant: 'ghost', tone: 'neutral', '<-_title': e('zoom'), '@id': 'zoomReset' },
            in: icon(t['shell.zoomInKey'], 'zoomIn', 'plus'),
            fit: icon(t['shell.fitKey'], 'zoomFit', 'fit')
        }, { layout: { type: 'row', gap: 'none', align: 'center' } })
    }, { 'own:hidden': e('noBoard') });
}

/** The chat bar at the bottom: what the next request is about, the request, the model and Send */
function chatBar(t: Texts): Record<string, unknown> {
    // The lines above the bar sit in from its rounded ends, as the old ones did (0.9rem)
    const line = (children: Record<string, unknown>, hidden: string): Record<string, unknown> =>
        row(children, { padding: 'md', theme: { panel: { padding: '0px 14px' } }, ...hiddenBy(hidden) });
    return float({ center: 'x', bottom: '12px', width: fit('640px') }, {
        status: line({ text: bound(e('status'), { textRole: 'caption', placement: { grow: 1 } }) }, e('noStatus')),
        // Each thing the next request is about is a chip with its own ×; Clear takes them all
        focus: line({
            about: { component: 'text', textRole: 'caption', _text: t['chat.about'] },
            chips: { component: 'chipList', size: 'sm', placement: { grow: 1 }, _label: t['chat.about'], '<-items': e('focusItems'), '@id': 'focusRemove' },
            clear: button(t['chat.clear'], 'focusClear')
        }, e('noFocus')),
        dataLine: line({ text: bound(e('dataLine'), { textRole: 'caption', placement: { grow: 1 } }) }, e('noDataLine')),
        bar: {
            component: 'panel',
            padding: 'none',
            // One line however narrow, as the old chat bar was: the request narrows, the buttons keep their size. Every
            // part is one height, so the row lines them up both at one line and, at the bottom, as the request grows
            layout: { type: 'row', gap: 'md', align: 'end', wrap: false },
            // The small controls of the bar are as tall as the request (36px), as the old bar's were, with icons to match
            theme: { size: { control: { sm: '{size.control.md}' }, icon: { sm: '{size.icon.md}' } } },
            children: {
                chat: icon(t['shell.showChat'], 'chatToggle', 'chat'),
                // What the view shown tells the agent with each request: fixed chips, the view and in Screens each layer on, as tall
                // as the bar's controls (a chip is three quarters of the control height)
                view: { component: 'chipList', size: 'md', tone: 'accent', theme: { size: { control: { md: '48px' } } }, removable: false, _label: t['chat.view'], '<-items': e('contextItems') },
                input: {
                    component: 'textareaField',
                    variant: 'ghost',
                    placement: { grow: 1 },
                    // Round at one line, like the bar around it, so its focus ring follows the bar's shape; the text sits in
                    // from the round ends, as the lines above it do
                    theme: { control: { radius: '18px', padding: { inline: '14px' } } },
                    _label: t['shell.request'],
                    _placeholder: t['shell.placeholder'],
                    titlePosition: 'hidden',
                    autoGrow: true,
                    rows: 1,
                    sendOnEnter: true,
                    // Off while the person may not ask the agent (their agent use is spent); the agent-use ring's tip says why
                    '<-disabled': e('chatOff'),
                    '@id': 'request',
                    on: { send: { command: 'clear' } }
                },
                // The person's agent use as a ring, used against the whole budget; its tip says what is used and left, or,
                // once it is spent, that they can carry on by hand
                budget: {
                    component: 'tooltip',
                    side: 'top',
                    delay: 0,
                    '<-_text': e('budgetLine'),
                    'own:hidden': e('noBudget'),
                    // A small dial, 24px across, in the middle of the bar's height (36px)
                    placement: { height: '36px' },
                    trigger: { component: 'progress', shape: 'ring', size: 'sm', theme: { size: { icon: { sm: '9.6px' } } }, _label: t['chat.budgetRing'], '<-value': e('budgetUsed'), '<-max': e('budgetTotal'), 'own:tone': e('budgetTone') }
                },
                model: { component: 'selectField', size: 'sm', variant: 'soft', corners: 'pill', width: 20, titlePosition: 'hidden', _label: t['shell.model'], '<-options': e('models'), '<-value': e('model'), 'own:hidden': e('noModels'), '@id': 'model' },
                send: { component: 'button', size: 'sm', corners: 'pill', _title: t['shell.send'], icon: 'send', iconPosition: 'only', '<-disabled': e('chatOff'), on: { press: { command: 'send', target: '#bar.children.input' } } }
            }
        }
        // A round end at one line (half its 50px height), and the same corners when the lines above it show, as the
        // old bar's 1.6rem: a pill would round a taller bar into a lozenge
    }, { theme: { panel: { radius: '25px' } } });
}

/** The chat above the bar: the conversation, and the agent's activity while it works */
function chatPanel(t: Texts): Record<string, unknown> {
    return float(
        { center: 'x', bottom: '76px', width: fit('640px'), height: 'min(480px, calc(100% - 176px))' },
        {
            head: row({ title: { component: 'text', textRole: 'label', placement: { grow: 1 }, _text: t['shell.chat'] }, close: icon(t['shell.closeChat'], 'chatClose', 'x') }),
            empty: caption(t['chat.empty'], { 'own:hidden': e('hasMessages') }),
            messages: { component: 'messageList', '<-records': '$.data.messages', 'own:hidden': e('noMessages'), placement: { grow: 1 } },
            drawer: {
                component: 'panel',
                padding: 'none',
                hidden: true, '@id': 'drawerPane',
                layout: { type: 'column', gap: 'sm' },
                children: {
                    head: row({
                        title: { component: 'text', textRole: 'label', placement: { grow: 1 }, _text: t['shell.activity'] },
                        keep: { component: 'switchField', size: 'sm', _label: t['shell.keepOpen'], '<-checked': e('keepOpen'), '@id': 'keepOpen' },
                        stop: { component: 'button', size: 'sm', variant: 'soft', tone: 'danger', _title: t['shell.stop'], 'own:hidden': e('notWorking'), '@id': 'stop' }
                    }),
                    note: bound(e('note'), { textRole: 'caption', truncate: 2 }),
                    calls: { component: 'list', '<-items': '$.data.calls', density: 'compact', placement: { height: '120px' }, row: { component: 'text', truncate: 1, textRole: 'caption', '<-_text': '$row.line' } }
                }
            }
        },
        { hidden: true, '@id': 'chatPane', layout: { type: 'column', gap: 'sm' } }
    );
}

/** Over a blank app's frame: what to do first, and ideas to start from */
function blankHint(t: Texts): Record<string, unknown> {
    const idea = (n: 1 | 2 | 3): Record<string, unknown> => ({ component: 'card', elevation: 'flat', padding: 'sm', interactive: true, _subtitle: t[`shell.idea${n}`], '@id': `idea${n}` });
    return float(
        { center: 'both', width: fit('480px') },
        {
            head: row({
                title: { component: 'text', textRole: 'heading', placement: { grow: 1 }, _text: t['shell.blankTitle'] },
                close: icon(t['shell.blankClose'], 'hintClose', 'x')
            }),
            text: caption(t['shell.blankText']),
            idea1: idea(1),
            idea2: idea(2),
            idea3: idea(3)
        },
        { hidden: true, '@id': 'hintPane', padding: 'md' }
    );
}

/** The Properties tab: the breadcrumb, what the selected node is, a field per property, and Delete */
function propertiesTab(t: Texts): Record<string, unknown> {
    return {
        component: 'panel',
        placement: { _tab: t['inspector.properties'] },
        padding: 'sm',
        layout: { type: 'column', gap: 'sm' },
        children: {
            crumbs: { component: 'breadcrumb', '<-items': e('crumbs'), '<-current': e('crumb'), 'own:hidden': e('noSelection'), '@id': 'crumb' },
            heading: bound(e('heading'), { textRole: 'label' }),
            // What to do with the selected node, above its fields so it is always in sight: give it to the agent with
            // the next request, or delete it
            actions: row({
                addToChat: { component: 'button', variant: 'soft', size: 'sm', icon: 'message-plus', _title: t['inspector.addToChat'], '@id': 'addToChat' },
                remove: { component: 'button', variant: 'soft', tone: 'danger', size: 'sm', 'own:hidden': e('cannotRemove'), _title: t['inspector.delete'], '@id': 'remove' }
            }, { 'own:hidden': e('noSelection') }),
            [EDITOR_KEYS.propertyFields]: { component: 'panel', padding: 'none', children: {} }
        }
    };
}

/**
 * The Connections panel, in the library's place beside the rail (the three take turns): the outside APIs of the app's
 * workspace and their endpoints, never a key. Pressing an endpoint asks the agent to show what it answers; Manage opens
 * the Connections page for those who manage the workspace's connections
 */
function connectionsPanel(t: Texts): Record<string, unknown> {
    return float(
        LIBRARY,
        {
            head: row({
                title: { component: 'text', textRole: 'label', placement: { grow: 1 }, _text: t['connectionsPanel.title'] },
                close: icon(t['connectionsPanel.close'], 'connectionsClose', 'x')
            }),
            hint: caption(t['connectionsPanel.hint']),
            status: bound(e('connectionsStatus'), { textRole: 'caption', muted: true, 'own:hidden': e('noConnectionsStatus') }),
            list: {
                component: 'list',
                '<-items': '$.data.connections',
                rowHeight: 'xl',
                placement: { grow: 1 },
                row: { component: 'card', elevation: 'flat', padding: 'sm', interactive: true, '<-_title': '$row.title', '<-_subtitle': '$row.subtitle', '@id': 'connectionAsk' }
            },
            manage: button(t['connectionsPanel.manage'], 'connectionsManage', { variant: 'soft', 'own:hidden': e('cannotManage') })
        },
        { hidden: true, '@id': 'connectionsPane' }
    );
}

/**
 * The Shared data panel, in the library's place too: the datasets other owners shared with the app's workspace, read
 * only, with who shared each and its fields. Pressing one asks the agent to show it in the app; Manage data opens the
 * Data page for those who manage the workspace
 */
function sharedPanel(t: Texts): Record<string, unknown> {
    return float(
        LIBRARY,
        {
            head: row({
                title: { component: 'text', textRole: 'label', placement: { grow: 1 }, _text: t['sharedPanel.title'] },
                close: icon(t['sharedPanel.close'], 'sharedClose', 'x')
            }),
            hint: caption(t['sharedPanel.hint']),
            status: bound(e('sharedStatus'), { textRole: 'caption', muted: true, 'own:hidden': e('noSharedStatus') }),
            list: {
                component: 'list',
                '<-items': '$.data.shared',
                rowHeight: 'xl',
                placement: { grow: 1 },
                row: { component: 'card', elevation: 'flat', padding: 'sm', interactive: true, '<-_title': '$row.title', '<-_subtitle': '$row.subtitle', '@id': 'sharedAsk' }
            },
            manage: button(t['sharedPanel.manage'], 'sharedManage', { variant: 'soft', 'own:hidden': e('cannotManageData') })
        },
        { hidden: true, '@id': 'sharedPane' }
    );
}

/**
 * The component library, a panel of its own beside the rail, shown when the editor opens on a wide window: find a
 * component by its words (narrowed as they are typed) or its category, then drag it onto the app, or press it and click
 * where it goes
 */
function library(t: Texts): Record<string, unknown> {
    return float(
        LIBRARY,
        {
            head: row({
                title: { component: 'text', textRole: 'label', placement: { grow: 1 }, _text: t['library.title'] },
                close: icon(t['library.close'], 'libraryClose', 'x')
            }),
            body: libraryBody(t)
        },
        { hidden: true, '@id': 'libraryPane' }
    );
}

/** The choices of how many screens the canvas lays side by side in a row */
export const SCREEN_COLUMNS = [1, 2, 3, 4, 5, 6, 8, 10] as const;

/**
 * The Screens panel, in the library's place beside the rail (the two take turns): the app's screens, the one worked
 * on marked, a new one by name, and what can be done to the one worked on. Each screen shows on the canvas as a frame
 * of its own; pressing one here or there makes it the screen the editor works on
 */
function screensPanel(t: Texts): Record<string, unknown> {
    const name = (id: string, label: string, valuePath: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
        component: 'textField',
        size: 'sm',
        _label: label,
        '<-value': valuePath,
        placement: { grow: 1 },
        '@id': id,
        ...extra
    });
    return float(
        LIBRARY,
        {
            head: row({
                title: { component: 'text', textRole: 'label', placement: { grow: 1 }, _text: t['screens.title'] },
                close: icon(t['screens.close'], 'screensClose', 'x')
            }),
            hint: caption(t['screens.pick']),
            columns: {
                component: 'selectField',
                size: 'sm',
                _label: t['screens.columns'],
                // keyed n1, n2…: a key may not be integer-like
                options: Object.fromEntries(SCREEN_COLUMNS.map((count) => [`n${count}`, { _label: String(count) }])),
                '<-value': e('screenColumns'),
                '@id': 'screenColumns'
            },
            list: {
                component: 'list',
                '<-items': '$.data.screens',
                rowHeight: 'xl',
                placement: { grow: 1 },
                row: { component: 'card', elevation: 'flat', padding: 'sm', interactive: true, '<-selected': '$row.current', '<-_title': '$row.title', '<-_subtitle': '$row.note', '@id': 'screenGo' }
            },
            add: row({ name: name('screenNew', t['screens.new'], e('screenNew'), { _placeholder: t['screens.newPlaceholder'] }), go: button(t['screens.add'], 'screenAdd', { variant: 'soft', tone: 'accent' }) }, { layout: { type: 'row', gap: 'sm', align: 'end' } }),
            thisTitle: { component: 'text', textRole: 'label', _text: t['screens.this'] },
            rename: row({ name: name('screenRenameText', t['screens.rename'], e('screenRename')), go: button(t['screens.rename'], 'screenRename', { variant: 'soft' }) }, { layout: { type: 'row', gap: 'sm', align: 'end' } }),
            actions: row({
                copy: button(t['screens.copy'], 'screenCopy', { variant: 'soft' }),
                home: button(t['screens.makeHome'], 'screenHome', { variant: 'soft', 'own:hidden': e('isHome') }),
                isHome: caption(t['screens.isHome'], { muted: true, 'own:hidden': e('notHome') }),
                remove: button(t['screens.delete'], 'screenDelete', { variant: 'soft', tone: 'danger' })
            }, { layout: { type: 'row', gap: 'sm', align: 'center', wrap: true } }),
            status: bound(e('screensStatus'), { textRole: 'caption', tone: 'danger', 'own:hidden': e('noScreensStatus') })
        },
        { hidden: true, '@id': 'screensPane' }
    );
}

function libraryBody(t: Texts): Record<string, unknown> {
    return {
        component: 'panel',
        padding: 'none',
        placement: { grow: 1 },
        layout: { type: 'column', gap: 'sm' },
        children: {
            search: { component: 'searchBox', size: 'sm', _label: t['inspector.find'], _placeholder: t['inspector.find'], value: '', '@id': 'search' },
            category: {
                component: 'selectField',
                size: 'sm',
                _label: t['inspector.category'],
                options: Object.fromEntries([['all', { _label: t['inspector.all'] }], ...COMPONENT_CATEGORIES.map((name) => [name, { _label: t[`inspector.cat.${name}`] }])]),
                value: 'all',
                '@id': 'category'
            },
            hint: caption(t['inspector.pick']),
            cards: {
                component: 'list',
                '<-items': '$.data.components',
                rowHeight: 'xl',
                placement: { grow: 1 },
                _empty: t['inspector.noMatch'],
                // A drag source: the card holds the pointer and says where it is, so the page sees the drag cross out of
                // the editor's frame (which covers the window) onto the canvas, and takes the drop. Rows have one fixed
                // height, so the summary keeps to one line: a second ran into the next card
                row: {
                    component: 'card',
                    elevation: 'flat',
                    padding: 'sm',
                    interactive: true,
                    draggable: true,
                    layout: { type: 'column', gap: 'none' },
                    children: {
                        name: { component: 'text', textRole: 'label', truncate: 1, '<-_text': '$row.name' },
                        summary: { component: 'text', textRole: 'caption', truncate: 1, muted: true, '<-_text': '$row.summary' }
                    },
                    '@id': 'libraryCard'
                }
            }
        }
    };
}

/** The State tab: `$.data` as a tree, what uses the chosen path, and the changes as they happen */
function stateTab(t: Texts): Record<string, unknown> {
    return {
        component: 'panel',
        placement: { _tab: t['inspector.state'] },
        padding: 'sm',
        layout: { type: 'column', gap: 'sm' },
        children: {
            paths: { component: 'tree', '<-records': '$.data.paths', selectable: 'single', density: 'compact', placement: { height: 'calc(100vh - 520px)' }, '@id': 'path' },
            detail: {
                component: 'panel',
                padding: 'none',
                'own:hidden': e('noDetail'),
                layout: { type: 'column', gap: 'sm' },
                children: {
                    path: bound(e('detailPath'), { textRole: 'label' }),
                    value: bound(e('detailValue'), { textRole: 'caption' }),
                    shown: bound(e('detailShown'), { textRole: 'caption' }),
                    read: bound(e('detailRead'), { textRole: 'caption' }),
                    written: bound(e('detailWritten'), { textRole: 'caption' }),
                    ask: { component: 'button', size: 'sm', variant: 'soft', _title: t['inspect.ask'], '@id': 'ask' }
                }
            },
            feedTitle: { component: 'text', textRole: 'label', _text: t['inspector.changes'] },
            feed: { component: 'list', '<-items': '$.data.feed', density: 'compact', placement: { height: '140px' }, _empty: t['inspector.noChanges'], row: { component: 'text', truncate: 1, textRole: 'caption', '<-_text': '$row.line' } }
        }
    };
}

/** The inspector at the right: its title and close button, what it is doing, and its two tabs, Properties and State (the library is a panel of its own) */
function inspector(t: Texts): Record<string, unknown> {
    return float(
        INSPECTOR,
        {
            head: row({
                title: { component: 'text', textRole: 'label', _text: t['shell.inspector'] },
                status: bound(e('inspectorStatus'), { textRole: 'caption', truncate: 1, placement: { grow: 1 } }),
                close: icon(t['shell.closeInspector'], 'inspectorClose', 'x')
            }),
            // The tabs take the inspector's height below its head, and the open tab scrolls
            tabs: { component: 'tabs', placement: { grow: 1 }, '<-active': e('tab'), '@id': 'tab', children: { properties: propertiesTab(t), state: stateTab(t) } }
        },
        { hidden: true, '@id': 'inspectorPane' }
    );
}

/**
 * Share, under its button: for an app in an org, whether everyone in the org may open and use it (org public); who may
 * do what with a new link; and the links made, each with Copy and Revoke
 */
function shareSheet(t: Texts): Record<string, unknown> {
    return float(
        { right: '12px', y: BELOW_RAIL, width: fit('352px') },
        {
            head: row({ title: { component: 'text', textRole: 'label', placement: { grow: 1 }, _text: t['shell.shareThis'] }, close: icon(t['editor.close'], 'shareClose', 'x') }),
            org: { component: 'switchField', size: 'sm', _label: t['shell.orgOpen'], '<-checked': e('orgOpen'), 'own:hidden': e('notInOrg'), '@id': 'orgOpen' },
            make: {
                component: 'panel',
                padding: 'none',
                layout: { type: 'row', gap: 'sm', align: 'end' },
                children: {
                    right: {
                        component: 'selectField',
                        size: 'sm',
                        placement: { grow: 1 },
                        _label: t['shell.shareCan'],
                        options: { use: { _label: t['shell.right.use'] }, view: { _label: t['shell.right.view'] }, remix: { _label: t['shell.right.remix'] } },
                        '<-value': e('shareRight'),
                        '@id': 'shareRight'
                    },
                    make: { component: 'button', size: 'sm', _title: t['shell.makeLink'], '@id': 'shareMake' }
                }
            },
            note: caption(t['shell.shareNote']),
            status: bound(e('shareStatus'), { textRole: 'caption' }),
            links: {
                component: 'list',
                '<-items': '$.data.links',
                divided: true,
                rowHeight: 'xl',
                placement: { height: '200px' },
                _empty: t['share.none'],
                row: row({
                    text: {
                        component: 'panel',
                        padding: 'none',
                        placement: { grow: 1 },
                        layout: { type: 'column', gap: 'none' },
                        children: { title: { component: 'text', textRole: 'label', '<-_text': '$row.title' }, note: { component: 'text', textRole: 'caption', truncate: 1, '<-_text': '$row.note' } }
                    },
                    copy: { component: 'button', size: 'sm', variant: 'soft', _title: t['share.copy'], '<-hidden': '$row.revoked', '@id': 'linkCopy' },
                    revoke: { component: 'button', size: 'sm', variant: 'ghost', tone: 'danger', _title: t['share.revoke'], '<-hidden': '$row.revoked', '@id': 'linkRevoke' }
                })
            }
        },
        { hidden: true, '@id': 'sharePane', padding: 'md' }
    );
}

/** The person's choices, under their button: light, dark or the system's, and the language Magnetic speaks */
function prefsSheet(t: Texts): Record<string, unknown> {
    return float(
        { right: '12px', y: BELOW_RAIL, width: fit('240px') },
        {
            head: row({ title: { component: 'text', textRole: 'label', placement: { grow: 1 }, _text: t['prefs.title'] }, close: icon(t['editor.close'], 'prefsClose', 'x') }),
            mode: { component: 'selectField', size: 'sm', _label: t['prefs.mode'], options: Object.fromEntries(MODES.map((mode) => [mode, { _label: t[`prefs.${mode}`] }])), '<-value': e('mode'), '@id': 'mode' },
            language: { component: 'selectField', size: 'sm', _label: t['prefs.language'], options: Object.fromEntries(LANGUAGES.map((language) => [language, { _label: LANGUAGE_NAMES[language] }])), '<-value': e('language'), '@id': 'language' },
            status: bound(e('prefsStatus'), { textRole: 'caption' })
        },
        { hidden: true, '@id': 'prefsPane', padding: 'md' }
    );
}

/**
 * Feedback, under the bug button: a bug, a comment or a feature request, in the person's words, sent to whoever runs
 * the server with the app's name, the frame size and the browser
 */
function feedbackSheet(t: Texts): Record<string, unknown> {
    return float(
        { right: '12px', y: BELOW_RAIL, width: fit('352px') },
        {
            head: row({ title: { component: 'text', textRole: 'label', placement: { grow: 1 }, _text: t['feedback.title'] }, close: icon(t['editor.close'], 'feedbackClose', 'x') }),
            kind: {
                component: 'selectField',
                size: 'sm',
                _label: t['feedback.kind'],
                options: { bug: { _label: t['feedback.kind.bug'] }, comment: { _label: t['feedback.kind.comment'] }, feature: { _label: t['feedback.kind.feature'] } },
                '<-value': e('feedbackKind'),
                '@id': 'feedbackKind'
            },
            text: {
                component: 'textareaField',
                size: 'sm',
                rows: 5,
                maxLength: 4000,
                _label: t['feedback.text'],
                _placeholder: t['feedback.placeholder'],
                '<-value': e('feedbackText'),
                '@id': 'feedbackText'
            },
            note: caption(t['feedback.note'], { muted: true }),
            send: row({ status: bound(e('feedbackStatus'), { textRole: 'caption', placement: { grow: 1 } }), send: button(t['feedback.send'], 'feedbackSend', { variant: 'solid', tone: 'accent' }) })
        },
        { hidden: true, '@id': 'feedbackPane', padding: 'md' }
    );
}

/**
 * The editor's screen: a stage as big as the window, whose children float at their places (the adhoc layout holds each
 * to its edges): first the canvas's pages, then over them the name corner, the Share corner, the rail, the zoom, the chat bar and the chat,
 * the inspector, the two sheets, the blank app's hint and the notice. The stage and the screen let a press anywhere
 * else through to the canvas (`passThrough`)
 */
function editorScreen(t: Texts): Record<string, unknown> {
    return {
        component: 'panel',
        padding: 'none',
        passThrough: true,
        layout: { type: 'column', gap: 'none' },
        children: {
            [EDITOR_KEYS.stage]: {
                component: 'panel',
                padding: 'none',
                passThrough: true,
                placement: { height: 'calc(100vh - 2px)' },
                layout: { type: 'adhoc' },
                children: {
                    ...canvasPages(t),
                    nameCorner: nameCorner(t),
                    shareCorner: shareCorner(t),
                    rail: rail(t),
                    railTop: rail(t, true),
                    zoom: zoom(t),
                    hint: blankHint(t),
                    chat: chatPanel(t),
                    chatBar: chatBar(t),
                    library: library(t),
                    screens: screensPanel(t),
                    connections: connectionsPanel(t),
                    shared: sharedPanel(t),
                    side: sidePanel(t),
                    inspector: inspector(t),
                    share: shareSheet(t),
                    prefs: prefsSheet(t),
                    feedback: feedbackSheet(t),
                    notice: float({ center: 'x', y: '12px', width: fit('480px') }, { text: bound(e('notice'), { tone: 'danger' }) }, { 'own:hidden': e('noNotice') })
                }
            }
        }
    };
}

/** The editor's definition, in English: the other languages are written over it as locales */
function definition(): Record<string, unknown> {
    const t = textsOf('en');
    const data = {
        ...Object.fromEntries(Object.keys(RECORDS).map((namespace) => [namespace, { model: modelOf(namespace), scope: 'person' }])),
        messages: { model: 'magnetic-message', scope: 'person' },
        calls: { model: 'magnetic-call', scope: 'person' },
        links: { model: 'magnetic-link', scope: 'person' },
        components: { model: 'inspector-component', scope: 'person' },
        screens: { model: 'magnetic-screen', scope: 'person' },
        connections: { model: 'magnetic-connection', scope: 'person' },
        shared: { model: 'magnetic-connection', scope: 'person' },
        paths: { model: 'inspector-path', scope: 'person' },
        feed: { model: 'inspector-change', scope: 'person' }
    };
    return { title: t['editor.title'], data, icons: EDITOR_ICONS, app: { seeThrough: true }, home: editorScreen(t) };
}

/** The editor as a page of Magnetic's, which a person's copy and an admin's draft are made from */
const SPEC: PageSpec = pageSpec({
    records: Object.keys(RECORDS).map((namespace) => ({ path: `$.data.${namespace}`, model: modelOf(namespace) })),
    name: EDITOR_APP,
    title: 'The editor',
    themed: true,
    required: ['request', 'home'],
    keys: [EDITOR_KEYS.stage, EDITOR_KEYS.propertyFields],
    models: MODELS,
    definition
});

/** The editor: its panes' flags go to the panes by id, as the other fields that are a node's own state do */
export const EDITOR: PageSpec = {
    ...SPEC,
    own: { ...SPEC.own, ...Object.fromEntries(Object.entries(EDITOR_PANES).map(([flag, id]) => [e(flag), [`${id}.hidden`]])) }
};

/** The editor's assembled document and icons, as a page mounts it */
export interface EditorDocument {
    readonly id: string;
    readonly document: Record<string, unknown>;
    readonly icons: Record<string, string>;
}

/**
 * Each person's editor: an app in their own workspace (`magnetic-editor`), made from Magnetic's version the first time
 * they edit, and made again when Magnetic's changes, unless they changed theirs (`PersonPages`). They open it in the
 * editor like any app, and reset it to Magnetic's
 */
export class EditorApps extends PersonPages {
    constructor(
        toolsOf: (services: Services) => readonly UiToolDefinition[],
        /** Where the version of each person's editor, and the revision Magnetic left it at, is kept */
        stamps: Stamps,
        /** Keeps two servers from making the same person's editor at once */
        exclusive: Exclusive = alone,
        source: () => PageSource = () => CODE_SOURCE
    ) {
        super(EDITOR, 'editor', toolsOf, stamps, source, exclusive);
    }

    /** A person's editor as the page mounts it */
    async document(services: Services, userId: string): Promise<EditorDocument> {
        const id = await this.id(services, userId);
        const app = await services.instanceViews.find(id);
        if (app === undefined) throw new Error('The editor app is gone');
        const message = await services.instanceViews.message(app, 'attach');
        return { id, document: message.document as Record<string, unknown>, icons: { ...message.icons } };
    }
}
