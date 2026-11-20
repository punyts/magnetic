#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { localSecretKey, localTls } from './server/localTls.js';
import { sesMailer } from './mail/Mailer.js';
import { join } from 'node:path';
import { generateKeyPair } from '@punyts/statenet';
import { SecretBox } from './auth/secrets.js';
import { StatenetAuthority } from './statenet/StatenetNode.js';
import { startMagneticAggregate } from './statenet/MagneticAggregate.js';
import { createReporter } from '@punyts/core';
import { HELP_TEXT, parseOptions, UsageError } from './server/options.js';
import { linkedInProvider } from './auth/OidcSignIn.js';
import { startMagnetic } from './server/startMagnetic.js';
import { assertMigrated, createDatabase, EmbeddingIndex, grantAggregateRole, grantAppRole, hashEmbedder, localEmbedder, migrate, PART_SOURCE, queueAllRecords } from '@punyts/stateui-pg';
import type { Embedder } from '@punyts/stateui-pg';
import { CHAT_SOURCE } from './agent/Chats.js';
import { EMBEDDING_SOURCES } from './search/Search.js';
import { Feedback } from './feedback/Feedback.js';
import { ALL_MIGRATIONS } from './storage/db.js';
import { importPeople } from './storage/importFiles.js';
import type { OidcProvider } from './auth/OidcSignIn.js';
import { MockAgentModel } from './testing/mockAgentModel.js';
import { startMockOidcProvider } from './testing/mockOidcProvider.js';
import { seedBeta } from './testing/betaPersonas.js';
import type { SeededBeta } from './testing/betaPersonas.js';

/** The embedder the options name; the local model only when its package is installed, as it never falls back to another */
async function embedderOf(kind: 'local' | 'hash' | 'off', modelCache: string | undefined): Promise<Embedder | undefined> {
    if (kind === 'off') return undefined;
    if (kind === 'hash') return hashEmbedder();
    const name = '@huggingface/transformers';
    const installed = await import(name).then(
        () => true,
        () => false
    );
    if (!installed) {
        process.stderr.write('magnetic: semantic search is off: the local model needs @huggingface/transformers (npm install @huggingface/transformers -w @punyts/magnetic), or start with --embedding hash\n');
        return undefined;
    }
    return localEmbedder(modelCache === undefined ? {} : { cacheDir: modelCache });
}

/**
 * The network listener's address and TLS: the operator's files, or a certificate for the address and this machine's
 * name from the local authority in `<dataDir>/tls` (docs/design/statenet-network.md, S10)
 */
async function networkOf(network: { host: string; tlsCert?: string; tlsKey?: string }, dataDir: string): Promise<{ host: string; key: string; cert: string }> {
    if (network.tlsCert !== undefined && network.tlsKey !== undefined) return { host: network.host, key: await readFile(network.tlsKey, 'utf8'), cert: await readFile(network.tlsCert, 'utf8') };
    const machine = hostname().toLowerCase();
    const names = [...new Set([network.host.toLowerCase(), machine, `${machine}.local`])].filter((name) => /^[a-z0-9.:-]+$/.test(name));
    const tls = await localTls(join(dataDir, 'tls'), machine, names);
    if (tls.made) process.stderr.write(`magnetic: made a certificate for ${names.join(', ')}; other computers trust ${tls.authorityFile} once\n`);
    return { host: network.host, key: tls.key, cert: tls.cert };
}

