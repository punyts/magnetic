import Anthropic from '@anthropic-ai/sdk';
import type { ToolOutcome, UiToolDefinition } from '@punyts/stateui-mcp';
import type { AgentModel, ModelMessage, ModelRequest } from './AgentModel.js';
import { costOf } from './Budgets.js';
import type { Budgets } from './Budgets.js';
import type { ChatEntry, Chats, ToolLine, TurnOutcome } from './Chats.js';

/** The facts a person can add to a turn with the toggles above the chat box */
export const CONTEXT_TOGGLES = ['theme', 'layout', 'data', 'logic', 'screens'] as const;
export type ContextToggle = (typeof CONTEXT_TOGGLES)[number];

/** What the shell is told while a turn runs, over its event stream */
export type AgentEvent =
    | { readonly type: 'state'; readonly running: boolean; readonly history: readonly ChatEntry[] }
    | { readonly type: 'person'; readonly text: string; readonly at: string }
    | { readonly type: 'say'; readonly delta: string }
    | { readonly type: 'note'; readonly delta: string }
    | { readonly type: 'tool'; readonly id: string; readonly name: string; readonly summary: string }
    | { readonly type: 'toolDone'; readonly id: string; readonly ok: boolean; readonly result: string }
    | { readonly type: 'done'; readonly outcome: TurnOutcome; readonly message?: string; readonly cost: number };

export interface TurnLimits {
    /** Tool calls in one turn */
    readonly toolCalls: number;
    /** Wall-clock time of one turn */
    readonly ms: number;
    /** `max_tokens` of each request */
    readonly maxTokens: number;
}

export const DEFAULT_TURN_LIMITS: TurnLimits = { toolCalls: 40, ms: 5 * 60_000, maxTokens: 32_000 };

/** What a turn works with: the tools of the user's workspace, the system prompt, and a hold on the workspace released when the turn ends */
export interface TurnWorkspace {
    readonly tools: readonly UiToolDefinition[];
    /** The same for every turn, so it is cached */
    readonly system: string;
    release(): void;
}

export interface AgentTurnsOptions {
    readonly model: AgentModel;
    /** The model id of a turn that names none, such as `claude-haiku-5-5` */
    readonly modelName: string;
    /** The model ids a turn may name; default only `modelName` */
    readonly models?: readonly string[];
    readonly effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
    readonly workspace: (userId: string) => Promise<TurnWorkspace>;
    readonly budgets: Budgets;
    readonly chats: Chats;
    readonly limits?: TurnLimits;
    readonly report: { info(message: string, details?: Record<string, unknown>): void };
}

/** Tools the agent does not get: the headless browser cannot reach a signed-in page yet, and no logic waits for an agent */
export const WITHHELD_TOOLS: ReadonlySet<string> = new Set(['ui_preview', 'ui_screenshot', 'ui_interact', 'ui_call_answer', 'ui_effect_answer']);

/** The models that take the server-side `fallbacks: "default"` on the Claude API */
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);
const BETAS_FALLBACK = 'server-side-fallback-2026-07-01';
const BETAS_UPDATES = 'thinking-display-updates-2026-08-18';

/** The most characters of a tool result sent back to the model */
const MAX_RESULT_CHARS = 60_000;
/** The earlier exchanges of the chat given to each turn, as text */
const RECALL = 6;

interface Running {
    readonly appId: string;
    readonly abort: AbortController;
}

const key = (userId: string, appId: string): string => `${userId}:${appId}`;
const clip = (text: string, size: number): string => (text.length <= size ? text : `${text.slice(0, size)}…`);

/** The note added to the last message when a tool input was not JSON, before the request is sent again */
export const SMALLER_INPUTS_NOTE = 'Your last tool call was not valid JSON, so it was not run. Write it again with shallower inputs: set the root with empty children, then each section as its own set operation at "root.children.<key>".';

/**
 * A tool input the model streamed that is not JSON: the SDK rejects the stream with a SyntaxError, or with its own
 * error naming the tool parameter JSON. Never an API error
 */
