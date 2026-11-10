import type { AgentModel, ModelListener, ModelMessage, ModelRequest } from '../agent/AgentModel.js';

const USAGE = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };

function message(content: unknown[], stopReason: string): ModelMessage {
    return { id: `msg_mock_${Date.now()}`, type: 'message', role: 'assistant', model: 'mock-agent', content, stop_reason: stopReason, stop_sequence: null, usage: USAGE } as unknown as ModelMessage;
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal.aborted) {
            reject(new Error('aborted'));
            return;
        }
        const timer = setTimeout(resolve, ms);
        signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('aborted'));
        }, { once: true });
    });
}

/** Says a few words a piece at a time */
async function say(text: string, listener: ModelListener, signal: AbortSignal): Promise<void> {
    for (const word of text.split(/(?<= )/)) {
        listener.text(word);
        await wait(40, signal);
    }
}

/**
 * A stand-in for the Claude API on a development server, so the editor can be tried without an API key and at no
 * cost. Each turn reads the app with `ui_tree`, then adds the person's request as a text on the app's first screen,
 * pausing between steps so the activity drawer can be watched. Costs nothing, so budgets are not spent
 */
export class MockAgentModel implements AgentModel {
    constructor(private readonly pauseMs = 700) {}

    async request(params: ModelRequest, listener: ModelListener, signal: AbortSignal): Promise<ModelMessage> {
        const opening = String(params.messages[0]?.content ?? '');
        const app = /The app being built is "([^"]+)"/.exec(opening)?.[1] ?? '';
        const request = /<request>\n([\s\S]*)\n<\/request>/.exec(opening)?.[1] ?? '';
        const last = params.messages.at(-1);
        const results = Array.isArray(last?.content) ? (last.content as { type: string; content?: { type: string; text?: string }[] }[]).filter((block) => block.type === 'tool_result') : [];
        const step = (params.messages.length - 1) / 2;
        await wait(this.pauseMs, signal);
        listener.note('Reading the app before changing it');

        if (step === 0) {
            await say('I am the mock agent: I will add your words to the first screen. ', listener, signal);
            return message([{ type: 'tool_use', id: `toolu_mock_tree_${Date.now()}`, name: 'ui_tree', input: { app } }], 'tool_use');
        }
        if (step === 1) {
            const tree = JSON.parse(results[0]?.content?.[0]?.text ?? '{}') as { revision?: number; screens?: string[] };
            const screen = tree.screens?.[0];
            if (screen === undefined || tree.revision === undefined) {
                await say('I could not read this app.', listener, signal);
                return message([{ type: 'text', text: 'I could not read this app.' }], 'end_turn');
            }
            return message(
                [
                    {
                        type: 'tool_use',
                        id: `toolu_mock_write_${Date.now()}`,
                        name: 'ui_nodes_write',
                        input: { app, screen, expectedRevision: tree.revision, operations: [{ op: 'add', path: 'root', key: `note${Date.now().toString(36)}`, value: { component: 'text', _text: request.slice(0, 200) } }] }
                    }
                ],
                'tool_use'
            );
        }
        const ok = results.length > 0 && !(results[0]?.content?.[0]?.text ?? '').includes('"error"');
        const text = ok ? 'Done: your words are on the first screen.' : 'The change did not go through.';
        await say(text, listener, signal);
        return message([{ type: 'text', text }], 'end_turn');
    }
}
