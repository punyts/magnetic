import { textsOf } from '../http/text.js';
import type { PageSpec } from '../pages/PageSpec.js';
import { hearingIds } from '../http/raised.js';
import type { Hearing } from '../http/raised.js';

/** The app name of the screens board's page, in every workspace that has it */
export const SCREENS_APP = 'magnetic-screens';

/**
 * The node the page finds by its key wherever it is: the viewport, whose commands the editor's zoom runs. Its `content`
 * is the board, whose `theme` the page writes with the tile size
 */
export const SCREENS_KEYS = { canvas: 'canvas' } as const;

const S = '$.data.screens';

/** What the page script hears of the screens board (src/http/raised.ts) */
export const SCREENS_HEARING: Hearing = {
    'headMore.press': { name: 'menu', from: 'row.id' },
    'cornerMore.press': { name: 'menu', from: 'row.id' },
    'close.press': { name: 'deselect', from: 'row.id' },
    'app.press': { name: 'press' },
    'app.menu': { name: 'menu' },
    'app.navigated': { name: 'navigated' },
    'add.press': { name: 'add' },
    'canvas.change': { name: 'view' },
    'canvas.press': { name: 'canvas' },
    'board.move': { name: 'move' }
};
const field = (name: string, type: string, value: unknown): Record<string, unknown> => ({ op: 'set', field: name, type, default: value });

/**
 * One card of the board, drawn for each record of `tiles`: the screen's title, its size and its ⋯ above the app on
 * that screen, the live one or a preview. In names the head goes (`noHead`) and the app shows only its name (it is not
 * active), and a corner over the screen's top right holds its ⋯ (`noMore`) and, for the screen chosen in names, a ×
 * that lets it go (`noClose`). The one tile of an app with no screens is Add a screen (`add`). The card fills its
 * row, gap included; it passes a press through and paints nothing, and holds the tile, which is as tall as its head
 * and screen, so the gap shows the canvas
 */
function tile(addFirst: string): Record<string, unknown> {
    const tool = (icon: string, label: string, size: string, hidden: string | undefined, id: string): Record<string, unknown> => ({
        component: 'button',
        icon,
        iconPosition: 'only',
        size,
        variant: size === 'lg' ? 'soft' : 'ghost',
        tone: 'neutral',
        '<-_title': label,
        ...(hidden !== undefined && { '<-hidden': hidden }),
        '@id': id
    });
    return {
        component: 'panel',
        padding: 'none',
        passThrough: true,
        layout: { type: 'adhoc' },
        children: {
            tile: {
                component: 'panel',
                padding: 'none',
                placement: { x: '0px', y: '0px', width: '100%' },
                layout: { type: 'column', gap: 'sm' },
                children: {
                    // Its title and ⋯ stand in from the screen's edges by the board's panel padding (EDGE in screens.ts), which has no height
                    head: {
                        component: 'panel',
                        padding: 'md',
                        '<-hidden': '$row.noHead',
                        layout: { type: 'row', gap: 'sm', align: 'center' },
                        children: {
                            title: { component: 'text', textRole: 'title', '<-_text': '$row.title' },
                            note: { component: 'text', textRole: 'caption', muted: true, placement: { grow: 1 }, '<-_text': '$row.note' },
                            more: tool('dots', '$row.moreLabel', 'md', undefined, 'headMore')
                        }
                    },
                    app: {
                        component: 'embeddedApp',
                        '<-app': '$row.app',
                        '<-appScreen': '$row.id',
                        '<-live': '$row.live',
                        '<-active': '$row.active',
                        '<-width': '$row.width',
                        '<-height': '$row.height',
                        '<-_label': '$row.title',
                        '<-hidden': '$row.add',
                        '@id': 'app'
                    },
                    add: {
                        component: 'button',
                        icon: 'plus',
                        variant: 'outline',
                        _title: addFirst,
                        '<-hidden': '$row.noAdd',
                        '@id': 'add'
                    }
                }
            },
            // Over the screen's top right, in names, where the head is gone: its buttons are a size of the board's and it
            // stands in from the screen's edges by EDGE, so they shrink with the card as the board zooms out
            corner: {
                component: 'panel',
                padding: 'none',
                passThrough: true,
                '<-hidden': '$row.noMore',
                placement: { right: '24px', y: '24px' },
                layout: { type: 'row', gap: 'sm', align: 'center' },
                children: {
                    more: tool('dots', '$row.moreLabel', 'lg', '$row.noMore', 'cornerMore'),
                    close: tool('x', '$row.closeLabel', 'lg', '$row.noClose', 'close')
                }
            }
        }
    };
}

