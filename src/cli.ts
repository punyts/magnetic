#!/usr/bin/env node
import { createReporter } from '@punyts/core';
import { HELP_TEXT, parseOptions, UsageError } from './server/options.js';
import { linkedInProvider } from './auth/OidcSignIn.js';
import { startMagnetic } from './server/startMagnetic.js';
import { createDatabase, migrate } from '@punyts/stateui-pg';
import { ALL_MIGRATIONS } from './storage/db.js';
import { importPeople } from './storage/importFiles.js';
import type { OidcProvider } from './auth/OidcSignIn.js';
import { MockAgentModel } from './testing/mockAgentModel.js';
import { startMockOidcProvider } from './testing/mockOidcProvider.js';

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
    if (options.command === 'migrate') {
        try {
            const applied = await migrate(database, ALL_MIGRATIONS);
            process.stdout.write(applied.length === 0 ? 'magnetic: the database is up to date\n' : applied.map((migration) => `magnetic: applied ${migration.owner} ${String(migration.version).padStart(4, '0')} ${migration.name}\n`).join(''));
        } finally {
            await database.close();
        }
        return;
    }
    if (options.command === 'import') {
        try {
            await migrate(database, ALL_MIGRATIONS);
            const report = await importPeople(database, options.dataDir);
            process.stdout.write(`magnetic: imported ${report.users} users, ${report.identities} identities, ${report.sessions} sessions, ${report.grants} links, ${report.spend} spend rows, ${report.chats} chat entries from ${options.dataDir}\n`);
            for (const reason of report.skipped) process.stdout.write(`magnetic: skipped ${reason}\n`);
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
    const providers: OidcProvider[] = options.linkedIn === undefined ? [] : [linkedInProvider(options.linkedIn.clientId, options.linkedIn.clientSecret, { pkce: options.linkedIn.pkce })];
    const mock = options.mockProvider ? await startMockOidcProvider() : undefined;
    if (mock !== undefined) providers.push({ name: 'mock', label: 'Sign in with the mock provider', issuer: mock.issuer, clientId: mock.clientId, clientSecret: mock.clientSecret });
    const server = await startMagnetic({
        database,
        dataDir: options.dataDir,
        host: options.host,
        port: options.port,
        ...(options.runtimePort !== undefined && { runtimePort: options.runtimePort }),
        report: reporter.report,
        devUsers: options.devUsers,
        starter: options.starter,
        ...(options.runtimeDir !== undefined && { runtimeDir: options.runtimeDir }),
        ...(options.publicOrigin !== undefined && { publicOrigin: options.publicOrigin }),
        providers,
        allowHttpProviders: mock !== undefined,
        agent: { ...(options.mockAgent && { model: new MockAgentModel() }), modelName: options.model, ...(options.models !== undefined && { models: options.models }), effort: options.effort, budgets: { dailyPerUser: options.dailyBudget, monthly: options.monthlyBudget } }
    });
    for (const provider of server.signIn.providers) process.stderr.write(`magnetic: ${provider.name} redirect URI ${server.signIn.redirectUri(provider.name)}\n`);
    if (options.mockAgent) process.stderr.write('magnetic: agent is the scripted mock agent; no API calls\n');
    else process.stderr.write(`magnetic: agent ${options.model} by default (${options.effort}), budget $${options.dailyBudget} per user per day and $${options.monthlyBudget} per month${process.env['ANTHROPIC_API_KEY'] === undefined ? '; ANTHROPIC_API_KEY is not set, so agent turns will fail' : ''}\n`);
    process.stderr.write(`magnetic: ${server.origin}  workspaces in ${options.dataDir}, everything else in the database\n`);

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
