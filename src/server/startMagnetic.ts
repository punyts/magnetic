import type { IncomingMessage, ServerResponse } from 'node:http';
import { appNamespace, COMMON_HEADERS, copyAppParts, createServices, createStateUiTools, DEFAULT_PERSONA, hostPageCsp, HttpError, installShowcaseInto, loadCatalogFile, loadChunk3d, loadHostScript, loadRuntimeBundle, requestHostName, startHttpServer } from '@punyts/stateui-mcp';
import type { AppLogicLimits, HttpTenant, PreviewBrowser, Services, TenantAnswer, UiToolDefinition } from '@punyts/stateui-mcp';
import type { Report } from '@punyts/core';
import type { Database } from '@punyts/stateui-pg';
import { Stamps } from '../storage/Stamps.js';
import { Accounts } from '../accounts/Accounts.js';
import { ClaudeModel } from '../agent/AgentModel.js';
import type { AgentModel } from '../agent/AgentModel.js';
import { AgentTurns, CONTEXT_TOGGLES } from '../agent/AgentTurns.js';
import type { ContextToggle, TurnLimits } from '../agent/AgentTurns.js';
import { Budgets, DEFAULT_BUDGETS } from '../agent/Budgets.js';
import type { BudgetLimits } from '../agent/Budgets.js';
import { Chats } from '../agent/Chats.js';
import { agentSystemPrompt } from '../agent/instructions.js';
import { AGENT_MODELS, modelChoice } from '../agent/models.js';
import { HOME_CSS, HOME_JS, homePage } from '../http/home.js';
import { privacyPage } from '../http/privacy.js';
import type { PrivacyContact } from '../http/privacy.js';
import { databaseExclusive } from '../storage/exclusive.js';
import { SHELL_CSS, SHELL_JS, shellPage } from '../http/shell.js';
import { HOME, HOME_APP, HomeApps } from '../home/HomeApp.js';
import { isLanguage, isMode, languageOf, PreferenceStore } from '../prefs/Preferences.js';
import type { Preferences } from '../prefs/Preferences.js';
import { fill, textsOf } from '../http/text.js';
import { INSPECT_JS } from '../http/inspect.js';
import { SCREENS_JS } from '../http/screens.js';
import { VIEWS_CSS, VIEWS_JS } from '../http/views.js';
import type { Mailer } from '../mail/Mailer.js';
import { Connections } from '../connections/Connections.js';
import { connectionFacts, paramsOf } from '../connections/facts.js';
import type { GuardOptions } from '../connections/guard.js';
import { CallLimits, HTTP_EFFECT, httpEffect } from '../connections/httpEffect.js';
import { connectionRoutes } from './connectionRoutes.js';
import { viewRoutes } from './viewRoutes.js';
import { dataRoutes } from './dataRoutes.js';
import { billingRoutes } from './billingRoutes.js';
import { Credits } from '../billing/Credits.js';
import { Feedback, FEEDBACK_KINDS, FEEDBACK_PER_HOUR, MAX_FEEDBACK_LENGTH } from '../feedback/Feedback.js';
import { Admin, AdminList } from '../admin/Admin.js';
import { adminRoutes } from './adminRoutes.js';
import { betaRoutes } from './betaRoutes.js';
import { busyPage, isInstanceBusy } from '../http/busyPage.js';
import { Beta } from '../beta/Beta.js';
import { Stripe } from '../billing/Stripe.js';
import type { StripeOptions } from '../billing/Stripe.js';
import type { LogicInstance } from '@punyts/stateui-mcp';
import { orgTextsOf } from '../http/orgText.js';
import { bindingsOf, childPlacements, layoutTypeOf, logicOf, nodeAt, ownSettings, parentPath, screensOf, titleOf, treeOf } from '../inspector/editInfo.js';
import { COMPONENT_CATEGORIES, PAGES_WORKSPACE_ID, SYSTEM_USER_ID } from '../inspector/constants.js';
import { SitePages } from '../pages/SitePages.js';
import { LAYOUTS } from '@punyts/stateui-app/core';
import { EDITOR, EDITOR_APP, EditorApps } from '../editor/EditorApp.js';
import { PAGE_APPS, PageApps } from '../pages/PageApps.js';
import type { PageAppDocument } from '../pages/PageApps.js';
import type { PageSpec } from '../pages/PageSpec.js';
import { APP_PAGE_CSS, APP_PAGE_JS, appPage } from '../http/appPage.js';
import { run } from '../stateui/run.js';
import type { HomeCard } from '../home/HomeApp.js';
import type { User } from '../accounts/Accounts.js';
import { Sessions, SESSION_DAYS } from '../accounts/Sessions.js';
import { OidcSignIn, safeNext, SignInError } from '../auth/OidcSignIn.js';
import type { OidcProvider } from '../auth/OidcSignIn.js';
import { httpOnlyCookie, readCookie, SESSION_COOKIE, sessionCookie, SIGN_IN_COOKIE } from '../http/cookies.js';
import { LOGO_SVG } from '../http/logo.js';
import { MAGNETIC_CSS, MAGNETIC_PAGE_CSP } from '../http/pages.js';
import type { PageLook, SharedApp } from '../http/pages.js';
import { GRANT_RIGHTS, Grants } from '../sharing/Grants.js';
import { ShareAnswers } from '../sharing/ShareAnswers.js';
import { usd } from '../http/billingPage.js';
import type { Grant, GrantRight } from '../sharing/Grants.js';
import { Workspaces } from '../workspaces/Workspaces.js';
import { SharedData } from '../sharing/SharedData.js';
import { sharedDataFacts, sharedWithWorkspace } from '../sharing/facts.js';
import { allows, AppAccess } from '../orgs/AppAccess.js';
import type { AppPermission } from '../orgs/AppAccess.js';
import { Orgs } from '../orgs/Orgs.js';
import { AppInstances } from '../orgs/Instances.js';
import { OrgPolicies } from '../orgs/Policies.js';
import { OrgDomains } from '../orgs/Domains.js';
import type { TxtResolver } from '../orgs/Domains.js';
import { OrgSso, ssoIdentityProvider } from '../orgs/Sso.js';
import { SignInRules } from '../orgs/SignInRules.js';
import { SecretBox } from '../auth/secrets.js';
import { startStatenetNode } from '../statenet/StatenetNode.js';
import type { StatenetNode, StatenetOptions } from '../statenet/StatenetNode.js';
import { CUSTOM_PROVIDER } from '../auth/OidcSignIn.js';
import { orgRoutes } from './orgRoutes.js';
import { orgSettingsRoutes } from './orgSettingsRoutes.js';
import { assertMigrated, CatalogEmbeddings, EmbeddingIndex, pgWorkspaceStorage, RecordSimilarity } from '@punyts/stateui-pg';
import type { Embedder } from '@punyts/stateui-pg';
import { CHAT_SOURCE } from '../agent/Chats.js';
import { EMBEDDING_SOURCES, Search } from '../search/Search.js';
import { OwnerKeys } from '../grants/OwnerKeys.js';
import { StateGrants } from '../grants/StateGrants.js';
import { grantRoutes } from './grantRoutes.js';
import { SIMILAR_PROCEDURE, similarProcedure, similarTool } from '../search/similar.js';
import { ALL_MIGRATIONS } from '../storage/db.js';
import type { WorkspacesOptions } from '../workspaces/Workspaces.js';

/** The bounds on each app's logic when no others are given: other people's logic runs on this server */
export const DEFAULT_LOGIC_LIMITS: AppLogicLimits = { timerRunsPerSecond: 20 };
/** The text frames a view's socket may send per second when no other number is given */
export const DEFAULT_SOCKET_MESSAGES_PER_SECOND = 50;

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);
const MAX_FORM_BYTES = 4096;
const MAX_TURN_BYTES = 16_384;
const MAX_REQUEST_CHARS = 4000;
/** The routes of the editor's inspector under `/edit/<id>` */
const INSPECT_ROUTES = new Set(['/node', '/nodes', '/components', '/state', '/trace', '/screens']);
/** The largest node write the inspector sends, and its most operations */
const MAX_NODE_WRITE_BYTES = 65_536;
const MAX_NODE_OPERATIONS = 20;
/** A state or node path a person points the agent at ("Ask the agent" in the State tab), and how many a turn takes */
const FOCUS_PATH = /^\$\.(data|app|screens)(\.[A-Za-z0-9_-]{1,64}){0,16}$/;
const MAX_FOCUS = 5;

/** An app part, as the views find it */
type AppPart = NonNullable<Awaited<ReturnType<Services['instanceViews']['find']>>>;

