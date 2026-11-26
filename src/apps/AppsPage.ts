import { textsOf } from '../http/text.js';
import type { PageSpec } from '../pages/PageSpec.js';
import { hearingIds } from '../http/raised.js';
import type { Hearing } from '../http/raised.js';

/** The app name of the board of a workspace's apps, in every workspace that has it */
export const APPS_APP = 'magnetic-apps';

/** The node the page finds by its key wherever it is: the viewport, whose `content` is the board */
export const APPS_KEYS = { canvas: 'canvas' } as const;

const A = '$.data.apps';

/** What the page script hears of the board (src/http/raised.ts) */
export const APPS_HEARING: Hearing = {
    'canvas.change': { name: 'view' },
    'canvas.press': { name: 'canvas' },
    'card.press': { name: 'press', from: 'row.id' }
};
const field = (name: string, type: string, value: unknown): Record<string, unknown> => ({ op: 'set', field: name, type, default: value });

/**
 * The apps of a workspace as a board, one level out from an app's screens (docs/design/magnetic-zoom.md, stage 3):
 * every app the person may open there is a card on a canvas that pans and zooms, in rows. The page script (`apps.ts`)
 * drives it through `$.data.apps` and hears it through the ids of its nodes only (`APPS_HEARING`):
 *
 * - It writes `tiles` (one record per app: `id`, `title`, `note`, `selected`, its place in the rows as `column` and
 *   `row`), `lanes` (the board's columns, one per place in a row), `view` ({ x, y, zoom }, linked to the viewport) and
 *   `filled` (some app is there; false shows that none is). It writes the theme of the viewport's `content`, the board, with the card size.
 * - It hears a press of a card (`card`, the app's id from its row), the view once a pan or zoom ends (`canvas`'s
 *   change) and a press on the empty canvas (`canvas`).
 */
export const APPS: PageSpec = {
    name: APPS_APP,
    title: 'Apps',
    themed: true,
    required: hearingIds(APPS_HEARING),
    keys: [APPS_KEYS.canvas],
    sample: {
        [A]: {
            tiles: [
                { id: 'a', title: 'Field notes', note: 'Changed 23 Nov 2026', selected: true, column: 'c0', row: 0 },
                { id: 'b', title: 'Orders', note: 'Changed 20 Nov 2026', selected: false, column: 'c1', row: 0 }
            ],
            lanes: { c0: { _title: '' }, c1: { _title: '' } },
            filled: true
        }
    },
    models: {
        [APPS_APP]: [
            field('tiles', 'array', []),
            field('lanes', 'object', {}),
            field('view', 'object', { x: 0, y: 0, zoom: 1 }),
            field('filled', 'boolean', true)
        ]
    },
    definition: () => {
        const t = textsOf('en');
        return {
            title: t['apps.board'],
            data: { apps: { model: APPS_APP, scope: 'person' } },
            home: {
                component: 'panel',
                padding: 'none',
                layout: { type: 'column', gap: 'none' },
                children: {
                    none: { component: 'text', muted: true, _text: t['apps.none'], '<-hidden': `${A}.filled` },
                    [APPS_KEYS.canvas]: {
                        component: 'viewport',
                        grid: true,
                        // The window less the level bar over it
                        placement: { height: 'calc(100vh - 2.25rem)' },
                        _label: t['apps.canvas'],
                        '@id': 'canvas',
                        '<-x': `${A}.view.x`,
                        '<-y': `${A}.view.y`,
                        '<-zoom': `${A}.view.zoom`,
                        content: {
                            component: 'board',
                            key: 'id',
                            columnField: 'column',
                            orderField: 'row',
                            labelField: 'title',
                            bare: true,
                            movable: false,
                            '<-columns': `${A}.lanes`,
                            '<-records': `${A}.tiles`,
                            card: {
                                component: 'card',
                                interactive: true,
                                '<-selected': '$row.selected',
                                '<-_title': '$row.title',
                                '<-_subtitle': '$row.note',
                                '@id': 'card'
                            }
                        }
                    }
                }
            }
        };
    }
};
