import { describe, expect, it } from 'vitest';
import { parseOptions, UsageError } from './options.js';

describe('parseOptions', () => {
    it('should take the database from the flag over the environment, and the command first', () => {
        // Act
        const fromEnv = parseOptions([], { MAGNETIC_DATABASE_URL: 'postgres://env/db' });
        const fromFlag = parseOptions(['migrate', '--database-url', 'postgres://flag/db'], { MAGNETIC_DATABASE_URL: 'postgres://env/db' });

        // Assert
        expect(fromEnv).toMatchObject({ command: 'serve', databaseUrl: 'postgres://env/db' });
        expect(fromFlag).toMatchObject({ command: 'migrate', databaseUrl: 'postgres://flag/db' });
        expect(parseOptions(['import', '--data-dir', 'old'], {})).toMatchObject({ command: 'import', dataDir: 'old', databaseUrl: undefined });
    });

    it('should refuse a database URL that is not postgres', () => {
        expect(() => parseOptions(['--database-url', 'mysql://x/y'], {})).toThrow(UsageError);
    });

    it('should read LinkedIn from the environment, with PKCE off by default', () => {
        // Act
        const options = parseOptions([], { MAGNETIC_LINKEDIN_CLIENT_ID: 'id', MAGNETIC_LINKEDIN_CLIENT_SECRET: 'secret' });

        // Assert
        expect(options.linkedIn).toEqual({ clientId: 'id', clientSecret: 'secret', pkce: false });
    });

    it('should turn PKCE off for LinkedIn when asked', () => {
        expect(parseOptions([], { MAGNETIC_LINKEDIN_CLIENT_ID: 'id', MAGNETIC_LINKEDIN_CLIENT_SECRET: 'secret', MAGNETIC_LINKEDIN_PKCE: 'false' }).linkedIn?.pkce).toBe(false);
    });

    it('should refuse a LinkedIn client id without its secret', () => {
        expect(() => parseOptions([], { MAGNETIC_LINKEDIN_CLIENT_ID: 'id' })).toThrow(UsageError);
    });

    it('should have no LinkedIn without its variables', () => {
        expect(parseOptions([], {}).linkedIn).toBeUndefined();
    });

    it('should take a public origin from the flag over the environment', () => {
        expect(parseOptions(['--public-origin', 'https://magnetic.example'], { MAGNETIC_PUBLIC_ORIGIN: 'http://127.0.0.1:4300' }).publicOrigin).toBe('https://magnetic.example');
    });

    it.each(['magnetic.example', 'https://magnetic.example/app', 'ftp://magnetic.example'])('should refuse the public origin %s', (origin) => {
        expect(() => parseOptions(['--public-origin', origin], {})).toThrow(UsageError);
    });

    it('should take a runtime origin from the flag over the environment', () => {
        expect(parseOptions(['--runtime-origin', 'https://run.magnetic.example'], { MAGNETIC_RUNTIME_ORIGIN: 'https://other.example' }).runtimeOrigin).toBe('https://run.magnetic.example');
        expect(parseOptions([], { MAGNETIC_RUNTIME_ORIGIN: 'https://run.magnetic.example' }).runtimeOrigin).toBe('https://run.magnetic.example');
        expect(parseOptions([], {}).runtimeOrigin).toBeUndefined();
    });

    it('should take who runs the server for the privacy page, both or neither', () => {
        expect(parseOptions([], { MAGNETIC_OPERATOR: 'Example Operator', MAGNETIC_CONTACT_EMAIL: 'privacy@magnetic.example' }).privacy).toEqual({ operator: 'Example Operator', email: 'privacy@magnetic.example' });
        expect(parseOptions([], {}).privacy).toBeUndefined();
        expect(() => parseOptions([], { MAGNETIC_OPERATOR: 'Example Operator' })).toThrow(UsageError);
        expect(() => parseOptions([], { MAGNETIC_OPERATOR: 'Example Operator', MAGNETIC_CONTACT_EMAIL: 'not an email' })).toThrow(UsageError);
    });

    it('should take a contact email with an s in it, and refuse one with a space or no dot', () => {
        expect(parseOptions([], { MAGNETIC_OPERATOR: 'Example Operator', MAGNETIC_CONTACT_EMAIL: 'support@sales.example.com' }).privacy?.email).toBe('support@sales.example.com');
        expect(() => parseOptions([], { MAGNETIC_OPERATOR: 'Example Operator', MAGNETIC_CONTACT_EMAIL: 'a b@example.com' })).toThrow(UsageError);
        expect(() => parseOptions([], { MAGNETIC_OPERATOR: 'Example Operator', MAGNETIC_CONTACT_EMAIL: 'someone@localhost' })).toThrow(UsageError);
    });

    it('should run the agent on Haiku 5.5 at high effort with $1 a day and $100 a month by default', () => {
        expect(parseOptions([], {})).toMatchObject({ model: 'claude-haiku-5-5', models: undefined, effort: 'high', dailyBudget: 1, monthlyBudget: 100 });
    });

    it('should take the models people may pick from a flag over the environment', () => {
        expect(parseOptions(['--models', 'claude-haiku-5-5, claude-sonnet-5-5'], { MAGNETIC_MODELS: 'claude-opus-5-5' }).models).toEqual(['claude-haiku-5-5', 'claude-sonnet-5-5']);
        expect(parseOptions([], { MAGNETIC_MODELS: 'claude-opus-5-5' }).models).toEqual(['claude-opus-5-5']);
        expect(() => parseOptions(['--models', ' , '], {})).toThrow('Invalid models');
    });

    it('should take the model, effort and budgets from flags over the environment', () => {
        const options = parseOptions(['--model', 'claude-sonnet-5-5', '--effort=medium', '--daily-budget', '0.5', '--monthly-budget', '20'], { MAGNETIC_MODEL: 'claude-opus-5-5', MAGNETIC_EFFORT: 'max', MAGNETIC_DAILY_BUDGET: '3', MAGNETIC_MONTHLY_BUDGET: '300' });
        expect(options).toMatchObject({ model: 'claude-sonnet-5-5', effort: 'medium', dailyBudget: 0.5, monthlyBudget: 20 });
    });

    it('should take a one-time allowance per user and turn the daily budget off', () => {
        expect(parseOptions([], {})).toMatchObject({ userAllowance: undefined });
        expect(parseOptions([], { MAGNETIC_USER_ALLOWANCE: '5', MAGNETIC_DAILY_BUDGET: 'off' })).toMatchObject({ userAllowance: 5, dailyBudget: undefined });
        expect(parseOptions(['--allowance-users', '100'], { MAGNETIC_ALLOWANCE_USERS: '7' }).allowanceUsers).toBe(100);
        expect(parseOptions([], { MAGNETIC_ALLOWANCE_USERS: '100' }).allowanceUsers).toBe(100);
        expect(() => parseOptions(['--allowance-users', '0'], {})).toThrow('Invalid allowance users');
        expect(parseOptions([], {}).admins).toEqual([]);
        expect(parseOptions([], { MAGNETIC_ADMIN_EMAILS: ' Ops@Example.com, b@example.com ' }).admins).toEqual(['ops@example.com', 'b@example.com']);
        expect(() => parseOptions([], { MAGNETIC_ADMIN_EMAILS: 'ops' })).toThrow('Invalid admin email');
        expect(parseOptions([], {}).betaOrg).toBeUndefined();
        expect(parseOptions([], { MAGNETIC_BETA_ORG: 'beta', MAGNETIC_SECRET_KEY: 'a-secret-key-of-enough-length' }).betaOrg).toBe('beta');
        expect(parseOptions(['--beta-org', 'trial'], { MAGNETIC_SECRET_KEY: 'a-secret-key-of-enough-length' }).betaOrg).toBe('trial');
        expect(parseOptions([], { MAGNETIC_BETA_ORG: 'beta' }).betaOrg).toBe('beta');
        expect(() => parseOptions([], { MAGNETIC_BETA_ORG: 'Beta Org', MAGNETIC_SECRET_KEY: 'a-secret-key-of-enough-length' })).toThrow('Invalid beta org');
        expect(parseOptions(['--user-allowance', '2', '--daily-budget', 'off'], {})).toMatchObject({ userAllowance: 2, dailyBudget: undefined });
    });

    it('should read the company org and the budgets of both orgs, and refuse a budget without its org or one slug for both', () => {
        // Arrange
        const key = { MAGNETIC_SECRET_KEY: 'a-secret-key-of-enough-length' };

        // Act
        const fromEnv = parseOptions([], { ...key, MAGNETIC_BETA_ORG: 'beta', MAGNETIC_BETA_BUDGET: '500', MAGNETIC_INTERNAL_ORG: 'ai-minion', MAGNETIC_INTERNAL_BUDGET: '50' });
        const fromFlags = parseOptions(['--internal-org', 'acme', '--internal-budget', '20', '--beta-org', 'trial', '--beta-budget', '100'], key);

        // Assert
        expect(fromEnv).toMatchObject({ betaOrg: 'beta', betaBudget: 500, internalOrg: 'ai-minion', internalBudget: 50 });
        expect(fromFlags).toMatchObject({ betaOrg: 'trial', betaBudget: 100, internalOrg: 'acme', internalBudget: 20 });
        expect(parseOptions([], {})).toMatchObject({ betaBudget: undefined, internalOrg: undefined, internalBudget: undefined });
        expect(() => parseOptions(['--beta-budget', '5'], {})).toThrow('--beta-budget is for --beta-org');
        expect(() => parseOptions(['--internal-budget', '5'], {})).toThrow('--internal-budget is for --internal-org');
        expect(() => parseOptions(['--internal-org', 'Ai Minion'], {})).toThrow('Invalid internal org');
        expect(() => parseOptions(['--internal-org', 'beta', '--beta-org', 'beta'], key)).toThrow('two orgs');
        expect(() => parseOptions(['--user-allowance', 'lots'], {})).toThrow('Invalid user allowance');
    });

    it('should turn the agent\'s browser on by default, and off by flag or environment', () => {
        expect(parseOptions([], {}).agentBrowser).toBe(true);
        expect(parseOptions(['--agent-browser', 'off'], {}).agentBrowser).toBe(false);
        expect(parseOptions([], { MAGNETIC_AGENT_BROWSER: 'off' }).agentBrowser).toBe(false);
        expect(() => parseOptions(['--agent-browser', 'maybe'], {})).toThrow('Invalid agent browser');
    });

    it('should take Stripe from the environment, both keys or none, and the amounts to buy', () => {
        expect(parseOptions([], {})).toMatchObject({ stripe: undefined, topUps: undefined });
        expect(parseOptions([], { MAGNETIC_STRIPE_SECRET_KEY: 'sk_test_x', MAGNETIC_STRIPE_WEBHOOK_SECRET: 'whsec_x' }).stripe).toEqual({ secretKey: 'sk_test_x', webhookSecret: 'whsec_x' });
        expect(() => parseOptions([], { MAGNETIC_STRIPE_SECRET_KEY: 'sk_test_x' })).toThrow('go together');
        expect(parseOptions(['--top-ups', '25, 10,25'], { MAGNETIC_TOP_UPS: '5' }).topUps).toEqual([10, 25]);
        expect(parseOptions([], { MAGNETIC_TOP_UPS: '5,7.5' }).topUps).toEqual([5, 7.5]);
        expect(() => parseOptions(['--top-ups', '0.5'], {})).toThrow('Invalid top-ups');
        expect(() => parseOptions(['--top-ups', '10.001'], {})).toThrow('Invalid top-ups');
    });

    it('should run as one of several servers with a mesh port, from flags over the environment', () => {
        const secret = { MAGNETIC_SECRET_KEY: 'a-secret-of-enough-length' };
        expect(parseOptions([], secret).statenet).toBeUndefined();
        expect(parseOptions(['--mesh-port', '4310', '--mesh-url', 'ws://magnetic-2:4310', '--node-id', 'magnetic-2'], { ...secret, MAGNETIC_MESH_HOST: '0.0.0.0', MAGNETIC_NODE_ID: 'other' }).statenet).toEqual({ meshPort: 4310, meshHost: '0.0.0.0', meshUrl: 'ws://magnetic-2:4310', nodeId: 'magnetic-2' });
        expect(parseOptions(['--mesh-port', '4310'], {}).statenet).toEqual({ meshPort: 4310 });
        expect(() => parseOptions(['--mesh-port', '4310', '--mesh-url', 'http://x'], secret)).toThrow('Invalid mesh URL');
        expect(parseOptions(['relay-certificate', '--node-id', 'relay-1', '--out', 'certs'], secret)).toMatchObject({ command: 'relay-certificate', nodeId: 'relay-1', out: 'certs' });
    });

    it('should put a relay’s region, group and mesh URL into its certificate, with no mesh port', () => {
        // Arrange
        const argv = ['relay-certificate', '--node-id', 'relay-1', '--region', 'us-east-2', '--group', 'magnetic', '--mesh-url', 'wss://relay-1.example:4310'];

        // Act
        const options = parseOptions(argv, { MAGNETIC_SECRET_KEY: 'a-secret-of-enough-length' });

        // Assert
        expect(options.relay).toEqual({ region: 'us-east-2', group: 'magnetic', endpoint: 'wss://relay-1.example:4310' });
        expect(options.statenet).toBeUndefined();
    });

    it('should link a server up to relays under a group, and run the aggregate and grant its role only with what they need', () => {
        // Arrange
        const secret = { MAGNETIC_SECRET_KEY: 'a-secret-of-enough-length' };

        // Act
        const linked = parseOptions(['--mesh-port', '4310', '--relays', 'ws://relay-1:4310, ws://relay-2:4310'], { ...secret, MAGNETIC_GROUP: 'magnetic' });
        const aggregate = parseOptions(['aggregate', '--mesh-port', '4310', '--node-id', 'aggregate-1'], secret);
        const migrate = parseOptions(['migrate', '--app-role', 'magnetic_app'], { MAGNETIC_AGGREGATE_ROLE: 'magnetic_aggregate' });

        // Assert
        expect(linked.statenet).toEqual({ meshPort: 4310, group: 'magnetic', relays: ['ws://relay-1:4310', 'ws://relay-2:4310'] });
        expect(aggregate).toMatchObject({ command: 'aggregate', statenet: { meshPort: 4310, nodeId: 'aggregate-1' } });
        expect(migrate).toMatchObject({ command: 'migrate', appRole: 'magnetic_app', aggregateRole: 'magnetic_aggregate' });
        expect(() => parseOptions(['--relays', 'ws://relay-1:4310'], secret)).toThrow('needs --mesh-port');
        expect(() => parseOptions(['--mesh-port', '4310', '--group', 'two words'], secret)).toThrow('Invalid group');
        expect(() => parseOptions(['aggregate'], secret)).toThrow('--mesh-port');
        expect(() => parseOptions(['migrate', '--aggregate-role', 'magnetic_aggregate'], {})).toThrow('--app-role');
    });

    it('should also serve on a network address, with TLS files or none, and never behind a proxy', () => {
        // Arrange
        const env = { MAGNETIC_NETWORK_HOST: '192.168.1.20' };

        // Act
        const made = parseOptions([], env);
        const given = parseOptions(['--network-host', '192.168.1.30', '--tls-cert', 'server.crt', '--tls-key', 'server.key'], env);

        // Assert
        expect(parseOptions([], {}).network).toBeUndefined();
        expect(made.network).toEqual({ host: '192.168.1.20' });
        expect(made.host).toBe('127.0.0.1');
        expect(given.network).toEqual({ host: '192.168.1.30', tlsCert: 'server.crt', tlsKey: 'server.key' });
        expect(parseOptions(['--network-host', 'desk.local'], {}).network).toEqual({ host: 'desk.local' });
        expect(() => parseOptions(['--network-host', '0.0.0.0'], {})).toThrow('Invalid network host');
        expect(() => parseOptions(['--network-host', '127.0.0.1'], {})).toThrow('Invalid network host');
        expect(() => parseOptions(['--network-host', 'a b'], {})).toThrow('Invalid network host');
        expect(() => parseOptions(['--network-host', '192.168.1.20', '--tls-cert', 'server.crt'], {})).toThrow('go together');
        expect(() => parseOptions(['--tls-cert', 'server.crt', '--tls-key', 'server.key'], {})).toThrow('for --network-host');
        expect(() => parseOptions(['--network-host', '192.168.1.20', '--public-origin', 'https://magnetic.example'], {})).toThrow('--public-origin alone');
    });

    it('should take the report categories from --report over PUNYTS_REPORT, and refuse a category that is not one', () => {
        // Act
        const none = parseOptions([], {});
        const fromEnv = parseOptions([], { PUNYTS_REPORT: 'magnetic.http, stateui-app.*,,' });
        const fromFlag = parseOptions(['--report', 'magnetic.agent'], { PUNYTS_REPORT: 'magnetic.http' });

        // Assert
        expect(none.report).toEqual([]);
        expect(fromEnv.report).toEqual(['magnetic.http', 'stateui-app.*']);
        expect(fromFlag.report).toEqual(['magnetic.agent']);
        expect(parseOptions(['--report=all'], {}).report).toEqual(['all']);
        expect(() => parseOptions(['--report', 'Magnetic HTTP'], {})).toThrow('Invalid report category');
        expect(() => parseOptions([], { PUNYTS_REPORT: 'magnetic.*.x' })).toThrow('Invalid report category');
    });

    it.each([['--effort', 'extreme'], ['--daily-budget', '-1'], ['--monthly-budget', 'lots'], ['--model', 'two words']])('should refuse %s %s', (flag, value) => {
        expect(() => parseOptions([flag, value], {})).toThrow(UsageError);
    });
});
