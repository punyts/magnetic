import type { Services } from '@punyts/stateui-mcp';
import type { Database } from '@punyts/stateui-pg';
import type { StateGrants } from '../grants/StateGrants.js';
import { datasetOf } from '../grants/StateGrants.js';
import { principalsOf } from '../server/dataRoutes.js';

/**
 * What the agent is told of the datasets other owners shared with a workspace, so an app can read one with
 * `uses.external`: each one's owner (name and id), name, model and fields. Undefined when none is shared
 */
export async function sharedDataFacts(grants: StateGrants, db: Database, workspace: (workspaceId: string) => Promise<Services>, workspaceId: string): Promise<string | undefined> {
    const shares = await grants.datasetsSharedWith(workspaceId);
    const seen = new Set<string>();
    const datasets = shares.flatMap((share) => {
        const data = datasetOf(share.address);
        if (data === undefined || seen.has(share.address)) return [];
        seen.add(share.address);
        return [data];
    });
    if (datasets.length === 0) return undefined;
    const owners = await principalsOf(
        db,
        datasets.map((data) => data.owner)
    );
    const lines: string[] = [];
    for (const { owner, dataset } of datasets) {
        let shape = '';
        try {
            const services = await workspace(owner);
            const part = await services.parts.findByName('data', dataset);
            const model = (part?.body as { model?: string } | undefined)?.model;
            const fields = model === undefined ? undefined : ((await services.parts.findByName('models', model))?.body as { fields?: Record<string, { type?: string }> } | undefined)?.fields;
            if (model !== undefined) shape = `: records of model ${model}${fields === undefined ? '' : ` (${Object.entries(fields).map(([name, field]) => `${name} ${field.type ?? ''}`.trim()).join(', ')})`}`;
        } catch {
            // The owner's workspace could not be opened: the dataset is named without its fields
        }
        lines.push(`- ${dataset}, shared by ${owners.get(owner)?.name ?? owner}${shape}. Read it with uses.external.<alias> = { owner: "${owner}", dataset: "${dataset}" }`);
    }
    return [
        '<context name="shared-data">',
        "Datasets other owners shared with this app's workspace, read only. An app reads one with uses.external.<alias> = { owner, dataset }: its records show at $.external.<alias> as a record map, live, and the logic runs on their changes (rules on $.external.<alias>.{id}.<field>). The app can never write them; copy into the app's own data to change anything. Only these are shared: sharing is the owner's, on the Data page, never yours.",
        ...lines,
        '</context>'
    ].join('\n');
}
