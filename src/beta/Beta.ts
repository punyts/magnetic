import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Database, Queryable } from '@punyts/stateui-pg';
import { audit } from '../orgs/Orgs.js';
import type { OrgRole } from '../orgs/Orgs.js';

/**
 * The beta (docs/design/magnetic-beta.md): one org, joined through one link, whose first members get the free agent
 * use. A place is held by a builder or member of the org, in the order they joined; its owners and admins run the
 * beta and hold none
 */
const PLACE_ROLES = "('builder', 'member')";

/** The person's place in the beta (1 for the first to join), or undefined when they hold none */
export async function betaPlaceOf(db: Queryable, slug: string, userId: string): Promise<number | undefined> {
    const row = (
        await db.query<{ place: number }>(
            `SELECT (SELECT count(*)::int FROM org_member other
                      WHERE other.org_id = me.org_id AND other.role IN ${PLACE_ROLES} AND (other.joined_at, other.user_id) <= (me.joined_at, me.user_id)) AS place
               FROM org_member me JOIN org o ON o.id = me.org_id
              WHERE o.slug = $1 AND me.user_id::text = $2 AND me.role IN ${PLACE_ROLES}`,
            [slug, userId]
        )
    ).rows[0];
    return row?.place;
}

/** How many places of the beta are taken */
export async function betaTaken(db: Queryable, slug: string): Promise<number> {
    return (await db.query<{ taken: number }>(`SELECT count(*)::int AS taken FROM org_member m JOIN org o ON o.id = m.org_id WHERE o.slug = $1 AND m.role IN ${PLACE_ROLES}`, [slug])).rows[0]?.taken ?? 0;
}

export interface BetaStatus {
    readonly slug: string;
    /** The beta org; undefined until the server makes it */
    readonly org?: { readonly id: string; readonly name: string };
    readonly taken: number;
    /** How many places there are; undefined for no limit */
    readonly places?: number;
}

/** What opening the beta link did: joined now, was already in the org, found it full, or found no beta org */
/** What opening the link did: `invited` takes no place, since an invite to the org waits for the person's verified email */
export type BetaJoin = 'joined' | 'member' | 'invited' | 'full' | 'closed';

export const BETA_ORG_NAME = 'Magnetic beta';

export class Beta {
    constructor(
        private readonly db: Database,
        /** The beta org's slug */
        readonly slug: string,
        /** How many places; undefined for no limit */
        readonly places: number | undefined,
        private readonly secretKey: string
    ) {}

    /** The code in the beta link, `/beta/<code>`: from the server's key, so it stays the same and cannot be guessed */
    get code(): string {
        return createHmac('sha256', this.secretKey).update(`magnetic beta link ${this.slug}`).digest('base64url').slice(0, 22);
    }

    isCode(code: string): boolean {
        const given = Buffer.from(code);
        const mine = Buffer.from(this.code);
        return given.length === mine.length && timingSafeEqual(given, mine);
    }

    async status(): Promise<BetaStatus> {
        const org = (await this.db.query<{ id: string; name: string }>('SELECT id::text AS id, name FROM org WHERE slug = $1', [this.slug])).rows[0];
        return { slug: this.slug, ...(org !== undefined && { org }), taken: org === undefined ? 0 : await betaTaken(this.db, this.slug), ...(this.places !== undefined && { places: this.places }) };
    }

    /** The person's role in the beta org, if they are in it */
    async roleOf(userId: string): Promise<OrgRole | undefined> {
        return (await this.db.query<{ role: OrgRole }>('SELECT m.role FROM org_member m JOIN org o ON o.id = m.org_id WHERE o.slug = $1 AND m.user_id::text = $2', [this.slug, userId])).rows[0]?.role;
    }

    /** Joins the person to the beta org as a builder while a place is left. Joins wait on the org's row, so two people can never take the last place */
    async join(userId: string): Promise<BetaJoin> {
        return await this.db.transaction(async (tx) => {
            const org = (await tx.query<{ id: string }>('SELECT id::text AS id FROM org WHERE slug = $1 FOR UPDATE', [this.slug])).rows[0];
            if (org === undefined) return 'closed';
            if ((await tx.query('SELECT 1 FROM org_member WHERE org_id = $1 AND user_id::text = $2', [org.id, userId])).rows.length > 0) return 'member';
            // Someone the org invited (its owners are) accepts the invite for their role, rather than taking a place as a builder
            const invited = await tx.query(
                `SELECT 1 FROM org_invite i JOIN app_user u ON lower(u.email) = i.email AND u.email_verified
                  WHERE i.org_id = $1 AND u.id::text = $2 AND i.accepted_at IS NULL AND i.declined_at IS NULL AND i.expires_at > now()`,
                [org.id, userId]
            );
            if (invited.rows.length > 0) return 'invited';
            const taken = await betaTaken(tx, this.slug);
            if (this.places !== undefined && taken >= this.places) return 'full';
            await tx.query("INSERT INTO org_member (org_id, user_id, role) VALUES ($1, $2, 'builder')", [org.id, userId]);
            await audit(tx, { orgId: org.id, actorId: userId, action: 'beta.joined', targetKind: 'user', targetId: userId, detail: { place: taken + 1 } });
            return 'joined';
        });
    }
}
