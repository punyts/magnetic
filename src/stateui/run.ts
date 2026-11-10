import type { UiToolDefinition } from '@punyts/stateui-mcp';

/** Runs one StateUI tool and returns its body, or throws with its message when it fails */
export async function run(tools: readonly UiToolDefinition[], name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const tool = tools.find((candidate) => candidate.name === name);
    if (tool === undefined) throw new Error(`No tool ${name}`);
    const outcome = await tool.run(args as never);
    const body = (outcome.body ?? {}) as Record<string, unknown>;
    if (outcome.isError) throw new Error(`${name}: ${typeof body['message'] === 'string' ? body['message'] : ''} ${JSON.stringify(body['errors'] ?? body)}`);
    return body;
}
