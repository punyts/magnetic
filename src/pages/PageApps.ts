import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { Services, UiToolDefinition } from '@punyts/stateui-mcp';
import { LOGO_SVG } from '../http/logo.js';
import { textsOf } from '../http/text.js';
import type { Texts } from '../http/text.js';
import { writeLocales } from '../stateui/localize.js';
import { run } from '../stateui/run.js';
import { ensureMagneticTheme, MAGNETIC_THEME, THEME_STAMP } from '../stateui/theme.js';
import { readJson, writeJsonAtomic } from '../storage/jsonFile.js';

/** A page app as a page mounts it: its assembled document and icons */
export interface PageAppDocument {
    readonly document: Record<string, unknown>;
    readonly icons: Record<string, string>;
}

/** What a page app is made for on this server: the sign-in providers and the development users */
export interface PageAppContext {
    readonly providers: readonly { readonly name: string; readonly label: string }[];
    readonly devUsers: readonly string[];
}

/** One of Magnetic's own pages as a StateUI app: its name, the models of its data, and its definition in English */
interface PageAppSpec {
    readonly name: string;
    readonly models: (context: PageAppContext) => Record<string, readonly Record<string, unknown>[]>;
    readonly definition: (t: Texts, context: PageAppContext) => Record<string, unknown>;
}

/** Magnetic's logo, as a frame (which has no network) can show it */
const LOGO = `data:image/svg+xml;base64,${Buffer.from(LOGO_SVG).toString('base64')}`;

/** Magnetic's name with its logo, as the top of a page */
function brand(): Record<string, unknown> {
    return {
        component: 'panel',
        padding: 'none',
        layout: { type: 'row', gap: 'sm', align: 'center' },
        children: {
            logo: { component: 'image', src: LOGO, decorative: true, ratio: '1:1', fit: 'contain', placement: { height: '40px' } },
            name: { component: 'text', textRole: 'display', placement: { grow: 1 }, _text: 'Magnetic' }
        }
    };
}

const emit = (target: string, from?: string): Record<string, unknown> => ({ command: 'emit', target, ...(from !== undefined && { from }) });
const field = (name: string, type: string, value: unknown): Record<string, unknown> => ({ op: 'set', field: name, type, default: value });

/** A centred column of a page, as Your apps has it */
function centred(children: Record<string, unknown>): Record<string, unknown> {
    return {
        component: 'panel',
        padding: 'lg',
        layout: { type: 'grid', cols: 12, collapseBelow: 'md' },
        children: { page: { component: 'panel', padding: 'none', placement: { col: 4, span: 6 }, layout: { type: 'column', gap: 'lg' }, children } }
    };
}

/**
 * Sign in: Magnetic and what it does, why the last sign-in failed, a button per provider (`provider`, with its name)
 * and, on a development server, a button per test user (`dev`, with the name). The buttons are the server's, so the app
 * is made for them; the labels of the development users are data, in the visitor's language
 */
const SIGN_IN: PageAppSpec = {
    name: 'magnetic-signin',
    models: (context) => ({
        // A label per development user, so each button links to a field that is there from the start
        'magnetic-signin': [field('error', 'string', ''), field('noError', 'boolean', true), field('labels', 'object', Object.fromEntries(context.devUsers.map((_, index) => [`u${index}`, ''])))]
    }),
    definition: (t, context) => {
        const stack = (children: Record<string, unknown>): Record<string, unknown> => ({ component: 'panel', padding: 'none', layout: { type: 'column', gap: 'sm', align: 'start' }, children });
        const providers = Object.fromEntries(context.providers.map((provider, index) => [`p${index}`, { component: 'button', _title: provider.label, on: { press: { command: 'emit', target: 'provider', value: provider.name } } }]));
        const users = Object.fromEntries(context.devUsers.map((name, index) => [`u${index}`, { component: 'button', variant: 'soft', '<-_title': `$.data.signin.labels.u${index}`, on: { press: { command: 'emit', target: 'dev', value: name } } }]));
        return {
            title: t['signin.title'],
            data: { signin: { model: 'magnetic-signin', scope: 'persona' } },
            home: centred({
                brand: brand(),
                tagline: { component: 'text', _text: t['signin.tagline'] },
                error: { component: 'alert', tone: 'danger', '<-_title': '$.data.signin.error', '<-hidden': '$.data.signin.noError' },
                ...(context.providers.length > 0 && { providers: stack(providers) }),
                ...(context.devUsers.length > 0 && {
                    dev: {
                        component: 'panel',
                        padding: 'none',
                        layout: { type: 'column', gap: 'sm' },
                        children: {
                            title: { component: 'text', textRole: 'heading', _text: t['signin.devTitle'] },
                            note: { component: 'text', textRole: 'caption', _text: t['signin.devNote'] },
                            users: stack(users)
                        }
                    }
                }),
                ...(context.providers.length === 0 && context.devUsers.length === 0 && { none: { component: 'text', textRole: 'caption', _text: t['signin.none'] } })
            })
        };
    }
};

