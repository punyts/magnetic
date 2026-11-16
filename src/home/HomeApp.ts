import { createHash } from 'node:crypto';
import type { Services, UiToolDefinition } from '@punyts/stateui-mcp';
import { LANGUAGE_NAMES, LANGUAGES, MODES } from '../prefs/Preferences.js';
import type { Language, Preferences } from '../prefs/Preferences.js';
import { textsOf } from '../http/text.js';
import type { Texts } from '../http/text.js';
import { run } from '../stateui/run.js';
import type { Stamps } from '../storage/Stamps.js';
import { alone, userAppsLock } from '../storage/exclusive.js';
import type { Exclusive } from '../storage/exclusive.js';

/** The name of each person's "Your apps" app, which Magnetic makes in their workspace and shows at `/` */
export const HOME_APP = 'your-apps';
/** The model of an app's card on the home app */
const CARD_MODEL = 'app-card';

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
}

/** The cards of a list, keyed by id in their order, as a record grid reads them */
function byId(cards: readonly HomeCard[]): Record<string, HomeCard> {
    return Object.fromEntries(cards.map((card) => [card.id, card]));
}

/** A grid of app cards; pressing one raises `open` with the app's id */
function grid(records: string): Record<string, unknown> {
    return {
        component: 'recordGrid',
        theme: { recordgrid: { itemheight: 'calc({size.control.md} * 2)' } },
        '<-records': records,
        row: { component: 'card', elevation: 'flat', interactive: true, '<-_title': '$row.name', '<-_subtitle': '$row.note', on: { press: { command: 'emit', target: 'open', from: '$row.id' } } }
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
                        join: { component: 'button', size: 'sm', _title: t['home.join'], on: { press: { command: 'emit', target: 'inviteJoin', from: '$row.id' } } },
                        decline: { component: 'button', size: 'sm', variant: 'ghost', _title: t['home.decline'], on: { press: { command: 'emit', target: 'inviteDecline', from: '$row.id' } } }
                    }
                }
            }
        }
    };
}

/** Where the home app keeps the name typed for a new app */
const MAKE_VALUE = '$.screens.home.children.page.children.new.children.make.value';

/** Whether the invites box hides: while no invite waits */
const INVITES_HIDDEN = '$.screens.home.children.page.children.invitesBox.hidden';

/** Where the home app keeps the person's choices of mode and language, which its menus show */
const TOP = '$.screens.home.children.page.children.top.children';

/**
 * The home screen, in a centred column: Magnetic, the menus of mode and language (`mode`, `language`), the org
 * settings (`orgs`) and Sign out (`signout`), a field and a button that make an app (`create`, with the name), the person's apps, the apps shared
 * with them, and their editor (`editEditor`, `resetEditor`). Each `emit` reaches the page (`stateui:emit`), whose script acts on it
 */