async function main(): Promise<void> {
    let options;
    try {
        options = parseOptions(process.argv.slice(2), process.env);
    } catch (error) {
        if (error instanceof UsageError) {
            process.stderr.write(`${error.message}\n\n${HELP_TEXT}`);
            process.exitCode = 2;
            return;
        }
        throw error;
    }
    if (options.help) {
        process.stdout.write(HELP_TEXT);
        return;
    }
    if (options.databaseUrl === undefined) {
        process.stderr.write(`magnetic: a database is needed: --database-url or MAGNETIC_DATABASE_URL (postgres://...)\n\n${HELP_TEXT}`);
        process.exitCode = 2;
        return;
    }
    const database = createDatabase({ url: options.databaseUrl });
    /** MAGNETIC_SECRET_KEY, or the one this data directory keeps, made on first use */
    const secretKey = async (): Promise<string> => {
        if (options.secretKey !== undefined) return options.secretKey;
        const local = await localSecretKey(options.dataDir);
        if (local.made) process.stderr.write(`magnetic: made a secret key in ${join(options.dataDir, 'secret-key')}; keep it, or set MAGNETIC_SECRET_KEY\n`);
        return local.key;
    };
    if (options.command === 'migrate') {
        try {
            const applied = await migrate(database, ALL_MIGRATIONS);
            process.stdout.write(applied.length === 0 ? 'magnetic: the database is up to date\n' : applied.map((migration) => `magnetic: applied ${migration.owner} ${String(migration.version).padStart(4, '0')} ${migration.name}\n`).join(''));
            if (options.appRole !== undefined) {
                await grantAppRole(database, options.appRole, { readOnlyState: options.aggregateRole !== undefined });
                process.stdout.write(`magnetic: ${options.appRole} may read and write the tables${options.aggregateRole === undefined ? '' : ", and only read people's state"}\n`);
            }
            if (options.aggregateRole !== undefined) {
                // The aggregate reads which workspace an address is in, and the grant keys it gives the relays
                await grantAggregateRole(database, options.aggregateRole, ['statenet_namespace', 'owner_key']);
                process.stdout.write(`magnetic: ${options.aggregateRole} may write people's state\n`);
            }
            // The search index of the configured model is the owner's to make; the servers may not own the table
            const embedder = await embedderOf(options.embedding, options.modelCache);
            if (embedder !== undefined) {
                await new EmbeddingIndex(database, embedder, EMBEDDING_SOURCES).ensureIndex();
                process.stdout.write(`magnetic: the search index of ${embedder.model} is ready\n`);
            }
        } finally {
            await database.close();
        }
        return;
    }
    if (options.command === 'import') {
        try {
            await migrate(database, ALL_MIGRATIONS);
            const report = await importPeople(database, options.dataDir);
            process.stdout.write(`magnetic: imported ${report.users} users, ${report.identities} identities, ${report.sessions} sessions, ${report.grants} links, ${report.spend} spend rows, ${report.chats} chat entries and ${report.workspaces} workspaces (${report.parts} parts, ${report.instances} instances, ${report.files} files; ${report.workspacesSkipped} already there) from ${options.dataDir}\n`);
            for (const reason of report.skipped) process.stdout.write(`magnetic: skipped ${reason}\n`);
        } finally {
            await database.close();
        }
        return;
    }
    if (options.command === 'feedback') {
        try {
            await assertMigrated(database, ALL_MIGRATIONS);
            const entries = await new Feedback(database).latest(100);
            if (entries.length === 0) process.stdout.write('magnetic: no feedback yet\n');
            // The oldest first, so the newest ends the output
            for (const entry of entries.reverse()) {
                process.stdout.write(`\n${entry.at.toISOString()}  ${entry.kind}  ${entry.userName}${entry.email === null ? '' : ` <${entry.email}>`}${entry.appName === null ? '' : `  in ${entry.appName} (${entry.appId})`}\n${entry.text}\n`);
            }
        } finally {
            await database.close();
        }
        return;
    }
    if (options.command === 'relay-certificate') {
        try {
            if (options.nodeId === undefined) throw new Error('relay-certificate needs the relay\'s --node-id');
            await assertMigrated(database, ALL_MIGRATIONS);
            const keys = generateKeyPair();
            const issued = await new StatenetAuthority(database, new SecretBox(await secretKey())).issue(options.nodeId, 'relay', keys.publicKey, options.statenet?.region ?? '');
            await mkdir(options.out, { recursive: true });
            const keyFile = join(options.out, `${options.nodeId}.key.json`);
            const certificateFile = join(options.out, `${options.nodeId}.certificate`);
            await writeFile(keyFile, JSON.stringify(keys), { mode: 0o600 });
            await writeFile(certificateFile, `${issued.certificate}\n`);
            await writeFile(join(options.out, `${options.nodeId}.authority`), `${issued.authorityPublicKey}\n`);
            process.stdout.write(`STATENET_NODE_ID=${options.nodeId}\nSTATENET_NODE_KEY_FILE=${keyFile}\nSTATENET_NODE_CERTIFICATE_FILE=${certificateFile}\nSTATENET_AUTHORITY_PUBLIC_KEY=${issued.authorityPublicKey}\n`);
        } finally {
            await database.close();
        }
        return;
    }
    if (options.command === 'aggregate') {
        const statenet = options.statenet;
        if (statenet === undefined) throw new Error('The aggregate needs --mesh-port');
        await assertMigrated(database, ALL_MIGRATIONS);
        const reporter = createReporter({ categories: ['info', 'warning', 'error'] });
        reporter.addListener((_timestamp, category, message, details) => {
            process.stderr.write(`[magnetic-aggregate] ${category} ${message}${details === undefined ? '' : ` ${JSON.stringify(details)}`}\n`);
        });
        const aggregate = await startMagneticAggregate(database, new SecretBox(await secretKey()), {
            nodeId: statenet.nodeId ?? 'aggregate-1',
            ...(statenet.meshHost === undefined ? {} : { host: statenet.meshHost }),
            port: statenet.meshPort,
            ...(statenet.region === undefined ? {} : { region: statenet.region }),
            embedRecords: options.embedding !== 'off',
            report: (message, fields) => reporter.report.info(message, fields)
        });
        process.stderr.write(`magnetic: the statenet's aggregate ${aggregate.nodeId} listens on ${aggregate.url}\n`);
        let stopping = false;
        const stop = (): void => {
            if (stopping) return;
            stopping = true;
            void aggregate
                .close()
                .then(() => database.close())
                .finally(() => process.exit(0));
        };
        process.on('SIGINT', stop);
        process.on('SIGTERM', stop);
        return;
    }
    const embedder = await embedderOf(options.embedding, options.modelCache);
    if (options.command === 'reindex') {
        try {
            if (embedder === undefined) throw new Error('reindex needs an embedder: --embedding local or hash');
            await migrate(database, ALL_MIGRATIONS);
            // Every part, chat entry and embedded record field of every workspace: the migration owner role sees past row-level security
            await database.query("INSERT INTO embedding_job (workspace_id, source_kind, source_id) SELECT workspace_id, $1, kind || '/' || id FROM part", [PART_SOURCE]);
            await database.query('INSERT INTO embedding_job (workspace_id, source_kind, source_id) SELECT workspace_id, $1, id::text FROM chat_entry', [CHAT_SOURCE]);
            await queueAllRecords(database);
            const index = new EmbeddingIndex(database, embedder, EMBEDDING_SOURCES);
            await index.drain();
            process.stdout.write(`magnetic: everything is embedded with ${embedder.model}\n`);
        } finally {
            await database.close();
        }
        return;
    }
    if (options.migrate) {
        for (const migration of await migrate(database, ALL_MIGRATIONS)) process.stderr.write(`magnetic: applied ${migration.owner} ${String(migration.version).padStart(4, '0')} ${migration.name}\n`);
    }
    const reporter = createReporter({ categories: ['info', 'warning', 'error'] });
    reporter.addListener((_timestamp, category, message, details) => {
        process.stderr.write(`[magnetic] ${category} ${message}${details === undefined ? '' : ` ${JSON.stringify(details)}`}\n`);
    });
    if (options.mockAgent && !['127.0.0.1', '::1', 'localhost'].includes(options.host.toLowerCase())) {
        process.stderr.write('magnetic: --mock-agent is only allowed on a loopback host\n');
        process.exitCode = 2;
        return;
    }
    let seeded: SeededBeta | undefined;
    if (options.seed !== undefined) {
        if (!['127.0.0.1', '::1', 'localhost'].includes(options.host.toLowerCase())) {
            process.stderr.write('magnetic: --seed is only allowed on a loopback host\n');
            process.exitCode = 2;
            return;
        }
        seeded = await seedBeta(database, { scenario: options.seed, slug: options.betaOrg as string, places: options.allowanceUsers ?? 100, allowance: options.userAllowance ?? 5 });
        const { personas, testers, placesTaken, places } = seeded.made;
        process.stderr.write(`magnetic: seeded ${options.seed}: ${personas} new personas, ${testers} new testers, ${placesTaken} of ${places} places taken\n`);
    }
    const devUsers = seeded === undefined ? options.devUsers : [...new Set([...seeded.devUsers, ...options.devUsers])];
    const admins = seeded === undefined ? options.admins : [...new Set([...options.admins, seeded.adminEmail])];
    // A seeded beta's mock turns cost about 15 cents (three requests priced as the dearest model), so its allowances move
    const mockUsage = seeded === undefined ? undefined : { input_tokens: 5000, output_tokens: 1500, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
    const providers: OidcProvider[] = options.linkedIn === undefined ? [] : [linkedInProvider(options.linkedIn.clientId, options.linkedIn.clientSecret, { pkce: options.linkedIn.pkce })];
    const mock = options.mockProvider ? await startMockOidcProvider() : undefined;
    if (mock !== undefined) providers.push({ name: 'mock', label: 'Sign in with the mock provider', issuer: mock.issuer, clientId: mock.clientId, clientSecret: mock.clientSecret });
    const network = options.network === undefined ? undefined : await networkOf(options.network, options.dataDir);
    const server = await startMagnetic({
        database,
        ...(embedder !== undefined && { embedder }),
        host: options.host,
        ...(network !== undefined && { network }),
        port: options.port,
        ...(options.runtimePort !== undefined && { runtimePort: options.runtimePort }),
        report: reporter.report,
        devUsers,
        ...(seeded !== undefined && { devProfiles: seeded.profiles }),
        starter: options.starter,
        ...(options.runtimeDir !== undefined && { runtimeDir: options.runtimeDir }),
        ...(options.publicOrigin !== undefined && { publicOrigin: options.publicOrigin }),
        ...(options.runtimeOrigin !== undefined && { runtimeOrigin: options.runtimeOrigin }),
        ...(options.privacy !== undefined && { privacy: options.privacy }),
        providers,
        allowHttpProviders: mock !== undefined,
        secretKey: await secretKey(),
        ...(options.mail !== undefined && { mailer: sesMailer(options.mail) }),
        ...(options.statenet !== undefined && { statenet: options.statenet }),
        ...(options.stripe !== undefined && { payments: { stripe: options.stripe, ...(options.topUps !== undefined && { topUps: options.topUps }) } }),
        ...(admins.length > 0 && { admins }),
        agent: { ...(options.mockAgent && { model: new MockAgentModel(undefined, mockUsage) }), modelName: options.model, ...(options.models !== undefined && { models: options.models }), effort: options.effort, budgets: { dailyPerUser: options.dailyBudget, perUserTotal: options.userAllowance, allowanceUsers: options.allowanceUsers, betaOrg: options.betaOrg, monthly: options.monthlyBudget } }
    });
    for (const provider of server.signIn.providers) process.stderr.write(`magnetic: ${provider.name} redirect URI ${server.signIn.redirectUri(provider.name)}\n`);
    if (options.mockAgent) process.stderr.write('magnetic: agent is the scripted mock agent; no API calls\n');
    else process.stderr.write(`magnetic: agent ${options.model} by default (${options.effort}), budget ${[options.userAllowance !== undefined && `$${options.userAllowance} per user in all${options.allowanceUsers !== undefined ? ` for the first ${options.allowanceUsers}` : ''}${options.betaOrg !== undefined ? ` of the beta org ${options.betaOrg}` : ''}`, options.dailyBudget !== undefined && `$${options.dailyBudget} per user per day`, `$${options.monthlyBudget} per month`].filter(Boolean).join(', ')}${process.env['ANTHROPIC_API_KEY'] === undefined ? '; ANTHROPIC_API_KEY is not set, so agent turns will fail' : ''}\n`);
    if (options.stripe !== undefined) process.stderr.write(`magnetic: agent use can be bought through Stripe; its webhook is ${server.origin}/billing/stripe\n`);
    process.stderr.write(`magnetic: ${server.origin}\n`);
    if (server.networkOrigin !== undefined) process.stderr.write(`magnetic: on the local network at ${server.networkOrigin}\n`);

    let stopping = false;
    const stop = (): void => {
        if (stopping) return;
        stopping = true;
        void server
            .stop()
            .then(() => mock?.stop())
            .then(() => database.close())
            .finally(() => process.exit(0));
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
}

main().catch((error: unknown) => {
    process.stderr.write(`magnetic: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
});