/**
 * A share link that does not open an app at once: its title and why, Your apps (`home`), and for a remix link the
 * offer to copy the app (`remix`)
 */
const LINK: PageAppSpec = {
    name: 'magnetic-link',
    models: () => ({
        'magnetic-linkpage': [field('title', 'string', ''), field('message', 'string', ''), field('noRemix', 'boolean', true)]
    }),
    definition: (t) => ({
        title: 'Magnetic',
        data: { link: { model: 'magnetic-linkpage', scope: 'persona' } },
        home: centred({
            brand: brand(),
            top: {
                component: 'panel',
                padding: 'none',
                layout: { type: 'row', gap: 'md', align: 'center' },
                children: {
                    title: { component: 'text', textRole: 'title', placement: { grow: 1 }, '<-_text': '$.data.link.title' },
                    home: { component: 'button', variant: 'ghost', size: 'sm', _title: t['link.home'], on: { press: emit('home') } }
                }
            },
            message: { component: 'text', '<-_text': '$.data.link.message' },
            remix: {
                component: 'panel',
                padding: 'none',
                '<-hidden': '$.data.link.noRemix',
                layout: { type: 'column', gap: 'sm' },
                children: {
                    remix: { component: 'button', _title: t['link.remix'], on: { press: emit('remix') } },
                    note: { component: 'text', textRole: 'caption', _text: t['link.remixNote'] }
                }
            }
        })
    })
};

export const PAGE_APPS = { signIn: SIGN_IN, link: LINK } as const;

/**
 * Magnetic's own pages before (or without) a workspace of a person's: StateUI apps made in the system workspace with
 * the tools the agent uses, in English with the other languages as locales, made again when Magnetic ships new ones.
 * Their documents are served to the pages, which fill their data and act on their emits
 */
export class PageApps {
    private readonly built = new Map<string, Promise<PageAppDocument>>();

    constructor(
        private readonly workspace: () => Promise<{ readonly services: Services; readonly release: () => void }>,
        private readonly toolsOf: (services: Services) => readonly UiToolDefinition[],
        private readonly stampDir: string,
        /** What this server signs in with, which the sign-in page shows */
        private readonly context: PageAppContext = { providers: [], devUsers: [] }
    ) {}

    document(spec: PageAppSpec): Promise<PageAppDocument> {
        let built = this.built.get(spec.name);
        if (built === undefined) {
            built = this.build(spec);
            built.catch(() => this.built.delete(spec.name));
            this.built.set(spec.name, built);
        }
        return built;
    }

    private async build(spec: PageAppSpec): Promise<PageAppDocument> {
        const { services, release } = await this.workspace();
        try {
            const tools = this.toolsOf(services);
            const made = spec.definition(textsOf('en'), this.context);
            const models = spec.models(this.context);
            const stamp = createHash('sha256').update(JSON.stringify({ models, theme: THEME_STAMP, made, texts: ['de', 'fr', 'es'].map((language) => textsOf(language as 'de')) })).digest('hex').slice(0, 16);
            const stampFile = join(this.stampDir, `${spec.name}.json`);
            const kept = (await readJson<{ stamp?: string }>(stampFile))?.stamp;
            let listed = (await services.instanceViews.list()).find((app) => app.name === spec.name);
            if (listed === undefined || kept !== stamp) {
                if (listed !== undefined) await run(tools, 'ui_delete', { kind: 'apps', name: spec.name, expectedRevision: listed.revision });
                for (const [model, operations] of Object.entries(models)) {
                    const existing = await run(tools, 'ui_get', { kind: 'models', name: model }).catch(() => undefined);
                    const revision = existing === undefined ? undefined : existing['revision'];
                    await run(tools, 'ui_model_write', { model, operations, ...(typeof revision === 'number' && { expectedRevision: revision }) });
                }
                await ensureMagneticTheme(tools);
                const created = await run(tools, 'ui_app_create', { name: spec.name, themes: [MAGNETIC_THEME], ...made });
                await writeLocales(tools, spec.name, { home: made['home'] }, typeof created['revision'] === 'number' ? created['revision'] : 1);
                await writeJsonAtomic(stampFile, { stamp });
                listed = (await services.instanceViews.list()).find((app) => app.name === spec.name);
            }
            const app = listed === undefined ? undefined : await services.instanceViews.find(listed.id);
            if (app === undefined) throw new Error(`The page app ${spec.name} could not be made`);
            const message = await services.instanceViews.message(app, 'attach');
            return { document: message.document as Record<string, unknown>, icons: { ...message.icons } };
        } finally {
            release();
        }
    }
}
