import { randomUUID } from 'node:crypto';
import { copyAppParts } from '@punyts/stateui-mcp';
import type { CreateUiPartInput, Services, UiPart, UiToolDefinition } from '@punyts/stateui-mcp';
import type { Database } from '@punyts/stateui-pg';
import { LANGUAGES } from '../prefs/Preferences.js';
import { localeOperations } from '../stateui/localize.js';
import { run } from '../stateui/run.js';
import type { Stamps } from '../storage/Stamps.js';
import { alone } from '../storage/exclusive.js';
import type { Exclusive } from '../storage/exclusive.js';
import type { PageAppDocument, PageApps } from './PageApps.js';
import { contractGaps, makePage, pageStamp } from './PageSpec.js';
import type { PageSpec } from './PageSpec.js';
import type { PageSource } from './PersonPages.js';

/** Keeps two servers from making, publishing or resetting a draft at once */
const PAGES_LOCK = 'site-pages';

/** A part as a publish keeps it: what `copyAppParts` needs to make it again */
interface KeptPart {
    readonly id: string;
    readonly kind: UiPart['kind'];
    readonly name: string;
    readonly body: unknown;
}

/** One page as an admin published it (`magnetic_page`) */
export interface Published {
    readonly name: string;
    /** Changes with every publish: a person's unchanged copy is made again from the new one */
    readonly stamp: string;
    /** The stamp of Magnetic's code the draft was made from */
    readonly base: string;
    readonly document: Record<string, unknown>;
    readonly icons: Record<string, string>;
    /** The app (first) and every part it reaches */
    readonly parts: readonly KeptPart[];
    /** The English of each text, by `<screen> <path>` */
    readonly english: Record<string, string>;
    readonly publishedBy: string;
    readonly publishedAt: Date;
}

/** A page as the admin's Pages list shows it */
export interface PageStatus {
    readonly name: string;
    readonly title: string;
    /** The draft's id, once an admin opened it */
    readonly draftId?: string;
    /** Whether the draft differs from what is served */
    readonly unpublished: boolean;
    readonly published?: { readonly by: string; readonly at: Date };
    /** Magnetic's code changed since the published version's draft was made from it */
    readonly newer: boolean;
}

/** What is kept of a draft: the code it was made from, the revision it was left at, and the English then */
interface DraftStamp {
    readonly base: string;
    readonly revision: number;
    readonly english: Record<string, string>;
    /** The draft's revision at its last publish */
    readonly publishedRevision?: number;
}

/** The English of each content text of an assembled document's screens, by `<screen> <path from root>` */
export function englishOf(document: Record<string, unknown>): Record<string, string> {
    const texts: Record<string, string> = {};
    const visit = (value: unknown, at: string): void => {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) return;
        for (const [key, inner] of Object.entries(value)) {
            if (key.startsWith('_') && typeof inner === 'string') texts[`${at}.${key}`] = inner;
            else if (!key.startsWith('<-') && key !== 'on') visit(inner, `${at}.${key}`);
        }
    };
    for (const [screen, body] of Object.entries((document['screens'] as Record<string, { root?: unknown }> | undefined) ?? {})) visit(body.root, `${screen} root`);
    return texts;
}

/** Whether a locale overlay of a screen has an entry at a path from its root (`root.children.a._text`) */
function overlayHas(overlay: unknown, path: string): boolean {
    let at = overlay;
    for (const key of path.split('.').slice(1)) {
        if (typeof at !== 'object' || at === null) return false;
        at = (at as Record<string, unknown>)[key];
    }
    return at !== undefined;
}

/** A store of parts in memory, over a publish's parts, which `copyAppParts` reads from or writes to */
function memoryParts(parts: KeptPart[] = []) {
    return {
        parts,
        findById: async <K extends UiPart['kind']>(kind: K, id: string) => parts.find((part) => part.kind === kind && part.id === id) as UiPart<K> | undefined,
        findByName: async <K extends UiPart['kind']>(kind: K, name: string) => parts.find((part) => part.kind === kind && part.name === name) as UiPart<K> | undefined,
        create: async <K extends UiPart['kind']>(input: CreateUiPartInput<K>) => {
            const part = { id: input.id ?? randomUUID(), kind: input.kind, name: input.name, body: input.body, revision: 1, createdAt: new Date(), updatedAt: new Date() };
            // The app comes last from a copy: keep it first, where a person's copy starts from
            if (input.kind === 'apps') parts.unshift(part);
            else parts.push(part);
            return { kind: 'created' as const, part: part as unknown as UiPart<K> };
        }
    };
}