function homeScreen(t: Texts): Record<string, unknown> {
    const menu = (target: string, label: string, options: Record<string, { _label: string }>): Record<string, unknown> => ({
        component: 'selectField',
        size: 'sm',
        _label: label,
        options,
        value: '',
        on: { change: { command: 'emit', target, from: `${TOP}.${target}.value` } }
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
                            orgs: { component: 'button', variant: 'ghost', size: 'sm', _title: t['home.orgs'], on: { press: { command: 'emit', target: 'orgs' } } },
                            connections: { component: 'button', variant: 'ghost', size: 'sm', _title: t['home.connections'], on: { press: { command: 'emit', target: 'connections' } } },
                            data: { component: 'button', variant: 'ghost', size: 'sm', _title: t['home.data'], on: { press: { command: 'emit', target: 'data' } } },
                            billing: { component: 'button', variant: 'ghost', size: 'sm', _title: t['home.billing'], on: { press: { command: 'emit', target: 'billing' } } },
                            signout: { component: 'button', variant: 'ghost', size: 'sm', _title: t['home.signOut'], on: { press: { command: 'emit', target: 'signout' } } }
                        }
                    },
                    // Shown only while invites wait (the page writes its hidden)
                    invitesBox: {
                        component: 'panel',
                        bordered: true,
                        hidden: true,
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
                            make: { component: 'textField', placement: { grow: 1 }, _label: t['home.name'], _placeholder: t['home.namePlaceholder'], value: '' },
                            create: { component: 'button', _title: t['home.make'], on: { press: { command: 'emit', target: 'create', from: MAKE_VALUE } } }
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
                            make: { component: 'button', size: 'sm', variant: 'soft', _title: t['home.makeOrg'], on: { press: { command: 'emit', target: 'orgs' } } }
                        }
                    },
                    orgsHint: { component: 'text', textRole: 'caption', _text: t['home.orgsText'] },
                    orgs: { ...grid('$.data.orgs'), row: { ...(grid('$.data.orgs')['row'] as Record<string, unknown>), on: { press: { command: 'emit', target: 'openOrg', from: '$row.id' } } } },
                    editor: {
                        component: 'panel',
                        bordered: true,
                        _title: t['home.editorTitle'],
                        _description: t['home.editorText'],
                        layout: { type: 'row', gap: 'sm', align: 'center', wrap: true },
                        children: {
                            edit: { component: 'button', variant: 'soft', icon: 'pencil', _title: t['home.editEditor'], on: { press: { command: 'emit', target: 'editEditor' } } },
                            reset: { component: 'button', variant: 'ghost', tone: 'danger', _title: t['home.resetEditor'], on: { press: { command: 'emit', target: 'resetEditor' } } }
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

/** The definition of the home app in a language, beside its name */
function homeDefinition(language: Language): Record<string, unknown> {
    const t = textsOf(language);
    return {
        title: t['home.appsTitle'],
        data: { apps: { model: CARD_MODEL, scope: 'persona' }, shared: { model: CARD_MODEL, scope: 'persona' }, orgs: { model: CARD_MODEL, scope: 'persona' }, invites: { model: CARD_MODEL, scope: 'persona' } },
        home: homeScreen(t)
    };
}

/** Changes when the definition does, or its language, so a workspace made with another one gets the new one */
function homeStamp(language: Language): string {
    return createHash('sha256').update(JSON.stringify({ CARD_FIELDS, definition: homeDefinition(language) })).digest('hex').slice(0, 16);
}

/**
 * Each person's "Your apps": a StateUI app in their own workspace, built with the same tools the agent uses. It is made
 * the first time it is needed, and made again when Magnetic ships a new definition or the person changes language (the
 * stamp kept for the workspace differs); each visit writes the lists of apps and the person's choices into
 * its data, so it is never stale
 */
export class HomeApps {
    /** The id of each workspace's home app, once known, and the language it was made in */
    private readonly ids = new WeakMap<Services, { readonly language: Language; readonly id: Promise<string> }>();

    constructor(
        private readonly toolsOf: (services: Services) => readonly UiToolDefinition[],
        /** Where the version of the home app made in each workspace is kept */
        private readonly stamps: Stamps,
        /** Keeps two servers from making the same person's home app at once */
        private readonly exclusive: Exclusive = alone
    ) {}

    /** The id of the home app of a person's workspace in a language, making it first when it has none in that language */
    id(services: Services, userId: string, language: Language = 'en'): Promise<string> {
        const known = this.ids.get(services);
        if (known !== undefined && known.language === language) return known.id;
        const id = (known?.id.catch(() => undefined) ?? Promise.resolve()).then(() => this.ensure(services, userId, language));
        id.catch(() => this.ids.delete(services));
        this.ids.set(services, { language, id });
        return id;
    }

    private async ensure(services: Services, userId: string, language: Language): Promise<string> {
        const HOME_STAMP = homeStamp(language);
        const current = async () => ({
            stamp: (await this.stamps.get<{ stamp?: string }>(userId, 'home'))?.stamp,
            existing: (await services.instanceViews.list()).find((app) => app.name === HOME_APP)
        });
        const first = await current();
        if (first.existing !== undefined && first.stamp === HOME_STAMP) return first.existing.id;
        return this.exclusive(userAppsLock(userId), async () => {
            // Another server may have made it meanwhile, past what this server's index of the parts has heard
            services.resyncParts();
            const { stamp, existing } = await current();
            if (existing !== undefined && stamp === HOME_STAMP) return existing.id;
            return this.make(services, userId, language, HOME_STAMP, existing?.revision);
        });
    }

    /** Makes the home app again, in place of the one at `replacing` */
    private async make(services: Services, userId: string, language: Language, HOME_STAMP: string, replacing: number | undefined): Promise<string> {
        const existing = replacing === undefined ? undefined : { revision: replacing };
        const tools = this.toolsOf(services);
        if (existing !== undefined) await run(tools, 'ui_delete', { kind: 'apps', name: HOME_APP, expectedRevision: existing.revision });
        const models = await run(tools, 'ui_list', { kind: 'models' }).catch(() => ({}));
        if (!JSON.stringify(models).includes(`"${CARD_MODEL}"`)) {
            await run(tools, 'ui_model_write', { model: CARD_MODEL, operations: CARD_FIELDS });
        }
        const created = await run(tools, 'ui_app_create', { name: HOME_APP, ...homeDefinition(language) });
        if (typeof created['id'] !== 'string') throw new Error('ui_app_create gave no id');
        await this.stamps.set(userId, 'home', { stamp: HOME_STAMP });
        return created['id'];
    }

    /** The lists the home app holds now, in their order */
    async read(services: Services, userId: string, language: Language = 'en'): Promise<HomeData> {
        await this.id(services, userId, language);
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
     * choices and empties the name field
     */
    async show(services: Services, userId: string, data: HomeData, prefs: Preferences = { mode: 'system', language: 'en' }): Promise<void> {
        await this.id(services, userId, prefs.language);
        const tools = this.toolsOf(services);
        await run(tools, 'ui_state_set', { app: HOME_APP, path: '$.data.apps', value: byId(data.apps), logic: false });
        await run(tools, 'ui_state_set', { app: HOME_APP, path: '$.data.shared', value: byId(data.shared), logic: false });
        await run(tools, 'ui_state_set', { app: HOME_APP, path: '$.data.orgs', value: byId(data.orgs ?? []), logic: false });
        await run(tools, 'ui_state_set', { app: HOME_APP, path: '$.data.invites', value: byId(data.invites ?? []), logic: false });
        await run(tools, 'ui_state_set', { app: HOME_APP, path: INVITES_HIDDEN, value: (data.invites ?? []).length === 0, logic: false });
        await run(tools, 'ui_state_set', { app: HOME_APP, path: MAKE_VALUE, value: '', logic: false });
        await run(tools, 'ui_state_set', { app: HOME_APP, path: `${TOP}.mode.value`, value: prefs.mode, logic: false });
        await run(tools, 'ui_state_set', { app: HOME_APP, path: `${TOP}.language.value`, value: prefs.language, logic: false });
    }
}
