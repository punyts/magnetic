// The server the Playwright suite runs against: Magnetic from dist on a fresh schema of the test database, with the
// dev users, the mock OIDC provider and the scripted agent, so no test needs an API key or LinkedIn. The schema is
// dropped when Playwright stops the server. It runs as hosted (docs/design/statenet-network.md, S11): the server
// connects as a role that only reads people's state, and saves it through a relay to an aggregate of its own role.
//   node e2e/server.mjs   (Playwright's webServer starts it. MAGNETIC_E2E_PORT, default 4390: the pages; +1 the
//                          runtime; +2 the test control; +3 a stand-in outside API with an OAuth provider, and a
//                          stand-in Stripe Checkout)
import { createServer } from 'node:http';
import { createTestDatabase } from '@punyts/stateui-pg/testing';
import { createStateUiTools } from '@punyts/stateui-mcp';
import { generateKeyPair, startRelayNode } from '@punyts/statenet';
import { MockAgentModel, signatureOf, startMagnetic, startMockOidcProvider } from '../dist/index.js';
import { ALL_MIGRATIONS } from '../dist/storage/db.js';
import { memoryMailer } from '../dist/mail/Mailer.js';
import { SecretBox } from '../dist/auth/secrets.js';
import { startMagneticAggregate } from '../dist/statenet/MagneticAggregate.js';
import { StatenetAuthority } from '../dist/statenet/StatenetNode.js';
import { roleDatabases } from '../dist/testing/testDb.js';

const port = Number(process.env.MAGNETIC_E2E_PORT ?? 4390);
const test = await createTestDatabase(ALL_MIGRATIONS);
const mock = await startMockOidcProvider();
const SECRET_KEY = 'e2e-secret-key-of-enough-length';
// Quiet unless MAGNETIC_E2E_VERBOSE is set
const quiet = (message, fields) => (process.env.MAGNETIC_E2E_VERBOSE ? process.stderr.write(`[magnetic] ${message} ${JSON.stringify(fields ?? {})}\n`) : undefined);
// The roles, the aggregate and the relay the hosted stack runs; the statenet's authority is made first, as the
// aggregate's role may not
const roles = await roleDatabases(test);
const authority = new StatenetAuthority(test.db, new SecretBox(SECRET_KEY));
await authority.keys();
const aggregate = await startMagneticAggregate(roles.aggregate, new SecretBox(SECRET_KEY), { nodeId: 'aggregate-1', host: '127.0.0.1', port: 0, embedRecords: false, report: quiet });
const relayKeys = generateKeyPair();
const relayCertificate = await authority.issue('relay-1', 'relay', relayKeys.publicKey);
const relay = await startRelayNode({ nodeId: 'relay-1', keys: relayKeys, certificate: relayCertificate.certificate, authorityPublicKey: relayCertificate.authorityPublicKey, parents: [aggregate.url], host: '127.0.0.1', meshPort: 0 });
// Invites are "emailed" into memory; GET /mail on the control port lists them
const mailer = memoryMailer();
const magnetic = await startMagnetic({
    database: roles.server,
    host: '127.0.0.1',
    port,
    runtimePort: port + 1,
    report: { info: quiet },
    // frank and gina spend all their agent use, one for each project of the suite
    devUsers: ['alice', 'bob', 'carol', 'dan', 'erin', 'frank', 'gina'],
    // erin runs the server once POST /verify gives her this email (dev users have none)
    admins: ['admin@example.test'],
    starter: 'none',
    providers: [{ name: 'mock', label: 'Sign in with the mock provider', issuer: mock.issuer, clientId: mock.clientId, clientSecret: mock.clientSecret }],
    allowHttpProviders: true,
    secretKey: SECRET_KEY,
    statenet: { meshPort: 0, group: 'e2e', relays: [relay.meshUrl] },
    mailer,
    // Connections may call the stand-in API on loopback, over http
    connectionGuard: { allowHttp: true, allowPrivate: true },
    privacy: { operator: 'The test operator', email: 'operator@example.com' },
    agent: { model: new MockAgentModel(), budgets: { perUserTotal: 5, monthly: 100 } },
    // Agent use is bought through the stand-in Stripe on the API port, with test keys made up for it
    payments: { stripe: { secretKey: 'sk_test_e2e', webhookSecret: 'whsec_e2e', api: `http://127.0.0.1:${port + 3}` }, topUps: [10, 25] }
});

/** The id of a dev user who signed in */
const devUserId = async (name) => (await test.db.query("SELECT user_id::text AS id FROM identity WHERE provider = 'dev' AND subject = $1", [name])).rows[0]?.id;

/**
 * POST /dataset: a dev user who signed in gets a verified email (dev users have none) and a dataset of their own, as the
 * agent would make it: { user, email, dataset, records } with a model of text fields named after the records' fields
 */
