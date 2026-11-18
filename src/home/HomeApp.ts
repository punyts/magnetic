import type { Services, UiToolDefinition } from '@punyts/stateui-mcp';
import { LANGUAGE_NAMES, LANGUAGES, MODES } from '../prefs/Preferences.js';
import type { Preferences } from '../prefs/Preferences.js';
import { textsOf } from '../http/text.js';
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

/** One app as the home app shows it */
export interface HomeCard {
    readonly id: string;
    readonly name: string;
    /** A line under the name: when it changed, or who shared it */
    readonly note: string;
}

/** What the home app holds in `$.data`: the person's apps, the apps shared with them, their orgs and the invites waiting for them, each by id */
export interface HomeData {
    readonly apps: readonly HomeCard[];
    readonly shared: readonly HomeCard[];
    /** An org's id, its name, and the person's role in words */
    readonly orgs?: readonly HomeCard[];
    /** An invite's id, "Join <org>", and the role and who sent it */
    readonly invites?: readonly HomeCard[];
    /** False: Make an org hides, as nobody makes one */
    readonly makeOrgs?: boolean;
    /** Whether the person runs the server: Admin shows */
    readonly admin?: boolean;
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
 * The home screen, in a centred column: Magnetic, the menus of mode and language (`mode`, `language`), the settings
 * pages and Sign out (`signout`), a field and a button that make an app (`create`, with the name), the person's apps,
 * the apps shared with them, their orgs, and their own pages (`editHome`, `resetHome`, `editEditor`, `resetEditor`).
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
    const link = (target: string, title: string, more: Record<string, unknown> = {}): Record<string, unknown> => ({ component: 'button', variant: 'ghost', size: 'sm', _title: title, ...more, on: { press: emit(target) } });
    return {
        component: 'panel',
        padding: 'lg',
        layout: { type: 'grid', cols: 12, collapseBelow: 'md' },
        children: {
            page: {
                component: 'panel',
                padding: 'none',
                placement: { col: 3, span: 8 },
                layout: { type: 'column', gap: 'lg' },
                children: {
                    top: {
                        component: 'panel',
                        padding: 'none',
                        layout: { type: 'row', align: 'end', gap: 'sm', wrap: true },
                        children: {
                            title: { component: 'text', textRole: 'title', placement: { grow: 1 }, _text: 'Magnetic' },
                            mode: menu('mode', t['prefs.mode'], Object.fromEntries(MODES.map((mode) => [mode, { _label: t[`prefs.${mode}`] }]))),
                            language: menu('language', t['prefs.language'], Object.fromEntries(LANGUAGES.map((language) => [language, { _label: LANGUAGE_NAMES[language] }]))),
                            orgs: link('orgs', t['home.orgs']),
                            connections: link('connections', t['home.connections']),
                            data: link('data', t['home.data']),
                            billing: link('billing', t['home.billing']),
                            admin: link('admin', t['home.admin'], { '<-hidden': `${H}.notAdmin` }),
                            signout: link('signout', t['home.signOut'])
                        }
                    },
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
                    appsTitle: { component: 'text', textRole: 'heading', _text: t['home.appsTitle'] },
                    appsHint: { component: 'text', textRole: 'caption', _text: t['home.appsText'] },
                    apps: grid('$.data.apps'),
                    sharedTitle: { component: 'text', textRole: 'heading', _text: t['home.sharedTitle'] },
                    sharedHint: { component: 'text', textRole: 'caption', _text: t['home.sharedText'] },
                    shared: grid('$.data.shared'),
                    orgsHead: {
                        component: 'panel',
                        padding: 'none',
                        layout: { type: 'row', gap: 'sm', align: 'center' },
                        children: {
                            title: { component: 'text', textRole: 'heading', placement: { grow: 1 }, _text: t['home.orgsTitle'] },
                            make: { component: 'button', size: 'sm', variant: 'soft', '<-hidden': `${H}.noMakeOrg`, _title: t['home.makeOrg'], on: { press: emit('orgs') } }
                        }
                    },
                    orgsHint: { component: 'text', textRole: 'caption', _text: t['home.orgsText'] },
                    orgs: grid('$.data.orgs', 'openOrg'),
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
                }
            }
        }
    };
}

