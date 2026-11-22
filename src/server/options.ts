import { isIP } from 'node:net';
import { parseCategories } from './reporting.js';

export interface CliOptions {
    /** The command: run the server (default), apply the migrations, or import a file data folder */
    command: 'serve' | 'migrate' | 'import' | 'reindex' | 'relay-certificate' | 'feedback' | 'aggregate';
    /** What makes the vectors of semantic search: the local CPU model, word hashing (no model), or nothing */
    embedding: 'local' | 'hash' | 'off';
    /** Where the local model is kept; it is downloaded there on first use */
    modelCache: string | undefined;
    /** Magnetic's Postgres database, `postgres://...`; required */
    databaseUrl: string | undefined;
    /** Applies the migrations before serving, for development */
    migrate: boolean;
    /** For migrate: the role the servers connect as, granted the tables after the migrations */
    appRole: string | undefined;
    dataDir: string;
    host: string;
    /**
     * Also serve over HTTPS on this address of the local network (docs/design/statenet-network.md, S10), with these
     * PEM files, or a certificate a local authority makes in `<dataDir>/tls` when they are absent
     */
    network: { host: string; tlsCert?: string; tlsKey?: string } | undefined;
    port: number;
    runtimePort: number | undefined;
    devUsers: string[];
    starter: 'showcase' | 'none';
    /** Seeds the beta's people on a development server, to sign in as each (src/testing/betaPersonas.ts) */
    seed: 'beta' | 'beta-full' | undefined;
    runtimeDir: string | undefined;
    publicOrigin: string | undefined;
    /** The runtime frame's origin behind a proxy, such as https://run.magnetic.example */
    runtimeOrigin: string | undefined;
    /** Who runs the server and where privacy requests go, for /privacy */
    privacy: { operator: string; email: string } | undefined;
    /** Runs a mock OpenID Connect provider beside the server, to try the provider sign-in without LinkedIn */
    mockProvider: boolean;
    /** LinkedIn's client, from the environment only so the secret stays out of the process list */
    linkedIn: { clientId: string; clientSecret: string; pkce: boolean } | undefined;
    /**
     * The server's secret key, from the environment only: it seals the sign-in secrets orgs keep here and the statenet's
     * authority. Absent, the commands use the one made in `<dataDir>/secret-key`
     */
    secretKey: string | undefined;
    /** Invites are emailed through Amazon SES from this verified address, in this region; undefined sends none */
    mail: { from: string; region: string } | undefined;
    /** Plays a scripted agent instead of calling the Claude API, to try the editor without a key */
    mockAgent: boolean;
    /** The agent's model, such as claude-opus-5-5 */
    model: string;
    effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
    /** The models people may pick in the editor; undefined for the default list */
    models: string[] | undefined;
    /** Dollars per user per UTC day; undefined for no daily limit */
    dailyBudget: number | undefined;
    /** Dollars per user ever (a one-time allowance); undefined for none */
    userAllowance: number | undefined;
    /** Only the first this many people get the allowance; undefined for everyone */
    allowanceUsers: number | undefined;
    /** The slug of the beta org, whose first `allowanceUsers` members get the allowance (docs/design/magnetic-beta.md) */
    betaOrg: string | undefined;
    /** The verified emails of the people who reach the admin pages */
    admins: string[];
    /** Stripe, for people to buy agent use after their allowance (environment only); undefined without both keys */
    stripe: { secretKey: string; webhookSecret: string } | undefined;
    /** The amounts of agent use offered, in dollars */
    topUps: number[] | undefined;
    /** Dollars for the whole server per UTC month */
    monthlyBudget: number;
    /** This server as one of several on the database, a node of the statenet: set by `--mesh-port` */
    statenet: { meshPort: number; meshHost?: string; meshUrl?: string; nodeId?: string; region?: string; group?: string; relays?: string[] } | undefined;
    /** For migrate: the role the aggregate connects as, which alone writes the state tables (docs/design/statenet-network.md, S11) */
    aggregateRole: string | undefined;
    /** For relay-certificate: the relay's node id, and the folder its key and certificate are written to */
    nodeId: string | undefined;
    out: string;
    /**
     * For relay-certificate: what the relay's certificate says besides its id, from `--region`, `--group` and
     * `--mesh-url` (where other relays reach it, which the directory lists: docs/design/statenet-relay-directory.md)
     */
    relay: { region?: string; group?: string; endpoint?: string };
    /** The reporter categories written to stderr beside warnings and errors, such as magnetic.http or stateui-app.* */
    report: string[];
    help: boolean;
}

