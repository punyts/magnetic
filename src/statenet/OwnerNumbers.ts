import type { OwnerNames } from '@punyts/stateui-mcp';
import type { Queryable } from '@punyts/stateui-pg';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMBER = /^[0-9]+$/;
/** How an org is named as the subject it reads as: `org:` and its id, or its number */
const ORG = 'org:';

interface OwnerRow {
    number: string;
    kind: 'user' | 'org' | 'system';
    id: string;
    workspace_id: string | null;
}

/**
 * The numbers owners go by in the statenet (docs/design/statenet-network.md, "`$` is the owner"): a person's and an
 * org's, from one sequence (`statenet_owner`). In an address, in a grant and beside a signing key an owner is its
 * number; the ids stay what Magnetic's own tables and pages use, so this is where the two meet.
 *
 * A person's own workspace has the person's id and goes by the person's number; an org's workspace goes by the org's.
 * A number stands for the workspace that is the owner's tree. Anything that is not an id (a named test person) goes
 * by itself.
 *
 * `of` and `idOf` answer at once, from what is known here; an id that was never looked up is an error, never passed
 * off as its own name, so nothing is ever addressed half by id and half by number. An id that was looked up and is
 * nobody's goes by itself. `ensure` and `learn` read
 * what is missing: the server calls them wherever an owner first comes up (a session's person, a workspace opened, a
 * namespace taken over by its address)
 */
export class OwnerNumbers implements OwnerNames {
    private readonly numbers = new Map<string, string>();
    private readonly trees = new Map<string, string>();
    private readonly orgs = new Map<string, string>();
    /** Ids that were looked up and are no owner's: a workspace made by hand in a test, an account since deleted */
    private readonly none = new Set<string>();

    constructor(private readonly db: Queryable) {}

    /** Reads every owner there is */
    async load(): Promise<void> {
        this.take((await this.db.query<OwnerRow>('SELECT number::text AS number, kind, id::text AS id, workspace_id::text AS workspace_id FROM statenet_owner')).rows);
    }

    /** Reads the owners of these ids (a person's, a workspace's, an org's) that are not known yet */
    async ensure(...ids: readonly string[]): Promise<void> {
        const missing = [...new Set(ids.map((id) => id.toLowerCase()))].filter((id) => UUID.test(id) && !this.numbers.has(id));
        for (const id of missing) this.none.delete(id);
        if (missing.length === 0) return;
        this.take((await this.db.query<OwnerRow>('SELECT number::text AS number, kind, id::text AS id, workspace_id::text AS workspace_id FROM statenet_owner WHERE id::text = ANY($1::text[]) OR workspace_id::text = ANY($1::text[])', [missing])).rows);
        for (const id of missing) if (!this.numbers.has(id)) this.none.add(id);
    }

    /** Reads the owner a number stands for, when it is not known yet */
    async learn(name: string): Promise<void> {
        if (!NUMBER.test(name) || this.trees.has(name)) return;
        this.take((await this.db.query<OwnerRow>('SELECT number::text AS number, kind, id::text AS id, workspace_id::text AS workspace_id FROM statenet_owner WHERE number = $1::bigint', [name])).rows);
    }

    of(id: string): string {
        const known = this.numbers.get(id.toLowerCase());
        if (known !== undefined) return known;
        if (UUID.test(id) && !this.none.has(id.toLowerCase())) throw new Error(`No owner number is known here for ${id}`);
        return id;
    }

    idOf(owner: string): string | undefined {
        return NUMBER.test(owner) ? this.trees.get(owner) : owner;
    }

    /** The name of an id, read first when it is not known: a person or a workspace by its number, an org's subject (`org:<id>`) as `org:<number>`; anything else as it is */
    async nameOf(id: string): Promise<string> {
        const org = id.startsWith(ORG);
        const bare = org ? id.slice(ORG.length) : id;
        if (!UUID.test(bare)) return id;
        await this.ensure(bare);
        const number = this.numbers.get(bare.toLowerCase());
        return number === undefined ? id : `${org ? ORG : ''}${number}`;
    }

    /** The id a name stands for, read first when it is not known: a workspace's for a number, `org:<id>` for an org's subject; anything else as it is */
    async idOfName(name: string): Promise<string> {
        const org = name.startsWith(ORG);
        const bare = org ? name.slice(ORG.length) : name;
        if (!NUMBER.test(bare)) return name;
        await this.learn(bare);
        return (org ? (this.orgs.get(bare) === undefined ? undefined : `${ORG}${this.orgs.get(bare)}`) : this.trees.get(bare)) ?? name;
    }

    /** An address with its owner by number, whichever way it was written */
    async address(address: string): Promise<string> {
        const [owner, ...rest] = address.split('/');
        return owner === undefined ? address : [await this.nameOf(owner), ...rest].join('/');
    }

    /** An address with its owner by id: for a page, which knows people and workspaces by their ids */
    async addressById(address: string): Promise<string> {
        const [owner, ...rest] = address.split('/');
        return owner === undefined ? address : [await this.idOfName(owner), ...rest].join('/');
    }

    private take(rows: readonly OwnerRow[]): void {
        for (const row of rows) {
            const tree = row.workspace_id ?? row.id;
            this.numbers.set(row.id, row.number);
            this.numbers.set(tree, row.number);
            this.trees.set(row.number, tree);
            if (row.kind === 'org') this.orgs.set(row.number, row.id);
        }
    }
}