export function isBadToolJson(error: unknown): boolean {
    if (error instanceof Anthropic.APIError || !(error instanceof Error)) return false;
    return error instanceof SyntaxError || /tool parameter JSON/i.test(error.message);
}

/** No usable API key: an authentication error from the API, or the SDK finding no key. The message is not searched further, as it may quote the model's text */
export function isMissingKey(error: unknown): boolean {
    if (error instanceof Anthropic.AuthenticationError) return true;
    return !(error instanceof Anthropic.APIError) && error instanceof Error && !isBadToolJson(error) && error.message.startsWith('Could not resolve authentication method');
}

/** Adds the note asking for smaller inputs to the last message, once */
function askForSmallerInputs(messages: Anthropic.Beta.Messages.BetaMessageParam[]): void {
    const last = messages[messages.length - 1];
    if (last === undefined || last.role !== 'user') return;
    const content = typeof last.content === 'string' ? [{ type: 'text' as const, text: last.content }] : [...last.content];
    if (content.some((block) => block.type === 'text' && block.text === SMALLER_INPUTS_NOTE)) return;
    content.push({ type: 'text', text: SMALLER_INPUTS_NOTE });
    messages[messages.length - 1] = { role: 'user', content };
}

/** A one-line description of a tool call, from the arguments that say what it touches */
export function describeCall(input: unknown): string {
    if (typeof input !== 'object' || input === null) return '';
    const args = input as Record<string, unknown>;
    const parts: string[] = [];
    for (const name of ['app', 'kind', 'name', 'screen', 'path', 'topic', 'query', 'group']) {
        const value = args[name];
        if (typeof value === 'string' && value !== '') parts.push(`${name} ${clip(value, 60)}`);
    }
    for (const [name, value] of Object.entries(args)) if (Array.isArray(value)) parts.push(`${value.length} ${name}`);
    return parts.join(', ');
}

/** A one-line description of a tool's outcome */
export function describeOutcome(outcome: ToolOutcome): string {
    const body = outcome.body as Record<string, unknown>;
    if (outcome.isError) return clip(typeof body['message'] === 'string' ? body['message'] : String(body['error'] ?? 'failed'), 200);
    const parts: string[] = [];
    if (typeof body['revision'] === 'number') parts.push(`revision ${body['revision']}`);
    if (typeof body['count'] === 'number') parts.push(`${body['count']} items`);
    if (Array.isArray(body['warnings']) && body['warnings'].length > 0) parts.push(`${body['warnings'].length} warnings`);
    if (outcome.images !== undefined && outcome.images.length > 0) parts.push(`${outcome.images.length} images`);
    return parts.length > 0 ? parts.join(', ') : 'done';
}

/** A tool outcome as the content of a `tool_result` block */
function resultContent(outcome: ToolOutcome): Anthropic.Beta.Messages.BetaToolResultBlockParam['content'] {
    const text = clip(JSON.stringify(outcome.body), MAX_RESULT_CHARS);
    return [{ type: 'text', text }, ...(outcome.images ?? []).map((image) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: image.mimeType, data: image.data } }))];
}

async function runTool(tool: UiToolDefinition | undefined, name: string, input: unknown): Promise<ToolOutcome> {
    if (tool === undefined) return { isError: true, body: { error: 'unknown-tool', message: `There is no tool ${name}` } };
    try {
        return await tool.run((typeof input === 'object' && input !== null ? input : {}) as Readonly<Record<string, unknown>>);
    } catch (error) {
        return { isError: true, body: { error: 'internal-error', message: error instanceof Error ? error.message : String(error) } };
    }
}

/**
 * The agent's turns: one at a time per user. A turn reads the facts the person asked for, then runs the model over the
 * user's own StateUI tools until it answers, is stopped, or reaches a limit. Each request is charged to the user's
 * budget. Everything the agent says and does is sent to the app's listeners as it happens and kept in the app's chat
 */
export class AgentTurns {
    private readonly running = new Map<string, Running>();
    private readonly finishing = new Set<Promise<void>>();
    private readonly listeners = new Map<string, Set<(event: AgentEvent) => void>>();
    private readonly limits: TurnLimits;