export const DEFAULT_PORT = 4300;

export const HELP_TEXT = `magnetic: the Magnetic app builder: sign-in, one workspace per user, live StateUI apps

Usage: magnetic [command] [options]

Commands:
  serve                  Run the server (the default)
  migrate                Apply the database migrations, then exit
  import                 Copy a file data folder of an earlier Magnetic (--data-dir) into the
                         database, then exit. A workspace already in the database is skipped
  reindex                Queue every part, chat and embedded record field to be embedded again with the current model, embed
                         them, then exit (after changing --embedding)
  feedback               Print the latest bugs, comments and feature requests sent from the editor, then exit
  aggregate              Run the statenet's aggregate: the one writer of people's state, which relays link up
                         to (--mesh-port, --node-id). Connects as the aggregate's role; needs MAGNETIC_SECRET_KEY
  relay-certificate      Make a key pair and a node certificate for a statenet-relay (--node-id), write them to
                         --out, and print the authority key the relay checks its parents with. Needs MAGNETIC_SECRET_KEY

Options:
  --database-url <url>   Magnetic's Postgres database with pgvector, postgres://...
                         (env MAGNETIC_DATABASE_URL; required)
  --migrate              Apply the database migrations before serving (development)
  --embedding <kind>     What makes the vectors of semantic search: local (all-MiniLM-L6-v2 on the CPU;
                         needs @huggingface/transformers), hash (word hashing, no model) or off
                         (env MAGNETIC_EMBEDDING, default local)
  --model-cache <dir>    Where the local model is kept (env MAGNETIC_MODEL_CACHE)
  --data-dir <dir>       Where the server keeps its own files: the secret key it makes without
                         MAGNETIC_SECRET_KEY, and the local network's certificates (tls/). For import:
                         the data folder of an earlier, file-based Magnetic (env MAGNETIC_DATA_DIR, default ./data)
  --port <number>        Port of the pages and sockets (env MAGNETIC_PORT, default ${DEFAULT_PORT})
  --runtime-port <n>     Port of the runtime origin that serves the app frame
                         (env MAGNETIC_RUNTIME_PORT, default the next port)
  --host <address>       Address to bind (env MAGNETIC_HOST, default 127.0.0.1)
  --network-host <address> Also serve over HTTPS on this address of the local network, such as
                         192.168.1.20, on the same ports, so other computers reach the server while --host stays
                         loopback (env MAGNETIC_NETWORK_HOST). Development sign-in is not offered there: people sign
                         in with a link made on a device already signed in. The certificate is --tls-cert and
                         --tls-key, or one a local authority makes in <data dir>/tls; the other computers trust its
                         authority.crt once. Not with --public-origin
  --tls-cert <file>      The network address's certificate, PEM (env MAGNETIC_TLS_CERT); with --tls-key
  --tls-key <file>       Its private key, PEM (env MAGNETIC_TLS_KEY)
  --dev-user <name>      A test user who signs in with a button, no provider; repeat for more
                         (env MAGNETIC_DEV_USERS, comma-separated). Loopback hosts only
  --seed <scenario>      Seeds the beta's people to sign in as, for development: beta (a few places
                         left) or beta-full (env MAGNETIC_SEED). Needs --beta-org. Loopback hosts only
  --starter <kind>       What a new workspace holds: showcase or none
                         (env MAGNETIC_STARTER, default showcase)
  --runtime-dir <dir>    The built StateUI runtime bundle (env MAGNETIC_RUNTIME_DIR)
  --public-origin <url>  The origin people reach the server at, such as https://magnetic.example
                         (env MAGNETIC_PUBLIC_ORIGIN, default the address it listens on). Redirect
                         URIs are <origin>/auth/<provider>/callback; cookies are Secure when it is HTTPS
  --runtime-origin <url> The origin people reach the app frame at behind a proxy, such as
                         https://run.magnetic.example (env MAGNETIC_RUNTIME_ORIGIN; needs --public-origin
                         on another host). The server then answers only to these two host names

Sign in with LinkedIn (environment only):
  MAGNETIC_LINKEDIN_CLIENT_ID      The client id of the LinkedIn app
  MAGNETIC_LINKEDIN_CLIENT_SECRET  Its primary client secret
  MAGNETIC_LINKEDIN_PKCE           true to send a PKCE challenge, which LinkedIn takes only from
                                   apps it enabled as native (default false)

Orgs' own sign-in (environment only):
  MAGNETIC_SECRET_KEY              A random secret of 16 or more characters that seals the client secret of each
                                   org's own OpenID Connect provider and the statenet's authority. Without it,
                                   the server makes one in <data dir>/secret-key on first run and keeps it there.
                                   Their redirect URI is <origin>/auth/sso/callback

Email (environment only):
  MAGNETIC_MAIL_FROM               A verified Amazon SES address invites are emailed from. Without it, an
                                   invite's link is only shown to the person who made it
  MAGNETIC_MAIL_REGION             The SES region (default us-east-2); credentials come from the machine

  --mock-provider        Also run a mock OpenID Connect provider on loopback that signs anyone in
                         as a test person, to try the provider flow (env MAGNETIC_MOCK_PROVIDER=true).
                         Loopback hosts only
The agent (the API key comes from ANTHROPIC_API_KEY):
  --model <id>           The model a turn uses unless the person picks another
                         (env MAGNETIC_MODEL, default claude-haiku-5-5)
  --models <ids>         The models people may pick, comma-separated (env MAGNETIC_MODELS,
                         default claude-haiku-5-5,claude-sonnet-5-5,claude-opus-5-5)
  --effort <level>       low, medium, high, xhigh or max (env MAGNETIC_EFFORT, default high)
  --daily-budget <usd>   Dollars each user may spend per UTC day, or off (env MAGNETIC_DAILY_BUDGET, default 1)
  --user-allowance <usd> Dollars each user may spend ever, a one-time allowance such as a beta's
                         (env MAGNETIC_USER_ALLOWANCE, default none)
  --allowance-users <n>  Only the first n people (by first sign-in) get the allowance; the others may buy
                         agent use (env MAGNETIC_ALLOWANCE_USERS, default everyone)
  --beta-org <slug>      The beta org: people join it through the beta link on Admin, and only its first
                         --allowance-users members get the allowance. Needs MAGNETIC_SECRET_KEY
                         (env MAGNETIC_BETA_ORG, default none)
  --monthly-budget <usd> Dollars the server may spend per UTC month (env MAGNETIC_MONTHLY_BUDGET, default 100)
  --top-ups <usd,...>    The amounts of agent use people may buy after their allowance
                         (env MAGNETIC_TOP_UPS, default 10,25,50)

Admin pages, /admin: feedback, people and giving agent use (environment only):
  MAGNETIC_ADMIN_EMAILS            Comma-separated; a person whose verified email is listed is an admin

Buying agent use after the allowance (environment only; both, or no buying):
  MAGNETIC_STRIPE_SECRET_KEY       The Stripe secret key (sk_live_... or sk_test_...)
  MAGNETIC_STRIPE_WEBHOOK_SECRET   The signing secret of the webhook <origin>/billing/stripe, which takes the
                                   events checkout.session.completed, checkout.session.async_payment_succeeded
                                   and charge.refunded
  --mock-agent           A scripted agent that adds each request as a text on the app's first screen,
                         to try the editor without an API key (env MAGNETIC_MOCK_AGENT=true). Loopback hosts only

Several servers on one database (each a node of the statenet; all with one MAGNETIC_SECRET_KEY, or one data directory):
  --mesh-port <number>   Run as one of several servers, linking to the others and to relays on this port
                         (env MAGNETIC_MESH_PORT; 0 for any free port). Without it the server runs alone
  --mesh-host <address>  Address the mesh binds (env MAGNETIC_MESH_HOST, default --host)
  --mesh-url <url>       The URL the other servers and relays reach this one's mesh at, such as ws://magnetic-2:4310
                         (env MAGNETIC_MESH_URL, default the address it listens on); for relay-certificate, the
                         relay's, written into its certificate and listed in the directory
  --node-id <id>         This server's node id (env MAGNETIC_NODE_ID, default its host name and a random suffix);
                         for relay-certificate, the relay's
  --region <name>        Where it runs (env MAGNETIC_REGION); for relay-certificate, the relay's
  --group <name>         The group of servers that run together and link to each other directly
                         (env MAGNETIC_GROUP, default the host's name); for relay-certificate, the relay's
  --relays <urls>        The relays this server links up to, comma-separated, in order, such as ws://relay-1:4310;
                         it saves people's state through them to the aggregate (env MAGNETIC_RELAYS). Without
                         them the server keeps the aggregate in its own process
  --out <dir>            For relay-certificate: the folder to write the relay's files to (default .)
  --app-role <role>      For migrate: then grant this role (made beforehand, with no superuser or
                         BYPASSRLS) the rows of every table, as the servers connect as it
                         (env MAGNETIC_APP_ROLE)
  --aggregate-role <role> For migrate: grant this role (made beforehand, like the app role) the writing of
                         people's state, and leave the app role only reading it (env MAGNETIC_AGGREGATE_ROLE)

  --report <categories>  Reporter categories to write to stderr beside warnings and errors, comma-separated: Magnetic's
                         (magnetic.http, magnetic.signin, magnetic.agent, magnetic.budget, magnetic.pages,
                         magnetic.statenet, magnetic.storage, magnetic.billing, magnetic.scim) and the libraries'
                         (stateui-app.*, state-sync.*); a family as <prefix>.* (env PUNYTS_REPORT)

  -h, --help             Show this help
`;

