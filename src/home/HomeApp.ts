import { pageSpec } from '../pages/PageSpec.js';
import { ownWrites, pathOfId } from '../pages/own.js';
import type { Authority } from '@punyts/state-sync/authority';
import type { Services, UiToolDefinition } from '@punyts/stateui-mcp';
import { LANGUAGE_NAMES, LANGUAGES, MODES } from '../prefs/Preferences.js';
import type { Preferences } from '../prefs/Preferences.js';
import { fill, textsOf } from '../http/text.js';
import type { Texts } from '../http/text.js';
import { CODE_SOURCE, PersonPages } from '../pages/PersonPages.js';
import type { PageSource } from '../pages/PersonPages.js';
import type { PageSpec } from '../pages/PageSpec.js';
import type { Hearing } from '../http/raised.js';
import type { Stamps } from '../storage/Stamps.js';
import { alone } from '../storage/exclusive.js';
import type { Exclusive } from '../storage/exclusive.js';

/** The name of each person's "Your apps" app, which Magnetic makes in their workspace and shows at `/` */
export const HOME_APP = 'your-apps';
/** The model of an app's card on the home app */
const CARD_MODEL = 'app-card';

/** One card of the home app: an app, an org or an invite */
export interface HomeCard {
    readonly id: string;
    readonly name: string;
    /** A line under the name: when it changed, or who shared it */
    readonly note: string;
    /** An app of the person's own: no Shared mark */
    readonly own?: boolean;
    /** An app of theirs, or a share they accepted: it opens on a press. False while a share waits for Accept or Reject */
    readonly answered?: boolean;
}

/** The person's agent use, in words and in cents for the ring */
export interface HomeUsage {
    /** "You have used $1.20 of $5.00." */
    readonly line: string;
    /** "Today: $0.20" */
    readonly today: string;
    readonly usedCents: number;
    /** What they may use in all; the used cents again when there is no limit, which fills the ring */
    readonly totalCents: number;
    readonly tone: 'accent' | 'warning' | 'danger';
}

/** What the home app holds in `$.data`: the person's apps and the apps shared with them, their orgs, the invites waiting for them, their agent use and who they are */
export interface HomeData {
    /** The shares waiting for an answer, then the person's own apps, then the shares they accepted */
    readonly apps: readonly HomeCard[];
    /** An org's id, its name, and the person's role in words */
    readonly orgs?: readonly HomeCard[];
    /** An invite's id, "Join <org>", and the role and who sent it */
    readonly invites?: readonly HomeCard[];
    /** False: Make an org hides, as nobody makes one */
    readonly makeOrgs?: boolean;
    /** Whether the person runs the server: Admin shows */
    readonly admin?: boolean;
    readonly usage?: HomeUsage;
    readonly person?: { readonly name: string; readonly email: string };
    /** How many changes people asked for wait for this person's decision (docs/design/statenet-requests.md, R3c) */
    readonly requests?: number;
}

/** The cards of a list, keyed by id in their order, as a record grid reads them */
function byId(cards: readonly HomeCard[]): Record<string, HomeCard> {
    return Object.fromEntries(cards.map((card) => [card.id, card]));
}

/** The value at a `$.a.b` path of a state, or undefined */
function valueAt(state: unknown, path: string): unknown {
    let at = state;
    for (const key of path.split('.').slice(1)) {
        if (typeof at !== 'object' || at === null) return undefined;
        at = (at as Record<string, unknown>)[key];
    }
    return at;
}

/** The value a document defines at a state path: a screen's nodes are under its `root` there (`$.screens.home.children.x`) */
function definedAt(document: unknown, path: string): unknown {
    const [, top, name, ...rest] = path.split('.');
    if (top !== 'screens' || name === undefined) return valueAt(document, path);
    const screen = valueAt(document, `$.screens.${name}`);
    const rooted = typeof screen === 'object' && screen !== null && typeof (screen as Record<string, unknown>)['root'] === 'object';
    return valueAt(document, ['$', 'screens', name, ...(rooted ? ['root'] : []), ...rest].join('.'));
}