    constructor(private readonly options: AgentTurnsOptions) {
        this.limits = options.limits ?? DEFAULT_TURN_LIMITS;
    }

    /** Listens to an app's turns; the listener is first sent the chat so far. Returns the function that stops it */
    async subscribe(userId: string, appId: string, listener: (event: AgentEvent) => void): Promise<() => void> {
        const set = this.listeners.get(key(userId, appId)) ?? new Set();
        set.add(listener);
        this.listeners.set(key(userId, appId), set);
        listener({ type: 'state', running: this.running.get(userId)?.appId === appId, history: await this.options.chats.read(userId, appId) });
        return () => {
            set.delete(listener);
            if (set.size === 0) this.listeners.delete(key(userId, appId));
        };
    }

    private emit(userId: string, appId: string, event: AgentEvent): void {
        for (const listener of this.listeners.get(key(userId, appId)) ?? []) listener(event);
    }

    /** Stops every running turn and waits until each has ended, for a server that stops */
    async stopAll(): Promise<void> {
        for (const running of this.running.values()) running.abort.abort();
        await Promise.all([...this.finishing]);
    }

    isRunning(userId: string): boolean {
        return this.running.has(userId);
    }

    /** Stops the user's running turn, if any */
    stop(userId: string): boolean {
        const running = this.running.get(userId);
        running?.abort.abort();
        return running !== undefined;
    }

    /**
     * Starts a turn on an app. Refused, with a reason for the person, when a turn of the user is already running or
     * the budget is spent. The turn runs on; its end is the `done` event. `finished` resolves when it has ended
     */
    async start(userId: string, app: { readonly id: string; readonly name: string }, text: string, toggles: readonly ContextToggle[], model: string = this.options.modelName): Promise<{ refused: string } | { finished: Promise<void> }> {
        if (!this.models.includes(model)) return { refused: 'That model is not offered on this server.' };
        if (this.running.has(userId)) return { refused: 'The agent is still working on your last request.' };
        const refusal = await this.options.budgets.check(userId);
        if (refusal !== undefined) return { refused: refusal };
        const abort = new AbortController();
        this.running.set(userId, { appId: app.id, abort });
        let workspace: TurnWorkspace;
        try {
            workspace = await this.options.workspace(userId);
        } catch (error) {
            this.running.delete(userId);
            throw error;
        }
        const finished = this.run(userId, workspace, app, text, toggles, model, abort.signal)
            .catch((error: unknown) => this.options.report.info('Agent turn could not be recorded', { userId, appId: app.id, error: error instanceof Error ? error.message : String(error) }))
            .finally(() => {
                workspace.release();
                this.running.delete(userId);
            });
        this.finishing.add(finished);
        void finished.then(() => this.finishing.delete(finished));
        return { finished };
    }

    /** The model ids a turn may name, the default first */
    get models(): readonly string[] {
        const { modelName, models = [] } = this.options;
        return [modelName, ...models.filter((model) => model !== modelName)];
    }