/** The fields of an app card */
const CARD_FIELDS = [
    { op: 'set', field: 'id', type: 'string', required: true },
    { op: 'set', field: 'name', type: 'string', required: true },
    { op: 'set', field: 'note', type: 'string' }
];

/** The fields of the page's record, `$.data.home`: the flags start as Your apps shows to someone with nothing waiting */
const HOME_FIELDS = [
    ...['noInvites', 'notAdmin', 'noMakeOrg'].map((field) => ({ op: 'set', field, type: 'boolean', default: field !== 'noMakeOrg' })),
    { op: 'set', field: 'mode', type: 'string', default: 'system' },
    { op: 'set', field: 'language', type: 'string', default: 'en' },
    { op: 'set', field: 'make', type: 'string', default: '' }
];

/** Your apps as a page of Magnetic's: made in English, with the other languages as locales */
export const HOME: PageSpec = {
    name: HOME_APP,
    title: 'Your apps',
    themed: false,
    required: ['open', 'create', 'signout', 'editHome', 'resetHome'],
    sample: {
        '$.data.apps': { 'app-one': { id: 'app-one', name: 'An app of theirs', note: 'Changed 18 Nov 2026' } },
        '$.data.shared': { 'app-two': { id: 'app-two', name: 'An app shared with them', note: 'Shared by someone' } },
        '$.data.orgs': { 'org-one': { id: 'org-one', name: 'An org of theirs', note: 'Builder' } },
        '$.data.invites': { 'invite-one': { id: 'invite-one', name: 'Join an org', note: 'As a builder, from someone' } },
        [H]: { noInvites: false, notAdmin: false, noMakeOrg: false, mode: 'system', language: 'en', make: '' }
    },
    models: { [CARD_MODEL]: CARD_FIELDS, [HOME_MODEL]: HOME_FIELDS },
    definition: () => {
        const t = textsOf('en');
        return {
            title: t['home.appsTitle'],
            data: {
                home: { model: HOME_MODEL, scope: 'persona' },
                apps: { model: CARD_MODEL, scope: 'persona' },
                shared: { model: CARD_MODEL, scope: 'persona' },
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
        return { apps: await list('$.data.apps'), shared: await list('$.data.shared') };
    }

    /**
     * Writes the lists into the home app's data, which its open views follow at once, sets its menus to the person's
     * choices and empties the name field. A write the person's copy refuses (they took its data out) is left out
     */
    async show(services: Services, userId: string, data: HomeData, prefs: Preferences = { mode: 'system', language: 'en' }, report?: (message: string, fields: Record<string, unknown>) => void): Promise<void> {
        await this.id(services, userId);
        const tools = this.toolsOf(services);
        const wanted: Array<[string, unknown]> = [
            ['$.data.apps', byId(data.apps)],
            ['$.data.shared', byId(data.shared)],
            ['$.data.orgs', byId(data.orgs ?? [])],
            ['$.data.invites', byId(data.invites ?? [])],
            [H, { noInvites: (data.invites ?? []).length === 0, notAdmin: data.admin !== true, noMakeOrg: data.makeOrgs === false, mode: prefs.mode, language: prefs.language, make: '' }]
        ];
        // Each write assembles the app again, so the state is read once and only what differs is written: most
        // loads of the page change nothing
        const state = (await run(tools, 'ui_state_get', { app: HOME_APP, path: '$', full: true }).catch((): Record<string, unknown> => ({})))['value'];
        for (const [path, value] of wanted) {
            if (JSON.stringify(valueAt(state, path)) === JSON.stringify(value)) continue;
            await run(tools, 'ui_state_set', { app: HOME_APP, path, value, logic: false }).catch((error: unknown) => report?.('Your apps refused a write', { path, error: error instanceof Error ? error.message.slice(0, 200) : String(error) }));
        }
    }
}
