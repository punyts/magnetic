import type { Services } from '@punyts/stateui-mcp';
import type { Database } from '@punyts/stateui-pg';
import type { StateGrants } from '../grants/StateGrants.js';
import { datasetOf } from '../grants/StateGrants.js';
import { principalsOf } from '../server/dataRoutes.js';

/** A dataset another owner shared with a workspace: who, what, and its fields as `name type` */
export interface SharedWithWorkspace {
    readonly owner: string;
    readonly ownerName: string;
    readonly dataset: string;
    readonly model?: string;
    readonly fields: readonly string[];
}

/** The datasets other owners shared with a workspace, once each, with their model's fields where the owner's workspace opens */
export async function sharedWithWorkspace(grants: StateGrants, db: Database, workspace: (workspaceId: string) => Promise<Services>, workspaceId: string): Promise<SharedWithWorkspace[]> {
    const shares = await grants.datasetsSharedWith(workspaceId);
    const seen = new Set<string>();
    const datasets = shares.flatMap((share) => {
        const data = datasetOf(share.address);
        if (data === undefined || seen.has(share.address)) return [];
        seen.add(share.address);
        return [data];
    });
    if (datasets.length === 0) return [];
    const owners = await principalsOf(
        db,
        datasets.map((data) => data.owner)
    );
    const found: SharedWithWorkspace[] = [];
    for (const { owner, dataset } of datasets) {
        let model: string | undefined;
        let fields: string[] = [];
        try {
            const services = await workspace(owner);
            const part = await services.parts.findByName('data', dataset);
            model = (part?.body as { model?: string } | undefined)?.model;
            const declared = model === undefined ? undefined : ((await services.parts.findByName('models', model))?.body as { fields?: Record<string, { type?: string }> } | undefined)?.fields;
            fields = Object.entries(declared ?? {}).map(([name, field]) => `${name} ${field.type ?? ''}`.trim());
        } catch {
            // The owner's workspace could not be opened: the dataset is named without its fields
        }
        found.push({ owner, ownerName: owners.get(owner)?.name ?? owner, dataset, ...(model !== undefined && { model }), fields });
    }
    return found;
}

/**
 * What the agent is told of the datasets other owners shared with a workspace, so an app can read one with
 * `uses.external`: each one's owner (name and id), name, model and fields. Undefined when none is shared
 */
export async function sharedDataFacts(grants: StateGrants, db: Database, workspace: (workspaceId: string) => Promise<Services>, workspaceId: string): Promise<string | undefined> {
    const datasets = await sharedWithWorkspace(grants, db, workspace, workspaceId);
    if (datasets.length === 0) return undefined;
    return [
        '<context name="shared-data">',
        "Datasets other owners shared with this app's workspace, read only. An app reads one with uses.external.<alias> = { owner, dataset }: its records show at $.external.<alias> as a record map, live, and the logic runs on their changes (rules on $.external.<alias>.{id}.<field>). The app can never write them; copy into the app's own data to change anything. Only these are shared: sharing is the owner's, on the Data page, never yours.",
        ...datasets.map(({ owner, ownerName, dataset, model, fields }) => {
            const shape = model === undefined ? '' : `: records of model ${model}${fields.length === 0 ? '' : ` (${fields.join(', ')})`}`;
            return `- ${dataset}, shared by ${ownerName}${shape}. Read it with uses.external.<alias> = { owner: "${owner}", dataset: "${dataset}" }`;
        }),
        '</context>'
    ].join('\n');
}