export class UsageError extends Error {}

const parsePort = (text: string): number => {
    const value = Number(text);
    if (!Number.isInteger(value) || value < 0 || value > 65535) throw new UsageError(`Invalid port: ${text}`);
    return value;
};

/** A whole number of people, one or more */
const parseCount = (name: string, text: string): number => {
    const value = Number(text.trim());
    if (!Number.isInteger(value) || value < 1) throw new UsageError(`Invalid ${name}: ${text}`);
    return value;
};

const DEV_USER = /^[a-z][a-z0-9-]{0,31}$/;

const parseDevUser = (text: string): string => {
    if (!DEV_USER.test(text)) throw new UsageError(`Invalid development user: ${text} (small letters, digits and -, starting with a letter)`);
    return text;
};

const parseOrigin = (text: string): string => {
    let url: URL;
    try {
        url = new URL(text);
    } catch {
        throw new UsageError(`Invalid public origin: ${text}`);
    }
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.origin !== text.replace(/\/+$/, '')) throw new UsageError(`Invalid public origin: ${text} (a scheme and host, such as https://magnetic.example)`);
    return url.origin;
};

/** LinkedIn's client from the environment: both the id and the secret, or neither */
const parseLinkedIn = (env: Readonly<Record<string, string | undefined>>): CliOptions['linkedIn'] => {
    const clientId = env['MAGNETIC_LINKEDIN_CLIENT_ID']?.trim() ?? '';
    const clientSecret = env['MAGNETIC_LINKEDIN_CLIENT_SECRET']?.trim() ?? '';
    if (clientId === '' && clientSecret === '') return undefined;
    if (clientId === '' || clientSecret === '') throw new UsageError('Set both MAGNETIC_LINKEDIN_CLIENT_ID and MAGNETIC_LINKEDIN_CLIENT_SECRET');
    const pkce = env['MAGNETIC_LINKEDIN_PKCE'];
    if (pkce !== undefined && pkce !== 'true' && pkce !== 'false') throw new UsageError(`Invalid MAGNETIC_LINKEDIN_PKCE: ${pkce} (true or false)`);
    // Off unless asked: LinkedIn refuses PKCE from a web app (linkedInProvider)
    return { clientId, clientSecret, pkce: pkce === 'true' };
};

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
const parseEffort = (text: string): CliOptions['effort'] => {
    const effort = EFFORTS.find((level) => level === text);
    if (effort === undefined) throw new UsageError(`Invalid effort: ${text} (${EFFORTS.join(', ')})`);
    return effort;
};

