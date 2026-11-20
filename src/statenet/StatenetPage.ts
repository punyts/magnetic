import { textsOf } from '../http/text.js';
import type { PageSpec } from '../pages/PageSpec.js';

/** The app name of Statenet's page, in every workspace that has it */
export const STATENET_APP = 'magnetic-statenet';

/** The node the page finds by its key wherever it is: the viewport, whose commands the editor's zoom runs */
export const STATENET_KEYS = { canvas: 'canvas' } as const;

const N = '$.data.statenet';

const emit = (target: string, from?: string): Record<string, unknown> => ({ command: 'emit', target, ...(from !== undefined && { from }) });
const field = (name: string, type: string, value: unknown): Record<string, unknown> => ({ op: 'set', field: name, type, default: value });

/**
 * One card of the tree, drawn for each record of `nodes`: the record says how it looks. A branch, the owner and the
 * "N more" pill are pills (`corners`), a part is a raised card with its kind above its label and note, flat when the app
 * does not use it, with its label muted; the app being edited is selected (`current`). A + adds under the record and is
 * named by it (`addLabel`)
 */
function card(): Record<string, unknown> {
    return {
        component: 'card',
        padding: 'sm',
        density: 'compact',
        '<-corners': '$row.corners',
        '<-elevation': '$row.elevation',
        '<-selected': '$row.current',
        layout: { type: 'row', gap: 'sm', align: 'center' },
        children: {
            body: {
                component: 'panel',
                padding: 'none',
                placement: { grow: 1 },
                layout: { type: 'column', gap: 'none' },
                children: {
                    kind: { component: 'text', textRole: 'caption', tone: 'accent', caps: true, '<-_text': '$row.kind', '<-hidden': '$row.noKind' },
                    label: { component: 'text', textRole: 'label', '<-_text': '$row.label', '<-muted': '$row.muted' },
                    note: { component: 'text', textRole: 'caption', muted: true, '<-_text': '$row.note', '<-hidden': '$row.noNote' }
                }
            },
            add: {
                component: 'button',
                icon: 'plus',
                iconPosition: 'only',
                size: 'sm',
                variant: 'ghost',
                corners: 'pill',
                tone: 'accent',
                '<-_title': '$row.addLabel',
                '<-hidden': '$row.noAdd',
                on: { press: emit('add', '$row.id') }
            }
        }
    };
}

/**
 * Statenet as a page of Magnetic's (docs/design/magnetic-statenet-diagram.md): the owner's tree on a canvas that pans and
 * zooms. The page script (`views.ts`) drives it through `$.data.statenet` and its emits only:
 *
 * - It writes `nodes` (one record per card: `id`, `parent`, `wrap`, the texts and the look), `links` (the edges across
 *   the tree), `selected`, `view` ({ x, y, zoom }, linked to the viewport) and `inset` (what its panels cover).
 * - The page emits `select` and `open` ({ id, box }) for a card, `add` with a record's id for its +, `press` for a press
 *   on the empty canvas, `view` with the view once a pan or zoom ends, and `layout` once the cards are placed.
 * - The editor's zoom runs the commands of the node keyed `canvas` (`STATENET_KEYS`), wherever it is.
 */
export const STATENET: PageSpec = {
    name: STATENET_APP,
    title: 'Statenet',
    themed: true,
    required: ['select', 'open', 'add', 'view', 'layout'],
    keys: [STATENET_KEYS.canvas],
    sample: {
        [N]: {
            nodes: [
                { id: '$', parent: '', label: '$', kind: '', note: '', noKind: true, noNote: true, noAdd: true, addLabel: '', corners: 'pill', elevation: 'flat', current: false, muted: false, wrap: false },
                { id: '$.apps', parent: '$', label: 'apps', kind: '', note: '', noKind: true, noNote: true, noAdd: false, addLabel: 'Add to $.apps', corners: 'pill', elevation: 'flat', current: false, muted: false, wrap: false },
                { id: '$.apps.shop', parent: '$.apps', label: 'Shop', kind: 'App', note: 'The authority', noKind: false, noNote: false, noAdd: true, addLabel: '', corners: 'rounded', elevation: 'raised', current: true, muted: false, wrap: false },
                { id: '$.data', parent: '$', label: 'data', kind: '', note: '', noKind: true, noNote: true, noAdd: false, corners: 'pill', elevation: 'flat', current: false, muted: false, wrap: false },
                { id: '$.data.orders', parent: '$.data', label: 'orders', kind: 'Dataset', note: 'Unused', noKind: false, noNote: false, noAdd: true, addLabel: '', corners: 'rounded', elevation: 'flat', current: false, muted: true, wrap: false }
            ],
            links: [{ from: '$.apps.shop', to: '$.data.orders', kind: 'binding', label: 'Shop binds orders' }]
        }
    },
    models: {
        [STATENET_APP]: [
            field('nodes', 'array', []),
            field('links', 'array', []),
            field('selected', 'string', ''),
            field('view', 'object', { x: 0, y: 0, zoom: 1 }),
            field('inset', 'object', { top: 0, right: 0, bottom: 0, left: 0 })
        ]
    },
    definition: () => {
        const t = textsOf('en');
        return {
            title: t['shell.view.statenet'],
            data: { statenet: { model: STATENET_APP, scope: 'persona' } },
            home: {
                component: 'panel',
                padding: 'none',
                layout: { type: 'column', gap: 'none' },
                children: {
                    [STATENET_KEYS.canvas]: {
                        component: 'viewport',
                        grid: true,
                        placement: { height: 'calc(100vh - 0px)' },
                        _label: t['statenet.canvas'],
                        '<-x': `${N}.view.x`,
                        '<-y': `${N}.view.y`,
                        '<-zoom': `${N}.view.zoom`,
                        '<-inset': `${N}.inset`,
                        on: { change: emit('view'), press: emit('press') },
                        content: {
                            component: 'treeDiagram',
                            _label: t['shell.view.statenet'],
                            twoSided: true,
                            columns: 2,
                            leafBlock: 420,
                            '<-nodes': `${N}.nodes`,
                            '<-links': `${N}.links`,
                            '<-selected': `${N}.selected`,
                            card: card(),
                            on: { select: emit('select'), open: emit('open'), layout: emit('layout') }
                        }
                    }
                }
            }
        };
    }
};