/**
 * Magnetic's own pages as admins edit them (docs/design/magnetic-editable.md). Each page has:
 * - Magnetic's code version, in the system workspace (`PageApps`), served until a page is published, always at
 *   `?page=default`, and what a page that does not load falls back to;
 * - an admin's **draft**, an app in the pages workspace, opened in the editor like any app;
 * - what was **published** from it (`magnetic_page`): the document pages serve and the parts a person's copy is made
 *   from.
 *
 * It is the `PageSource` of the people's copies of Your apps and the editor
 */
export class SitePages implements PageSource {
    /** The last published row read of each page, by its stamp */
    private readonly cache = new Map<string, Published>();

    constructor(
        private readonly db: Database,
        /** The id of the pages workspace: the company org's, or Magnetic's own without one */
        readonly workspaceId: string,
        /** The pages workspace, where the drafts are */
        private readonly workspace: () => Promise<{ readonly services: Services; readonly release: () => void }>,
        private readonly toolsOf: (services: Services) => readonly UiToolDefinition[],
        private readonly stamps: Stamps,
        /** Magnetic's code version of each page */
        private readonly code: PageApps,
        readonly pages: readonly PageSpec[],
        private readonly exclusive: Exclusive = alone
    ) {}

    /** A page by its app name */
    spec(name: string): PageSpec | undefined {
        return this.pages.find((page) => page.name === name);
    }

    /** What an admin published of a page, or undefined while Magnetic's code version is served */
    async published(name: string): Promise<Published | undefined> {
        const stamp = (await this.db.query<{ stamp: string }>('SELECT stamp FROM magnetic_page WHERE name = $1', [name])).rows[0]?.stamp;
        if (stamp === undefined) {
            this.cache.delete(name);
            return undefined;
        }
        const cached = this.cache.get(name);
        if (cached?.stamp === stamp) return cached;
        const row = (
            await this.db.query<{ stamp: string; base: string; document: Record<string, unknown>; icons: Record<string, string>; parts: KeptPart[]; english: Record<string, string>; published_by: string; published_at: Date }>(
                'SELECT stamp, base, document, icons, parts, english, published_by, published_at FROM magnetic_page WHERE name = $1',
                [name]
            )
        ).rows[0];
        if (row === undefined) return undefined;
        const published: Published = { name, stamp: row.stamp, base: row.base, document: row.document, icons: row.icons, parts: row.parts, english: row.english, publishedBy: row.published_by, publishedAt: row.published_at };
        this.cache.set(name, published);
        return published;
    }

    /** The document a page serves: what was published, or Magnetic's code version */
    async served(spec: PageSpec): Promise<PageAppDocument & { readonly id: string; readonly published: boolean }> {
        const published = await this.published(spec.name);
        if (published !== undefined) return { id: (published.parts[0] as KeptPart).id, document: published.document, icons: published.icons, published: true };
        return { ...(await this.code.document(spec)), published: false };
    }

    /** Magnetic's code version of a page, whatever was published */
    codeDocument(spec: PageSpec): Promise<PageAppDocument & { readonly id: string }> {
        return this.code.document(spec);
    }

    async stamp(spec: PageSpec): Promise<string> {
        return (await this.published(spec.name))?.stamp ?? pageStamp(spec);
    }

    /** Makes a person's copy from what was published, or from the code */
    async make(spec: PageSpec, tools: readonly UiToolDefinition[], services: Services): Promise<{ id: string; revision: number }> {
        const published = await this.published(spec.name);
        if (published === undefined) return makePage(tools, spec);
        const app = published.parts[0] as KeptPart;
        const copied = await copyAppParts(memoryParts([...published.parts]), services.parts, app.id, { name: spec.name });
        if (copied.kind !== 'copied') throw new Error(`The published ${spec.name} could not be copied: ${copied.kind === 'failed' ? copied.reason : 'not found'}`);
        services.resyncParts();
        return { id: copied.app.id, revision: copied.app.revision };
    }