    private async run(userId: string, workspace: TurnWorkspace, app: { readonly id: string; readonly name: string }, text: string, toggles: readonly ContextToggle[], model: string, signal: AbortSignal): Promise<void> {
        const { chats, budgets, report } = this.options;
        // Stopped by the person or by the deadline; wired before the first await, so a stop that comes early is not lost
        const turnAbort = new AbortController();
        const stopTurn = (): void => turnAbort.abort();
        if (signal.aborted) stopTurn();
        else signal.addEventListener('abort', stopTurn, { once: true });
        let outcome: TurnOutcome = 'finished';
        let message: string | undefined;
        const deadline = Date.now() + this.limits.ms;
        const timer = setTimeout(() => {
            outcome = 'limit';
            message = 'The turn took too long and was stopped.';
            stopTurn();
        }, this.limits.ms);
        const at = new Date().toISOString();
        const history = await chats.read(userId, app.id);
        await chats.append(userId, app.id, { role: 'person', text, at });
        this.emit(userId, app.id, { type: 'person', text, at });

        const tools = workspace.tools.filter((tool) => !WITHHELD_TOOLS.has(tool.name));
        const byName = new Map(tools.map((tool) => [tool.name, tool]));
        const lines: ToolLine[] = [];
        const said: string[] = [];
        let cost = 0;

        try {
            const facts = await this.facts(byName, app.name, toggles);
            const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [{ role: 'user', content: this.firstMessage(history, app.name, facts, text) }];
            let toolCalls = 0;
            let jsonRetries = 0;
            for (;;) {
                if (turnAbort.signal.aborted) break;
                let response: ModelMessage;
                let spoken = '';
                try {
                    response = await this.options.model.request(
                        this.request(model, workspace.system, tools, messages),
                        {
                            text: (delta) => {
                                spoken += delta;
                                this.emit(userId, app.id, { type: 'say', delta });
                            },
                            note: (delta) => this.emit(userId, app.id, { type: 'note', delta })
                        },
                        turnAbort.signal
                    );
                    jsonRetries = 0;
                } catch (error) {
                    if (turnAbort.signal.aborted) break;
                    // With eager input streaming a tool input that is not JSON rejects the stream; that alone is retried,
                    // with a note asking for smaller inputs, as a large node tree is where a model breaks its JSON
                    if (isBadToolJson(error) && jsonRetries++ < 2) {
                        askForSmallerInputs(messages);
                        continue;
                    }
                    throw error;
                }
                const spent = costOf(response.model, response.usage);
                cost += spent;
                await budgets.charge(userId, spent);
                if (spoken !== '') said.push(spoken);
                // A spent budget ends the turn at once, so a hard limit is passed by one request at most
                const spentOut = await budgets.check(userId);
                if (spentOut !== undefined) {
                    outcome = 'limit';
                    message = spentOut;
                    break;
                }

                if (response.stop_reason === 'refusal') {
                    outcome = 'refused';
                    message = 'The model declined this request.';
                    break;
                }
                if (response.stop_reason === 'pause_turn') {
                    messages.push({ role: 'assistant', content: response.content });
                    continue;
                }
                const uses = response.content.filter((block): block is Anthropic.Beta.Messages.BetaToolUseBlock => block.type === 'tool_use');
                if (uses.length === 0) break;
                if (response.stop_reason === 'max_tokens') {
                    outcome = 'failed';
                    message = 'The answer was cut off before a tool call was complete.';
                    break;
                }
                messages.push({ role: 'assistant', content: response.content });
                const results: Anthropic.Beta.Messages.BetaToolResultBlockParam[] = [];
                for (const use of uses) {
                    if (toolCalls >= this.limits.toolCalls || Date.now() > deadline || turnAbort.signal.aborted) {
                        results.push({ type: 'tool_result', tool_use_id: use.id, is_error: true, content: 'Not run: the turn has reached its limit.' });
                        continue;
                    }
                    toolCalls++;
                    const summary = describeCall(use.input);
                    this.emit(userId, app.id, { type: 'tool', id: use.id, name: use.name, summary });
                    const result = await runTool(byName.get(use.name), use.name, use.input);
                    const line: ToolLine = { name: use.name, summary, ok: !result.isError, result: describeOutcome(result) };
                    lines.push(line);
                    this.emit(userId, app.id, { type: 'toolDone', id: use.id, ok: line.ok, result: line.result });
                    results.push({ type: 'tool_result', tool_use_id: use.id, content: resultContent(result), ...(result.isError && { is_error: true }) });
                }
                messages.push({ role: 'user', content: results });
                if (toolCalls >= this.limits.toolCalls) {
                    outcome = 'limit';
                    message = `The turn reached its limit of ${this.limits.toolCalls} tool calls. Ask again to continue.`;
                    break;
                }
            }
            if (signal.aborted) {
                outcome = 'stopped';
                message = 'Stopped.';
            }
        } catch (error) {
            outcome = signal.aborted ? 'stopped' : outcome === 'limit' ? 'limit' : 'failed';
            if (outcome === 'failed') {
                message = isMissingKey(error) ? 'The agent is not set up on this server (no valid API key).' : error instanceof Anthropic.RateLimitError ? 'The agent is busy right now. Please try again in a minute.' : 'The agent ran into a problem and stopped.';
                report.info('Agent turn failed', { userId, appId: app.id, error: error instanceof Error ? error.message : String(error) });
            } else if (outcome === 'stopped') message = 'Stopped.';
        } finally {
            clearTimeout(timer);
            signal.removeEventListener('abort', stopTurn);
        }
        const entry: ChatEntry = { role: 'agent', text: said.join('\n\n'), at: new Date().toISOString(), tools: lines, outcome, ...(message !== undefined && { message }) };
        await chats.append(userId, app.id, entry);
        this.emit(userId, app.id, { type: 'done', outcome, ...(message !== undefined && { message }), cost });
        report.info('Agent turn', { userId, appId: app.id, model, outcome, toolCalls: lines.length, cost: Number(cost.toFixed(4)) });
    }

