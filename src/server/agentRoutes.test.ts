import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStateUiTools } from '@punyts/stateui-mcp';
import type { PreviewBrowser } from '@punyts/stateui-mcp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AgentModel, ModelListener, ModelMessage, ModelRequest } from '../agent/AgentModel.js';
import { SMALLER_INPUTS_NOTE } from '../agent/AgentTurns.js';
import type { AgentEvent } from '../agent/AgentTurns.js';
import { Chats } from '../agent/Chats.js';
import { appNameOf, startMagnetic } from './startMagnetic.js';
import type { RunningMagnetic } from './startMagnetic.js';

const silent = { info: () => undefined };

const noBrowser: PreviewBrowser = {
    open: async () => ({ rendered: false }),
    screenshot: async () => {
        throw new Error('no browser in this test');
    },
    interact: async () => {
        throw new Error('no browser in this test');
    },
    rendered: async () => {
        throw new Error('no browser in this test');
    },
    closePage: async () => undefined,
    close: async () => undefined
};

type Step = (params: ModelRequest, listener: ModelListener, signal: AbortSignal) => Promise<ModelMessage> | ModelMessage;

/** Plays recorded answers of the Claude API, one per request, and keeps a copy of each request */
class ScriptedModel implements AgentModel {
    steps: Step[] = [];
    readonly requests: ModelRequest[] = [];

    async request(params: ModelRequest, listener: ModelListener, signal: AbortSignal): Promise<ModelMessage> {
        this.requests.push(JSON.parse(JSON.stringify(params)) as ModelRequest);
        const step = this.steps.shift();
        if (step === undefined) throw new Error('The script has no more answers');
        return step(params, listener, signal);
    }
}

const USAGE = { input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };

/** An answer as the API returns it */
function answer(content: unknown[], stopReason: string): ModelMessage {
    return { id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content, stop_reason: stopReason, stop_sequence: null, usage: USAGE } as unknown as ModelMessage;
}

async function signIn(origin: string, user: string): Promise<string> {
    const response = await fetch(`${origin}/signin/dev`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ user }).toString(), redirect: 'manual' });
    return (response.headers.get('set-cookie') ?? '').split(';')[0] as string;
}

/** Reads an app's event stream until `until` says so */
function listen(origin: string, appId: string, cookie: string, until: (event: AgentEvent) => boolean): Promise<AgentEvent[]> {
    const abort = new AbortController();
    return (async () => {
        const response = await fetch(`${origin}/edit/${appId}/events`, { headers: { Cookie: cookie }, signal: abort.signal });
        expect(response.headers.get('content-type')).toMatch(/^text\/event-stream/);
        const reader = (response.body as ReadableStream<Uint8Array>).getReader();
        const decoder = new TextDecoder();
        const events: AgentEvent[] = [];
        let buffer = '';
        for (;;) {
            const { value, done } = await reader.read();
            if (done) return events;
            buffer += decoder.decode(value, { stream: true });
            let end: number;
            while ((end = buffer.indexOf('\n\n')) >= 0) {
                const frame = buffer.slice(0, end);
                buffer = buffer.slice(end + 2);
                if (!frame.startsWith('data: ')) continue;
                const event = JSON.parse(frame.slice(6)) as AgentEvent;
                events.push(event);
                if (until(event)) {
                    abort.abort();
                    return events;
                }
            }
        }
    })();
}

const postTurn = (origin: string, appId: string, cookie: string, text: string, context: string[] = [], model?: string): Promise<Response> =>
    fetch(`${origin}/edit/${appId}/turns`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ text, context, ...(model !== undefined && { model }) }) });

/** Waits for the stream to have sent its first event, so a turn started after it is seen whole */
async function opened(origin: string, appId: string, cookie: string, until: (event: AgentEvent) => boolean): Promise<{ all: Promise<AgentEvent[]> }> {
    let ready: () => void = () => undefined;
    const first = new Promise<void>((resolve) => (ready = resolve));
    const all = listen(origin, appId, cookie, (event) => {
        if (event.type === 'state') ready();
        return until(event);
    });
    await first;
    // In an object: an async function that returned the promise itself would wait for it
    return { all };
}

