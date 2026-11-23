import type { Services, UiToolDefinition } from '@punyts/stateui-mcp';
import { LANGUAGE_NAMES, LANGUAGES, MODES } from '../prefs/Preferences.js';
import type { Preferences } from '../prefs/Preferences.js';
import { fill, textsOf } from '../http/text.js';
import type { Texts } from '../http/text.js';
import { CODE_SOURCE, PersonPages } from '../pages/PersonPages.js';
import type { PageSource } from '../pages/PersonPages.js';
import type { PageSpec } from '../pages/PageSpec.js';
import { run } from '../stateui/run.js';
import type { Stamps } from '../storage/Stamps.js';
import { alone } from '../storage/exclusive.js';
import type { Exclusive } from '../storage/exclusive.js';

/** The name of each person's "Your apps" app, which Magnetic makes in their workspace and shows at `/` */
export const HOME_APP = 'your-apps';
/** The model of an app's card on the home app */
const CARD_MODEL = 'app-card';
/** The model of the home app's one record of the page's choices (`$.data.home`) */
const HOME_MODEL = 'magnetic-home';

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

const emit = (target: string, from?: string): Record<string, unknown> => ({ command: 'emit', target, ...(from !== undefined && { from }) });

/** A grid of cards; pressing one raises `target` with the card's id */
function grid(records: string, target = 'open'): Record<string, unknown> {
    return {
        component: 'recordGrid',
        theme: { recordgrid: { itemheight: 'calc({size.control.md} * 2)' } },
        '<-records': records,
        row: { component: 'card', elevation: 'flat', interactive: true, '<-_title': '$row.name', '<-_subtitle': '$row.note', on: { press: emit(target, '$row.id') } }
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
            on: { press: emit('open', '$row.id') },
            // The Shared mark in the card's top corner, apart from the answers of a waiting share at its foot
            actions: { component: 'badge', size: 'sm', tone: 'accent', icon: 'users', _text: t['home.shared'], '<-hidden': '$row.own' },
            footer: {
                component: 'panel',
                padding: 'none',
                layout: { type: 'row', gap: 'sm', align: 'center' },
                '<-hidden': '$row.answered',
                children: {
                    accept: { component: 'button', size: 'sm', variant: 'soft', tone: 'success', icon: 'check', iconPosition: 'only', _title: t['home.accept'], on: { press: emit('shareAccept', '$row.id') } },
                    reject: { component: 'button', size: 'sm', variant: 'soft', tone: 'danger', icon: 'x', iconPosition: 'only', _title: t['home.reject'], on: { press: emit('shareReject', '$row.id') } }
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
                        join: { component: 'button', size: 'sm', _title: t['home.join'], on: { press: emit('inviteJoin', '$row.id') } },
                        decline: { component: 'button', size: 'sm', variant: 'ghost', _title: t['home.decline'], on: { press: emit('inviteDecline', '$row.id') } }
                    }
                }
            }
        }
    };
}

/** The page's record: what it shows and hides, the person's choices, and the name typed for a new app */
const H = '$.data.home';

/**
 * The home screen, in a centred column: Magnetic over four tabs, the one shown kept in `$.data.home.tab`.
 * - Apps: a field and a button that make an app (`create`, with the name), and one grid of the person's apps and the
 *   apps shared with them (`open`, `shareAccept`, `shareReject`).
 * - Orgs: the invites waiting (`inviteJoin`, `inviteDecline`), their orgs (`openOrg`) and Make an org (`orgs`).
 * - Usage: a ring of the agent use spent of all they may spend, in words, and Agent use (`billing`).
 * - Profile: who they are, the menus of mode and language (`mode`, `language`), the settings pages, Admin, Sign out
 *   (`signout`), and their own pages (`editHome`, `resetHome`, `editEditor`, `resetEditor`).
 * Each `emit` reaches the page (`stateui:emit`), whose script acts on it. The page writes only `$.data`, so any node
 * can move
 */