type Operation = Record<string, unknown>;
const text = (field: string, value = ''): Operation => ({ op: 'set', field, type: 'string', default: value });
const count = (field: string, value: number): Operation => ({ op: 'set', field, type: 'number', default: value });
const flag = (field: string, value: boolean): Operation => ({ op: 'set', field, type: 'boolean', default: value });

/**
 * The page's data by namespace, beside the lists of cards (`apps`, `orgs`, `invites`): each is one record at
 * `$.data.<namespace>` with a model of its own (`magnetic-home-<namespace>`), named for what its fields are about.
 * A field's name is unique across the namespaces, and `HOME_FIELDS` says where it is. The flags start as Your apps
 * shows to someone with nothing waiting
 */
const RECORDS: Readonly<Record<string, readonly Operation[]>> = {
    // The page itself: the tab shown, which is kept from one visit to the next
    page: [text('tab', 'apps')],
    // The app being made: the name typed for it
    newApp: [text('make')],
    // What waits for the person: invites to orgs, and changes people asked for
    waiting: [flag('noInvites', true), flag('noRequests', true), text('requestsLine')],
    // Who the person is, their choices of mode and language, and what they may not do: open Admin, make an org
    person: [text('name'), text('email'), text('mode', 'system'), text('language', 'en'), flag('notAdmin', true), flag('noMakeOrg', false)],
    // Their agent use: in words, in cents for the ring, and the ring's tone
    usage: [text('usageLine'), text('usageToday'), count('usedCents', 0), count('totalCents', 1), text('usageTone', 'accent')]
};

