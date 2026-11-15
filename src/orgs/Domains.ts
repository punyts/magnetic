import { randomBytes } from 'node:crypto';
import { resolveTxt } from 'node:dns/promises';
import { isUniqueViolation } from '@punyts/stateui-pg';
import type { Database } from '@punyts/stateui-pg';
import { audit, OrgError } from './Orgs.js';
import type { Orgs } from './Orgs.js';

/** Looks up the TXT records of a name, as `dns.promises.resolveTxt` does; replaced in tests */
export type TxtResolver = (name: string) => Promise<string[][]>;

/** One email domain of an org, and how its owner proves it */
export interface OrgDomain {
    readonly domain: string;
    /** The DNS name the TXT record goes at */
    readonly recordName: string;
    /** What the TXT record must say */
    readonly recordValue: string;
    readonly verifiedAt?: string;
}

const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
/** The label under the domain where the TXT record goes, so it sits apart from the domain's own records */
export const RECORD_LABEL = '_magnetic-challenge';

/** The domain of an email address, lower case; `undefined` when it has none */
export function domainOf(email: string | undefined): string | undefined {
    const at = email?.lastIndexOf('@') ?? -1;
    if (email === undefined || at < 0) return undefined;
    const domain = email.slice(at + 1).trim().toLowerCase();
    return DOMAIN.test(domain) ? domain : undefined;
}

/**
 * The email domains orgs claim (`org_domain`). An owner adds a domain and gets a TXT record to publish; verifying looks
 * the record up in DNS. A domain belongs to one org, and only a verified one routes sign-in to the org's provider or
 * lets people join by it. Every change is written to the audit log
 */
export class OrgDomains {
    constructor(
        private readonly db: Database,
        private readonly orgs: Orgs,
        private readonly resolve: TxtResolver = resolveTxt
    ) {}

    /** An org's domains; for its admins and owners */
    async list(actorId: string, orgId: string): Promise<OrgDomain[]> {
        await this.orgs.require(orgId, actorId, 'admin');
        const rows = (await this.db.query<{ domain: string; txt_token: string; verified_at: Date | null }>('SELECT domain, txt_token, verified_at FROM org_domain WHERE org_id = $1 ORDER BY domain', [orgId])).rows;
        return rows.map((row) => ({ domain: row.domain, recordName: `${RECORD_LABEL}.${row.domain}`, recordValue: `magnetic-verification=${row.txt_token}`, ...(row.verified_at !== null && { verifiedAt: row.verified_at.toISOString() }) }));
    }

    /** Claims a domain for the org, unverified; owners */
    async add(actorId: string, orgId: string, typed: string): Promise<OrgDomain> {
        const domain = typed.trim().toLowerCase().replace(/^@/, '');
        if (!DOMAIN.test(domain) || domain.length > 253) throw new OrgError(400, 'That is not a domain, such as example.com.');
        await this.orgs.require(orgId, actorId, 'owner');
        const token = randomBytes(18).toString('base64url');
        try {
            await this.db.transaction(async (tx) => {
                await tx.query('INSERT INTO org_domain (org_id, domain, txt_token) VALUES ($1, $2, $3)', [orgId, domain, token]);
                await audit(tx, { orgId, actorId, action: 'domain.added', targetKind: 'domain', targetId: domain });
            });
        } catch (error) {
            if (isUniqueViolation(error)) throw new OrgError(409, 'This domain is already claimed.');
            throw error;
        }
        return { domain, recordName: `${RECORD_LABEL}.${domain}`, recordValue: `magnetic-verification=${token}` };
    }

    /** Looks the domain's TXT record up, and marks the domain verified when it says what it must; owners */
    async verify(actorId: string, orgId: string, domain: string): Promise<boolean> {
        await this.orgs.require(orgId, actorId, 'owner');
        const row = (await this.db.query<{ txt_token: string; verified_at: Date | null }>('SELECT txt_token, verified_at FROM org_domain WHERE org_id = $1 AND domain = $2', [orgId, domain])).rows[0];
        if (row === undefined) throw new OrgError(404, 'The org has not claimed this domain.');
        if (row.verified_at !== null) return true;
        let records: string[][] = [];
        try {
            records = await this.resolve(`${RECORD_LABEL}.${domain}`);
        } catch {
            records = [];
        }
        const found = records.some((parts) => parts.join('').trim() === `magnetic-verification=${row.txt_token}`);
        if (!found) return false;
        await this.db.transaction(async (tx) => {
            await tx.query('UPDATE org_domain SET verified_at = now() WHERE org_id = $1 AND domain = $2', [orgId, domain]);
            await audit(tx, { orgId, actorId, action: 'domain.verified', targetKind: 'domain', targetId: domain });
        });
        return true;
    }

    /** Gives a domain up; owners */
    async remove(actorId: string, orgId: string, domain: string): Promise<void> {
        await this.orgs.require(orgId, actorId, 'owner');
        await this.db.transaction(async (tx) => {
            const gone = (await tx.query('DELETE FROM org_domain WHERE org_id = $1 AND domain = $2', [orgId, domain])).rowCount ?? 0;
            if (gone === 0) throw new OrgError(404, 'The org has not claimed this domain.');
            await audit(tx, { orgId, actorId, action: 'domain.removed', targetKind: 'domain', targetId: domain });
        });
    }

    /** The org that has verified the domain of an email, if any */
    async orgOfEmail(email: string | undefined): Promise<string | undefined> {
        const domain = domainOf(email);
        if (domain === undefined) return undefined;
        return (await this.db.query<{ org_id: string }>('SELECT org_id FROM org_domain WHERE domain = $1 AND verified_at IS NOT NULL', [domain])).rows[0]?.org_id;
    }
}
