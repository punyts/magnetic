import Anthropic from '@anthropic-ai/sdk';
import type { BetaMessage, BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages/messages';

export type ModelRequest = BetaMessageStreamParams;
export type ModelMessage = BetaMessage;

/** What the model says while a request streams */
export interface ModelListener {
    /** A piece of the visible answer */
    text(delta: string): void;
    /** A progress note between tool calls (`thinking.display: "updates"`) */
    note(delta: string): void;
}

/**
 * One request to the model, streamed. The port the agent loop talks to, so tests can play recorded answers instead
 * of calling the API
 */
export interface AgentModel {
    request(params: ModelRequest, listener: ModelListener, signal: AbortSignal): Promise<ModelMessage>;
}

/**
 * The Claude API, through the official SDK. Credentials come from the environment (`ANTHROPIC_API_KEY` and the rest);
 * the client is made at the first request, so a server without them starts and only its agent turns fail
 */
export class ClaudeModel implements AgentModel {
    private client: Anthropic | undefined;

    constructor(private readonly given?: Anthropic) {}

    async request(params: ModelRequest, listener: ModelListener, signal: AbortSignal): Promise<ModelMessage> {
        this.client ??= this.given ?? new Anthropic();
        const stream = this.client.beta.messages.stream(params, { signal });
        stream.on('text', (delta) => listener.text(delta));
        stream.on('thinking', (delta) => listener.note(delta));
        return stream.finalMessage();
    }
}