/** The model of a namespace of the page's data */
const modelOf = (namespace: string): string => `magnetic-home-${namespace.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;

/** Where each field of the page is: its name to its data path (`tab` to `$.data.page.tab`), made from the models */
export const HOME_FIELDS: Readonly<Record<string, string>> = (() => {
    const paths: Record<string, string> = {};
    for (const [namespace, operations] of Object.entries(RECORDS)) {
        for (const operation of operations) {
            const field = String(operation['field']);
            if (paths[field] !== undefined) throw new Error(`The field ${field} of Your apps is in two namespaces`);
            paths[field] = `$.data.${namespace}.${field}`;
        }
    }
    return paths;
})();

/** The data path of a field of the page */
function h(field: string): string {
    const path = HOME_FIELDS[field];
    if (path === undefined) throw new Error(`Your apps has no field ${field}`);
    return path;
}

/** Fields of the page as the records they are in: one value per namespace, by its data path, in the order of `RECORDS` */
function byNamespace(fields: Readonly<Record<string, unknown>>): Array<[string, Record<string, unknown>]> {
    const records = new Map<string, Record<string, unknown>>(Object.keys(RECORDS).map((namespace) => [`$.data.${namespace}`, {}]));
    for (const [field, value] of Object.entries(fields)) {
        const path = h(field);
        (records.get(path.slice(0, path.lastIndexOf('.'))) as Record<string, unknown>)[field] = value;
    }
    return [...records].filter(([, record]) => Object.keys(record).length > 0);
}

/**
 * What the page script hears of Your apps (src/http/raised.ts): a card's or a button's id names what it does, a card
 * in a grid with its id from its row; the name typed for a new app is kept as it changes, for Make
 */
export const HOME_HEARING: Hearing = {
    'appCard.press': { name: 'open', from: 'row.id' },
    'shareAccept.press': { name: 'shareAccept', from: 'row.id' },
    'shareReject.press': { name: 'shareReject', from: 'row.id' },
    'inviteJoin.press': { name: 'inviteJoin', from: 'row.id' },
    'inviteDecline.press': { name: 'inviteDecline', from: 'row.id' },
    'orgCard.press': { name: 'openOrg', from: 'row.id' },
    'make.change': { keep: h('make') },
    'create.press': { name: 'create', from: h('make') },
    'review.press': { name: 'requests' },
    'makeOrg.press': { name: 'orgs' },
    'billing.press': { name: 'billing' },
    'mode.change': { name: 'mode', from: 'value.value' },
    'language.change': { name: 'language', from: 'value.value' },
    'connections.press': { name: 'connections' },
    'data.press': { name: 'data' },
    'requests.press': { name: 'requests' },
    'device.press': { name: 'device' },
    'admin.press': { name: 'admin' },
    'signout.press': { name: 'signout' },
    'editHome.press': { name: 'editHome' },
    'editEditor.press': { name: 'editEditor' },
    'resetHome.press': { name: 'resetHome' },
    'resetEditor.press': { name: 'resetEditor' }
};

/** A grid of cards; pressing one is heard by its id, with the card's id from its row */
function grid(records: string, id: string): Record<string, unknown> {
    return {
        component: 'recordGrid',
        theme: { recordgrid: { itemheight: 'calc({size.control.md} * 2)' } },
        '<-records': records,
        row: { component: 'card', elevation: 'flat', interactive: true, '<-_title': '$row.name', '<-_subtitle': '$row.note', '@id': id }
    };
}

/**
 * The grid of apps: each card opens its app on a press (`open`), a shared one carries a Shared mark, and a share that
 * waits has Accept and Reject (`shareAccept`, `shareReject` with the app's id) and does not open until accepted
 */
function appGrid(t: Texts): Record<string, unknown> {
    return {
        component: 'recordGrid',
        theme: { recordgrid: { itemheight: 'calc({size.control.md} * 3.25)' } },
        '<-records': '$.data.apps',
        row: {
            component: 'card',
            elevation: 'flat',
            '<-interactive': '$row.answered',
            '<-_title': '$row.name',
           
            '<-_subtitle': '$row.note',
            '@id': 'appCard',
            // The Shared mark in the card's top corner, apart from the answers of a waiting share at its foot
            actions: { component: 'badge', size: 'sm', tone: 'accent', icon: 'users', _text: t['home.shared'], '<-hidden': '$row.own' },
            footer: {
                component: 'panel',
                padding: 'none',
                layout: { type: 'row', gap: 'sm', align: 'center' },
                '<-hidden': '$row.answered',
                children: {
                    accept: { component: 'button', size: 'sm', variant: 'soft', tone: 'success', icon: 'check', iconPosition: 'only', _title: t['home.accept'], '@id': 'shareAccept' },
                    reject: { component: 'button', size: 'sm', variant: 'soft', tone: 'danger', icon: 'x', iconPosition: 'only', _title: t['home.reject'], '@id': 'shareReject' }
                }
            }
        }
    };
}

/** A grid of invites, each with Join and Decline (`inviteJoin`, `inviteDecline` with the invite's id) */
function inviteGrid(t: Texts): Record<string, unknown> {
    return {
        component: 'recordGrid',
        theme: { recordgrid: { itemheight: 'calc({size.control.md} * 3.5)' } },
        '<-records': '$.data.invites',
        row: {
            component: 'card',
            elevation: 'flat',
            '<-_title': '$row.name',
            '<-_subtitle': '$row.note',
            // The buttons under the title, where a grid cell has room for them
            children: {
                buttons: {
                    component: 'panel',
                    padding: 'none',
                    layout: { type: 'row', gap: 'sm' },
                    children: {
                        join: { component: 'button', size: 'sm', _title: t['home.join'], '@id': 'inviteJoin' },
                        decline: { component: 'button', size: 'sm', variant: 'ghost', _title: t['home.decline'], '@id': 'inviteDecline' }
                    }
                }
            }
        }
    };
}

/**
 * The home screen, in a centred column: Magnetic over four tabs, the one shown kept in `$.data.page.tab`.
 * - Apps: a field and a button that make an app (`create`, with the name), and one grid of the person's apps and the
 *   apps shared with them (`open`, `shareAccept`, `shareReject`).
 * - Orgs: the invites waiting (`inviteJoin`, `inviteDecline`), their orgs (`openOrg`) and Make an org (`orgs`).
 * - Usage: a ring of the agent use spent of all they may spend, in words, and Agent use (`billing`).
 * - Profile: who they are, the menus of mode and language (`mode`, `language`), the settings pages, Admin, Sign out
 *   (`signout`), and their own pages (`editHome`, `resetHome`, `editEditor`, `resetEditor`).
 * The page's script hears those nodes by their ids (`HOME_HEARING`) and acts on them. The page writes only `$.data`,
 * so any node can move
 */
function homeScreen(t: Texts): Record<string, unknown> {
    const menu = (target: string, label: string, options: Record<string, { _label: string }>): Record<string, unknown> => ({
        component: 'selectField',
        size: 'sm',
        _label: label,
        options,
        '<-value': h(target),
        '@id': target
    });
    const link = (id: string, title: string, more: Record<string, unknown> = {}): Record<string, unknown> => ({ component: 'button', variant: 'soft', size: 'sm', _title: title, ...more, '@id': id });
    const tab = (title: string, icon: string, children: Record<string, unknown>): Record<string, unknown> => ({
        component: 'panel',
        padding: 'none',
        placement: { _tab: title, icon },
        layout: { type: 'column', gap: 'lg' },
        children
    });
    return {
        component: 'panel',
        padding: 'lg',
        layout: { type: 'grid', cols: 12, collapseBelow: 'md' },
        children: {
            page: {
                component: 'panel',
                padding: 'none',
                placement: { col: 3, span: 8 },
                layout: { type: 'column', gap: 'md' },
                children: {
                    title: { component: 'text', textRole: 'title', element: 'h1', _text: 'Magnetic' },
                    tabs: {
                        component: 'tabs',
                        '<-active': h('tab'),
                        children: {
                            apps: tab(t['home.tabApps'], 'apps', {
                                invitesWaiting: { component: 'alert', tone: 'info', icon: 'mail', _text: t['home.invitesWaiting'], 'own:hidden': h('noInvites') },
                                // Shown only while changes people asked for wait for a decision
                                requestsWaiting: {
                                    component: 'panel',
                                    padding: 'none',
                                    'own:hidden': h('noRequests'),
                                    layout: { type: 'row', gap: 'sm', align: 'center' },
                                    children: {
                                        alert: { component: 'alert', tone: 'warning', icon: 'inbox', placement: { grow: 1 }, '<-_text': h('requestsLine') },
                                        review: link('review', t['home.requestsReview'])
                                    }
                                },
                                new: {
                                    component: 'panel',
                                    bordered: true,
                                    _title: t['home.makeTitle'],
                                    _description: t['home.makeText'],
                                    layout: { type: 'row', align: 'end', gap: 'sm' },
                                    children: {
                                        make: { component: 'textField', placement: { grow: 1 }, _label: t['home.name'], _placeholder: t['home.namePlaceholder'], '<-value': h('make'), '@id': 'make' },
                                        create: { component: 'button', _title: t['home.make'], '@id': 'create' }
                                    }
                                },
                                appsTitle: { component: 'text', textRole: 'heading', element: 'h2', _text: t['home.appsTitle'] },
                                apps: appGrid(t)
                            }),
                            orgs: tab(t['home.tabOrgs'], 'building', {
                                // Shown only while invites wait
                                invitesBox: {
                                    component: 'panel',
                                    bordered: true,
                                    'own:hidden': h('noInvites'),
                                    _title: t['home.invitesTitle'],
                                    _description: t['home.invitesText'],
                                    layout: { type: 'column', gap: 'sm' },
                                    children: { invites: inviteGrid(t) }
                                },
                                orgsHead: {
                                    component: 'panel',
                                    padding: 'none',
                                    layout: { type: 'row', gap: 'sm', align: 'center' },
                                    children: {
                                        title: { component: 'text', textRole: 'heading', element: 'h2', placement: { grow: 1 }, _text: t['home.orgsTitle'] },
                                        make: { component: 'button', size: 'sm', variant: 'soft', 'own:hidden': h('noMakeOrg'), _title: t['home.makeOrg'], '@id': 'makeOrg' }
                                    }
                                },
                                orgsHint: { component: 'text', textRole: 'caption', _text: t['home.orgsText'] },
                                orgs: grid('$.data.orgs', 'orgCard')
                            }),
                            usage: tab(t['home.tabUsage'], 'chart-donut', {
                                spent: {
                                    component: 'panel',
                                    bordered: true,
                                    _title: t['home.billing'],
                                    _description: t['home.usageText'],
                                    layout: { type: 'row', gap: 'lg', align: 'center', wrap: true },
                                    children: {
                                        ring: { component: 'progress', shape: 'ring', size: 'lg', _label: t['home.billing'], '<-value': h('usedCents'), '<-max': h('totalCents'), 'own:tone': h('usageTone') },
                                        words: {
                                            component: 'panel',
                                            padding: 'none',
                                            placement: { grow: 1 },
                                            layout: { type: 'column', gap: 'sm' },
                                            children: {
                                                line: { component: 'text', textRole: 'heading', '<-_text': h('usageLine') },
                                                today: { component: 'text', textRole: 'caption', '<-_text': h('usageToday') }
                                            }
                                        },
                                        billing: link('billing', t['home.billing'])
                                    }
                                }
                            }),
                            profile: tab(t['home.tabProfile'], 'user', {
                                who: {
                                    component: 'panel',
                                    bordered: true,
                                    '<-_title': h('name'),
                                    '<-_description': h('email'),
                                    layout: { type: 'column', gap: 'md' },
                                    children: {
                                        about: { component: 'text', textRole: 'caption', _text: t['home.profileText'] },
                                        choices: {
                                            component: 'panel',
                                            padding: 'none',
                                            layout: { type: 'row', align: 'end', gap: 'sm', wrap: true },
                                            children: {
                                                mode: menu('mode', t['prefs.mode'], Object.fromEntries(MODES.map((mode) => [mode, { _label: t[`prefs.${mode}`] }]))),
                                                language: menu('language', t['prefs.language'], Object.fromEntries(LANGUAGES.map((language) => [language, { _label: LANGUAGE_NAMES[language] }])))
                                            }
                                        },
                                        settings: {
                                            component: 'panel',
                                            padding: 'none',
                                            layout: { type: 'row', gap: 'sm', wrap: true },
                                            children: {
                                                connections: link('connections', t['home.connections']),
                                                data: link('data', t['home.data']),
                                                requests: link('requests', t['home.requests']),
                                                device: link('device', t['home.device']),
                                                admin: link('admin', t['home.admin'], { 'own:hidden': h('notAdmin') }),
                                                signout: link('signout', t['home.signOut'], { variant: 'ghost' })
                                            }
                                        }
                                    }
                                },
                                editor: {
                                    component: 'panel',
                                    bordered: true,
                                    _title: t['home.pagesTitle'],
                                    _description: t['home.pagesText'],
                                    layout: { type: 'row', gap: 'sm', align: 'center', wrap: true },
                                    children: {
                                        editHome: { component: 'button', variant: 'soft', icon: 'pencil', _title: t['home.editHome'], '@id': 'editHome' },
                                        edit: { component: 'button', variant: 'soft', icon: 'pencil', _title: t['home.editEditor'], '@id': 'editEditor' },
                                        resetHome: { component: 'button', variant: 'ghost', tone: 'danger', _title: t['home.resetHome'], '@id': 'resetHome' },
                                        reset: { component: 'button', variant: 'ghost', tone: 'danger', _title: t['home.resetEditor'], '@id': 'resetEditor' }
                                    }
                                }
                            })
                        }
                    }
                }
            }
        }
    };
}

/**
 * The fields of an app card. They have no defaults: a person binding starts as its model's defaults, which on a map of
 * cards would be keys beside the cards, and the server writes `own` and `answered` on every app card
 */
const CARD_FIELDS = [
    { op: 'set', field: 'id', type: 'string', required: true },
    { op: 'set', field: 'name', type: 'string', required: true },
    { op: 'set', field: 'note', type: 'string' },
    { op: 'set', field: 'own', type: 'boolean' },
    { op: 'set', field: 'answered', type: 'boolean' }
];

/** Your apps as a page of Magnetic's: made in English, with the other languages as locales */
export const HOME: PageSpec = pageSpec({
    records: Object.keys(RECORDS).map((namespace) => ({ path: `$.data.${namespace}`, model: modelOf(namespace) })),
    name: HOME_APP,
    title: 'Your apps',
    themed: false,
    required: ['appCard', 'create', 'signout', 'editHome', 'resetHome', 'shareAccept', 'shareReject'],
    sample: {
        '$.data.apps': {
            'app-two': { id: 'app-two', name: 'An app shared with them', note: 'Someone · use', own: false, answered: false },
            'app-one': { id: 'app-one', name: 'An app of theirs', note: 'Changed 18 Nov 2026', own: true, answered: true },
            'app-three': { id: 'app-three', name: 'A share they accepted', note: 'Someone · view only', own: false, answered: true }
        },
        '$.data.orgs': { 'org-one': { id: 'org-one', name: 'An org of theirs', note: 'Builder' } },
        '$.data.invites': { 'invite-one': { id: 'invite-one', name: 'Join an org', note: 'As a builder, from someone' } },
        ...Object.fromEntries(
            byNamespace({
                noInvites: false,
                noRequests: false,
                requestsLine: '2 changes people asked for wait for your approval.',
                notAdmin: false,
                noMakeOrg: false,
                mode: 'system',
                language: 'en',
                make: '',
                tab: 'apps',
                name: 'Someone',
                email: 'someone@example.com',
                usageLine: 'You have used $1.20 of $5.00.',
                usageToday: 'Today: $0.20',
                usedCents: 120,
                totalCents: 500,
                usageTone: 'accent'
            })
        )
    },
    models: { [CARD_MODEL]: CARD_FIELDS, ...Object.fromEntries(Object.entries(RECORDS).map(([namespace, operations]) => [modelOf(namespace), operations])) },
    definition: () => {
        const t = textsOf('en');
        return {
            title: t['home.appsTitle'],
            data: {
                ...Object.fromEntries(Object.keys(RECORDS).map((namespace) => [namespace, { model: modelOf(namespace), scope: 'person' }])),
                apps: { model: CARD_MODEL, scope: 'person' },
                orgs: { model: CARD_MODEL, scope: 'person' },
                invites: { model: CARD_MODEL, scope: 'person' }
            },
            home: homeScreen(t)
        };
    }
});

/**
 * Each person's "Your apps": a StateUI app in their own workspace, made from Magnetic's version and kept when they change
 * it (`PersonPages`). Each visit writes the lists of apps and the person's choices into its data, so it is never
 * stale; one copy serves every language, as its texts are locales
 */
export class HomeApps extends PersonPages {
    constructor(
        toolsOf: (services: Services) => readonly UiToolDefinition[],
        /** Where the version of the home app made in each workspace is kept */
        stamps: Stamps,
        /** Keeps two servers from making the same person's home app at once */
        exclusive: Exclusive = alone,
        source: () => PageSource = () => CODE_SOURCE
    ) {
        super(HOME, 'home', toolsOf, stamps, source, exclusive);
    }

    /** The person's own instance of their home app: the page is real use, never a test run (docs/design/stateui-test-runs.md) */
    private async own(services: Services, userId: string): Promise<Authority> {
        return (await this.opened(services, userId, false)).own;
    }

    /** The person's instance and, when asked, the document of their copy, which says where each node of the page is now */
    private async opened(services: Services, userId: string, withDocument: boolean): Promise<{ own: Authority; document: unknown }> {
        const app = await services.instanceViews.find(await this.id(services, userId));
        if (app === undefined) throw new Error('Your apps could not be opened');
        const document = withDocument ? (await services.instanceViews.message(app, 'attach')).document : undefined;
        return { own: await services.instanceViews.authority(app, userId), document };
    }

    /** The lists the home app holds now, in their order */
    async read(services: Services, userId: string): Promise<HomeData> {
        const own = await this.own(services, userId);
        const list = async (path: string): Promise<HomeCard[]> => {
            const value = own.get(path);
            return typeof value === 'object' && value !== null ? (Object.values(value) as unknown as HomeCard[]) : [];
        };
        return { apps: await list('$.data.apps') };
    }

    /**
     * Writes the lists into the home app's data, which its open views follow at once, sets its menus to the person's
     * choices, shows their agent use and who they are, and empties the name field. The tab shown is kept. A write the
     * person's copy refuses (they took its data out) is left out. A field that is a node's own state (`HOME.own`) is
     * written to the node with that id in the person's copy of the page, found in its document: the instance's state
     * holds only what was written to it, so it cannot say where a node is. A copy without the node drops the write
     */
    async show(services: Services, userId: string, data: HomeData, prefs: Preferences = { mode: 'system', language: 'en' }, report?: (message: string, fields: Record<string, unknown>) => void): Promise<void> {
        const { own, document } = await this.opened(services, userId, true);
        // The state is read once and only what differs is written: most loads of the page change nothing
        const state = own.get('$');
        const tab = valueAt(state, h('tab'));
        const usage = data.usage ?? { line: '', today: '', usedCents: 0, totalCents: 1, tone: 'accent' };
        /** The lists of cards: maps whose keys are in the order the cards show */
        const lists: Array<[string, unknown]> = [
            ['$.data.apps', byId(data.apps)],
            ['$.data.orgs', byId(data.orgs ?? [])],
            ['$.data.invites', byId(data.invites ?? [])]
        ];
        const fields: Array<[string, unknown]> = [
            ...lists,
            ...byNamespace({
                noInvites: (data.invites ?? []).length === 0,
                noRequests: (data.requests ?? 0) === 0,
                requestsLine: (data.requests ?? 0) === 0 ? '' : fill(textsOf(prefs.language)['home.requestsWaiting'], { count: String(data.requests) }),
                notAdmin: data.admin !== true,
                noMakeOrg: data.makeOrgs === false,
                mode: prefs.mode,
                language: prefs.language,
                make: '',
                tab: typeof tab === 'string' && tab !== '' ? tab : 'apps',
                name: data.person?.name ?? '',
                email: data.person?.email ?? '',
                usageLine: usage.line,
                usageToday: usage.today,
                usedCents: usage.usedCents,
                totalCents: Math.max(1, usage.totalCents),
                usageTone: usage.tone
            })
        ];
        // A field that is a node's own state (the Admin link's hidden) goes to that node, wherever the person's copy has it
        const placed = ownWrites(HOME.own, fields.map(([path, value]) => ({ path, value })), (target) => {
            const dot = target.indexOf('.');
            const node = pathOfId(document, target.slice(0, dot));
            return node === undefined ? '' : node + target.slice(dot);
        });
        const wanted: Array<[string, unknown]> = placed.filter((write) => write.path !== '').map((write) => [write.path, write.value]);
        const set = async (path: string, value: unknown): Promise<void> => {
            if (own.write({ op: 'set', path, value } as Parameters<Authority['write']>[0]) === undefined) report?.('Your apps refused a write', { path });
        };
        for (const [path, value] of wanted) {
            // The instance holds only what was written to it: a node's state never written is the definition's
            const now = valueAt(state, path) ?? definedAt(document, path);
            if (JSON.stringify(now) === JSON.stringify(value)) continue;
            // A write keeps the keys a map has where they are and adds new ones after them, so a list whose cards must
            // change order (a new share goes first) is emptied first
            if (lists.some(([list]) => list === path) && !sameOrder(now, value)) await set(path, {});
            await set(path, value);
        }
    }
}

/** True when writing the second map over the first leaves its keys in the order of the second */
function sameOrder(before: unknown, after: unknown): boolean {
    if (typeof before !== 'object' || before === null || typeof after !== 'object' || after === null) return true;
    const kept = Object.keys(before).filter((key) => Object.hasOwn(after, key));
    const wanted = Object.keys(after).filter((key) => Object.hasOwn(before, key));
    if (kept.some((key, index) => key !== wanted[index])) return false;
    // A new key goes after the kept ones: in order only when no kept key comes after it in the new map
    const keys = Object.keys(after);
    const lastKept = Math.max(-1, ...wanted.map((key) => keys.indexOf(key)));
    return keys.every((key, index) => Object.hasOwn(before, key) || index > lastKept);
}