const parseModel = (text: string): string => {
    if (!/^[a-z0-9][a-z0-9.@:/_-]{0,99}$/i.test(text)) throw new UsageError(`Invalid model: ${text}`);
    return text;
};

const parseModels = (text: string): string[] => {
    const models = text
        .split(',')
        .map((model) => model.trim())
        .filter((model) => model !== '');
    if (models.length === 0) throw new UsageError('Invalid models: name at least one');
    return models.map(parseModel);
};

const parseDollars = (name: string, text: string): number => {
    const value = Number(text);
    if (!Number.isFinite(value) || value < 0 || text.trim() === '') throw new UsageError(`Invalid ${name}: ${text} (dollars, such as 2.5)`);
    return value;
};

/** Amounts of agent use to buy: whole or cent dollars from 1 to 1,000, comma-separated */
const parseTopUps = (text: string): number[] => {
    const amounts = text.split(',').map((part) => Number(part.trim()));
    if (amounts.length === 0 || amounts.some((amount) => !Number.isFinite(amount) || amount < 1 || amount > 1000 || Math.round(amount * 100) !== amount * 100)) {
        throw new UsageError(`Invalid top-ups: ${text} (dollars from 1 to 1000, comma-separated, such as 10,25,50)`);
    }
    return [...new Set(amounts)].sort((a, b) => a - b);
};