    /** The draft of a page, made from Magnetic's code the first time, and again when the code changed and the draft did not */
    async draft(spec: PageSpec): Promise<string> {
        return this.inPages(async (services, tools) => {
            const found = await this.findDraft(services, spec);
            const kept = await this.stamps.get<DraftStamp>(this.workspaceId, `draft:${spec.name}`);
            if (found !== undefined && (kept === undefined || kept.base === pageStamp(spec) || kept.revision !== found.revision)) return found.id;
            return this.exclusive(PAGES_LOCK, async () => {
                services.resyncParts();
                const again = await this.findDraft(services, spec);
                if (again !== undefined) await run(tools, 'ui_delete', { kind: 'apps', name: spec.name, expectedRevision: again.revision });
                return (await this.makeDraft(services, tools, spec)).id;
            });
        });
    }

    /**
     * Publishes a page's draft: refused, with the reasons, when it does not validate or lacks part of the page's contract.
     * The translations of texts whose English changed since the last publish are dropped from the draft first (other
     * languages show the new English), and Magnetic's own texts are translated again
     */
    async publish(spec: PageSpec, userId: string): Promise<{ readonly published: true } | { readonly refused: readonly string[] }> {
        return this.inPages((services, tools) =>
            this.exclusive(PAGES_LOCK, async () => {
                services.resyncParts();
                const draft = await this.findDraft(services, spec);
                if (draft === undefined) return { refused: ['There is no draft to publish: open it in the editor first'] };
                const validation = await run(tools, 'ui_validate', { app: spec.name }).catch((error: unknown) => ({ valid: false, errors: [error instanceof Error ? error.message : String(error)] }));
                if (validation['valid'] === false) return { refused: ((validation['errors'] as unknown[] | undefined) ?? ['It does not validate']).map((error) => (typeof error === 'string' ? error : String((error as { message?: unknown }).message ?? JSON.stringify(error)))) };
                let document = await this.assembled(services, draft.id);
                const gaps = contractGaps(spec, document.document);
                if (gaps.length > 0) return { refused: gaps };
                const kept = await this.stamps.get<DraftStamp>(this.workspaceId, `draft:${spec.name}`);
                const before = (await this.published(spec.name))?.english ?? kept?.english ?? {};
                const now = englishOf(document.document);
                let revision = await this.retranslate(tools, spec, document.document, before, now, draft.revision);
                if (revision !== draft.revision) document = await this.assembled(services, draft.id);
                const bundle = memoryParts();
                const copied = await copyAppParts(services.parts, bundle, draft.id, { name: spec.name, keepId: true, functions: services.functions });
                if (copied.kind !== 'copied') return { refused: [copied.kind === 'failed' ? copied.reason : 'The draft is gone'] };
                if (copied.missingFunctions !== undefined && copied.missingFunctions.length > 0) {
                    return { refused: copied.missingFunctions.map((path) => `It names ${path}, a function this server does not run`) };
                }
                const stamp = randomUUID();
                await this.db.query(
                    `INSERT INTO magnetic_page (name, stamp, base, document, icons, parts, english, published_by, published_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
                     ON CONFLICT (name) DO UPDATE SET stamp = EXCLUDED.stamp, base = EXCLUDED.base, document = EXCLUDED.document, icons = EXCLUDED.icons, parts = EXCLUDED.parts, english = EXCLUDED.english, published_by = EXCLUDED.published_by, published_at = EXCLUDED.published_at`,
                    [spec.name, stamp, kept?.base ?? pageStamp(spec), JSON.stringify(document.document), JSON.stringify(document.icons), JSON.stringify(bundle.parts), JSON.stringify(now), userId]
                );
                revision = (await this.findDraft(services, spec))?.revision ?? revision;
                await this.stamps.set(this.workspaceId, `draft:${spec.name}`, { ...(kept ?? { base: pageStamp(spec), english: now }), revision: kept?.revision ?? revision, publishedRevision: revision });
                this.cache.delete(spec.name);
                return { published: true as const };
            })
        );
    }

    /** Puts a page back to Magnetic's: the published version goes, so the code's is served, and the draft is made again */
    async reset(spec: PageSpec): Promise<void> {
        await this.inPages((services, tools) =>
            this.exclusive(PAGES_LOCK, async () => {
                services.resyncParts();
                await this.db.query('DELETE FROM magnetic_page WHERE name = $1', [spec.name]);
                this.cache.delete(spec.name);
                const draft = await this.findDraft(services, spec);
                if (draft !== undefined) await run(tools, 'ui_delete', { kind: 'apps', name: spec.name, expectedRevision: draft.revision });
                await this.makeDraft(services, tools, spec);
            })
        );
    }