async function seedDataset({ user, email, dataset, records }) {
    const id = await devUserId(user);
    if (id === undefined) throw new Error(`${user} has not signed in`);
    await test.db.query('UPDATE app_user SET email = $2, email_verified = true WHERE id = $1', [id, email]);
    const run = await toolsOf(id);
    const fields = [...new Set(Object.values(records).flatMap((record) => Object.keys(record)))];
    await run('ui_model_write', { model: `${dataset}-item`, operations: fields.map((field) => ({ op: 'set', field, type: 'string' })) });
    await run('ui_data_write', { dataset, model: `${dataset}-item`, operations: Object.entries(records).map(([path, value]) => ({ op: 'set', path, value })) });
}

/** Runs the agent's tools in a dev user's workspace: run(name, args) answers the tool's body or throws its error */
async function toolsOf(id) {
    const tools = createStateUiTools(await magnetic.workspaces.get(id));
    return async (name, args) => {
        const outcome = await tools.find((candidate) => candidate.name === name).run(args);
        if (outcome.isError) throw new Error(`${name}: ${JSON.stringify(outcome.body)}`);
        return outcome.body;
    };
}

/**
 * POST /module: a dev user's app gets a logic module, as the agent would make it: { user, app, module, dataset } with
 * the app's name and a dataset of the user's (POST /dataset), bound in the app as $.data.stock. The module's rule
 * marks a record seen when its name changes
 */
async function seedModule({ user, app, module, dataset }) {
    const id = await devUserId(user);
    if (id === undefined) throw new Error(`${user} has not signed in`);
    const run = await toolsOf(id);
    await run('ui_logic_write', {
        module,
        needs: { stock: { model: `${dataset}-item` } },
        params: {},
        operations: [{ op: 'set', unit: 'rules.seen', value: { when: { path: '$.data.stock.{id}.name' }, do: [{ command: 'set', target: '$.data.stock.{id}.seen', value: 'yes' }] } }]
    });
    const read = await run('ui_get', { kind: 'apps', name: app, depth: 8 });
    const uses = read.value.uses ?? {};
    await run('ui_app_configure', {
        name: app,
        expectedRevision: read.revision,
        uses: { ...uses, data: { ...uses.data, stock: { dataset } }, logic: { ...uses.logic, [module]: {} } }
    });
}

/**
 * The stand-in Stripe's news to Magnetic: an event signed with the webhook secret, as Stripe sends it
 */
