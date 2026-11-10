export interface CliOptions {
    dataDir: string;
    host: string;
    port: number;
    runtimePort: number | undefined;
    devUsers: string[];
    starter: 'showcase' | 'none';
    runtimeDir: string | undefined;
    publicOrigin: string | undefined;
    /** Runs a mock OpenID Connect provider beside the server, to try the provider sign-in without LinkedIn */
    mockProvider: boolean;
    /** LinkedIn's client, from the environment only so the secret stays out of the process list */
    linkedIn: { clientId: string; clientSecret: string; pkce: boolean } | undefined;
    /** Plays a scripted agent instead of calling the Claude API, to try the editor without a key */
    mockAgent: boolean;
    /** The agent's model, such as claude-opus-5-5 */
    model: string;
    effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
    /** Dollars per user per UTC day */
    dailyBudget: number;
    /** Dollars for the whole server per UTC month */
    monthlyBudget: number;
    help: boolean;
}

export const DEFAULT_PORT = 4300;

export const HELP_TEXT = `magnetic: the Magnetic app builder: sign-in, one workspace per user, live StateUI apps

Usage: magnetic [options]

Options:
  --data-dir <dir>       Where the accounts, sessions and workspaces live
                         (env MAGNETIC_DATA_DIR, default ./data)
  --port <number>        Port of the pages and sockets (env MAGNETIC_PORT, default ${DEFAULT_PORT})
  --runtime-port <n>     Port of the runtime origin that serves the app frame
                         (env MAGNETIC_RUNTIME_PORT, default the next port)
  --host <address>       Address to bind (env MAGNETIC_HOST, default 127.0.0.1)
  --dev-user <name>      A test user who signs in with a button, no provider; repeat for more
                         (env MAGNETIC_DEV_USERS, comma-separated). Loopback hosts only
  --starter <kind>       What a new workspace holds: showcase or none
                         (env MAGNETIC_STARTER, default showcase)
  --runtime-dir <dir>    The built StateUI runtime bundle (env MAGNETIC_RUNTIME_DIR)
  --public-origin <url>  The origin people reach the server at, such as https://magnetic.example
                         (env MAGNETIC_PUBLIC_ORIGIN, default the address it listens on). Redirect
                         URIs are <origin>/auth/<provider>/callback; cookies are Secure when it is HTTPS

Sign in with LinkedIn (environment only):
  MAGNETIC_LINKEDIN_CLIENT_ID      The client id of the LinkedIn app
  MAGNETIC_LINKEDIN_CLIENT_SECRET  Its primary client secret
  MAGNETIC_LINKEDIN_PKCE           false to send no PKCE challenge (default true)

  --mock-provider        Also run a mock OpenID Connect provider on loopback that signs anyone in
                         as a test person, to try the provider flow (env MAGNETIC_MOCK_PROVIDER=true).
                         Loopback hosts only
The agent (the API key comes from ANTHROPIC_API_KEY):
  --model <id>           The model (env MAGNETIC_MODEL, default claude-opus-5-5)
  --effort <level>       low, medium, high, xhigh or max (env MAGNETIC_EFFORT, default high)
  --daily-budget <usd>   Dollars each user may spend per UTC day (env MAGNETIC_DAILY_BUDGET, default 1)
  --monthly-budget <usd> Dollars the server may spend per UTC month (env MAGNETIC_MONTHLY_BUDGET, default 100)
  --mock-agent           A scripted agent that adds each request as a text on the app's first screen,
                         to try the editor without an API key (env MAGNETIC_MOCK_AGENT=true). Loopback hosts only

  -h, --help             Show this help
`;

export class UsageError extends Error {}

const parsePort = (text: string): number => {
    const value = Number(text);
    if (!Number.isInteger(value) || value < 0 || value > 65535) throw new UsageError(`Invalid port: ${text}`);
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
    return { clientId, clientSecret, pkce: pkce !== 'false' };
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

const parseDollars = (name: string, text: string): number => {
    const value = Number(text);
    if (!Number.isFinite(value) || value < 0 || text.trim() === '') throw new UsageError(`Invalid ${name}: ${text} (dollars, such as 2.5)`);
    return value;
};

const parseStarter = (text: string): 'showcase' | 'none' => {
    if (text !== 'showcase' && text !== 'none') throw new UsageError(`Invalid starter: ${text}`);
    return text;
};

/** Reads the command line and the environment. A flag wins over its environment variable */
export function parseOptions(argv: readonly string[], env: Readonly<Record<string, string | undefined>>): CliOptions {
    let dataDir = env['MAGNETIC_DATA_DIR'] ?? './data';
    let host = env['MAGNETIC_HOST'] ?? '127.0.0.1';
    let port = env['MAGNETIC_PORT'] !== undefined ? parsePort(env['MAGNETIC_PORT']) : DEFAULT_PORT;
    let runtimePort = env['MAGNETIC_RUNTIME_PORT'] !== undefined ? parsePort(env['MAGNETIC_RUNTIME_PORT']) : undefined;
    let starter = env['MAGNETIC_STARTER'] !== undefined ? parseStarter(env['MAGNETIC_STARTER']) : 'showcase';
    let runtimeDir = env['MAGNETIC_RUNTIME_DIR'];
    let publicOrigin = env['MAGNETIC_PUBLIC_ORIGIN'] !== undefined ? parseOrigin(env['MAGNETIC_PUBLIC_ORIGIN']) : undefined;
    const linkedIn = parseLinkedIn(env);
    let mockProvider = env['MAGNETIC_MOCK_PROVIDER'] === 'true';
    let mockAgent = env['MAGNETIC_MOCK_AGENT'] === 'true';
    let model = env['MAGNETIC_MODEL'] !== undefined ? parseModel(env['MAGNETIC_MODEL']) : 'claude-opus-5-5';
    let effort = env['MAGNETIC_EFFORT'] !== undefined ? parseEffort(env['MAGNETIC_EFFORT']) : 'high';
    let dailyBudget = env['MAGNETIC_DAILY_BUDGET'] !== undefined ? parseDollars('daily budget', env['MAGNETIC_DAILY_BUDGET']) : 1;
    let monthlyBudget = env['MAGNETIC_MONTHLY_BUDGET'] !== undefined ? parseDollars('monthly budget', env['MAGNETIC_MONTHLY_BUDGET']) : 100;
    const envUsers = (env['MAGNETIC_DEV_USERS'] ?? '')
        .split(',')
        .map((name) => name.trim())
        .filter((name) => name !== '')
        .map(parseDevUser);
    let flagUsers: string[] | undefined;
    let help = false;

    for (let index = 0; index < argv.length; index++) {
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
            case '--data-dir':
                dataDir = value();
                break;
            case '--host':
                host = value();
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
            case '--starter':
                starter = parseStarter(value());
                break;
            case '--runtime-dir':
                runtimeDir = value();
                break;
            case '--public-origin':
                publicOrigin = parseOrigin(value());
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
            case '--effort':
                effort = parseEffort(value());
                break;
            case '--daily-budget':
                dailyBudget = parseDollars('daily budget', value());
                break;
            case '--monthly-budget':
                monthlyBudget = parseDollars('monthly budget', value());
                break;
            case '-h':
            case '--help':
                help = true;
                break;
            default:
                throw new UsageError(`Unknown option: ${argument}`);
        }
    }
    return { dataDir, host, port, runtimePort, devUsers: flagUsers ?? envUsers, starter, runtimeDir, publicOrigin, linkedIn, mockProvider, mockAgent, model, effort, dailyBudget, monthlyBudget, help };
}