    /** Every page as the Pages list shows it */
    async status(): Promise<PageStatus[]> {
        return this.inPages(async (services) => {
            const statuses: PageStatus[] = [];
            for (const spec of this.pages) {
                const draft = await this.findDraft(services, spec);
                const kept = await this.stamps.get<DraftStamp>(this.workspaceId, `draft:${spec.name}`);
                const published = await this.published(spec.name);
                const changed = draft !== undefined && kept !== undefined && kept.revision !== draft.revision;
                statuses.push({
                    name: spec.name,
                    title: spec.title,
                    ...(draft !== undefined && { draftId: draft.id }),
                    unpublished: draft !== undefined && (published === undefined ? changed : kept?.publishedRevision !== draft.revision),
                    ...(published !== undefined && { published: { by: published.publishedBy, at: published.publishedAt } }),
                    newer: published !== undefined && published.base !== pageStamp(spec)
                });
            }
            return statuses;
        });
    }

    /** Whether an app is one of the drafts: the pages workspace holds nothing else */
    async isDraft(appId: string): Promise<boolean> {
        return this.inPages(async (services) => (await services.instanceViews.find(appId)) !== undefined);
    }

    private async inPages<T>(work: (services: Services, tools: readonly UiToolDefinition[]) => Promise<T>): Promise<T> {
        const { services, release } = await this.workspace();
        try {
            return await work(services, this.toolsOf(services));
        } finally {
            release();
        }
    }

    private async findDraft(services: Services, spec: PageSpec): Promise<{ readonly id: string; readonly revision: number } | undefined> {
        return (await services.instanceViews.list()).find((app) => app.name === spec.name);
    }

    private async makeDraft(services: Services, tools: readonly UiToolDefinition[], spec: PageSpec): Promise<{ id: string; revision: number }> {
        const made = await makePage(tools, spec);
        for (const [path, value] of Object.entries(spec.sample ?? {})) await run(tools, 'ui_state_set', { app: spec.name, path, value, logic: false });
        const revision = (await this.findDraft(services, spec))?.revision ?? made.revision;
        const document = await this.assembled(services, made.id);
        await this.stamps.set(this.workspaceId, `draft:${spec.name}`, { base: pageStamp(spec), revision, english: englishOf(document.document) });
        return { id: made.id, revision };
    }

    private async assembled(services: Services, id: string): Promise<PageAppDocument> {
        const app = await services.instanceViews.find(id);
        if (app === undefined) throw new Error('The draft is gone');
        const message = await services.instanceViews.message(app, 'attach');
        return { document: message.document as Record<string, unknown>, icons: { ...message.icons } };
    }

    /**
     * Drops each translation of a text whose English changed from `before` to `now`, then writes Magnetic's own
     * translations over every screen again; answers the draft's revision after
     */
    private async retranslate(tools: readonly UiToolDefinition[], spec: PageSpec, document: Record<string, unknown>, before: Record<string, string>, now: Record<string, string>, revision: number): Promise<number> {
        let at = revision;
        const screens = (document['screens'] as Record<string, { root?: unknown; locales?: Record<string, unknown> }> | undefined) ?? {};
        for (const [screen, body] of Object.entries(screens)) {
            const changed = Object.keys(now)
                .filter((key) => key.startsWith(`${screen} `) && before[key] !== undefined && before[key] !== now[key])
                .map((key) => key.slice(screen.length + 1));
            for (const language of LANGUAGES) {
                if (language === 'en') continue;
                const overlay = body.locales?.[language];
                const operations = [
                    ...changed.filter((path) => overlayHas(overlay, path)).map((path) => ({ op: 'remove', path })),
                    ...localeOperations(body.root, language).filter((operation) => !overlayHas(overlay, operation.path) || changed.includes(operation.path))
                ];
                for (let start = 0; start < operations.length; start += 50) {
                    const written = await run(tools, 'ui_locale_write', { app: spec.name, screen, language, expectedRevision: at, operations: operations.slice(start, start + 50) });
                    if (typeof written['revision'] === 'number') at = written['revision'];
                }
            }
        }
        return at;
    }
}