    /** One request of the loop: the cached system prompt and tools, then the turn's messages */
    private request(modelName: string, system: string, tools: readonly UiToolDefinition[], messages: Anthropic.Beta.Messages.BetaMessageParam[]): ModelRequest {
        const { effort } = this.options;
        const fallback = FALLBACK_MODELS.has(modelName);
        return {
            model: modelName,
            max_tokens: this.limits.maxTokens,
            betas: [BETAS_UPDATES, ...(fallback ? [BETAS_FALLBACK] : [])],
            ...(fallback && { fallbacks: 'default' as const }),
            thinking: { type: 'adaptive', display: 'updates' },
            output_config: { effort },
            system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
            tools: tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.inputSchema as unknown as Anthropic.Beta.Messages.BetaTool.InputSchema, eager_input_streaming: true })),
            cache_control: { type: 'ephemeral' },
            messages
        };
    }

    /** The turn's first message: the chat so far, the facts asked for, and the request */
    private firstMessage(history: readonly ChatEntry[], appName: string, facts: readonly string[], text: string): string {
        const recall = history
            .slice(-RECALL * 2)
            .map((entry) => (entry.role === 'person' ? `Person: ${clip(entry.text, 600)}` : `You: ${clip(entry.text === '' ? (entry.message ?? '(no reply)') : entry.text, 600)}`))
            .join('\n');
        return [
            `The app being built is "${appName}". Work on it unless the person names another of their apps.`,
            recall === '' ? '' : `<earlier_chat>\n${recall}\n</earlier_chat>`,
            ...facts,
            `<request>\n${text}\n</request>`
        ]
            .filter((part) => part !== '')
            .join('\n\n');
    }

    /** The facts of the toggles, each read with a read-only tool; a fact that cannot be read says so */
    private async facts(tools: ReadonlyMap<string, UiToolDefinition>, app: string, toggles: readonly ContextToggle[]): Promise<string[]> {
        const reads: Record<ContextToggle, () => Promise<unknown>> = {
            layout: async () => (await runTool(tools.get('ui_tree'), 'ui_tree', { app })).body,
            logic: async () => (await runTool(tools.get('ui_tree'), 'ui_tree', { app, logic: true, depth: 0 })).body,
            data: async () => (await runTool(tools.get('ui_state_get'), 'ui_state_get', { app, path: '$.data' })).body,
            screens: async () => (await runTool(tools.get('ui_list'), 'ui_list', { kind: 'screens', app })).body,
            theme: async () => {
                const uses = (await runTool(tools.get('ui_get'), 'ui_get', { kind: 'apps', name: app, path: 'uses' })).body as { value?: { theme?: unknown } };
                const theme = uses.value?.theme;
                if (typeof theme !== 'string') return { note: 'The app uses the default theme.' };
                return (await runTool(tools.get('ui_get'), 'ui_get', { kind: 'themes', name: theme })).body;
            }
        };
        const facts: string[] = [];
        for (const toggle of CONTEXT_TOGGLES) {
            if (!toggles.includes(toggle)) continue;
            let body: unknown;
            try {
                body = await reads[toggle]();
            } catch (error) {
                body = { error: error instanceof Error ? error.message : String(error) };
            }
            facts.push(`<context name="${toggle}">\n${clip(JSON.stringify(body), 20_000)}\n</context>`);
        }
        return facts;
    }
}