/**
 * The screens board as a page of Magnetic's (docs/design/magnetic-screens-board.md): every screen of the app on a canvas
 * that pans and zooms, in rows, the screen worked on live and the others previews of it. The page script
 * (`screens.ts`) drives it through `$.data.screens` and hears it through the ids of its nodes only (`SCREENS_HEARING`):
 *
 * - It writes `tiles` (one record per screen: `id` the screen's name, `app`, `title`, `note`, `live`, `active`, `width`,
 *   `height`, its place in the rows as `column` and `row`, and the look of its head), `lanes` (the board's columns, one
 *   per place in a row), `view` ({ x, y, zoom }, linked to the viewport), `names` (the cards show only their names and
 *   can be dragged) and `inset` (what the editor's panels cover). It writes the theme of the viewport's `content`, the board, with the tile size.
 * - It hears `press` and `menu` for a tile ({ app, screen }, or the screen's name from its ⋯), `navigated` when the
 *   live app moves itself ({ screen }), `move` when a card is dragged to another place ({ key, from, to, index }),
 *   `deselect` from the × of the screen chosen in names, `add` from Add a screen, `view` with the view once a pan or
 *   zoom ends, and `canvas` for a press on the empty canvas.
 * - The editor's zoom runs the commands of the node keyed `canvas` (`SCREENS_KEYS`), wherever it is.
 */
export const SCREENS: PageSpec = {
    name: SCREENS_APP,
    title: 'Screens',
    themed: true,
    required: hearingIds(SCREENS_HEARING),
    keys: [SCREENS_KEYS.canvas],
    sample: {
        [S]: {
            tiles: [
                { id: 'home', app: '', title: 'Home', note: '1280 × 800', live: true, active: true, width: 1280, height: 800, column: 'c0', row: 0, add: false, noAdd: true, noHead: false, noMore: true, noClose: true, moreLabel: '', closeLabel: '' },
                { id: 'cart', app: '', title: 'Cart', note: '', live: false, active: false, width: 1280, height: 800, column: 'c1', row: 0, add: false, noAdd: true, noHead: false, noMore: true, noClose: true, moreLabel: '', closeLabel: '' }
            ],
            lanes: { c0: { _title: '' }, c1: { _title: '' } }
        }
    },
    models: {
        [SCREENS_APP]: [
            field('tiles', 'array', []),
            field('lanes', 'object', {}),
            field('view', 'object', { x: 0, y: 0, zoom: 1 }),
            field('names', 'boolean', false),
            field('inset', 'object', { top: 0, right: 0, bottom: 0, left: 0 })
        ]
    },
    definition: () => {
        const t = textsOf('en');
        return {
            title: t['screens.board'],
            data: { screens: { model: SCREENS_APP, scope: 'person' } },
            home: {
                component: 'panel',
                padding: 'none',
                layout: { type: 'column', gap: 'none' },
                children: {
                    [SCREENS_KEYS.canvas]: {
                        component: 'viewport',
                        grid: true,
                        // The window less the borders around it: the editor's stage, the page's frame and its own panel
                        placement: { height: 'calc(100vh - 7px)' },
                        _label: t['screens.canvas'],
                        '<-x': `${S}.view.x`,
                        '<-y': `${S}.view.y`,
                        '<-zoom': `${S}.view.zoom`,
                        '<-inset': `${S}.inset`,
                        '@id': 'canvas',
                        content: {
                            component: 'board',
                            key: 'id',
                            columnField: 'column',
                            orderField: 'row',
                            labelField: 'title',
                            bare: true,
                            '<-columns': `${S}.lanes`,
                            '<-records': `${S}.tiles`,
                            '<-movable': `${S}.names`,
                            card: tile(t['screens.addFirst']),
                            '@id': 'board'
                        }
                    }
                }
            }
        };
    }
};
