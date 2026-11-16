// The server the Playwright suite runs against: Magnetic from dist on a fresh schema of the test database, with the
// dev users, the mock OIDC provider and the scripted agent, so no test needs an API key or LinkedIn. The schema is
// dropped when Playwright stops the server.
//   node e2e/server.mjs   (Playwright's webServer starts it. MAGNETIC_E2E_PORT, default 4390: the pages; +1 the
//                          runtime; +2 the test control; +3 a stand-in outside API with an OAuth provider, and a
//                          stand-in Stripe Checkout)
import { createServer } from 'node:http';
import { createTestDatabase } from '@punyts/stateui-pg/testing';
import { createStateUiTools } from '@punyts/stateui-mcp';
import { MockAgentModel, signatureOf, startMagnetic, startMockOidcProvider } from '../dist/index.js';
import { ALL_MIGRATIONS } from '../dist/storage/db.js';
import { memoryMailer } from '../dist/mail/Mailer.js';

const port = Number(process.env.MAGNETIC_E2E_PORT ?? 4390);
const test = await createTestDatabase(ALL_MIGRATIONS);
const mock = await startMockOidcProvider();
// Invites are "emailed" into memory; GET /mail on the control port lists them
const mailer = memoryMailer();
const magnetic = await startMagnetic({
    database: test.db,
    host: '127.0.0.1',
    port,
    runtimePort: port + 1,
    // Quiet unless MAGNETIC_E2E_VERBOSE is set
    report: { info: (message, fields) => (process.env.MAGNETIC_E2E_VERBOSE ? process.stderr.write(`[magnetic] ${message} ${JSON.stringify(fields ?? {})}\n`) : undefined) },
    devUsers: ['alice', 'bob', 'carol', 'dan', 'erin'],
    // erin runs the server once POST /verify gives her this email (dev users have none)
    admins: ['admin@example.test'],
    starter: 'none',
    providers: [{ name: 'mock', label: 'Sign in with the mock provider', issuer: mock.issuer, clientId: mock.clientId, clientSecret: mock.clientSecret }],
    allowHttpProviders: true,
    secretKey: 'e2e-secret-key-of-enough-length',
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
    const tools = createStateUiTools(await magnetic.workspaces.get(id));
    const run = async (name, args) => {
        const outcome = await tools.find((candidate) => candidate.name === name).run(args);
        if (outcome.isError) throw new Error(`${name}: ${JSON.stringify(outcome.body)}`);
    };
    const fields = [...new Set(Object.values(records).flatMap((record) => Object.keys(record)))];
    await run('ui_model_write', { model: `${dataset}-item`, operations: fields.map((field) => ({ op: 'set', field, type: 'string' })) });
    await run('ui_data_write', { dataset, model: `${dataset}-item`, operations: Object.entries(records).map(([path, value]) => ({ op: 'set', path, value })) });
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
// invites emailed so far (GET /mail), and a dev user's dataset (POST /dataset)
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
        } else if (request.method === 'POST' && request.url === '/dataset') {
            seedDataset(JSON.parse(body)).then(
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
        .then(() => test.drop())
        .finally(() => process.exit(0));
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