const parseOptionalDollars =(name: string, text: string): number | undefined => (text.trim() === 'off' ? undefined : parseDollars(name, text));

const parseEmbedding = (text: string): 'local' | 'hash' | 'off' => {
    if (text !== 'local' && text !== 'hash' && text !== 'off') throw new UsageError(`Invalid embedding: ${text} (local, hash or off)`);
    return text;
};

const parseStarter = (text: string): 'showcase' | 'none' => {
    if (text !== 'showcase' && text !== 'none') throw new UsageError(`Invalid starter: ${text}`);
    return text;
};

const parseSeed = (text: string): 'beta' | 'beta-full' => {
    if (text !== 'beta' && text !== 'beta-full') throw new UsageError(`Invalid seed: ${text} (beta or beta-full)`);
    return text;
};

/** Reads the command line and the environment. A flag wins over its environment variable */
/** A comma-separated list of relay URLs, each ws:// or wss://; none for an empty one */
function parseRelays(text: string | undefined): string[] | undefined {
    const urls = (text ?? '').split(',').map((url) => url.trim()).filter((url) => url !== '');
    for (const url of urls) if (!/^wss?:\/\/[^/]+/.test(url)) throw new UsageError(`Invalid relay URL: ${url} (ws:// or wss://, such as ws://relay-1:4310)`);
    return urls.length === 0 ? undefined : urls;
}

