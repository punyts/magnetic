import type { Database } from '@punyts/stateui-pg';
import { domainOf } from './Domains.js';
import type { OrgDomains } from './Domains.js';
import { audit } from './Orgs.js';
import type { OrgPolicies } from './Policies.js';
import type { ScimDirectory } from './Scim.js';

/** Said to someone at an org's domain who tries to sign in another way while the org requires its own provider */
export const SSO_REQUIRED = 'Your organisation signs you in through its own account. Use "Sign in with your work email".';

/**
 * What an org's policies say about signing in: `requireSso` lets people at the org's verified domains in only through
 * its own provider, and `autoJoin` adds people at those domains (with a verified email) or signed in through the
 * provider to the org as members. While an org takes its people by SCIM, a sign-in links the person it pushed with
 * that verified email instead, and `autoJoin` joins nobody else (docs/design/magnetic-scim.md). Every sign-in of an
 * org's member is written to that org's audit log
 */
export class SignInRules {
    constructor(
        private readonly db: Database,
        private readonly domains: OrgDomains,
        private readonly policies: OrgPolicies,
        private readonly scim: ScimDirectory
    ) {}

    /** Why a sign-in may not go on, or `undefined`: refused when the email's org requires its own provider and this is not it */
    async refusal(email: string | undefined, viaOrgId?: string): Promise<string | undefined> {
        const orgId = await this.domains.orgOfEmail(email);
        if (orgId === undefined || orgId === viaOrgId) return undefined;
        return (await this.policies.get(orgId)).requireSso ? SSO_REQUIRED : undefined;
    }

    /** Whether an email given by an org's own provider counts as verified: only at a domain that org has verified */
    async vouches(orgId: string, email: string | undefined): Promise<boolean> {
        return email !== undefined && (await this.domains.orgOfEmail(email)) === orgId;
    }

    /**
     * After a sign-in: joins the person to the org of their verified email's domain, or of the provider they came
     * through, when that org allows it; then writes the sign-in to the audit log of each org they are in
     */
    async signedIn(user: { readonly id: string; readonly email?: string; readonly emailVerified: boolean }, via: { readonly provider: string; readonly orgId?: string; readonly ip?: string }): Promise<void> {
        const candidates = new Set<string>();
        if (via.orgId !== undefined) candidates.add(via.orgId);
        if (user.emailVerified) {
            const orgId = await this.domains.orgOfEmail(user.email);
            if (orgId !== undefined) candidates.add(orgId);
        }
        if (user.emailVerified && user.email !== undefined) await this.scim.signedIn(user.id, user.email);
        for (const orgId of candidates) {
            if (!(await this.policies.get(orgId)).autoJoin) continue;
            // An org that takes its people by SCIM joins only those it pushed
            if ((await this.db.query('SELECT 1 FROM org_scim WHERE org_id = $1', [orgId])).rows.length > 0) continue;
            await this.db.transaction(async (tx) => {
                const joined = (await tx.query("INSERT INTO org_member (org_id, user_id, role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING", [orgId, user.id])).rowCount ?? 0;
                if (joined > 0) await audit(tx, { orgId, actorId: user.id, action: 'member.auto_joined', targetKind: 'user', targetId: user.id, detail: { domain: domainOf(user.email) ?? null, provider: via.provider } });
            });
        }
        const orgs = (await this.db.query<{ org_id: string }>('SELECT org_id FROM org_member WHERE user_id = $1', [user.id])).rows;
        for (const { org_id: orgId } of orgs) {
            await audit(this.db, { orgId, actorId: user.id, action: 'user.signed_in', targetKind: 'user', targetId: user.id, detail: { provider: via.provider }, ...(via.ip !== undefined && { ip: via.ip }) });
        }
    }
}