describe('Agent turns', () => {
    let dataDir: string;
    let magnetic: RunningMagnetic;
    const model = new ScriptedModel();
    let alice: string;
    let aliceId: string;
    let appId: string;

    beforeAll(async () => {
        dataDir = await mkdtemp(join(tmpdir(), 'magnetic-agent-'));
        magnetic = await startMagnetic({ dataDir, host: '127.0.0.1', port: 0, report: silent, devUsers: ['alice', 'bob'], starter: 'none', browser: noBrowser, agent: { model } });
        alice = await signIn(magnetic.origin, 'alice');
        aliceId = (await magnetic.sessions.find(alice.split('=')[1]))?.userId as string;
        const created = await fetch(`${magnetic.origin}/new`, { method: 'POST', headers: { Cookie: alice, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'name=Greeting+Card', redirect: 'manual' });
        expect(created.status).toBe(303);
        appId = decodeURIComponent((created.headers.get('location') ?? '').replace('/edit/', ''));
    });

    afterAll(async () => {
        await magnetic.stop();
        await rm(dataDir, { recursive: true, force: true });
    });

    beforeEach(() => {
        model.steps = [];
        model.requests.length = 0;
    });

    it('should make an app from the name a person typed and open its editor', async () => {
        const services = await magnetic.workspaces.get(aliceId);
        expect((await services.instanceViews.find(appId))?.name).toBe('greeting-card');
        const page = await fetch(`${magnetic.origin}/edit/${appId}`, { headers: { Cookie: alice } });
        expect(page.status).toBe(200);
        const html = await page.text();
        expect(html).toContain(`data-app-id="${appId}"`);
        expect(html).toMatch(/data-runtime-url="http:\/\/127\.0\.0\.1:\d+\/runtime\/[^"]+\.html"/);
        expect(html).toContain('/assets/shell.js');
        expect(page.headers.get('content-security-policy')).toMatch(/frame-src http:\/\/127\.0\.0\.1:\d+/);
        expect((await fetch(`${magnetic.origin}/assets/shell.js`)).headers.get('content-type')).toMatch(/^text\/javascript/);
    });

    it('should open an own app with the editor hidden and the editor chord named, and the editor with it shown', async () => {
        // Act
        const app = await (await fetch(`${magnetic.origin}/apps/${appId}`, { headers: { Cookie: alice } })).text();
        const editor = await (await fetch(`${magnetic.origin}/edit/${appId}`, { headers: { Cookie: alice } })).text();

        // Assert
        expect(app).toContain('<body class="view shell" data-host-keys="mod+shift+e"');
        expect(app).toContain(`data-app-id="${appId}"`);
        expect(editor).toContain('<body class="view shell editing" data-host-keys="mod+shift+e"');
    });

    it('should make an app for the home page with a JSON answer, refuse a bad name and keep the agent off Your apps', async () => {
        // Arrange
        const post = (name: string): Promise<Response> =>
            fetch(`${magnetic.origin}/new`, { method: 'POST', redirect: 'manual', headers: { Cookie: alice, Origin: magnetic.origin, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ name }).toString() });
        await fetch(`${magnetic.origin}/`, { headers: { Cookie: alice } });
        const services = await magnetic.workspaces.get(aliceId);
        const home = await magnetic.homes.id(services, aliceId);

        // Act
        const made = await post('Reading list');
        const bad = await post('42');
        const homeEditor = await fetch(`${magnetic.origin}/edit/${home}`, { redirect: 'manual', headers: { Cookie: alice } });
        const homeApp = await fetch(`${magnetic.origin}/apps/${home}`, { redirect: 'manual', headers: { Cookie: alice } });
        const homeTurn = await fetch(`${magnetic.origin}/edit/${home}/turns`, { method: 'POST', headers: { Cookie: alice, Origin: magnetic.origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Make it red' }) });

        // Assert
        expect(made.status).toBe(201);
        const { id } = (await made.json()) as { id: string };
        expect((await services.instanceViews.find(id))?.name).toBe('reading-list');
        expect(bad.status).toBe(400);
        expect(((await bad.json()) as { message: string }).message).toMatch(/starts with a letter/);
        expect(homeEditor.status).toBe(303);
        expect(homeEditor.headers.get('location')).toBe('/');
        expect(homeApp.headers.get('location')).toBe('/');
        expect(homeTurn.status).toBe(404);
        expect((await magnetic.homes.read(services, aliceId)).apps.map((app) => app.id)).not.toContain(home);
    });

    it('should make Your apps again when it was made from an older definition', async () => {
        // Arrange
        const usersDir = join(dataDir, 'users');
        const stampFile = join(usersDir, aliceId, 'magnetic', 'home.json');
        const before = await magnetic.homes.id(await magnetic.workspaces.get(aliceId), aliceId);
        await writeFile(stampFile, JSON.stringify({ stamp: 'older' }));
        const later = await startMagnetic({ dataDir, host: '127.0.0.1', port: 0, report: silent, devUsers: ['alice'], starter: 'none', browser: noBrowser, agent: { model } });

        try {
            // Act
            const services = await later.workspaces.get(aliceId);
            const after = await later.homes.id(services, aliceId);

            // Assert
            expect(after).not.toBe(before);
            expect((await services.instanceViews.list()).filter((app) => app.name === 'your-apps')).toHaveLength(1);
            expect(JSON.parse(await readFile(stampFile, 'utf8')).stamp).not.toBe('older');
        } finally {
            await later.stop();
        }
    });

    it('should name apps in lower case words joined by dashes', () => {
        expect(appNameOf('  My Todo List! ')).toBe('my-todo-list');
        expect(appNameOf('42 things')).toBeUndefined();
        expect(appNameOf('***')).toBeUndefined();
    });

    it('should send the editor to sign-in and refuse its stream without a session', async () => {
        const page = await fetch(`${magnetic.origin}/edit/${appId}`, { redirect: 'manual' });
        expect(page.status).toBe(303);
        expect(page.headers.get('location')).toBe(`/signin?next=${encodeURIComponent(`/edit/${appId}`)}`);
        expect((await fetch(`${magnetic.origin}/edit/${appId}/events`)).status).toBe(401);
        expect((await postTurn(magnetic.origin, appId, '', 'hi')).status).toBe(401);
    });

    it("should not find another user's app", async () => {
        const bob = await signIn(magnetic.origin, 'bob');
        expect((await fetch(`${magnetic.origin}/edit/${appId}`, { headers: { Cookie: bob } })).status).toBe(404);
        expect((await postTurn(magnetic.origin, appId, bob, 'hi')).status).toBe(404);
    });

    it('should run a turn that writes nodes, streaming what it says and does', async () => {
        model.steps = [
            (params, listener) => {
                listener.text('Adding a greeting.');
                listener.note('Looking at the home screen');
                return answer(
                    [
                        { type: 'text', text: 'Adding a greeting.' },
                        { type: 'tool_use', id: 'toolu_1', name: 'ui_nodes_write', input: { app: 'greeting-card', screen: 'home', expectedRevision: 1, operations: [{ op: 'add', path: 'root', key: 'greeting', value: { component: 'text', _text: 'Hello from the agent' } }] } }
                    ],
                    'tool_use'
                );
            },
            (_params, listener) => {
                listener.text(' Done: the home screen greets you.');
                return answer([{ type: 'text', text: ' Done: the home screen greets you.' }], 'end_turn');
            }
        ];
                const { all: events } = await opened(magnetic.origin, appId, alice, (event) => event.type === 'done');
        const started = await postTurn(magnetic.origin, appId, alice, 'Greet people on the home screen', ['layout', 'nonsense']);
        expect(started.status).toBe(202);
        const seen = await events;

        expect(seen.map((event) => event.type)).toEqual(['state', 'person', 'say', 'note', 'tool', 'toolDone', 'say', 'done']);
        expect(seen.find((event) => event.type === 'tool')).toMatchObject({ name: 'ui_nodes_write', summary: expect.stringContaining('app greeting-card') });
        expect(seen.find((event) => event.type === 'toolDone')).toMatchObject({ ok: true, result: 'revision 2' });
        const done = seen.at(-1) as Extract<AgentEvent, { type: 'done' }>;
        expect(done.outcome).toBe('finished');
        expect(done.cost).toBeCloseTo(2 * (1000 * 4 + 200 * 20) / 1e6);

        // The nodes are in the app
        const services = await magnetic.workspaces.get(aliceId);
        const tree = await createStateUiTools(services)
            .find((tool) => tool.name === 'ui_tree')
            ?.run({ app: 'greeting-card' });
        expect((tree?.body as { text: string }).text).toContain('greeting (text)');

        // The first request: the cached system prompt, the tools without the browser ones, the layout asked for
        const [first, second] = model.requests as [ModelRequest, ModelRequest];
        // The default model is Haiku 5.5, which takes no server-side fallback
        expect(first.model).toBe('claude-haiku-5-5');
        expect(first.thinking).toEqual({ type: 'adaptive', display: 'updates' });
        expect(first.fallbacks).toBeUndefined();
        expect(first.betas).toEqual(['thinking-display-updates-2026-08-18']);
        const system = first.system as { text: string; cache_control?: unknown }[];
        expect(system[0]?.text).toContain('You are the builder inside Magnetic');
        expect(system[0]?.cache_control).toEqual({ type: 'ephemeral' });
        const names = (first.tools ?? []).map((tool) => (tool as { name: string }).name);
        expect(names).toContain('ui_nodes_write');
        expect(names).not.toContain('ui_screenshot');
        expect(names).not.toContain('ui_call_answer');
        expect((first.tools ?? []).every((tool) => (tool as { eager_input_streaming?: boolean }).eager_input_streaming === true)).toBe(true);
        const opening = first.messages[0]?.content as string;
        expect(opening).toContain('<context name="layout">');
        expect(opening).toContain('home (panel)');
        expect(opening).not.toContain('<context name="nonsense">');
        expect(opening).toContain('<request>\nGreet people on the home screen\n</request>');

        // The second request carries the answer back unchanged and the tool's result
        expect(second.messages).toHaveLength(3);
        expect(second.messages[1]).toEqual({ role: 'assistant', content: expect.arrayContaining([expect.objectContaining({ type: 'tool_use', id: 'toolu_1' })]) });
        const results = second.messages[2]?.content as { type: string; tool_use_id: string; content: { text: string }[] }[];
        expect(results[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'toolu_1' });
        expect(results[0]?.content[0]?.text).toContain('"revision":2');

        // The chat is kept and the turn charged
        const chat = await new Chats(join(dataDir, 'users')).read(aliceId, appId);
        expect(chat.map((entry) => entry.role)).toEqual(['person', 'agent']);
        expect(chat[1]).toMatchObject({ text: 'Adding a greeting.\n\n Done: the home screen greets you.', outcome: 'finished', tools: [{ name: 'ui_nodes_write', ok: true }] });
        expect((await magnetic.budgets.spent(aliceId)).today).toBeCloseTo(done.cost);
    });

    it('should give the next turn the earlier chat as text, and send a new stream the chat so far', async () => {
        model.steps = [() => answer([{ type: 'text', text: 'It says hello.' }], 'end_turn')];
        const { all: events } = await opened(magnetic.origin, appId, alice, (event) => event.type === 'done');
        expect((await postTurn(magnetic.origin, appId, alice, 'What does it say?')).status).toBe(202);
        const seen = await events;
        const state = seen[0] as Extract<AgentEvent, { type: 'state' }>;
        expect(state.history.length).toBeGreaterThanOrEqual(2);
        const opening = model.requests[0]?.messages[0]?.content as string;
        expect(opening).toContain('<earlier_chat>\nPerson: Greet people on the home screen\nYou: Adding a greeting.');
        expect(model.requests[0]?.messages).toHaveLength(1);
    });

    it('should give a turn the paths the person points at, and leave out what is not a path', async () => {
        // Arrange
        model.steps = [() => answer([{ type: 'text', text: 'That is the home screen.' }], 'end_turn')];
        const { all: events } = await opened(magnetic.origin, appId, alice, (event) => event.type === 'done');

        // Act
        const started = await fetch(`${magnetic.origin}/edit/${appId}/turns`, {
            method: 'POST',
            headers: { Cookie: alice, 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: 'What is this?', focus: ['$.screens.home', 'not a path', '$.data.nothing.here'] })
        });
        await events;

        // Assert
        expect(started.status).toBe(202);
        const opening = model.requests[0]?.messages[0]?.content as string;
        expect(opening).toContain('<context name="focus" path="$.screens.home">\n{"note":"The person points at this node of the app."}\n</context>');
        expect(opening).toContain('<context name="focus" path="$.data.nothing.here">');
        expect(opening).not.toContain('not a path');
    });

    it('should stop a turn when asked, and refuse a second turn while one runs', async () => {
        model.steps = [(_params, _listener, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))))];
        const { all: events } = await opened(magnetic.origin, appId, alice, (event) => event.type === 'done');
        expect((await postTurn(magnetic.origin, appId, alice, 'Build a whole shop')).status).toBe(202);
        const second = await postTurn(magnetic.origin, appId, alice, 'And another');
        expect(second.status).toBe(409);
        expect(((await second.json()) as { message: string }).message).toMatch(/still working/);
        const stop = await fetch(`${magnetic.origin}/edit/${appId}/stop`, { method: 'POST', headers: { Cookie: alice, 'Content-Type': 'application/json' }, body: '{}' });
        expect(await stop.json()).toEqual({ stopped: true });
        const done = (await events).at(-1);
        expect(done).toMatchObject({ type: 'done', outcome: 'stopped' });
        expect(magnetic.turns.isRunning(aliceId)).toBe(false);
    });

    it('should report a refusal of the model and run no tools', async () => {
        model.steps = [() => answer([], 'refusal')];
        const { all: events } = await opened(magnetic.origin, appId, alice, (event) => event.type === 'done');
        await postTurn(magnetic.origin, appId, alice, 'Something the model declines');
        expect((await events).at(-1)).toMatchObject({ type: 'done', outcome: 'refused' });
        expect(model.requests).toHaveLength(1);
    });

    it('should retry a tool input that is not JSON with a note asking for smaller inputs, and not take it for a missing key', async () => {
        // The SDK's own error, quoting the model's JSON, which here holds the word "author"
        const badJson = (): never => {
            throw new Error('Unable to parse tool parameter JSON from model. Please retry your request or adjust your prompt. Error: SyntaxError. JSON: {"author": "x"');
        };
        model.steps = [badJson, () => answer([{ type: 'text', text: 'Done.' }], 'end_turn')];
        const { all: events } = await opened(magnetic.origin, appId, alice, (event) => event.type === 'done');
        await postTurn(magnetic.origin, appId, alice, 'Make a reading list');
        expect((await events).at(-1)).toMatchObject({ type: 'done', outcome: 'finished' });
        const [first, second] = model.requests as [ModelRequest, ModelRequest];
        // The note holds quotes, so it is looked for as JSON writes it
        const note = JSON.stringify(SMALLER_INPUTS_NOTE).slice(1, -1);
        expect(JSON.stringify(first.messages)).not.toContain(note);
        expect(JSON.stringify(second.messages)).toContain(note);

        model.requests.length = 0;
        model.steps = [badJson, badJson, badJson];
        const { all: failed } = await opened(magnetic.origin, appId, alice, (event) => event.type === 'done');
        await postTurn(magnetic.origin, appId, alice, 'Make a reading list');
        expect((await failed).at(-1)).toMatchObject({ type: 'done', outcome: 'failed', message: 'The agent ran into a problem and stopped.' });
        expect(model.requests).toHaveLength(3);
    });

    it('should end a turn that reaches its tool-call limit', async () => {
        const limited = await startMagnetic({
            dataDir: join(dataDir, 'limited'),
            host: '127.0.0.1',
            port: 0,
            report: silent,
            devUsers: ['carol'],
            starter: 'none',
            browser: noBrowser,
            agent: { model, limits: { toolCalls: 2, ms: 60_000, maxTokens: 1000 } }
        });
        try {
            const carol = await signIn(limited.origin, 'carol');
            const made = await fetch(`${limited.origin}/new`, { method: 'POST', headers: { Cookie: carol, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'name=loop', redirect: 'manual' });
            const id = decodeURIComponent((made.headers.get('location') ?? '').replace('/edit/', ''));
            const look = (n: number): Step => () => answer([{ type: 'tool_use', id: `toolu_${n}`, name: 'ui_tree', input: { app: 'loop' } }], 'tool_use');
            model.steps = [look(1), look(2), look(3)];
            const { all: events } = await opened(limited.origin, id, carol, (event) => event.type === 'done');
            await postTurn(limited.origin, id, carol, 'Look forever');
            const seen = await events;
            expect(seen.filter((event) => event.type === 'tool')).toHaveLength(2);
            expect(seen.at(-1)).toMatchObject({ type: 'done', outcome: 'limit' });
        } finally {
            await limited.stop();
        }
    });

    it("should refuse a turn once the user has spent the day's budget", async () => {
        const bob = await signIn(magnetic.origin, 'bob');
        const bobId = (await magnetic.sessions.find(bob.split('=')[1]))?.userId as string;
        const made = await fetch(`${magnetic.origin}/new`, { method: 'POST', headers: { Cookie: bob, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'name=budget', redirect: 'manual' });
        const id = decodeURIComponent((made.headers.get('location') ?? '').replace('/edit/', ''));
        await magnetic.budgets.charge(bobId, 1.5);
        const refused = await postTurn(magnetic.origin, id, bob, 'Build something');
        expect(refused.status).toBe(409);
        expect(((await refused.json()) as { message: string }).message).toMatch(/today's agent budget/);
        expect(model.requests).toHaveLength(0);
    });

    it('should run a turn on the model the person picked, offer the models in the editor, and refuse one not offered', async () => {
        model.steps = [() => answer([{ type: 'text', text: 'Hello.' }], 'end_turn')];
        const { all: events } = await opened(magnetic.origin, appId, alice, (event) => event.type === 'done');
        const started = await postTurn(magnetic.origin, appId, alice, 'Say hello', [], 'claude-opus-5-5');
        await events;
        const refused = await postTurn(magnetic.origin, appId, alice, 'Say hello', [], 'claude-unknown-1');
        const editor = await (await fetch(`${magnetic.origin}/edit/${appId}`, { headers: { Cookie: alice } })).text();

        expect(started.status).toBe(202);
        const [request] = model.requests as [ModelRequest];
        expect(request.model).toBe('claude-opus-5-5');
        expect(request.fallbacks).toBe('default');
        expect(refused.status).toBe(400);
        expect(model.requests).toHaveLength(1);
        expect(editor).toContain('<select id="model"');
        expect(editor.indexOf('value="claude-haiku-5-5"')).toBeLessThan(editor.indexOf('value="claude-opus-5-5"'));
    });

    it('should end a turn as soon as it spends the last of the budget', async () => {
        const capped = await startMagnetic({ dataDir: join(dataDir, 'capped'), host: '127.0.0.1', port: 0, report: silent, devUsers: ['dan'], starter: 'none', browser: noBrowser, agent: { model, budgets: { dailyPerUser: 1, monthly: 0.01 } } });
        try {
            const dan = await signIn(capped.origin, 'dan');
            const made = await fetch(`${capped.origin}/new`, { method: 'POST', headers: { Cookie: dan, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'name=capped', redirect: 'manual' });
            const id = decodeURIComponent((made.headers.get('location') ?? '').replace('/edit/', ''));
            const look = (n: number): Step => () => answer([{ type: 'tool_use', id: `toolu_${n}`, name: 'ui_tree', input: { app: 'capped' } }], 'tool_use');
            // Each recorded answer costs $0.008 at Opus prices, so the second crosses $0.01
            model.steps = [look(1), look(2), look(3), look(4)];
            const { all: events } = await opened(capped.origin, id, dan, (event) => event.type === 'done');
            await postTurn(capped.origin, id, dan, 'Look around');
            const seen = await events;
            expect(model.requests).toHaveLength(2);
            expect(seen.at(-1)).toMatchObject({ type: 'done', outcome: 'limit', message: expect.stringMatching(/budget for this month/) });
        } finally {
            await capped.stop();
        }
    });

    it('should refuse an empty or oversized request', async () => {
        expect((await postTurn(magnetic.origin, appId, alice, '   ')).status).toBe(400);
        expect((await postTurn(magnetic.origin, appId, alice, 'x'.repeat(4001))).status).toBe(400);
    });
});
