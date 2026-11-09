export interface CliOptions {
    dataDir: string;
    host: string;
    port: number;
    runtimePort: number | undefined;
    devUsers: string[];
    starter: 'showcase' | 'none';
    runtimeDir: string | undefined;
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
            case '-h':
            case '--help':
                help = true;
                break;
            default:
                throw new UsageError(`Unknown option: ${argument}`);
        }
    }
    return { dataDir, host, port, runtimePort, devUsers: flagUsers ?? envUsers, starter, runtimeDir, help };
}
