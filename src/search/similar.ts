import type { AppProcedure, UiPartRepository, UiToolDefinition } from '@punyts/stateui-mcp';
import type { RecordSimilarity, SimilarRequest } from '@punyts/stateui-pg';

/** The name logic `call`s to find records by meaning */
export const SIMILAR_PROCEDURE = 'similar';

type Parts = Pick<UiPartRepository, 'findById' | 'findByName'>;

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

/** A `similar` request from a call's payload or a tool's arguments, or why it is not one */
export function similarRequestOf(value: unknown): SimilarRequest | string {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'similar takes { binding, field, text, limit? }';
    const { binding, field, text, limit } = value as Record<string, unknown>;
    if (typeof binding !== 'string' || binding === '') return 'similar needs "binding": a data binding of the app';
    if (typeof field !== 'string' || field === '') return 'similar needs "field": a string field its model marks embed: true';
    if (typeof text !== 'string' || text.trim() === '') return 'similar needs "text": what to compare the records with';
    if (limit !== undefined && (typeof limit !== 'number' || !Number.isFinite(limit))) return '"limit" is a number';
    return { binding, field, text: text.slice(0, 2000), ...(typeof limit === 'number' && { limit }) };
}

/**
 * The `similar` server procedure of one workspace: Full-mode logic calls it with `{ binding, field, text, limit? }` and
 * gets `{ results: [{ key, score }] }` for the records of the app's binding, a person binding's for the person whose
 * instance calls (the workspace's owner when the call comes from no instance)
 */
export function similarProcedure(similarity: RecordSimilarity, workspaceId: string, parts: () => Parts): AppProcedure {
    return async (payload, context) => {
        const request = similarRequestOf(payload);
        if (typeof request === 'string') return { status: 'rejected', reason: request };
        const answer = await similarity.similar({ workspaceId, parts: parts(), appId: context.appId, person: context.person ?? workspaceId }, request);
        return answer.kind === 'found' ? { status: 'accepted', value: { results: answer.results.map((found) => ({ key: found.key, score: found.score })) } } : { status: 'rejected', reason: answer.reason };
    };
}

/** The agent's `data_similar`: the same search, for an app it names, as the person it works for */
export function similarTool(similarity: RecordSimilarity, userId: string, workspaceId: string, parts: Parts): UiToolDefinition {
    return {
        name: 'data_similar',
        description:
            "Find the records of an app's data binding whose field is closest in meaning to a text, best first: the keys with a score from 0 to 1. The field must be a string field its model marks embed: true (ui_model_write). Over a person binding, only the records of the person you work for. Read the records themselves with ui_data_query or ui_state_get.",
        inputSchema: {
            type: 'object',
            properties: {
                app: { type: 'string', description: 'The app name (ui_list kind "apps")' },
                binding: { type: 'string', description: 'A data binding of the app, its name under uses.data' },
                field: { type: 'string', description: 'A string field of the binding\'s model marked embed: true' },
                text: { type: 'string', description: 'What to compare the records with, in plain words' },
                limit: { type: 'number', description: 'At most this many, 10 by default, at most 50' }
            },
            required: ['app', 'binding', 'field', 'text']
        } as never,
        annotations: READ_ONLY,
        run: async (args) => {
            const request = similarRequestOf(args);
            if (typeof request === 'string') return { isError: true, body: { error: 'invalid-argument', message: request } };
            const app = typeof args['app'] === 'string' ? await parts.findByName('apps', args['app']) : undefined;
            if (app === undefined) return { isError: true, body: { error: 'not-found', message: `No app named "${String(args['app'] ?? '')}"; ui_list lists the apps` } };
            // The person's own instance: in their own workspace, the workspace's owner is them
            const answer = await similarity.similar({ workspaceId, parts, appId: app.id, person: userId }, request);
            if (answer.kind === 'refused') return { isError: true, body: { error: 'refused', message: answer.reason } };
            return { isError: false, body: { results: answer.results } };
        }
    };
}