export function parseOptions(argv: readonly string[], env: Readonly<Record<string, string | undefined>>): CliOptions {
    let command: CliOptions['command'] = 'serve';
    let databaseUrl = env['MAGNETIC_DATABASE_URL'];
    let migrate = env['MAGNETIC_MIGRATE'] === 'true';
    let appRole = env['MAGNETIC_APP_ROLE'] || undefined;
    let aggregateRole = env['MAGNETIC_AGGREGATE_ROLE'] || undefined;
    let embedding = env['MAGNETIC_EMBEDDING'] !== undefined ? parseEmbedding(env['MAGNETIC_EMBEDDING']) : 'local';
    let modelCache = env['MAGNETIC_MODEL_CACHE'];
    let dataDir = env['MAGNETIC_DATA_DIR'] ?? './data';
    let host = env['MAGNETIC_HOST'] ?? '127.0.0.1';
    let networkHost = env['MAGNETIC_NETWORK_HOST']?.trim() || undefined;
    let tlsCert = env['MAGNETIC_TLS_CERT']?.trim() || undefined;
    let tlsKey = env['MAGNETIC_TLS_KEY']?.trim() || undefined;
    let port = env['MAGNETIC_PORT'] !== undefined ? parsePort(env['MAGNETIC_PORT']) : DEFAULT_PORT;
    let runtimePort = env['MAGNETIC_RUNTIME_PORT'] !== undefined ? parsePort(env['MAGNETIC_RUNTIME_PORT']) : undefined;
    let starter = env['MAGNETIC_STARTER'] !== undefined ? parseStarter(env['MAGNETIC_STARTER']) : 'showcase';
    let seed = env['MAGNETIC_SEED'] !== undefined && env['MAGNETIC_SEED'] !== '' ? parseSeed(env['MAGNETIC_SEED']) : undefined;
    let runtimeDir = env['MAGNETIC_RUNTIME_DIR'];
    let publicOrigin = env['MAGNETIC_PUBLIC_ORIGIN'] !== undefined ? parseOrigin(env['MAGNETIC_PUBLIC_ORIGIN']) : undefined;
    let runtimeOrigin = env['MAGNETIC_RUNTIME_ORIGIN'] !== undefined ? parseOrigin(env['MAGNETIC_RUNTIME_ORIGIN']) : undefined;
    const operator = env['MAGNETIC_OPERATOR']?.trim() || undefined;
    const contactEmail = env['MAGNETIC_CONTACT_EMAIL']?.trim() || undefined;
    if ((operator === undefined) !== (contactEmail === undefined)) throw new UsageError('MAGNETIC_OPERATOR and MAGNETIC_CONTACT_EMAIL go together, for the privacy page');
    if (contactEmail !== undefined && !/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(contactEmail)) throw new UsageError('MAGNETIC_CONTACT_EMAIL is not an email address');
    const privacy = operator !== undefined && contactEmail !== undefined ? { operator, email: contactEmail } : undefined;
    const linkedIn = parseLinkedIn(env);
    const secretKey = env['MAGNETIC_SECRET_KEY']?.trim() || undefined;
    const mailFrom = env['MAGNETIC_MAIL_FROM']?.trim() || undefined;
    if (mailFrom !== undefined && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(mailFrom)) throw new UsageError(`Invalid MAGNETIC_MAIL_FROM: ${mailFrom} (an email address)`);
    const mail = mailFrom === undefined ? undefined : { from: mailFrom, region: env['MAGNETIC_MAIL_REGION']?.trim() || 'us-east-2' };
    if (secretKey !== undefined && secretKey.length < 16) throw new UsageError('MAGNETIC_SECRET_KEY must be at least 16 characters');
    let mockProvider = env['MAGNETIC_MOCK_PROVIDER'] === 'true';
    let mockAgent = env['MAGNETIC_MOCK_AGENT'] === 'true';
    let model = env['MAGNETIC_MODEL'] !== undefined ? parseModel(env['MAGNETIC_MODEL']) : 'claude-haiku-5-5';
    let models = env['MAGNETIC_MODELS'] !== undefined ? parseModels(env['MAGNETIC_MODELS']) : undefined;
    let effort = env['MAGNETIC_EFFORT'] !== undefined ? parseEffort(env['MAGNETIC_EFFORT']) : 'high';
    let dailyBudget = env['MAGNETIC_DAILY_BUDGET'] !== undefined ? parseOptionalDollars('daily budget', env['MAGNETIC_DAILY_BUDGET']) : 1;
    let userAllowance = env['MAGNETIC_USER_ALLOWANCE'] !== undefined && env['MAGNETIC_USER_ALLOWANCE'] !== '' ? parseOptionalDollars('user allowance', env['MAGNETIC_USER_ALLOWANCE']) : undefined;
    let allowanceUsers = env['MAGNETIC_ALLOWANCE_USERS'] !== undefined && env['MAGNETIC_ALLOWANCE_USERS'] !== '' ? parseCount('allowance users', env['MAGNETIC_ALLOWANCE_USERS']) : undefined;
    let betaOrg = env['MAGNETIC_BETA_ORG']?.trim() || undefined;
    let monthlyBudget = env['MAGNETIC_MONTHLY_BUDGET'] !== undefined ? parseDollars('monthly budget', env['MAGNETIC_MONTHLY_BUDGET']) : 100;
    let topUps = env['MAGNETIC_TOP_UPS'] !== undefined && env['MAGNETIC_TOP_UPS'] !== '' ? parseTopUps(env['MAGNETIC_TOP_UPS']) : undefined;
    const admins = (env['MAGNETIC_ADMIN_EMAILS'] ?? '').split(',').map((email) => email.trim().toLowerCase()).filter((email) => email !== '');
    for (const email of admins) if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new UsageError(`Invalid admin email: ${email}`);
    const stripeSecretKey = env['MAGNETIC_STRIPE_SECRET_KEY']?.trim() || undefined;
    const stripeWebhookSecret = env['MAGNETIC_STRIPE_WEBHOOK_SECRET']?.trim() || undefined;
    if ((stripeSecretKey === undefined) !== (stripeWebhookSecret === undefined)) throw new UsageError('MAGNETIC_STRIPE_SECRET_KEY and MAGNETIC_STRIPE_WEBHOOK_SECRET go together');
    const stripe = stripeSecretKey !== undefined && stripeWebhookSecret !== undefined ? { secretKey: stripeSecretKey, webhookSecret: stripeWebhookSecret } : undefined;
    const envUsers = (env['MAGNETIC_DEV_USERS'] ?? '')
        .split(',')
        .map((name) => name.trim())
        .filter((name) => name !== '')
        .map(parseDevUser);
    let flagUsers: string[] | undefined;
    let help = false;
    let meshPort = env['MAGNETIC_MESH_PORT'] !== undefined && env['MAGNETIC_MESH_PORT'] !== '' ? parsePort(env['MAGNETIC_MESH_PORT']) : undefined;
    let meshHost = env['MAGNETIC_MESH_HOST'] || undefined;
    let meshUrl = env['MAGNETIC_MESH_URL'] || undefined;
    let nodeId = env['MAGNETIC_NODE_ID'] || undefined;
    let region = env['MAGNETIC_REGION'] || undefined;
    let group = env['MAGNETIC_GROUP'] || undefined;
    let relays = parseRelays(env['MAGNETIC_RELAYS']);
    let out = '.';
    let report = parseCategories(env['PUNYTS_REPORT'] ?? '');

    let first = 0;
    if (argv[0] === 'serve' || argv[0] === 'migrate' || argv[0] === 'import' || argv[0] === 'reindex' || argv[0] === 'relay-certificate' || argv[0] === 'feedback' || argv[0] === 'aggregate') {
        command = argv[0];
        first = 1;
    }
    for (let index = first; index < argv.length; index++) {
        const argument = argv[index] as string;
        const equals = argument.startsWith('--') ? argument.indexOf('=') : -1;
        const flag = equals < 0 ? argument : argument.slice(0, equals);
        const inline = equals < 0 ? undefined : argument.slice(equals + 1);
        const value = (): string => {
            if (inline !== undefined) return inline;
            const next = argv[++index];
            if (next === undefined) throw new UsageError(`${flag} needs a value`);
            return next;
        };
        switch (flag) {
            case '--database-url':
                databaseUrl = value();
                break;
            case '--migrate':
                migrate = true;
                break;
            case '--embedding':
                embedding = parseEmbedding(value());
                break;
            case '--model-cache':
                modelCache = value();
                break;
            case '--data-dir':
                dataDir = value();
                break;
            case '--host':
                host = value();
                break;
            case '--network-host':
                networkHost = value();
                break;
            case '--tls-cert':
                tlsCert = value();
                break;
            case '--tls-key':
                tlsKey = value();
                break;
            case '--port':
                port = parsePort(value());
                break;
            case '--runtime-port':
                runtimePort = parsePort(value());
                break;
            case '--dev-user':
                (flagUsers ??= []).push(parseDevUser(value()));
                break;
            case '--seed':
                seed = parseSeed(value());
                break;
            case '--starter':
                starter = parseStarter(value());
                break;
            case '--runtime-dir':
                runtimeDir = value();
                break;
            case '--public-origin':
                publicOrigin = parseOrigin(value());
                break;
            case '--runtime-origin':
                runtimeOrigin = parseOrigin(value());
                break;
            case '--mock-provider':
                mockProvider = true;
                break;
            case '--mock-agent':
                mockAgent = true;
                break;
            case '--model':
                model = parseModel(value());
                break;
            case '--models':
                models = parseModels(value());
                break;
            case '--effort':
                effort = parseEffort(value());
                break;
            case '--daily-budget':
                dailyBudget = parseOptionalDollars('daily budget', value());
                break;
            case '--user-allowance':
                userAllowance = parseOptionalDollars('user allowance', value());
                break;
            case '--allowance-users':
                allowanceUsers = parseCount('allowance users', value());
                break;
            case '--beta-org':
                betaOrg = value();
                break;
            case '--monthly-budget':
                monthlyBudget = parseDollars('monthly budget', value());
                break;
            case '--top-ups':
                topUps = parseTopUps(value());
                break;
            case '--mesh-port':
                meshPort = parsePort(value());
                break;
            case '--mesh-host':
                meshHost = value();
                break;
            case '--mesh-url':
                meshUrl = value();
                break;
            case '--node-id':
                nodeId = value();
                break;
            case '--app-role':
                appRole = value();
                break;
            case '--aggregate-role':
                aggregateRole = value();
                break;
            case '--group':
                group = value();
                break;
            case '--relays':
                relays = parseRelays(value());
                break;
            case '--region':
                region = value();
                break;
            case '--out':
                out = value();
                break;
            case '--report':
                report = parseCategories(value());
                break;
            case '-h':
            case '--help':
                help = true;
                break;
            default:
                throw new UsageError(`Unknown option: ${argument}`);
        }
    }
    for (const category of report) if (!/^(all|[a-z][a-z0-9-]*(\.[a-z0-9-]+)*(\.\*)?)$/.test(category)) throw new UsageError(`Invalid report category: ${category} (such as magnetic.http or stateui-app.*)`);
    if (databaseUrl !== undefined && !/^postgres(ql)?:\/\//.test(databaseUrl)) throw new UsageError('Invalid database URL: it starts with postgres://');
    if (meshUrl !== undefined && !/^wss?:\/\/[^/]+/.test(meshUrl)) throw new UsageError(`Invalid mesh URL: ${meshUrl} (ws:// or wss://, such as ws://magnetic-2:4310)`);
    if (nodeId !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/.test(nodeId)) throw new UsageError(`Invalid node id: ${nodeId} (letters, digits, '.', '_' and '-')`);
    if (relays !== undefined && meshPort === undefined) throw new UsageError('Linking up to relays (--relays) needs --mesh-port');
    if (group !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/.test(group)) throw new UsageError(`Invalid group: ${group} (letters, digits, '.', '_' and '-')`);
    if (command === 'aggregate' && meshPort === undefined) throw new UsageError('The aggregate needs --mesh-port');
    if (aggregateRole !== undefined && appRole === undefined) throw new UsageError('--aggregate-role takes the writing of state from the app role: give --app-role too');
    if (betaOrg !== undefined && !/^[a-z0-9][a-z0-9-]{1,62}$/.test(betaOrg)) throw new UsageError(`Invalid beta org: ${betaOrg} (an org slug: lower-case letters, digits and dashes)`);
    if (seed !== undefined && betaOrg === undefined) throw new UsageError('Seeding the beta (--seed) needs --beta-org');
    if ((tlsCert === undefined) !== (tlsKey === undefined)) throw new UsageError('--tls-cert and --tls-key go together');
    if (tlsCert !== undefined && networkHost === undefined) throw new UsageError('--tls-cert and --tls-key are for --network-host');
    if (networkHost !== undefined) {
        const name = networkHost.toLowerCase();
        if (['0.0.0.0', '::', '[::]', '127.0.0.1', '::1', 'localhost'].includes(name)) throw new UsageError(`Invalid network host: ${networkHost} (one address of this machine on the local network, such as 192.168.1.20)`);
        if (!/^[a-z0-9.-]+$/.test(name) && isIP(name) === 0) throw new UsageError(`Invalid network host: ${networkHost}`);
        if (publicOrigin !== undefined) throw new UsageError('--network-host is for a server reached on the local network; behind a proxy, give --public-origin alone');
    }
    const network = networkHost === undefined ? undefined : { host: networkHost, ...(tlsCert !== undefined && { tlsCert }), ...(tlsKey !== undefined && { tlsKey }) };
    const relay = { ...(region !== undefined && { region }), ...(group !== undefined && { group }), ...(meshUrl !== undefined && { endpoint: meshUrl }) };
    const statenet = meshPort === undefined ? undefined : { meshPort, ...(meshHost !== undefined && { meshHost }), ...(meshUrl !== undefined && { meshUrl }), ...(nodeId !== undefined && { nodeId }), ...(region !== undefined && { region }), ...(group !== undefined && { group }), ...(relays !== undefined && { relays }) };
    return { command, databaseUrl, migrate, appRole, aggregateRole, embedding, modelCache, dataDir, host, network, port, runtimePort, devUsers: flagUsers ?? envUsers, starter, seed, runtimeDir, publicOrigin, runtimeOrigin, privacy, linkedIn, secretKey, mail, mockProvider, mockAgent, model, models, effort, dailyBudget, userAllowance, allowanceUsers, betaOrg, admins, stripe, topUps, monthlyBudget, statenet, nodeId, out, relay, report, help };
}