function homeScreen(t: Texts): Record<string, unknown> {
    const menu = (target: string, label: string, options: Record<string, { _label: string }>): Record<string, unknown> => ({
        component: 'selectField',
        size: 'sm',
        _label: label,
        options,
        '<-value': `${H}.${target}`,
        on: { change: emit(target, `${H}.${target}`) }
    });
    const link = (target: string, title: string, more: Record<string, unknown> = {}): Record<string, unknown> => ({ component: 'button', variant: 'soft', size: 'sm', _title: title, ...more, on: { press: emit(target) } });
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
                        '<-active': `${H}.tab`,
                        children: {
                            apps: tab(t['home.tabApps'], 'apps', {
                                invitesWaiting: { component: 'alert', tone: 'info', icon: 'mail', _text: t['home.invitesWaiting'], '<-hidden': `${H}.noInvites` },
                                // Shown only while changes people asked for wait for a decision
                                requestsWaiting: {
                                    component: 'panel',
                                    padding: 'none',
                                    '<-hidden': `${H}.noRequests`,
                                    layout: { type: 'row', gap: 'sm', align: 'center' },
                                    children: {
                                        alert: { component: 'alert', tone: 'warning', icon: 'inbox', placement: { grow: 1 }, '<-_text': `${H}.requestsLine` },
                                        review: link('requests', t['home.requestsReview'])
                                    }
                                },
                                new: {
                                    component: 'panel',
                                    bordered: true,
                                    _title: t['home.makeTitle'],
                                    _description: t['home.makeText'],
                                    layout: { type: 'row', align: 'end', gap: 'sm' },
                                    children: {
                                        make: { component: 'textField', placement: { grow: 1 }, _label: t['home.name'], _placeholder: t['home.namePlaceholder'], '<-value': `${H}.make` },
                                        create: { component: 'button', _title: t['home.make'], on: { press: emit('create', `${H}.make`) } }
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
                                    '<-hidden': `${H}.noInvites`,
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
                                        make: { component: 'button', size: 'sm', variant: 'soft', '<-hidden': `${H}.noMakeOrg`, _title: t['home.makeOrg'], on: { press: emit('orgs') } }
                                    }
                                },
                                orgsHint: { component: 'text', textRole: 'caption', _text: t['home.orgsText'] },
                                orgs: grid('$.data.orgs', 'openOrg')
                            }),
                            usage: tab(t['home.tabUsage'], 'chart-donut', {
                                spent: {
                                    component: 'panel',
                                    bordered: true,
                                    _title: t['home.billing'],
                                    _description: t['home.usageText'],
                                    layout: { type: 'row', gap: 'lg', align: 'center', wrap: true },
                                    children: {
                                        ring: { component: 'progress', shape: 'ring', size: 'lg', _label: t['home.billing'], '<-value': `${H}.usedCents`, '<-max': `${H}.totalCents`, '<-tone': `${H}.usageTone` },
                                        words: {
                                            component: 'panel',
                                            padding: 'none',
                                            placement: { grow: 1 },
                                            layout: { type: 'column', gap: 'sm' },
                                            children: {
                                                line: { component: 'text', textRole: 'heading', '<-_text': `${H}.usageLine` },
                                                today: { component: 'text', textRole: 'caption', '<-_text': `${H}.usageToday` }
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
                                    '<-_title': `${H}.name`,
                                    '<-_description': `${H}.email`,
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
                                                admin: link('admin', t['home.admin'], { '<-hidden': `${H}.notAdmin` }),
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
                                        editHome: { component: 'button', variant: 'soft', icon: 'pencil', _title: t['home.editHome'], on: { press: emit('editHome') } },
                                        edit: { component: 'button', variant: 'soft', icon: 'pencil', _title: t['home.editEditor'], on: { press: emit('editEditor') } },
                                        resetHome: { component: 'button', variant: 'ghost', tone: 'danger', _title: t['home.resetHome'], on: { press: emit('resetHome') } },
                                        reset: { component: 'button', variant: 'ghost', tone: 'danger', _title: t['home.resetEditor'], on: { press: emit('resetEditor') } }
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
 * The fields of an app card. They have no defaults: a persona binding starts as its model's defaults, which on a map of
 * cards would be keys beside the cards, and the server writes `own` and `answered` on every app card
 */
const CARD_FIELDS = [
    { op: 'set', field: 'id', type: 'string', required: true },
    { op: 'set', field: 'name', type: 'string', required: true },
    { op: 'set', field: 'note', type: 'string' },
    { op: 'set', field: 'own', type: 'boolean' },
    { op: 'set', field: 'answered', type: 'boolean' }
];

/** The fields of the page's record, `$.data.home`: the flags start as Your apps shows to someone with nothing waiting */
const HOME_FIELDS = [
    ...['noInvites', 'noRequests', 'notAdmin', 'noMakeOrg'].map((field) => ({ op: 'set', field, type: 'boolean', default: field !== 'noMakeOrg' })),
    { op: 'set', field: 'requestsLine', type: 'string', default: '' },
    { op: 'set', field: 'mode', type: 'string', default: 'system' },
    { op: 'set', field: 'language', type: 'string', default: 'en' },
    { op: 'set', field: 'make', type: 'string', default: '' },
    { op: 'set', field: 'tab', type: 'string', default: 'apps' },
    { op: 'set', field: 'name', type: 'string', default: '' },
    { op: 'set', field: 'email', type: 'string', default: '' },
    { op: 'set', field: 'usageLine', type: 'string', default: '' },
    { op: 'set', field: 'usageToday', type: 'string', default: '' },
    { op: 'set', field: 'usedCents', type: 'number', default: 0 },
    { op: 'set', field: 'totalCents', type: 'number', default: 1 },
    { op: 'set', field: 'usageTone', type: 'string', default: 'accent' }
];

/** Your apps as a page of Magnetic's: made in English, with the other languages as locales */
export const HOME: PageSpec = {
    name: HOME_APP,
    title: 'Your apps',
    themed: false,
    required: ['open', 'create', 'signout', 'editHome', 'resetHome', 'shareAccept', 'shareReject'],
    sample: {
        '$.data.apps': {
            'app-two': { id: 'app-two', name: 'An app shared with them', note: 'Someone · use', own: false, answered: false },
            'app-one': { id: 'app-one', name: 'An app of theirs', note: 'Changed 18 Nov 2026', own: true, answered: true },
            'app-three': { id: 'app-three', name: 'A share they accepted', note: 'Someone · view only', own: false, answered: true }
        },
        '$.data.orgs': { 'org-one': { id: 'org-one', name: 'An org of theirs', note: 'Builder' } },
        '$.data.invites': { 'invite-one': { id: 'invite-one', name: 'Join an org', note: 'As a builder, from someone' } },
        [H]: {
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
        }
    },
    models: { [CARD_MODEL]: CARD_FIELDS, [HOME_MODEL]: HOME_FIELDS },
    definition: () => {
        const t = textsOf('en');
        return {
            title: t['home.appsTitle'],
            data: {
                home: { model: HOME_MODEL, scope: 'persona' },
                apps: { model: CARD_MODEL, scope: 'persona' },
                orgs: { model: CARD_MODEL, scope: 'persona' },
                invites: { model: CARD_MODEL, scope: 'persona' }
            },
            home: homeScreen(t)
        };
    }
};

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

    /** The lists the home app holds now, in their order */
    async read(services: Services, userId: string): Promise<HomeData> {
        await this.id(services, userId);
        const tools = this.toolsOf(services);
        const list = async (path: string): Promise<HomeCard[]> => {
            const body = await run(tools, 'ui_state_get', { app: HOME_APP, path, full: true });
            const value = body['value'];
            return typeof value === 'object' && value !== null ? (Object.values(value) as HomeCard[]) : [];
        };
        return { apps: await list('$.data.apps') };
    }

    /**
     * Writes the lists into the home app's data, which its open views follow at once, sets its menus to the person's
     * choices, shows their agent use and who they are, and empties the name field. The tab shown is kept. A write the
     * person's copy refuses (they took its data out) is left out
     */
    async show(services: Services, userId: string, data: HomeData, prefs: Preferences = { mode: 'system', language: 'en' }, report?: (message: string, fields: Record<string, unknown>) => void): Promise<void> {
        await this.id(services, userId);
        const tools = this.toolsOf(services);
        // Each write assembles the app again, so the state is read once and only what differs is written: most
        // loads of the page change nothing
        const state = (await run(tools, 'ui_state_get', { app: HOME_APP, path: '$', full: true }).catch((): Record<string, unknown> => ({})))['value'];
        const tab = valueAt(state, `${H}.tab`);
        const usage = data.usage ?? { line: '', today: '', usedCents: 0, totalCents: 1, tone: 'accent' };
        const wanted: Array<[string, unknown]> = [
            ['$.data.apps', byId(data.apps)],
            ['$.data.orgs', byId(data.orgs ?? [])],
            ['$.data.invites', byId(data.invites ?? [])],
            [
                H,
                {
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
                }
            ]
        ];
        const set = (path: string, value: unknown): Promise<unknown> =>
            run(tools, 'ui_state_set', { app: HOME_APP, path, value, logic: false }).catch((error: unknown) => report?.('Your apps refused a write', { path, error: error instanceof Error ? error.message.slice(0, 200) : String(error) }));
        for (const [path, value] of wanted) {
            const now = valueAt(state, path);
            if (JSON.stringify(now) === JSON.stringify(value)) continue;
            // A write keeps the keys a map has where they are and adds new ones after them, so a list whose cards must
            // change order (a new share goes first) is emptied first
            if (path !== H && !sameOrder(now, value)) await set(path, {});
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