/** True when no screen of an app has anything on it yet: a new app, before the agent builds it */
function isBlank(body: unknown): boolean {
    const screens = isRecord(body) && isRecord(body['screens']) ? Object.values(body['screens']) : [];
    return screens.every((screen) => {
        const root = isRecord(screen) ? screen['root'] : undefined;
        return !isRecord(root) || !isRecord(root['children']) || Object.keys(root['children']).length === 0;
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A random (version 4) UUID: the id of an app made in a workspace, which no other workspace has */
const RANDOM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const APP_PATH = /^\/apps\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i;
/** Said when an org's monthly agent budget is spent: turns in its apps wait for next month */
export const ORG_BUDGET_SPENT = "Your org has used this month's agent budget. Everything else still works, and the agent will be back next month.";
/** Said to a member of an org that keeps its apps in the org, who tries to make one of their own */
/** Said when no org has its own sign-in for the domain of the work email typed */
export const NO_ORG_SIGN_IN = "No organisation signs in here with that email's domain. Sign in another way.";
export const NO_PERSONAL_APPS ='Your org keeps apps in the org, not in your own workspace: make this app in the org instead (Orgs on Your apps).';
/** What a person sees, and their browser is told, when an app shared with them is taken back */
export const REVOKED_MESSAGE = 'This app is no longer shared with you.';

/** The model of the agent when no other is given: the cheapest, as every turn is paid for */
export const DEFAULT_AGENT_MODEL = 'claude-haiku-5-5';
export type AgentEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface MagneticAgentOptions {
    /** Replaces the Claude API, for tests */
    readonly model?: AgentModel;
    /** The model of a turn that names none; default `claude-haiku-5-5` */
    readonly modelName?: string;
    /** The models people may pick in the editor; default Haiku, Sonnet and Opus 5.5 (`AGENT_MODELS`) */
    readonly models?: readonly string[];
    /** Default `high` */
    readonly effort?: AgentEffort;
    /** Default $1 per user per day and $100 per month for the server */
    readonly budgets?: BudgetLimits;
    readonly limits?: TurnLimits;
}

export interface MagneticOptions {
    /** Magnetic's database, migrated (`migrate(db, ALL_MIGRATIONS)`); the server does not close it */
    readonly database: Database;
    /**
     * Makes the vectors of semantic search (apps and parts, the agent's recall of earlier chats), such as
     * `localEmbedder()`; without one there is no semantic search and nothing is queued to embed
     */
    readonly embedder?: Embedder;
    /** How often the embedding worker looks for work; default 2 s */
    readonly embedEveryMs?: number;
    readonly host: string;
    /** 0 picks a free port */
    readonly port: number;
    /** The port of the runtime origin; default the next port (a free one when `port` is 0) */
    readonly runtimePort?: number;
    readonly report: Pick<Report, 'info'>;
    /**
     * Test users who sign in with a button and no provider, for development and tests. Only on a loopback host: a
     * server bound to any other address refuses to start with them
     */
    readonly devUsers?: readonly string[];
    /**
     * The name, verified email and button label of development users who have them (a seeded beta: its admin is an admin
     * by that email). Without one, a development user is their name and has no email
     */
    readonly devProfiles?: Readonly<Record<string, { readonly name: string; readonly email?: string; readonly label?: string }>>;
    /** What a new user's workspace starts with: the component showcase (default) or nothing */
    readonly starter?: 'showcase' | 'none';
    /** The folder of the built runtime bundle; default the one in `@punyts/stateui-app` */
    readonly runtimeDir?: string;
    /** The folder of the built 3D chunk; default the one in `@punyts/stateui-3d` when installed */
    readonly chunk3dDir?: string;
    /** Replaces each workspace's headless browser, for tests */
    readonly browser?: PreviewBrowser;
    readonly logicLimits?: AppLogicLimits;
    readonly socketMessagesPerSecond?: number;
    readonly workspaces?: WorkspacesOptions;
    /** Marks the cookies `Secure`; default on when `publicOrigin` is HTTPS */
    readonly secureCookies?: boolean;
    /** The OpenID Connect providers people sign in with, such as `linkedInProvider(id, secret)` */
    readonly providers?: readonly OidcProvider[];
    /**
     * The origin people reach the server at, such as `https://magnetic.example`; default the origin it listens on.
     * Each provider's redirect URI is `<publicOrigin>/auth/<name>/callback`
     */
    readonly publicOrigin?: string;
    /**
     * The origin of the runtime frame people reach, such as `https://run.magnetic.example`, given with `publicOrigin`
     * when a proxy stands in front. Both set: the pages name these two origins and answer only to their host names.
     * Absent: `http://<Host>:<runtime port>`
     */
    readonly runtimeOrigin?: string;
    /** Who runs this server and where privacy requests go: with them, `/privacy` says what Magnetic keeps. Absent: no such page */
    readonly privacy?: PrivacyContact;
    /** Allows providers over plain HTTP, for a mock provider in tests. Loopback hosts only */
    readonly allowHttpProviders?: boolean;
    readonly agent?: MagneticAgentOptions;
    /**
     * The server's secret key, which seals the secrets it keeps for others (an org's own sign-in client secret); at least
     * 16 characters. Without it, orgs cannot set up their own sign-in
     */
    readonly secretKey?: string;
    /** Sends invites by email (`sesMailer`); without one, an invite's link is only shown to the person who made it */
    readonly mailer?: Mailer;
    /**
     * What an app's calls to outside APIs may reach, for tests and a development server on loopback: http, and private
     * addresses. Refused on any other host
     */
    readonly connectionGuard?: GuardOptions;
    /** Replaces the DNS lookup that verifies an org's domain, for tests */
    readonly resolveTxt?: TxtResolver;
    /**
     * Runs this server as one of several on the database (docs/design/statenet-relays.md, "Topology, in steps", 3): a
     * node of the statenet, owning some instances and reaching the others over the mesh. Needs `secretKey`
     */
    readonly statenet?: StatenetOptions;
    /**
     * People buy more agent use after their allowance (`agent.budgets.perUserTotal`) through Stripe Checkout
     * (docs/design/magnetic-payments.md). Absent: the Agent use page shows the balance only
     */
    readonly payments?: PaymentsOptions;
    /**
     * The verified emails of the people who run the server: they reach the admin pages, `/admin`
     * (docs/design/magnetic-admin.md). Empty or absent: there are none
     */
    readonly admins?: readonly string[];
}

export interface PaymentsOptions {
    readonly stripe: StripeOptions;
    /** The amounts offered, in dollars; default 10, 25 and 50 */
    readonly topUps?: readonly number[];
}

/** The amounts of agent use offered when the server names none */
export const DEFAULT_TOP_UPS: readonly number[] = [10, 25, 50];

export interface RunningMagnetic {
    readonly origin: string;
    /** The database the server was given */
    readonly database: Database;
    readonly port: number;
    readonly runtimePort: number;
    readonly accounts: Accounts;
    readonly sessions: Sessions;
    readonly orgs: Orgs;
    readonly access: AppAccess;
    readonly policies: OrgPolicies;
    readonly domains: OrgDomains;
    readonly sso: OrgSso;
    /** Each owner's signing key */
    readonly keys: OwnerKeys;
    /** The grants of state, when the server can sign (`secretKey`) */
    readonly stateGrants?: StateGrants;
    /** The embedding index, when the server has an embedder */
    readonly index?: EmbeddingIndex;
    /** The records of an app's data binding by meaning (the `similar` call and `data_similar`), when the server has an embedder */
    readonly similarity?: RecordSimilarity;
    readonly workspaces: Workspaces;
    readonly signIn: OidcSignIn;
    readonly turns: AgentTurns;
    readonly budgets: Budgets;
    /** Each workspace's connections to outside APIs */
    readonly connections: Connections;
    readonly grants: Grants;
    /** Each person's "Your apps" */
    readonly homes: HomeApps;
    /** This server's node of the statenet, when it runs as one of several (`statenet`) */
    readonly statenet?: StatenetNode;
    /** Closes the server, the workspaces and their browsers. Safe to call twice */
    stop(): Promise<void>;
}

function redirect(response: ServerResponse, location: string, cookie?: string | string[]): void {
    response.writeHead(303, { ...COMMON_HEADERS, Location: location, 'Cache-Control': 'no-store', ...(cookie !== undefined && { 'Set-Cookie': cookie }) });
    response.end();
}

/**
 * Sends one of Magnetic's own pages. Their forms post to this server, and a browser sends `Origin: null` with a form
 * post from a page whose referrer policy is `no-referrer`, which the same-origin check refuses: these pages send their
 * origin to themselves only (`same-origin`)
 */
function sendPage(response: ServerResponse, html: string, status = 200, cookie?: string, formTargets: readonly string[] = []): void {
    response.writeHead(status, {
        ...(cookie !== undefined && { 'Set-Cookie': cookie }),
        ...COMMON_HEADERS,
        'Referrer-Policy': 'same-origin',
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': formTargets.length === 0 ? MAGNETIC_PAGE_CSP : MAGNETIC_PAGE_CSP.replace("form-action 'self'", "form-action 'self' " + formTargets.join(' ')),
        'Cache-Control': 'no-store'
    });
    response.end(html);
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
    response.writeHead(status, { ...COMMON_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(body));
}

function sendAsset(response: ServerResponse, type: string, body: string): void {
    response.writeHead(200, { ...COMMON_HEADERS, 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-cache' });
    response.end(body);
}

/** A small JSON body */
async function readJsonBody(request: IncomingMessage, limit: number): Promise<unknown> {
    if (!/^application\/json/i.test(request.headers['content-type'] ?? '')) throw new HttpError(415, 'Send JSON', 'unsupported_type');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
        size += buffer.length;
        if (size > limit) throw new HttpError(413, 'The request is too large', 'too_large');
        chunks.push(buffer);
    }
    try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } catch {
        throw new HttpError(400, 'The body is not JSON', 'invalid_json');
    }
}

/** An app name from what a person typed: lower case words joined by dashes */
export function appNameOf(typed: string): string | undefined {
    const name = typed
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
    return /^[a-z][a-z0-9-]*$/.test(name) ? name : undefined;
}

/** The fields of a small `application/x-www-form-urlencoded` body */
async function readForm(request: IncomingMessage): Promise<URLSearchParams> {
    if (!/^application\/x-www-form-urlencoded/i.test(request.headers['content-type'] ?? '')) throw new HttpError(415, 'Send a form', 'unsupported_type');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
        size += buffer.length;
        if (size > MAX_FORM_BYTES) throw new HttpError(413, 'The form is too large', 'too_large');
        chunks.push(buffer);
    }
    return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

/**
 * Starts Magnetic's server: the stateui-mcp browser endpoint with one workspace per signed-in user, and the sign-in
 * pages. A request without a session is sent to `/signin` (a page) or refused with 401 (anything else, sockets too).
 * Each user's apps, files and live state come from their own workspace, so an app id of another user is not found
 */
export async function startMagnetic(options: MagneticOptions): Promise<RunningMagnetic> {
    const devUsers = options.devUsers ?? [];
    if (devUsers.length > 0 && !LOOPBACK.has(options.host.toLowerCase())) throw new Error('Development users are only offered on a loopback host');
    if (options.allowHttpProviders === true && !LOOPBACK.has(options.host.toLowerCase())) throw new Error('Providers over HTTP are only allowed on a loopback host');
    const runtime = loadRuntimeBundle(
        options.runtimeDir,
        loadCatalogFile().components.map((component) => component.name)
    );
    const chunk3d = loadChunk3d(options.chunk3dDir);
    const hostScript = loadHostScript();
    const db = options.database;
    await assertMigrated(db, ALL_MIGRATIONS);
    const accounts = new Accounts(db);
    const sessions = new Sessions(db);
    const stamps = new Stamps(db);
    // Magnetic's own apps are made by one server at a time, as several may share the database
    const exclusive = databaseExclusive(db);
    const orgs = new Orgs(db);
    const access = new AppAccess(db);
    const policies: OrgPolicies = new OrgPolicies(db, (): readonly string[] => turns.models);
    const domains = new OrgDomains(db, orgs, options.resolveTxt);
    const box = options.secretKey === undefined ? undefined : new SecretBox(options.secretKey);
    if (options.connectionGuard !== undefined && (options.connectionGuard.allowHttp === true || options.connectionGuard.allowPrivate === true) && !LOOPBACK.has(options.host.toLowerCase()))
        throw new Error('Calls to http or private addresses are only allowed on a loopback host');
    const connectionGuard = options.connectionGuard ?? {};
    // Outside APIs: each workspace's connections, the calls each app made this minute, and the facts the agent is told
    const connections = new Connections(db, box, connectionGuard);
    const callLimits = new CallLimits();
    /** Whether a workspace's apps may call out: a person's always, an org's unless its `connections` policy is off */
    async function connectionsAllowed(workspaceId: string): Promise<boolean> {
        const org = await orgs.byWorkspace(workspaceId);
        return org === undefined || (await policies.get(org.id)).connections;
    }
    const sso = new OrgSso(db, orgs, box);
    /** Each owner's signing key and the grants of state (docs/design/statenet-relays.md, S4); grants need the server's key */
    const keys = new OwnerKeys(db, box);
    const stateGrants = keys.available ? new StateGrants(db, keys, policies) : undefined;
    const instances = new AppInstances(db, access, stateGrants);
    const rules = new SignInRules(db, domains, policies);
    const index = options.embedder === undefined ? undefined : new EmbeddingIndex(db, options.embedder, EMBEDDING_SOURCES, { report: (message, fields) => options.report.info(message, fields) });
    const search = index === undefined ? undefined : new Search(db, index, access);
    /** The library by meaning, for the catalog searches the keywords answer weakly; shared by every workspace */
    const catalogMeanings = options.embedder === undefined ? undefined : new CatalogEmbeddings(db, options.embedder);
    /** The records of an app's data binding by meaning: logic's `similar` call and the agent's `data_similar` */
    const similarity = index === undefined ? undefined : new RecordSimilarity(index);
    index?.start(options.embedEveryMs);
    let origin = '';
    let runtimePort = 0;
    const publicOrigin = options.publicOrigin?.replace(/\/+$/, '');
    const runtimeOrigin = options.runtimeOrigin?.replace(/\/+$/, '');
    if (runtimeOrigin !== undefined && publicOrigin === undefined) throw new Error('A runtime origin needs a public origin beside it');
    if (runtimeOrigin !== undefined && new URL(runtimeOrigin).host === new URL(publicOrigin as string).host) throw new Error('The runtime origin must be another host than the public origin, so an app cannot reach the session cookie');
    const secure = options.secureCookies ?? publicOrigin?.startsWith('https://') ?? false;
    /** In the beta (docs/design/magnetic-beta.md) people sign in only with the server's providers, and nobody makes an org */
    const inBeta = options.agent?.budgets?.betaOrg !== undefined;
    const signIn = new OidcSignIn(options.providers ?? [], { publicOrigin: () => publicOrigin ?? origin, allowHttp: options.allowHttpProviders === true });
    const providerButtons = signIn.providers.map((provider) => ({ name: provider.name, label: provider.label }));
    /** The notice of the sign-in page while the beta is full: people may still sign in, and hear of the next one */
    const betaNotice = async (t: ReturnType<typeof textsOf>): Promise<{ notice: string; noNotice: boolean }> => {
        if (!inBeta || !(await budgets.allowanceFull())) return { notice: '', noNotice: true };
        return { notice: fill(t['signin.betaFullText'], { places: String(budgetLimits.allowanceUsers), provider: providerButtons[0]?.label ?? '' }), noNotice: false };
    };
    /** The sign-in page, a StateUI app in the browser's language: a button per provider and per development user */
    const signInPageOf = async (request: IncomingMessage, next: string, error?: string): Promise<string> => {
        const look: PageLook = { language: languageOf(request.headers['accept-language']), mode: 'system' };
        const t = textsOf(look.language);
        const query = next === '/' ? '' : `?next=${encodeURIComponent(next)}`;
        const app = await pageOf(request, PAGE_APPS.signIn);
        const work = sso.available && !inBeta;
        return appPage({
            look,
            title: t['signin.title'],
            runtimeUrl: `${runtimeOriginOf(request)}/runtime/${runtime.hash}.html`,
            app,
            fallback: app.published,
            data: {
                '$.data.signin': {
                    error: error ?? '',
                    noError: error === undefined,
                    ...(await betaNotice(t)),
                    providers: Object.fromEntries(providerButtons.map((provider, index) => [`p${index}`, { id: provider.name, label: provider.label }])),
                    noProviders: providerButtons.length === 0,
                    devUsers: Object.fromEntries(devUsers.map((name, index) => [`u${index}`, { id: name, label: fill(t['signin.as'], { name: options.devProfiles?.[name]?.label ?? name }) }])),
                    noDevUsers: devUsers.length === 0,
                    noSso: !work,
                    noNone: providerButtons.length > 0 || devUsers.length > 0 || work
                }
            },
            actions: { provider: { go: `/auth/{id}${query}` }, dev: { post: '/signin/dev', form: { user: '{id}', next } }, sso: { go: `/signin/sso?email={id}${next === '/' ? '' : `&next=${encodeURIComponent(next)}`}` } }
        });
    };
    /** A share link's page, a StateUI app: why the link does not open an app, or the offer to remix it */
    const linkPageOf = async (request: IncomingMessage, look: PageLook, title: string, message: string, remix?: string): Promise<string> => {
        const app = await pageOf(request, PAGE_APPS.link);
        return appPage({
            look,
            title,
            runtimeUrl: `${runtimeOriginOf(request)}/runtime/${runtime.hash}.html`,
            app,
            fallback: app.published,
            data: { '$.data.link': { title, message, noRemix: remix === undefined } },
            actions: { home: { go: '/' }, ...(remix !== undefined && { remix: { post: `/s/${encodeURIComponent(remix)}/remix` } }) }
        });
    };
    /** A page as a visitor gets it: what an admin published, or Magnetic's own at `?page=default` and until one is */
    const pageOf = async (request: IncomingMessage, spec: PageSpec): Promise<PageAppDocument & { readonly published: boolean }> =>
        new URL(request.url ?? '/', 'http://magnetic').searchParams.get('page') === 'default' ? { ...(await sitePages.codeDocument(spec)), published: false } : sitePages.served(spec);
    if (options.statenet !== undefined && box === undefined) throw new Error('A server of several (statenet) needs the secret key, which keeps the statenet\'s certificate authority');
    let workspacesRef: Workspaces | undefined;
    /** This server's node of the statenet, when it is one of several on the database */
    const statenet =
        options.statenet === undefined || box === undefined
            ? undefined
            : await startStatenetNode(
                  db,
                  box,
                  {
                      get: (workspaceId) => (workspacesRef as Workspaces).get(workspaceId),
                      peek: (workspaceId) => workspacesRef?.peek(workspaceId),
                      open: () => workspacesRef?.openAll() ?? []
                  },
                  options.statenet,
                  (message, fields) => options.report.info(message, fields)
              );
    const workspaces = new Workspaces(
        {
            open: async (workspaceId) => {
                const storage = pgWorkspaceStorage(db, workspaceId, { embedParts: index !== undefined, embedRecords: index !== undefined, ...(statenet !== undefined && { announceAs: statenet.announceAs }) });
                // A person's own workspace starts with the showcase; an org's starts empty
                if ((options.starter ?? 'showcase') === 'showcase' && workspaceId !== SYSTEM_USER_ID && workspaceId !== PAGES_WORKSPACE_ID && (await orgs.byWorkspace(workspaceId)) === undefined) {
                    await installShowcaseInto({ parts: storage.parts, files: storage.files, fileStore: storage.fileStore, ...(storage.importPart !== undefined && { importPart: storage.importPart }), report: options.report });
                }
                const services = createServices({
                    storage,
                    ownerId: workspaceId,
                    report: options.report,
                    origin: () => origin,
                    agentAnswers: false,
                    // The http effect of each running app, bound to its workspace and app
                    logicFunctions: (instance: LogicInstance) => ({
                        effects: {
                            [HTTP_EFFECT]: httpEffect({ connections, workspaceId, appId: instance.appId, limits: callLimits, report: (message, fields) => options.report.info(message, fields), guard: connectionGuard, allowed: () => connectionsAllowed(workspaceId) })
                        }
                    }),
                    logicLimits: options.logicLimits ?? DEFAULT_LOGIC_LIMITS,
                    ...(catalogMeanings !== undefined && { catalogMeanings }),
                    ...(similarity !== undefined && { procedures: { [SIMILAR_PROCEDURE]: similarProcedure(similarity, workspaceId, () => storage.parts) } }),
                    ...(options.browser !== undefined && { browser: options.browser }),
                    ...(statenet !== undefined && { placement: statenet.placement }),
                    // Datasets other owners shared with this workspace, read by its apps' `uses.external`
                    ...(sharedData !== undefined && { sharedData: sharedData.forReader(workspaceId) })
                });
                await services.recoverParts();
                return services;
            },
            close: async (services: Services) => {
                await services.browser.close();
                await services.authorities.close();
            }
        },
        options.workspaces
    );
    workspacesRef = workspaces;
    /** Datasets shared between workspaces, read through signed grants (docs/design/magnetic-shared-data.md) */
    const sharedData = stateGrants === undefined ? undefined : new SharedData(stateGrants, workspaces, (message, fields) => options.report.info(message, fields as Record<string, string>));
    const tools = new WeakMap<Services, readonly UiToolDefinition[]>();
    const toolsOf = (services: Services): readonly UiToolDefinition[] => {
        let found = tools.get(services);
        if (found === undefined) {
            found = createStateUiTools(services);
            tools.set(services, found);
        }
        return found;
    };

    const preferences = new PreferenceStore(db);
    /** How Magnetic looks and speaks to a signed-in person */
    const lookOf = (request: IncomingMessage, userId: string): Promise<Preferences> => preferences.read(userId, request.headers['accept-language']);
    /** A workspace no person owns, held open while it is used */
    const fixedWorkspace = (workspaceId: string) => async (): Promise<{ services: Services; release: () => void }> => {
        const release = workspaces.retain(workspaceId);
        try {
            return { services: await workspaces.get(workspaceId), release };
        } catch (error) {
            release();
            throw error;
        }
    };
    /** Magnetic's own pages as its code makes them, in the system workspace */
    const pageApps = new PageApps(fixedWorkspace(SYSTEM_USER_ID), toolsOf, stamps, exclusive);
    /** Magnetic's own pages as admins edit and publish them (docs/design/magnetic-editable.md) */
    const sitePages = new SitePages(db, fixedWorkspace(PAGES_WORKSPACE_ID), toolsOf, stamps, pageApps, [PAGE_APPS.signIn, PAGE_APPS.link, HOME, EDITOR], exclusive);
    /** Each person's "Your apps", made from Magnetic's version and kept when they change it */
    const homes = new HomeApps(toolsOf, stamps, exclusive, () => sitePages);
    /** Each person's editor, made from Magnetic's version and kept when they change it */
    const editors = new EditorApps(toolsOf, stamps, exclusive, () => sitePages);
    /** The component library as the Add tab lists it */
    const library = loadCatalogFile()
        .components.filter((component) => component.name !== 'app')
        .map((component) => ({ name: component.name, category: component.category, summary: component.summary }));
    let system: string | undefined;
    const budgetLimits = options.agent?.budgets ?? DEFAULT_BUDGETS;
    const budgets = new Budgets(db, { ...budgetLimits, canBuy: options.payments !== undefined && budgetLimits.perUserTotal !== undefined });
    const credits = new Credits(db);
    const feedback = new Feedback(db);
    const admins = new AdminList(db, options.admins ?? []);
    const stripe = options.payments === undefined ? undefined : new Stripe(options.payments.stripe);
    const turns = new AgentTurns({
        model: options.agent?.model ?? new ClaudeModel(),
        modelName: options.agent?.modelName ?? DEFAULT_AGENT_MODEL,
        models: options.agent?.models ?? AGENT_MODELS.map((model) => model.id),
        effort: options.agent?.effort ?? 'high',
        budgets,
        // What the workspace can reach beyond its own parts: its connections, and the datasets other owners shared with it
        connectionFacts: async (workspaceId: string) => {
            const facts = [
                (await connectionsAllowed(workspaceId)) ? await connectionFacts(connections, workspaceId) : undefined,
                stateGrants === undefined ? undefined : await sharedDataFacts(stateGrants, db, (id) => workspaces.get(id), workspaceId).catch(() => undefined)
            ].filter((fact): fact is string => fact !== undefined);
            return facts.length === 0 ? undefined : facts.join('\n');
        },
        // An org's monthly budget, which every turn in its workspace spends
        workspaceRefusal: async (workspaceId: string): Promise<string | undefined> => {
            const org = await orgs.byWorkspace(workspaceId);
            const limit = org === undefined ? undefined : (await policies.get(org.id)).monthlyBudget;
            if (limit === undefined) return undefined;
            return (await budgets.workspaceSpent(workspaceId)) >= limit ? ORG_BUDGET_SPENT : undefined;
        },
        chats: new Chats(db, { embed: index !== undefined }),
        ...(options.agent?.limits !== undefined && { limits: options.agent.limits }),
        report: options.report,
        workspace: async (userId, workspaceId) => {
            const release = workspaces.retain(workspaceId);
            try {
                const services = await workspaces.get(workspaceId);
                system ??= agentSystemPrompt(services);
                return { tools: [...toolsOf(services), ...(search?.tools(userId, workspaceId) ?? []), ...(similarity === undefined ? [] : [similarTool(similarity, userId, workspaceId, services.parts)])], system, release };
            } catch (error) {
                release();
                throw error;
            }
        }
    });
    /** The open view sockets of each session (by the hash of its token), closed when it signs out */
    const sessionSockets = new Map<string, Set<(reason: string, revoked?: boolean) => void>>();
    const grants = new Grants(db);
    const shareAnswers = new ShareAnswers(db);
    /** The open view sockets of apps shared with a person, by `<userId>/<appId>`, closed when a link is revoked */
    const sharedSockets = new Map<string, Set<(reason: string, revoked?: boolean) => void>>();
    const linkOf = (grant: Grant): string => `${publicOrigin ?? origin}/s/${grant.token}`;

    /** Adds a close function to one of the socket maps; the function returned takes it out again */
    function track(map: Map<string, Set<(reason: string, revoked?: boolean) => void>>, key: string, close: (reason: string, revoked?: boolean) => void): () => void {
        const open = map.get(key) ?? new Set();
        open.add(close);
        map.set(key, open);
        return () => {
            open.delete(close);
            if (open.size === 0) map.delete(key);
        };
    }

    /**
     * After a link is revoked, closes the views of everyone who opened it. A person with no other live link to the app
     * is told it was revoked, so their browser deletes what it kept of it; one with another link reconnects under it
     */
    async function closeRevoked(grant: Grant): Promise<void> {
        for (const userId of Object.keys(grant.members)) {
            const access = await grants.access(grant.appId, userId);
            const live = access !== undefined && 'live' in access;
            for (const close of [...(sharedSockets.get(`${userId}/${grant.appId}`) ?? [])]) close(live ? 'Your access to this app changed' : REVOKED_MESSAGE, !live);
        }
    }

    /** The signed-in user of a request and their session token, or `undefined` */
    async function signedIn(request: IncomingMessage): Promise<{ user: User; token: string } | undefined> {
        const token = readCookie(request, SESSION_COOKIE);
        const session = await sessions.find(token);
        if (session === undefined || token === undefined) return undefined;
        const user = await accounts.user(session.userId);
        return user === undefined ? undefined : { user, token };
    }

    /** The open view sockets of org apps by `<userId>/<appId>`, closed when the person loses the app */
    const orgSockets = new Map<string, Set<(reason: string, revoked?: boolean) => void>>();

    /** An app a person reaches: one of their own (they manage it), or one of an org's they may at least view */
    async function reach(userId: string, appId: string): Promise<{ readonly services: Services; readonly app: AppPart; readonly workspaceId: string; readonly orgId?: string; readonly permission: AppPermission } | undefined> {
        const own = await workspaces.get(userId);
        const app = await own.instanceViews.find(appId);
        if (app !== undefined) return { services: own, app, workspaceId: userId, permission: 'manage' };
        const place = await access.locate(userId, appId);
        if (place?.orgId === undefined) {
            // An admin's draft of one of Magnetic's own pages (docs/design/magnetic-editable.md): admins only
            if (!(await admins.is(userId))) return undefined;
            const pages = await workspaces.get(PAGES_WORKSPACE_ID);
            const draft = await pages.instanceViews.find(appId);
            return draft === undefined ? undefined : { services: pages, app: draft, workspaceId: PAGES_WORKSPACE_ID, permission: 'manage' };
        }
        const services = await workspaces.get(place.workspaceId);
        const found = await services.instanceViews.find(appId);
        return found === undefined ? undefined : { services, app: found, workspaceId: place.workspaceId, orgId: place.orgId, permission: place.permission };
    }

    /** Closes a person's open views of an org's apps, such as when they leave the org or lose an app */
    function closeOrgViews(userId: string, appIds: readonly string[] | 'all', reason: string): void {
        for (const [key, closes] of [...orgSockets]) {
            const [owner, appId] = key.split('/');
            if (owner !== userId || (appIds !== 'all' && !appIds.includes(appId ?? ''))) continue;
            for (const close of [...closes]) close(reason);
        }
    }

    /** The name of an org, shown in the editor beside the app's name; undefined for a person's own workspace */
    async function orgNameOf(orgId: string | undefined): Promise<string | undefined> {
        return orgId === undefined ? undefined : (await orgs.get(orgId))?.name;
    }

    /** The workspace an app is in, as the editor's top bar names it: an org's name, Magnetic's pages, or undefined for the person's own */
    async function workspaceNameOf(place: { readonly orgId?: string; readonly workspaceId: string }): Promise<string | undefined> {
        return place.workspaceId === PAGES_WORKSPACE_ID ? "Magnetic's pages" : orgNameOf(place.orgId);
    }

    /** Whether a share link to an app of this workspace opens for the person: an org's reach only its members, unless it allows outside people */
    async function linkAllowed(workspaceId: string, userId: string): Promise<boolean> {
        const org = await orgs.byWorkspace(workspaceId);
        if (org === undefined) return true;
        return (await policies.get(org.id)).externalLinks || (await orgs.role(org.id, userId)) !== undefined;
    }

    /** Why the person may not make apps of their own, or `undefined`: an org of theirs keeps its apps in the org */
    async function personalRefusal(userId: string): Promise<string | undefined> {
        for (const policy of (await policies.ofMember(userId)).values()) if (!policy.personalWorkspaces) return NO_PERSONAL_APPS;
        return undefined;
    }

    /** The models a person may pick for an app: the server's, narrowed by the org's policy for an app of an org */
    async function modelsFor(orgId: string | undefined): Promise<readonly string[]> {
        const allowed = orgId === undefined ? undefined : (await policies.get(orgId)).agentModels;
        return allowed === undefined ? turns.models : turns.models.filter((model) => allowed.includes(model));
    }

    const orgContext = {
        db,
        ...(options.mailer !== undefined && { mailer: options.mailer }),
        report: (message: string, fields?: Record<string, unknown>) => options.report.info(message, fields),
        orgs,
        access,
        instances,
        workspaces,
        toolsOf,
        signedIn,
        readJson: (request: IncomingMessage) => readJsonBody(request, MAX_FORM_BYTES),
        sendJson,
        origin: () => publicOrigin ?? origin,
        closeOrgViews,
        appNameOf,
        policies,
        domains,
        sso,
        budgets,
        ssoRedirectUri: () => signIn.redirectUri(CUSTOM_PROVIDER),
        makeOrgs: !inBeta,
        orgDeleted: async (workspaceId: string, members: readonly string[]) => {
            for (const userId of members) closeOrgViews(userId, 'all', 'The org was deleted');
            await workspaces.reopen(workspaceId);
        }
    };
    const handleOrgRoute = orgRoutes(orgContext);
    const handleGrants = grantRoutes({ db, grants: stateGrants, keys, revoked: (revoked) => sharedData?.revoked(revoked), orgs, signedIn, readJson: (request) => readJsonBody(request, MAX_FORM_BYTES), readForm, sendJson, sendPage, redirect: (response, location) => redirect(response, location), lookOf });
    const handleOrgSettings = orgSettingsRoutes({ ...orgContext, lookOf, readForm, sendPage, redirect: (response, location) => redirect(response, location), models: () => turns.models });
    const handleConnections = connectionRoutes({
        db,
        connections,
        orgs,
        guard: connectionGuard,
        allowed: connectionsAllowed,
        signedIn,
        readForm,
        lookOf,
        sendPage,
        redirect: (response, location) => redirect(response, location),
        origin: () => publicOrigin ?? origin,
        report: (message, fields) => options.report.info(message, fields)
    });
    // The editor's views: Screens, Statenet, Theme and Logic (docs/design/magnetic-show-views.md)
    const handleViews = viewRoutes({
        toolsOf: (services) => toolsOf(services),
        readJson: (request) => readJsonBody(request, MAX_FORM_BYTES),
        sendJson,
        connections,
        changeConnection: (user, form) => handleConnections.change(user, form),
        sharedDatasets: async (workspaceId) => (stateGrants === undefined ? [] : sharedWithWorkspace(stateGrants, db, (id) => workspaces.get(id), workspaceId)),
        personaApps: async (workspaceId, ownerId) => {
            // The person's own state of each app is at `<ownerId>/<appId>/user`
            const like = ownerId.replace(/[\\%_]/g, '\\$&') + '/%/user';
            const rows = await db.transaction(
                async (tx) => (await tx.query<{ address: string; updated_at: Date }>("SELECT address, updated_at FROM namespace_head WHERE workspace_id = $1 AND address LIKE $2 ORDER BY updated_at DESC, address", [workspaceId, like])).rows,
                { workspaceIds: [workspaceId] }
            );
            return rows.map((row) => ({ id: row.address.split('/')[1] as string, updatedAt: row.updated_at.toISOString() }));
        },
        sharedCount: async (workspaceId, appId) => (await grants.forApp(workspaceId, appId)).filter((grant) => grant.revokedAt === undefined).length,
        report: (message, fields) => options.report.info(message, fields)
    });
    // The beta (docs/design/magnetic-beta.md): one org, joined through a link signed with the server's key
    if (budgetLimits.betaOrg !== undefined && options.secretKey === undefined) throw new Error('The beta org needs secretKey, which signs the beta link');
    const beta = budgetLimits.betaOrg === undefined || options.secretKey === undefined ? undefined : new Beta(db, orgs, budgetLimits.betaOrg, budgetLimits.allowanceUsers, options.secretKey);
    /** Those this server saw in the beta org already, so their visits ask no more */
    const inBetaOrg = new Set<string>();
    /**
     * Everyone who signs in joins the beta org while places are left, as through its link; an admin's sign-in makes the
     * org first, with them as its owner. Tried again on Your apps, for those who signed in before it was made
     */
    const joinBeta = async (userId: string): Promise<void> => {
        if (beta === undefined || inBetaOrg.has(userId)) return;
        try {
            if (await admins.is(userId)) {
                await beta.start(userId);
                if ((await beta.roleOf(userId)) !== undefined) inBetaOrg.add(userId);
                return;
            }
            const joined = await beta.join(userId);
            if (joined === 'joined' || joined === 'member') inBetaOrg.add(userId);
            if (joined === 'joined') options.report.info('Joined the beta', { userId });
        } catch (error) {
            options.report.info('Joining the beta failed', { userId, error: error instanceof Error ? error.message : String(error) });
        }
    };
    const handleBeta =
        beta === undefined
            ? async () => false
            : betaRoutes({ beta, budgets, signedIn, lookOf, sendPage: (response, html, status) => sendPage(response, html, status), redirect: (response, location) => redirect(response, location), report: (message, fields) => options.report.info(message, fields) });
    const handleAdmin = adminRoutes({
        admin: new Admin(db),
        admins,
        pages: sitePages,
        allowance: { ...(budgetLimits.perUserTotal !== undefined && { dollars: budgetLimits.perUserTotal }), ...(budgetLimits.allowanceUsers !== undefined && { people: budgetLimits.allowanceUsers }), monthly: budgetLimits.monthly, ...(beta !== undefined && { betaOrg: beta.slug }) },
        ...(beta !== undefined && { beta }),
        origin: () => publicOrigin ?? origin,
        signedIn,
        readForm,
        lookOf,
        sendPage: (response, html, status) => sendPage(response, html, status),
        redirect: (response, location) => redirect(response, location),
        report: (message, fields) => options.report.info(message, fields)
    });
    const handleBilling = billingRoutes({
        budgets,
        credits,
        ...(stripe !== undefined && { stripe }),
        topUps: options.payments?.topUps ?? DEFAULT_TOP_UPS,
        signedIn,
        readForm,
        lookOf,
        sendPage: (response, html, status, formTargets) => sendPage(response, html, status, undefined, formTargets),
        sendJson,
        redirect: (response, location) => redirect(response, location),
        origin: () => publicOrigin ?? origin,
        report: (message, fields) => options.report.info(message, fields)
    });
    const handleData = dataRoutes({
        db,
        orgs,
        ...(stateGrants !== undefined && { grants: stateGrants }),
        ...(sharedData !== undefined && { sharedData }),
        workspace: (workspaceId) => workspaces.get(workspaceId),
        signedIn,
        readForm,
        lookOf,
        sendPage,
        redirect: (response, location) => redirect(response, location),
        report: (message, fields) => options.report.info(message, fields)
    });

    async function tenant(request: IncomingMessage): Promise<TenantAnswer> {
        const who = await signedIn(request);
        if (who === undefined) {
            const next = safeNext(request.url);
            return { refuse: 401, location: next === '/' ? '/signin' : `/signin?next=${encodeURIComponent(next)}` };
        }
        const services = await workspaces.get(who.user.id);
        const key = Sessions.keyOf(who.token);
        const appId = APP_PATH.exec(new URL(request.url ?? '/', 'http://localhost').pathname)?.[1]?.toLowerCase();
        if (appId !== undefined && (await services.instanceViews.find(appId)) === undefined) {
            // An app of one of their orgs: their own instance (persona = their id), as far as their permission goes
            const place = await reach(who.user.id, appId);
            if (place?.orgId !== undefined) {
                const orgAnswer: HttpTenant = {
                    useCases: place.services.useCases,
                    hub: place.services.hub,
                    liveViews: place.services.liveViews,
                    instances: place.services.instanceViews,
                    persona: who.user.id,
                    access: allows(place.permission, 'edit') ? 'owner' : place.permission === 'use' ? 'use' : 'view',
                    retain: (close) => {
                        const release = workspaces.retain(place.workspaceId);
                        const untrackSession = track(sessionSockets, key, close);
                        const untrackOrg = track(orgSockets, `${who.user.id}/${appId}`, close);
                        return () => {
                            release();
                            untrackSession();
                            untrackOrg();
                        };
                    }
                };
                return { tenant: orgAnswer };
            }
            // Not one of theirs: an app shared with them, or one taken back from them
            const shared = await grants.access(appId, who.user.id);
            if (shared !== undefined && 'revoked' in shared) {
                const grant = shared.revoked;
                const persona = grant.right === 'use' ? who.user.id : DEFAULT_PERSONA;
                return { revoked: { message: REVOKED_MESSAGE, namespace: appNamespace({ persona, ownerId: grant.ownerId, appId }), name: grant.appName } };
            }
            if (shared !== undefined) {
                // An org that keeps its links to members: someone who left it, or never joined, no longer reaches its apps
                if (!(await linkAllowed(shared.live.ownerId, who.user.id))) return { refuse: 404 };
                return { tenant: await sharedTenant(shared.live, who.user.id, key) };
            }
        }
        const answer: HttpTenant = {
            useCases: services.useCases,
            hub: services.hub,
            liveViews: services.liveViews,
            instances: services.instanceViews,
            retain: (close) => {
                const release = workspaces.retain(who.user.id);
                const open = sessionSockets.get(key) ?? new Set();
                open.add(close);
                sessionSockets.set(key, open);
                return () => {
                    release();
                    open.delete(close);
                    if (open.size === 0) sessionSockets.delete(key);
                };
            }
        };
        return { tenant: answer };
    }

    /** The owner's workspace, seen by a person given the app: their own instance (`use`) or the owner's, read only (`view`) */
    async function sharedTenant(grant: Grant & { readonly right: 'view' | 'use' }, userId: string, sessionKey: string): Promise<HttpTenant> {
        const owner = await workspaces.get(grant.ownerId);
        return {
            useCases: owner.useCases,
            hub: owner.hub,
            liveViews: owner.liveViews,
            instances: owner.instanceViews,
            persona: grant.right === 'use' ? userId : DEFAULT_PERSONA,
            access: grant.right,
            retain: (close) => {
                const release = workspaces.retain(grant.ownerId);
                const untrackSession = track(sessionSockets, sessionKey, close);
                const untrackShared = track(sharedSockets, `${userId}/${grant.appId}`, close);
                return () => {
                    release();
                    untrackSession();
                    untrackShared();
                };
            }
        };
    }

    /** The apps shared with a person and the apps of their orgs they may open, for their home page */
    async function sharedApps(userId: string): Promise<SharedApp[]> {
        const found: SharedApp[] = [];
        for (const grant of await grants.sharedWith(userId)) {
            const owner = await accounts.user(grant.ownerId);
            found.push({ appId: grant.appId, name: grant.appName, right: grant.right === 'use' ? 'use' : 'view', ownerName: owner?.name ?? 'Someone' });
        }
        // The apps of their orgs that they may open, with the org as the one who shares them
        for (const membership of await orgs.of(userId)) {
            const visible = await access.visibleApps(userId, membership.workspaceId);
            if (visible.size === 0) continue;
            const services = await workspaces.get(membership.workspaceId);
            for (const app of await services.instanceViews.list()) {
                const permission = visible.get(app.id);
                if (permission === undefined || found.some((shared) => shared.appId === app.id)) continue;
                found.push({ appId: app.id, name: app.name, right: permission === 'view' ? 'view' : 'use', ownerName: membership.name });
            }
        }
        return found;
    }

    /** The runtime origin as the browser of a request reaches it */
    function runtimeOriginOf(request: IncomingMessage): string {
        if (runtimeOrigin !== undefined) return runtimeOrigin;
        return `http://${requestHostName(request.headers.host) ?? '127.0.0.1'}:${runtimePort}`;
    }

    /** Sends one of Magnetic's own pages made as a StateUI app: its frame comes from the runtime origin */
    function sendAppPage(request: IncomingMessage, response: ServerResponse, html: string, status = 200, cookie?: string): void {
        response.writeHead(status, {
            ...(cookie !== undefined && { 'Set-Cookie': cookie }),
            ...COMMON_HEADERS,
            'Referrer-Policy': 'same-origin',
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Security-Policy': hostPageCsp(runtimeOriginOf(request)),
            'Cache-Control': 'no-store'
        });
        response.end(html);
    }

    /** Sends a page that runs an app: its frame comes from the runtime origin */
    function sendHostPage(request: IncomingMessage, response: ServerResponse, html: string): void {
        response.writeHead(200, { ...COMMON_HEADERS, 'Referrer-Policy': 'same-origin', 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': hostPageCsp(runtimeOriginOf(request)), 'Cache-Control': 'no-store' });
        response.end(html);
    }

    /** `GET /`: the person's "Your apps", with the lists written into its data first */
    async function homeRoute(request: IncomingMessage, response: ServerResponse, user: User): Promise<void> {
        await joinBeta(user.id);
        const services = await workspaces.get(user.id);
        const look = await lookOf(request, user.id);
        const t = textsOf(look.language);
        const homeId = await homes.id(services, user.id);
        const all = await services.instanceViews.list();
        const changed = (at: Date): string => fill(t['home.changed'], { date: at.toLocaleDateString(look.language === 'en' ? 'en-GB' : look.language, { day: 'numeric', month: 'short', year: 'numeric' }) });
        const apps: HomeCard[] = [...all]
            .filter((app) => app.id !== homeId && app.name !== EDITOR_APP)
            .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
            .map((app) => ({ id: app.id, name: app.name, note: changed(app.updatedAt), own: true, answered: true }));
        // The apps shared with them: those waiting for an answer come first, those they accepted after their own, and
        // those they rejected not at all
        const answers = await shareAnswers.of(user.id);
        const shared = (await sharedApps(user.id))
            .filter((app) => answers.get(app.appId) !== 'rejected')
            .map((app): HomeCard => ({ id: app.appId, name: app.name, note: fill(t[app.right === 'use' ? 'home.sharedUse' : 'home.sharedView'], { owner: app.ownerName }), own: false, answered: answers.get(app.appId) === 'accepted' }));
        // The agent use they have had, against all they may have (their allowance and what they bought)
        const spent = await budgets.spent(user.id);
        const allowance = await budgets.allowanceOf(user.id);
        const total = allowance === undefined ? undefined : allowance + spent.bought;
        const usedCents = Math.round(spent.total * 100);
        const totalCents = total === undefined ? Math.max(1, usedCents) : Math.max(1, Math.round(total * 100));
        const usage = {
            line: total === undefined ? fill(t['home.usageNoLimit'], { used: usd(spent.total) }) : fill(t['home.usageOf'], { used: usd(spent.total), total: usd(total) }),
            today: fill(t['home.usageToday'], { today: usd(spent.today) }),
            usedCents: Math.min(usedCents, totalCents),
            totalCents,
            tone: total === undefined ? ('accent' as const) : spent.total >= total ? ('danger' as const) : spent.total >= total * 0.8 ? ('warning' as const) : ('accent' as const)
        };
        // The person's orgs, and the invites waiting for their verified email
        const orgWords = orgTextsOf(look.language);
        const roleWords = (role: string): string => orgWords[`orgs.role.${role}` as keyof typeof orgWords] ?? role;
        const memberships: HomeCard[] = (await orgs.of(user.id)).map((org) => ({ id: org.id, name: org.name, note: fill(t['home.orgNote'], { role: roleWords(org.role) }) }));
        const invites: HomeCard[] = (await orgs.pendingFor(user.id)).map((invite) => ({ id: invite.id, name: fill(t['home.inviteName'], { org: invite.org.name }), note: fill(t['home.inviteNote'], { role: roleWords(invite.role), name: invite.invitedBy }) }));
        await homes.show(
            services,
            user.id,
            {
                apps: [...shared.filter((app) => app.answered !== true), ...apps, ...shared.filter((app) => app.answered === true)],
                orgs: memberships,
                invites,
                admin: await admins.is(user.id),
                makeOrgs: !inBeta,
                usage,
                person: { name: user.name, email: user.email ?? '' }
            },
            look, (message, fields) => options.report.info(message, fields));
        const home = await services.instanceViews.find(homeId);
        if (home === undefined) throw new HttpError(500, 'Your apps could not be opened', 'internal');
        sendHostPage(
            request,
            response,
            homePage({ appId: homeId, runtimeUrl: `${runtimeOriginOf(request)}/runtime/${runtime.hash}.html`, ...(chunk3d !== undefined && { chunk3d: chunk3d.hash }), namespace: services.instanceViews.namespace(home), look })
        );
    }

    /** `GET /s/<token>` and `POST /s/<token>/remix`: a share link */
    async function linkRoute(request: IncomingMessage, response: ServerResponse, method: string, token: string, remix: boolean): Promise<void> {
        const who = await signedIn(request);
        if (who === undefined) {
            if (method === 'GET') redirect(response, `/signin?next=${encodeURIComponent(`/s/${token}`)}`);
            else throw new HttpError(401, 'Sign in first', 'unauthorized');
            return;
        }
        const look: PageLook = await lookOf(request, who.user.id);
        const t = textsOf(look.language);
        const grant = await grants.byToken(token);
        if (grant === undefined) {
            sendAppPage(request, response, await linkPageOf(request, look, t['link.notFoundTitle'], t['link.notFound']), 404);
            return;
        }
        if (grant.revokedAt !== undefined) {
            sendAppPage(request, response, await linkPageOf(request, look, grant.appName, t['link.revoked']), 410);
            return;
        }
        const owner = await workspaces.get(grant.ownerId);
        const app = await owner.instanceViews.find(grant.appId);
        if (app === undefined) {
            sendAppPage(request, response, await linkPageOf(request, look, grant.appName, t['link.deleted']), 404);
            return;
        }
        if (grant.ownerId === who.user.id) {
            redirect(response, `/edit/${encodeURIComponent(grant.appId)}`);
            return;
        }
        if (!(await linkAllowed(grant.ownerId, who.user.id))) {
            sendAppPage(request, response, await linkPageOf(request, look, grant.appName, t['link.membersOnly']), 403);
            return;
        }
        if (method === 'GET') {
            await grants.join(grant.id, who.user.id);
            if (grant.right === 'remix') {
                const sharer = await accounts.user(grant.ownerId);
                sendAppPage(request, response, await linkPageOf(request, look, fill(t['link.remixTitle'], { name: app.name }), fill(t['link.sharedCopy'], { name: sharer?.name ?? t['link.someone'] }), token));
            } else redirect(response, `/apps/${encodeURIComponent(grant.appId)}`);
            return;
        }
        if (!remix || grant.right !== 'remix') throw new HttpError(405, 'Not allowed', 'method_not_allowed');
        if ((await personalRefusal(who.user.id)) !== undefined) {
            sendAppPage(request, response, await linkPageOf(request, look, fill(t['link.remixTitle'], { name: app.name }), t['link.noPersonal']), 403);
            return;
        }
        const mine = await workspaces.get(who.user.id);
        const copied = await copyAppParts(owner.parts, mine.parts, grant.appId);
        if (copied.kind !== 'copied') {
            sendAppPage(request, response, await linkPageOf(request, look, fill(t['link.remixTitle'], { name: app.name }), copied.kind === 'failed' ? fill(t['link.copyFailed'], { reason: copied.reason }) : t['link.deleted'], token), copied.kind === 'failed' ? 500 : 404);
            return;
        }
        options.report.info('App remixed', { from: grant.appId, to: copied.app.id, parts: copied.parts.length });
        redirect(response, `/edit/${encodeURIComponent(copied.app.id)}`);
    }

    async function routes(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
        const url = new URL(request.url ?? '/', 'http://localhost');
        const path = url.pathname;
        const method = request.method ?? 'GET';
        const cookie = (token: string, maxAge: number): string => sessionCookie(token, { maxAge, secure });

        if (method === 'GET' && path === '/assets/logo.svg') {
            response.writeHead(200, { ...COMMON_HEADERS, 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' });
            response.end(LOGO_SVG);
            return true;
        }
        if (method === 'GET' && path === '/assets/magnetic.css') {
            response.writeHead(200, { ...COMMON_HEADERS, 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-cache' });
            response.end(MAGNETIC_CSS);
            return true;
        }
        if (method === 'GET' && path === '/privacy' && options.privacy !== undefined) {
            sendPage(response, privacyPage(options.privacy));
            return true;
        }
        if (method === 'GET' && path === '/signin') {
            const next = safeNext(url.searchParams.get('next'));
            if ((await signedIn(request)) !== undefined) redirect(response, next);
            else sendAppPage(request, response, await signInPageOf(request, next));
            return true;
        }
        if (method === 'POST' && path === '/signin/dev') {
            const form = await readForm(request);
            const name = form.get('user');
            if (name === null || !devUsers.includes(name)) throw new HttpError(403, 'Not a development user of this server', 'forbidden');
            const profile = options.devProfiles?.[name];
            const user = await accounts.signIn({ provider: 'dev', subject: name }, profile === undefined ? { name } : { name: profile.name, ...(profile.email !== undefined && { email: profile.email, emailVerified: true }) });
            await joinBeta(user.id);
            await rules.signedIn({ id: user.id, emailVerified: profile?.email !== undefined }, { provider: 'dev', ...(request.socket.remoteAddress !== undefined && { ip: request.socket.remoteAddress }) });
            redirect(response, safeNext(form.get('next')), cookie(await sessions.start(user.id), SESSION_DAYS * 24 * 60 * 60));
            return true;
        }
        const pendingCookie = (key: string, maxAge: number): string => httpOnlyCookie(SIGN_IN_COOKIE, key, { maxAge, secure, path: '/auth' });
        if (method === 'GET' && path === '/signin/sso' && !inBeta) {
            // "Sign in with your work email": the org that verified the email's domain, through its own provider
            const next = safeNext(url.searchParams.get('next'));
            const email = (url.searchParams.get('email') ?? '').trim().slice(0, 320);
            const orgId = await domains.orgOfEmail(email);
            const provider = orgId === undefined ? undefined : await sso.provider(orgId);
            if (orgId === undefined || provider === undefined) {
                sendAppPage(request, response, await signInPageOf(request, next, NO_ORG_SIGN_IN), 404);
                return true;
            }
            let started;
            try {
                started = await signIn.startWith(provider, next, orgId);
            } catch (error) {
                options.report.info('Org sign-in could not start', { orgId, error: error instanceof Error ? error.message : String(error) });
                sendAppPage(request, response, await signInPageOf(request, next, 'Your organisation\'s sign-in could not be reached. Please try again in a moment.'), 502);
                return true;
            }
            redirect(response, started.url, pendingCookie(started.key, 10 * 60));
            return true;
        }
        const auth = /^\/auth\/([a-z][a-z0-9-]{0,31})(\/callback)?$/.exec(path);
        // An org's own provider comes back at /auth/sso/callback; its sign-in starts at /signin/sso
        if (method === 'GET' && auth !== null && (signIn.has(auth[1] as string) || (auth[1] === CUSTOM_PROVIDER && auth[2] !== undefined))) {
            const name = auth[1] as string;
            if (auth[2] === undefined) {
                let started;
                try {
                    started = await signIn.start(name, url.searchParams.get('next') ?? '/');
                } catch (error) {
                    options.report.info('Sign-in could not start', { provider: name, error: error instanceof Error ? error.message : String(error) });
                    sendAppPage(request, response, await signInPageOf(request, safeNext(url.searchParams.get('next')), 'The sign-in provider could not be reached. Please try again in a moment.'), 502);
                    return true;
                }
                redirect(response, started.url, pendingCookie(started.key, 10 * 60));
                return true;
            }
            try {
                const done = await signIn.finish(name, readCookie(request, SIGN_IN_COOKIE), url.search);
                // Through an org's own provider: its identities are the org's, and it vouches only for emails at its own verified domains
                const orgId = name === CUSTOM_PROVIDER ? done.tag : undefined;
                const identity = orgId === undefined ? done.identity : { provider: ssoIdentityProvider(orgId), subject: done.identity.subject };
                const profile = orgId === undefined ? done.profile : { ...done.profile, emailVerified: await rules.vouches(orgId, done.profile.email) };
                const refusal = await rules.refusal(profile.email, orgId);
                if (refusal !== undefined) throw new SignInError(refusal);
                const user = await accounts.signIn(identity, profile, orgId);
                await joinBeta(user.id);
                await rules.signedIn({ id: user.id, ...(profile.email !== undefined && { email: profile.email }), emailVerified: profile.emailVerified === true }, { provider: identity.provider, ...(orgId !== undefined && { orgId }), ...(request.socket.remoteAddress !== undefined && { ip: request.socket.remoteAddress }) });
                redirect(response, done.next, [pendingCookie('', 0), cookie(await sessions.start(user.id), SESSION_DAYS * 24 * 60 * 60)]);
            } catch (error) {
                if (!(error instanceof SignInError)) throw error;
                options.report.info('Sign-in did not finish', { provider: name, error: error.message, ...(error.detail !== undefined && { providerSaid: error.detail }) });
                sendAppPage(request, response, await signInPageOf(request, '/', error.message), 400, pendingCookie('', 0));
            }
            return true;
        }
        if (method === 'POST' && path === '/signout') {
            const token = readCookie(request, SESSION_COOKIE);
            if (token !== undefined) {
                await sessions.end(token);
                for (const close of [...(sessionSockets.get(Sessions.keyOf(token)) ?? [])]) close('Signed out');
            }
            redirect(response, '/signin', cookie('', 0));
            return true;
        }
        if (method === 'GET' && path === '/') {
            const who = await signedIn(request);
            if (who === undefined) {
                redirect(response, '/signin');
                return true;
            }
            await homeRoute(request, response, who.user);
            return true;
        }
        if (method === 'GET' && path === '/assets/shell.css') {
            sendAsset(response, 'text/css', SHELL_CSS);
            return true;
        }
        if (method === 'GET' && path === '/assets/views.css') {
            sendAsset(response, 'text/css', VIEWS_CSS);
            return true;
        }
        if (method === 'GET' && path === '/assets/app-page.css') {
            sendAsset(response, 'text/css', APP_PAGE_CSS);
            return true;
        }
        if (method === 'GET' && path === '/assets/app-page.js') {
            sendAsset(response, 'text/javascript', APP_PAGE_JS);
            return true;
        }
        if (method === 'GET' && path === '/assets/home.css') {
            sendAsset(response, 'text/css', HOME_CSS);
            return true;
        }
        if (method === 'GET' && path === '/assets/home.js') {
            sendAsset(response, 'text/javascript', HOME_JS);
            return true;
        }
        if (method === 'GET' && path === '/assets/shell.js') {
            sendAsset(response, 'text/javascript', SHELL_JS);
            return true;
        }
        if (method === 'GET' && path === '/assets/screens.js') {
            sendAsset(response, 'text/javascript', SCREENS_JS);
            return true;
        }
        if (method === 'GET' && path === '/assets/views.js') {
            sendAsset(response, 'text/javascript', VIEWS_JS);
            return true;
        }
        if (method === 'GET' && path === '/assets/inspect.js') {
            sendAsset(response, 'text/javascript', INSPECT_JS);
            return true;
        }
        if (method === 'GET' && path === '/assets/editor.json') {
            const who = await signedIn(request);
            if (who === undefined) throw new HttpError(401, 'Sign in first', 'unauthorized');
            // Magnetic's own: what an admin published (`default`), or the code's (`code`), the last to fall back to
            const which = url.searchParams.get('editor');
            if (which === 'default' || which === 'code') {
                sendJson(response, 200, { ...(which === 'code' ? await sitePages.codeDocument(EDITOR) : await sitePages.served(EDITOR)), fallback: true });
                return true;
            }
            try {
                sendJson(response, 200, await editors.document(await workspaces.get(who.user.id), who.user.id));
            } catch (error) {
                options.report.info('A person\'s editor did not load', { error: error instanceof Error ? error.message : String(error) });
                sendJson(response, 200, { ...(await sitePages.served(EDITOR)), fallback: true });
            }
            return true;
        }
        if (method === 'POST' && (path === '/editor' || path === '/editor/reset')) {
            const who = await signedIn(request);
            if (who === undefined) throw new HttpError(401, 'Sign in first', 'unauthorized');
            const services = await workspaces.get(who.user.id);
            const id = path === '/editor' ? await editors.id(services, who.user.id) : await editors.reset(services, who.user.id);
            sendJson(response, 200, { id });
            return true;
        }
        const answer = /^\/shares\/([A-Za-z0-9-]{1,64})\/(accept|reject)$/.exec(path);
        if (method === 'POST' && answer !== null) {
            // An app shared with the person, answered on Your apps: accepted, it joins their apps; rejected, it goes
            const who = await signedIn(request);
            if (who === undefined) throw new HttpError(401, 'Sign in first', 'unauthorized');
            const appId = answer[1] as string;
            if (answer[2] === 'accept') await shareAnswers.accept(who.user.id, appId);
            else await shareAnswers.reject(who.user.id, appId);
            sendJson(response, 200, { answered: answer[2] });
            return true;
        }
        if (method === 'POST' && (path === '/home' || path === '/home/reset')) {
            const who = await signedIn(request);
            if (who === undefined) throw new HttpError(401, 'Sign in first', 'unauthorized');
            const services = await workspaces.get(who.user.id);
            const id = path === '/home' ? await homes.id(services, who.user.id) : await homes.reset(services, who.user.id);
            sendJson(response, 200, { id });
            return true;
        }
        if (method === 'POST' && path === '/prefs') {
            const who = await signedIn(request);
            if (who === undefined) throw new HttpError(401, 'Sign in first', 'unauthorized');
            const body = await readJsonBody(request, MAX_FORM_BYTES);
            const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
            const change: { mode?: Preferences['mode']; language?: Preferences['language'] } = {};
            if (record['mode'] !== undefined) {
                if (!isMode(record['mode'])) throw new HttpError(400, 'Unknown mode', 'invalid_request');
                change.mode = record['mode'];
            }
            if (record['language'] !== undefined) {
                if (!isLanguage(record['language'])) throw new HttpError(400, 'Unknown language', 'invalid_request');
                change.language = record['language'];
            }
            sendJson(response, 200, await preferences.write(who.user.id, request.headers['accept-language'], change));
            return true;
        }
        if (method === 'POST' && path === '/new') {
            const who = await signedIn(request);
            if (who === undefined) throw new HttpError(401, 'Sign in first', 'unauthorized');
            const json = (request.headers.accept ?? '').includes('application/json');
            const noPersonal = await personalRefusal(who.user.id);
            if (noPersonal !== undefined) {
                if (json) sendJson(response, 403, { message: noPersonal });
                else redirect(response, '/settings/orgs');
                return true;
            }
            const services = await workspaces.get(who.user.id);
            const name = appNameOf((await readForm(request)).get('name') ?? '');
            const create = toolsOf(services).find((tool) => tool.name === 'ui_app_create');
            const outcome = name === undefined || create === undefined ? undefined : await create.run({ name });
            const created = outcome?.body as { id?: unknown; message?: unknown } | undefined;
            if (outcome === undefined || outcome.isError || typeof created?.id !== 'string') {
                const why = name === undefined ? 'Give the app a name that starts with a letter.' : typeof created?.message === 'string' ? created.message : 'The app could not be made.';
                if (json) sendJson(response, 400, { message: why });
                else redirect(response, '/');
                return true;
            }
            if (json) sendJson(response, 201, { id: created.id });
            else redirect(response, `/edit/${encodeURIComponent(created.id)}`);
            return true;
        }
        // An app of the person's own opens with the editor hidden; any other falls through to the app page of the host
        const own = method === 'GET' ? /^\/apps\/([^/]+)$/.exec(path) : null;
        if (own !== null && (await ownAppPage(request, response, decodeURIComponent(own[1] as string)))) return true;
        const edit = /^\/edit\/([^/]+)(\/events|\/turns|\/stop|\/share|\/share\/[^/]+\/revoke|\/node|\/nodes|\/components|\/state|\/trace|\/screens|\/connections|\/shared-data|\/feedback|\/budget|\/views\/[a-z]+)?$/.exec(path);
        if (edit !== null) {
            await editRoute(request, response, method, decodeURIComponent(edit[1] as string), edit[2]);
            return true;
        }
        if (await handleOrgRoute(request, response, method, path)) return true;
        if (await handleOrgSettings(request, response, method, path, url.searchParams)) return true;
        if (await handleConnections(request, response, method, path)) return true;
        if (await handleData(request, response, method, path)) return true;
        if (await handleAdmin(request, response, method, path, url.searchParams)) return true;
        if (await handleBeta(request, response, method, path)) return true;
        if (await handleBilling(request, response, method, path, url.searchParams)) return true;
        if (await handleGrants(request, response, method, path, url.searchParams)) return true;
        if (method === 'GET' && path === '/search') {
            const who = await signedIn(request);
            if (who === undefined) throw new HttpError(401, 'Sign in first', 'unauthorized');
            const query = (new URL(request.url ?? '/', 'http://localhost').searchParams.get('q') ?? '').slice(0, 500);
            sendJson(response, 200, { apps: search === undefined ? [] : await search.apps(who.user.id, query), semantic: search !== undefined });
            return true;
        }
        const link = /^\/s\/([A-Za-z0-9_-]{1,64})(\/remix)?$/.exec(path);
        if (link !== null && (method === 'GET' ? link[2] === undefined : method === 'POST' && link[2] !== undefined)) {
            await linkRoute(request, response, method, link[1] as string, link[2] !== undefined);
            return true;
        }
        return false;
    }

    /** The page of an app, with the editor hidden (`editing` false) or shown */
    function appShellPage(
        request: IncomingMessage,
        services: Services,
        app: NonNullable<Awaited<ReturnType<Services['instanceViews']['find']>>>,
        editing: boolean,
        look: PageLook,
        persona?: string,
        models: readonly string[] = turns.models,
        workspace?: string
    ): string {
        return shellPage({
            look,
            appId: app.id,
            name: app.name,
            runtimeUrl: `${runtimeOriginOf(request)}/runtime/${runtime.hash}.html`,
            ...(chunk3d !== undefined && { chunk3d: chunk3d.hash }),
            namespace: services.instanceViews.namespace(app, persona),
            models: models.map(modelChoice),
            editing,
            blank: isBlank(app.body),
            ...(workspace !== undefined && { workspace })
        });
    }

    /** `GET /apps/<appId>` of an app the person owns: the app, with the editor a key chord away. False for any other */
    async function ownAppPage(request: IncomingMessage, response: ServerResponse, appId: string): Promise<boolean> {
        const who = await signedIn(request);
        if (who === undefined) return false;
        const place = await reach(who.user.id, appId);
        // An org app the person may only use or view is served as any shared app is, by the tenant
        if (place === undefined || !allows(place.permission, 'edit')) return false;
        const { services, app } = place;
        if (app.name === HOME_APP) {
            redirect(response, '/');
            return true;
        }
        sendHostPage(request, response, appShellPage(request, services, app, false, await lookOf(request, who.user.id), place.orgId === undefined ? undefined : who.user.id, await modelsFor(place.orgId), await workspaceNameOf(place)));
        return true;
    }

    /** The editor of one app: the page, its event stream, a new turn, and stop */
    async function editRoute(request: IncomingMessage, response: ServerResponse, method: string, appId: string, what: string | undefined): Promise<void> {
        const who = await signedIn(request);
        if (who === undefined) {
            if (what === undefined && method === 'GET') redirect(response, `/signin?next=${encodeURIComponent(safeNext(request.url))}`);
            else sendJson(response, 401, { message: 'Sign in first.' });
            return;
        }
        const place = await reach(who.user.id, appId);
        if (place === undefined) throw new HttpError(404, 'No app with this id', 'not_found');
        // Only people who may edit an app open its editor; the others are sent to the app
        if (!allows(place.permission, 'edit')) {
            if (what === undefined && method === 'GET') redirect(response, `/apps/${encodeURIComponent(appId)}`);
            else sendJson(response, 403, { message: 'Your access to this app does not include changing it.' });
            return;
        }
        const { services, app, workspaceId } = place;
        const persona = place.orgId === undefined ? undefined : who.user.id;
        const userId = who.user.id;
        if (what === undefined && method === 'GET') {
            sendHostPage(request, response, appShellPage(request, services, app, true, await lookOf(request, who.user.id), persona, await modelsFor(place.orgId), await workspaceNameOf(place)));
            return;
        }
        if (what === '/events' && method === 'GET') {
            response.writeHead(200, { ...COMMON_HEADERS, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
            response.write(': open\n\n');
            const key = Sessions.keyOf(who.token);
            const release = workspaces.retain(workspaceId);
            const open = sessionSockets.get(key) ?? new Set();
            const close = (): void => {
                response.end();
            };
            open.add(close);
            sessionSockets.set(key, open);
            const stopListening = await turns.subscribe(userId, appId, (event) => response.write(`data: ${JSON.stringify(event)}\n\n`), workspaceId);
            const beat = setInterval(() => response.write(': beat\n\n'), 25_000);
            response.on('close', () => {
                clearInterval(beat);
                stopListening();
                release();
                open.delete(close);
                if (open.size === 0) sessionSockets.delete(key);
            });
            return;
        }
        if (what === '/turns' && method === 'POST') {
            const body = await readJsonBody(request, MAX_TURN_BYTES);
            const fields = (typeof body === 'object' && body !== null ? body : {}) as { text?: unknown; context?: unknown; model?: unknown; focus?: unknown };
            const text = typeof fields.text === 'string' ? fields.text.trim() : '';
            if (text === '' || text.length > MAX_REQUEST_CHARS) {
                sendJson(response, 400, { message: `Write a request of up to ${MAX_REQUEST_CHARS} characters.` });
                return;
            }
            const context = Array.isArray(fields.context) ? fields.context.filter((name): name is ContextToggle => (CONTEXT_TOGGLES as readonly unknown[]).includes(name)) : [];
            const focus = Array.isArray(fields.focus) ? fields.focus.filter((entry): entry is string => typeof entry === 'string' && FOCUS_PATH.test(entry)).slice(0, MAX_FOCUS) : [];
            if (fields.model !== undefined && (typeof fields.model !== 'string' || !turns.models.includes(fields.model))) {
                sendJson(response, 400, { message: 'Choose one of the models offered.' });
                return;
            }
            // An org may narrow the models its people pick; a turn that names none takes the first it allows
            const allowed = await modelsFor(place.orgId);
            const model = typeof fields.model === 'string' ? fields.model : allowed.includes(turns.models[0] as string) ? undefined : allowed[0];
            if ((model !== undefined && !allowed.includes(model)) || allowed.length === 0) {
                sendJson(response, 409, { message: `Your org does not allow this model. Choose one of: ${allowed.join(', ')}.` });
                return;
            }
            const started = await turns.start(userId, { id: appId, name: app.name, workspaceId }, text, context, model, focus);
            if ('refused' in started) sendJson(response, 409, { message: started.refused });
            else sendJson(response, 202, { ok: true });
            return;
        }
        if (what === '/budget' && method === 'GET') {
            // What the person has of agent use, for the line above the chat bar, and why they may not ask now
            const spent = await budgets.spent(userId);
            const allowance = await budgets.allowanceOf(userId);
            const refusal = await turns.refusal(userId, { id: appId, name: app.name, workspaceId });
            sendJson(response, 200, { used: spent.total, ...(allowance !== undefined && { total: allowance + spent.bought }), ...(refusal !== undefined && { refusal }) });
            return;
        }
        if (what === '/stop' && method === 'POST') {
            sendJson(response, 200, { stopped: turns.stop(userId) });
            return;
        }
        if (what?.startsWith('/share') === true && !allows(place.permission, 'manage')) {
            sendJson(response, 403, { message: 'Only people who manage the app can share it.' });
            return;
        }
        if (what === '/share' && method === 'GET') {
            const links = (await grants.forApp(workspaceId, appId)).map((grant) => ({ id: grant.id, right: grant.right, url: linkOf(grant), members: Object.keys(grant.members).length, revoked: grant.revokedAt !== undefined, createdAt: grant.createdAt }));
            sendJson(response, 200, { grants: links });
            return;
        }
        if (what === '/share' && method === 'POST') {
            const body = await readJsonBody(request, MAX_FORM_BYTES);
            const right = (typeof body === 'object' && body !== null ? (body as { right?: unknown }).right : undefined) as GrantRight;
            if (!GRANT_RIGHTS.includes(right)) {
                sendJson(response, 400, { message: `Choose what the link gives: ${GRANT_RIGHTS.join(', ')}.` });
                return;
            }
            if (!RANDOM_ID.test(appId)) {
                // The starter apps have the same id in every workspace, so a link to one would open the person's own
                sendJson(response, 409, { message: 'Everyone starts with this app already. Ask the agent to make an app of your own from it, and share that.' });
                return;
            }
            const grant = await grants.create(workspaceId, { id: appId, name: app.name }, right, userId);
            sendJson(response, 201, { id: grant.id, right: grant.right, url: linkOf(grant) });
            return;
        }
        if (what === '/connections' && method === 'GET') {
            // The editor's Connections panel: the workspace's connections and endpoints, never a secret; Manage for
            // those who manage them (the person's own workspace, or an org's admins and owners)
            const role = place.orgId === undefined ? undefined : await orgs.role(place.orgId, userId);
            const manages = place.orgId === undefined || role === 'owner' || role === 'admin';
            sendJson(response, 200, {
                off: !(await connectionsAllowed(workspaceId)),
                manage: manages ? `/settings/connections?w=${encodeURIComponent(workspaceId)}` : null,
                connections: (await connections.list(workspaceId)).map((connection) => ({
                    name: connection.name,
                    host: new URL(connection.baseUrl).host,
                    endpoints: connection.endpoints.map((endpoint) => ({ name: endpoint.name, method: endpoint.method, path: endpoint.path, params: paramsOf(endpoint) }))
                }))
            });
            return;
        }
        if (what === '/shared-data' && method === 'GET') {
            // The editor's Shared data panel: the datasets other owners shared with the app's workspace, read only;
            // Manage data for those who manage the workspace
            const role = place.orgId === undefined ? undefined : await orgs.role(place.orgId, userId);
            const manages = place.orgId === undefined || role === 'owner' || role === 'admin';
            sendJson(response, 200, {
                manage: manages ? `/settings/data?w=${encodeURIComponent(workspaceId)}` : null,
                datasets: stateGrants === undefined ? [] : (await sharedWithWorkspace(stateGrants, db, (id) => workspaces.get(id), workspaceId)).map(({ owner, ownerName, dataset, fields }) => ({ owner, ownerName, dataset, fields }))
            });
            return;
        }
        if (what === '/feedback' && method === 'POST') {
            // The editor's bug button: a bug, a comment or a feature request, kept and emailed to whoever runs the
            // server (docs/design/magnetic-feedback.md)
            const body = (await readJsonBody(request, MAX_FORM_BYTES)) as { kind?: unknown; text?: unknown; context?: unknown } | undefined;
            const kind = FEEDBACK_KINDS.find((item) => item === body?.kind);
            const text = typeof body?.text === 'string' ? body.text.trim() : '';
            if (kind === undefined || text === '' || text.length > MAX_FEEDBACK_LENGTH) {
                sendJson(response, 400, { message: `Say what happened, in up to ${MAX_FEEDBACK_LENGTH} characters.` });
                return;
            }
            if ((await feedback.sentLastHour(userId)) >= FEEDBACK_PER_HOUR) {
                sendJson(response, 429, { message: 'You have sent a lot in the last hour. Try again later.' });
                return;
            }
            const raw = body?.context !== null && typeof body?.context === 'object' ? (body.context as Record<string, unknown>) : {};
            const context = Object.fromEntries(['size', 'screen', 'language'].filter((key) => typeof raw[key] === 'string').map((key) => [key, String(raw[key]).slice(0, 80)]));
            const userAgent = request.headers['user-agent'];
            await feedback.add({ userId, kind, text, workspaceId, appId, appName: app.name, context, ...(userAgent !== undefined && { userAgent }) });
            if (options.mailer?.feedback !== undefined && options.privacy !== undefined) {
                const email = who.user.email;
                options.mailer
                    .feedback({ to: options.privacy.email, kind, text, fromName: who.user.name, ...(email !== undefined && { fromEmail: email }), appName: app.name, context: { ...context, app: appId, ...(userAgent !== undefined && { browser: userAgent.slice(0, 200) }) } })
                    .catch((error: unknown) => options.report.info('feedback email failed', { error: error instanceof Error ? error.message : String(error) }));
            }
            sendJson(response, 200, { sent: true });
            return;
        }
        const view = what === undefined ? null : /^\/views\/([a-z]+)$/.exec(what);
        if (view !== null) {
            const role = place.orgId === undefined ? undefined : await orgs.role(place.orgId, userId);
            const manages = place.orgId === undefined || role === 'owner' || role === 'admin';
            if (await handleViews(request, response, method, view[1] as string, { services, app, workspaceId, user: who.user, manages })) return;
        }
        if (what !== undefined && INSPECT_ROUTES.has(what)) {
            await inspectRoute(request, response, method, services, app, what);
            return;
        }
        const revoke = what === undefined ? null : /^\/share\/([^/]+)\/revoke$/.exec(what);
        if (revoke !== null && method === 'POST') {
            const grant = await grants.revoke(workspaceId, decodeURIComponent(revoke[1] as string));
            if (grant === undefined || grant.appId !== appId) {
                sendJson(response, 404, { message: 'No such link.' });
                return;
            }
            await closeRevoked(grant);
            sendJson(response, 200, { revoked: true });
            return;
        }
        throw new HttpError(405, 'Not allowed', 'method_not_allowed');
    }

    /**
     * What the editor's inspector reads and writes of an app, each with the person's own tools: a node and its
     * component (`/node`), one checked node write (`/nodes`), the component library (`/components`), the state with
     * the nodes and logic that use each path (`/state`), the latest logic runs (`/trace`) and the screens (`/screens`)
     */
    async function inspectRoute(request: IncomingMessage, response: ServerResponse, method: string, services: Services, app: AppPart, what: string): Promise<void> {
        const tools = toolsOf(services);
        const url = new URL(request.url ?? '/', 'http://localhost');
        if (what === '/node' && method === 'GET') {
            const path = url.searchParams.get('path') ?? '';
            const { document } = await services.instanceViews.message(app, 'attach');
            const node = nodeAt(document as Record<string, unknown>, path);
            const tree = treeOf(path);
            if (node === undefined || tree === undefined) {
                sendJson(response, 404, { message: 'No node at this path.' });
                return;
            }
            const component = await run(tools, 'ui_component_get', { name: node['component'] }).catch(() => undefined);
            const parent = parentPath(path);
            sendJson(response, 200, {
                path,
                tree,
                revision: app.revision,
                settings: ownSettings(node),
                children: Object.keys(isRecord(node['children']) ? node['children'] : {}),
                // The layout the node's parent lays it out with (its Placement fields), and its children's placements,
                // which a change of its own layout type may clear
                parentLayout: parent === undefined ? null : (layoutTypeOf(nodeAt(document as Record<string, unknown>, parent)) ?? null),
                childPlacements: childPlacements(node),
                component: component === undefined ? undefined : { name: component['name'], summary: component['summary'], properties: component['properties'], events: component['events'], layout: component['layout'] === true }
            });
            return;
        }
        if (what === '/nodes' && method === 'POST') {
            const body = await readJsonBody(request, MAX_NODE_WRITE_BYTES);
            const operations = isRecord(body) && Array.isArray(body['operations']) ? body['operations'] : [];
            const trees = new Set(operations.map((operation) => (isRecord(operation) && typeof operation['path'] === 'string' ? treeOf(operation['path']) : undefined)));
            const tree = [...trees][0];
            if (operations.length === 0 || operations.length > MAX_NODE_OPERATIONS || trees.size !== 1 || tree === undefined) {
                sendJson(response, 400, { message: `Send 1 to ${MAX_NODE_OPERATIONS} operations, each with a node path of one screen ("$.screens.<name>…") or of the app node ("$.app…").` });
                return;
            }
            const expected = isRecord(body) && typeof body['revision'] === 'number' ? body['revision'] : app.revision;
            const write = tools.find((tool) => tool.name === 'ui_nodes_write');
            if (write === undefined) throw new HttpError(500, 'No node write tool', 'internal');
            const outcome = await write.run({ app: app.name, screen: tree, expectedRevision: expected, operations } as never);
            const result = (outcome.body ?? {}) as Record<string, unknown>;
            if (outcome.isError) sendJson(response, result['error'] === 'conflict' ? 409 : 400, { message: typeof result['message'] === 'string' ? result['message'] : 'The change was refused.', errors: result['errors'] ?? [] });
            else sendJson(response, 200, { revision: result['revision'], added: result['added'] });
            return;
        }
        // The app's screens, for the Screens panel: their names and titles in order, and the one the app opens on
        if (what === '/screens' && method === 'GET') {
            const { document } = await services.instanceViews.message(app, 'attach');
            sendJson(response, 200, { revision: app.revision, ...screensOf(document as Record<string, unknown>) });
            return;
        }
        // One change to the screens, through the same tools as the agent's: add (blank), copy, rename, delete, home, order
        // (every screen's name in the new order) or title (a screen's new title)
        if (what === '/screens' && method === 'POST') {
            const body = await readJsonBody(request, MAX_FORM_BYTES);
            const action = isRecord(body) && typeof body['action'] === 'string' ? body['action'] : '';
            const name = isRecord(body) && typeof body['name'] === 'string' ? body['name'] : '';
            const to = isRecord(body) && typeof body['to'] === 'string' ? body['to'] : '';
            const order = isRecord(body) && Array.isArray(body['order']) ? body['order'].filter((item): item is string => typeof item === 'string') : [];
            const title = isRecord(body) && typeof body['title'] === 'string' ? body['title'].trim() : '';
            const expectedRevision = isRecord(body) && typeof body['revision'] === 'number' ? body['revision'] : app.revision;
            const call = async (tool: string, args: Record<string, unknown>): Promise<void> => {
                const found = tools.find((candidate) => candidate.name === tool);
                if (found === undefined) throw new HttpError(500, `No tool ${tool}`, 'internal');
                const outcome = await found.run({ ...args, expectedRevision } as never);
                const result = (outcome.body ?? {}) as Record<string, unknown>;
                if (outcome.isError) throw new HttpError(result['error'] === 'conflict' ? 409 : 400, typeof result['message'] === 'string' ? result['message'] : 'The change was refused.', 'invalid');
            };
            const { document } = await services.instanceViews.message(app, 'attach');
            const screens = isRecord((document as Record<string, unknown>)['screens']) ? ((document as Record<string, unknown>)['screens'] as Record<string, unknown>) : {};
            try {
                if (action === 'add') await call('ui_screen_create', { app: app.name, name, title: titleOf(name), root: { component: 'panel', layout: { type: 'column', gap: 'md' }, children: {} } });
                else if (action === 'copy') {
                    const from = screens[name];
                    if (!isRecord(from)) throw new HttpError(404, 'No such screen.', 'not_found');
                    await call('ui_screen_create', { app: app.name, name: to, title: titleOf(to), ...(isRecord(from['params']) && { params: from['params'] }), root: from['root'] });
                } else if (action === 'rename') await call('ui_rename', { kind: 'screens', app: app.name, name, to });
                else if (action === 'delete') await call('ui_delete', { kind: 'screens', app: app.name, name });
                else if (action === 'home') await call('ui_app_configure', { name: app.name, start: name });
                else if (action === 'order') await call('ui_app_configure', { name: app.name, screens: order.map((screen) => ({ name: screen })) });
                else if (action === 'title') {
                    if (!isRecord(screens[name])) throw new HttpError(404, 'No such screen.', 'not_found');
                    if (title === '') throw new HttpError(400, 'A screen title is some text.', 'invalid');
                    await call('ui_app_configure', { name: app.name, screens: Object.keys(screens).map((screen) => (screen === name ? { name: screen, title } : { name: screen })) });
                } else throw new HttpError(400, 'Say add, copy, rename, delete, home, order or title.', 'invalid');
            } catch (error) {
                if (error instanceof HttpError) {
                    sendJson(response, error.status, { message: error.message });
                    return;
                }
                throw error;
            }
            const after = await services.instanceViews.message(await services.parts.findById('apps', app.id).then((part) => part ?? app), 'attach');
            sendJson(response, 200, screensOf(after.document as Record<string, unknown>));
            return;
        }
        if (what === '/components' && method === 'GET') {
            sendJson(response, 200, { categories: COMPONENT_CATEGORIES, components: library, layouts: LAYOUTS });
            return;
        }
        if (what === '/state' && method === 'GET') {
            const { document } = await services.instanceViews.message(app, 'attach');
            const state = await run(tools, 'ui_state_get', { app: app.name, path: '$.data', full: true }).catch(() => ({}) as Record<string, unknown>);
            sendJson(response, 200, { data: state['value'] ?? {}, bindings: bindingsOf(document as Record<string, unknown>), logic: logicOf(document as Record<string, unknown>) });
            return;
        }
        if (what === '/trace' && method === 'GET') {
            sendJson(response, 200, await run(tools, 'ui_logic_trace', { app: app.name, limit: 20 }));
            return;
        }
        throw new HttpError(405, 'Not allowed', 'method_not_allowed');
    }

    const http = await startHttpServer({
        host: options.host,
        port: options.port,
        runtimePort: options.runtimePort ?? (options.port === 0 ? 0 : options.port + 1),
        ...(runtimeOrigin !== undefined && publicOrigin !== undefined && { publicOrigins: { main: publicOrigin, runtime: runtimeOrigin } }),
        tenant,
        routes: async (request, response) => {
            try {
                return await routes(request, response);
            } catch (error) {
                // A page asked for while its instance is still on another server (just after a restart): a page that
                // loads again in a moment, not a bare error
                if (!isInstanceBusy(error) || response.headersSent || request.method !== 'GET' || !/text\/html/.test(request.headers.accept ?? '')) throw error;
                options.report.info('A page waited for an instance on another server', { path: request.url?.split('?')[0] });
                response.setHeader('Retry-After', '3');
                sendPage(response, busyPage(languageOf(request.headers['accept-language'])), 503);
                return true;
            }
        },
        socketMessagesPerSecond: options.socketMessagesPerSecond ?? DEFAULT_SOCKET_MESSAGES_PER_SECOND,
        runtime,
        ...(chunk3d !== undefined && { chunk3d }),
        hostScript,
        report: options.report
    });
    runtimePort = http.runtimePort;
    origin = http.origin.replace('//0.0.0.0', '//127.0.0.1').replace('//[::]', '//[::1]');
    const sweep = setInterval(() => void workspaces.sweep(), 60_000);
    sweep.unref();
    // Each org's retentionDays: its old chats, and the state of people no longer in it, go once an hour
    const retention = setInterval(() => void policies.applyRetention().catch((error: unknown) => options.report.info('Retention sweep failed', { error: error instanceof Error ? error.message : String(error) })), 3_600_000);
    retention.unref();
    options.report.info('Magnetic started', { origin, devUsers: devUsers.length, providers: signIn.providers.map((provider) => provider.name) });

    let stopped = false;
    return {
        origin,
        database: db,
        port: http.port,
        runtimePort: http.runtimePort,
        accounts,
        sessions,
        orgs,
        access,
        policies,
        domains,
        sso,
        ...(index !== undefined && { index }),
        keys,
        ...(stateGrants !== undefined && { stateGrants }),
        ...(similarity !== undefined && { similarity }),
        workspaces,
        signIn,
        turns,
        budgets,
        connections,
        grants,
        homes,
        ...(statenet !== undefined && { statenet }),
        stop: async () => {
            if (stopped) return;
            stopped = true;
            clearInterval(sweep);
            clearInterval(retention);
            await turns.stopAll();
            await index?.stop();
            await http.close();
            // what this server owns is saved and let go first, so another server takes it at once
            await statenet?.stop();
            await workspaces.close();
        }
    };
}
