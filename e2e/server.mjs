// The server the Playwright suite runs against: Magnetic from dist on a fresh schema of the test database, with the
// dev users, the mock OIDC provider and the scripted agent, so no test needs an API key or LinkedIn. The schema is
// dropped when Playwright stops the server.
//   node e2e/server.mjs   (Playwright's webServer starts it. MAGNETIC_E2E_PORT, default 4390: the pages; +1 the
//                          runtime; +2 the test control)
import { createServer } from 'node:http';
import { createTestDatabase } from '@punyts/stateui-pg/testing';
import { MockAgentModel, startMagnetic, startMockOidcProvider } from '../dist/index.js';
import { ALL_MIGRATIONS } from '../dist/storage/db.js';

const port = Number(process.env.MAGNETIC_E2E_PORT ?? 4390);
const test = await createTestDatabase(ALL_MIGRATIONS);
const mock = await startMockOidcProvider();
const magnetic = await startMagnetic({
    database: test.db,
    host: '127.0.0.1',
    port,
    runtimePort: port + 1,
    // Quiet unless MAGNETIC_E2E_VERBOSE is set
    report: { info: (message, fields) => (process.env.MAGNETIC_E2E_VERBOSE ? process.stderr.write(`[magnetic] ${message} ${JSON.stringify(fields ?? {})}\n`) : undefined) },
    devUsers: ['alice', 'bob', 'carol', 'dan'],
    starter: 'none',
    providers: [{ name: 'mock', label: 'Sign in with the mock provider', issuer: mock.issuer, clientId: mock.clientId, clientSecret: mock.clientSecret }],
    allowHttpProviders: true,
    secretKey: 'e2e-secret-key-of-enough-length',
    privacy: { operator: 'The test operator', email: 'operator@example.com' },
    agent: { model: new MockAgentModel(), budgets: { perUserTotal: 5, monthly: 100 } }
});

// For the tests only, on loopback: who the mock provider signs in next (POST /person with the person's claims)
const control = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
        if (request.method === 'POST' && request.url === '/person') {
            mock.person = JSON.parse(body);
            response.writeHead(204).end();
        } else response.writeHead(404).end();
    });
});
await new Promise((resolve) => control.listen(port + 2, '127.0.0.1', resolve));
process.stderr.write(`magnetic e2e: ${magnetic.origin} (schema ${test.schema})\n`);

let stopping = false;
const stop = () => {
    if (stopping) return;
    stopping = true;
    void magnetic
        .stop()
        .then(() => new Promise((resolve) => control.close(resolve)))
        .then(() => mock.stop())
        .then(() => test.drop())
        .finally(() => process.exit(0));
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
