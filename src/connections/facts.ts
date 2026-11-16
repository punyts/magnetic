import type { Connections, Endpoint } from './Connections.js';
import { templateNames } from './Connections.js';
import { HTTP_EFFECT } from './httpEffect.js';

/** The params an endpoint takes: the `{names}` of its path, query and body */
export function paramsOf(endpoint: Endpoint): string[] {
    return [...new Set([...templateNames(endpoint.path), ...Object.values(endpoint.query ?? {}).flatMap(templateNames), ...templateNames(JSON.stringify(endpoint.body ?? ''))])];
}

/**
 * What the agent is told of a workspace's connections with each request, so it can write effects that call them:
 * each connection's name and host, and each endpoint's name, method, params and where its records are. Never a
 * secret, a key or a token; undefined when the workspace has none
 */
export async function connectionFacts(connections: Connections, workspaceId: string): Promise<string | undefined> {
    const list = await connections.list(workspaceId);
    if (list.length === 0) return undefined;
    const lines = list.map((connection) => {
        const host = new URL(connection.baseUrl).host;
        const endpoints = connection.endpoints.map((endpoint) => {
            const params = paramsOf(endpoint);
            return `  - ${endpoint.name}: ${endpoint.method} ${endpoint.path}${params.length > 0 ? `, params ${params.join(', ')}` : ''}${endpoint.records !== undefined ? `; answers records (at ${endpoint.records})` : '; answers a value'}`;
        });
        return [`- ${connection.name} (${host})${endpoints.length === 0 ? ': no endpoints yet' : ''}`, ...endpoints].join('\n');
    });
    return [
        '<context name="connections">',
        `The outside APIs this app's workspace has. An app calls one with a logic effect run by "${HTTP_EFFECT}": logic.effects.<name> = { request: "<state path>", run: "${HTTP_EFFECT}", status: "<state path>", and records: { into, key } (or window) for an endpoint that answers records, or value: "<state path>" for one that answers a value }. Writing { connection, endpoint, params } at the request path makes the call; status shows loading, ready or error with its reason. Only these connections and endpoints exist: new ones are made by the person on the Connections page, never by you.`,
        ...lines,
        '</context>'
    ].join('\n');
}