async function stripeSends(type, object) {
    const body = JSON.stringify({ id: 'evt_' + Math.random().toString(36).slice(2), type, data: { object } });
    const answer = await fetch(`${magnetic.origin}/billing/stripe`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': signatureOf(body, 'whsec_e2e') }, body });
    if (!answer.ok) throw new Error(`The webhook answered ${answer.status}: ${await answer.text()}`);
}

/** The stand-in Stripe's checkout sessions, by id */
const checkouts = new Map();

// For the tests only, on loopback: who the mock provider signs in next (POST /person with the person's claims), the
// invites emailed so far (GET /mail), and a dev user's dataset (POST /dataset) and logic module (POST /module)
const control = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
        if (request.method === 'GET' && request.url === '/mail') {
            response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(mailer.sent));
        } else if (request.method === 'GET' && request.url === '/feedback-mail') {
            response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(mailer.feedbackSent));
        } else if (request.method === 'POST' && request.url === '/person') {
            mock.person = JSON.parse(body);
            response.writeHead(204).end();
        } else if (request.method === 'POST' && request.url === '/refund') {
            // POST /refund { session, cents }: the stand-in Stripe says a payment was refunded, so far in all
            const { session, cents } = JSON.parse(body);
            stripeSends('charge.refunded', { id: 'ch_' + session, currency: 'usd', payment_intent: 'pi_' + session, amount_refunded: cents }).then(
                () => response.writeHead(204).end(),
                (error) => response.writeHead(400, { 'Content-Type': 'text/plain' }).end(String(error))
            );
        } else if (request.method === 'POST' && request.url === '/verify') {
            const { user, email } = JSON.parse(body);
            devUserId(user)
                .then((id) => test.db.query('UPDATE app_user SET email = $2, email_verified = true WHERE id = $1', [id, email]))
                .then(
                    () => response.writeHead(204).end(),
                    (error) => response.writeHead(400, { 'Content-Type': 'text/plain' }).end(String(error))
                );
        } else if (request.method === 'POST' && request.url === '/spend') {
            // POST /spend { user, dollars }: a dev user who signed in spends agent use, as turns would
            const { user, dollars } = JSON.parse(body);
            devUserId(user)
                .then((id) => magnetic.budgets.charge(id, dollars))
                .then(
                    () => response.writeHead(204).end(),
                    (error) => response.writeHead(400, { 'Content-Type': 'text/plain' }).end(String(error))
                );
        } else if (request.method === 'POST' && request.url === '/dataset') {
            seedDataset(JSON.parse(body)).then(
                () => response.writeHead(204).end(),
                (error) => response.writeHead(400, { 'Content-Type': 'text/plain' }).end(String(error))
            );
        } else if (request.method === 'POST' && request.url === '/module') {
            seedModule(JSON.parse(body)).then(
                () => response.writeHead(204).end(),
                (error) => response.writeHead(400, { 'Content-Type': 'text/plain' }).end(String(error))
            );
        } else response.writeHead(404).end();
    });
});
await new Promise((resolve) => control.listen(port + 2, '127.0.0.1', resolve));
// A stand-in outside API for the Connections tests: a key-protected endpoint, and an OAuth 2 provider whose sign-in
// sends the person straight back with a code (the code and the PKCE verifier are checked at /token)
const challenges = new Map();
const api = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', async () => {
        const url = new URL(request.url ?? '/', 'http://localhost');
        const json = (status, value) => response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(value));
        const today = /^\/today\/([a-z]+)$/.exec(url.pathname);
        if (today !== null) return request.headers['x-api-key'] === 'k-e2e' ? json(200, { city: today[1], today: 'snow' }) : json(401, { error: 'no key' });
        if (url.pathname === '/authorize') {
            const code = 'code-' + Math.random().toString(36).slice(2);
            challenges.set(code, url.searchParams.get('code_challenge'));
            const back = new URL(url.searchParams.get('redirect_uri') ?? '');
            back.searchParams.set('code', code);
            back.searchParams.set('state', url.searchParams.get('state') ?? '');
            return response.writeHead(302, { Location: back.toString() }).end();
        }
        if (url.pathname === '/token') {
            const form = new URLSearchParams(body);
            const { createHash } = await import('node:crypto');
            const expected = challenges.get(form.get('code') ?? '');
            const verifier = form.get('code_verifier') ?? '';
            if (expected === undefined || createHash('sha256').update(verifier).digest('base64url') !== expected || form.get('client_secret') !== 'cs-e2e') return json(400, { error: 'invalid_grant' });
            challenges.delete(form.get('code'));
            return json(200, { access_token: 'at-e2e', refresh_token: 'rt-e2e', expires_in: 3600 });
        }
        // The stand-in Stripe Checkout: a session, its page, and Pay, which tells Magnetic and sends the person back
        if (url.pathname === '/v1/checkout/sessions' && request.method === 'POST') {
            if (request.headers.authorization !== 'Bearer sk_test_e2e') return json(401, { error: { message: 'Invalid API key' } });
            const form = new URLSearchParams(body);
            const id = 'cs_e2e_' + Math.random().toString(36).slice(2);
            checkouts.set(id, form);
            return json(200, { id, url: `http://127.0.0.1:${port + 3}/pay/${id}` });
        }
        const pay = /^\/pay\/(cs_e2e_[a-z0-9]+)$/.exec(url.pathname);
        const checkout = pay === null ? undefined : checkouts.get(pay[1]);
        if (checkout !== undefined && request.method === 'GET') {
            const dollars = (Number(checkout.get('line_items[0][price_data][unit_amount]')) / 100).toFixed(2);
            const page = `<!doctype html><title>Stand-in checkout</title><h1>Stand-in checkout</h1><p>${checkout.get('line_items[0][price_data][product_data][name]')}</p><form method="post"><button>Pay $${dollars}</button></form><p><a href="${checkout.get('cancel_url')}">Cancel</a></p>`;
            return response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(page);
        }
        if (checkout !== undefined && request.method === 'POST') {
            const session = pay[1];
            await stripeSends('checkout.session.completed', {
                id: session,
                payment_status: 'paid',
                currency: checkout.get('line_items[0][price_data][currency]'),
                amount_total: Number(checkout.get('line_items[0][price_data][unit_amount]')),
                payment_intent: 'pi_' + session,
                client_reference_id: checkout.get('client_reference_id'),
                metadata: { user_id: checkout.get('metadata[user_id]') }
            });
            return response.writeHead(303, { Location: (checkout.get('success_url') ?? '').replace('{CHECKOUT_SESSION_ID}', session) }).end();
        }
        if (url.pathname === '/me') return request.headers.authorization === 'Bearer at-e2e' ? json(200, { name: 'Ada' }) : json(401, { error: 'no token' });
        json(404, { error: 'not found' });
    });
});
await new Promise((resolve) => api.listen(port + 3, '127.0.0.1', resolve));
process.stderr.write(`magnetic e2e: ${magnetic.origin} (schema ${test.schema})\n`);

let stopping = false;
const stop = () => {
    if (stopping) return;
    stopping = true;
    void magnetic
        .stop()
        .then(() => new Promise((resolve) => control.close(resolve)))
        .then(() => new Promise((resolve) => api.close(resolve)))
        .then(() => mock.stop())
        .then(() => relay.close())
        .then(() => aggregate.close())
        .then(() => roles.close())
        .then(() => test.drop())
        .finally(() => process.exit(0));
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
