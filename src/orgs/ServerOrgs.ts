import type { Mailer } from '../mail/Mailer.js';
import { MAGNETIC, MAGNETIC_NAME, OrgError } from './Orgs.js';
import type { Org, Orgs } from './Orgs.js';
import type { OrgPolicies } from './Policies.js';

/** One org the server keeps (docs/design/magnetic-orgs-and-invites.md) */
export interface ServerOrg {
    readonly slug: string;
    readonly name: string;
    /** The org's agent budget per UTC month, given when the server makes it */
    readonly monthlyBudget?: number;
    /** The org that holds Magnetic's own pages: their drafts are apps in its workspace (docs/design/magnetic-editable.md) */
    readonly pages?: true;
}

export interface ServerOrgsContext {
    readonly orgs: Orgs;
    readonly policies: OrgPolicies;
    /** Never given an address or a token */
    readonly report: (message: string, fields: Record<string, unknown>) => void;
}

/**
 * Makes each of the server's orgs that is not there yet, with no members, apps kept in the org and its budget; the
 * policies are the org's own after that. Answers each org, in the order given. Run under a lock when servers share
 * the database
 */
export async function ensureServerOrgs(context: ServerOrgsContext, wanted: readonly ServerOrg[]): Promise<Array<Org & { readonly pages?: true }>> {
    const made: Array<Org & { readonly pages?: true }> = [];
    for (const want of wanted) made.push({ ...(await ensure(context, want)), ...(want.pages === true && { pages: true as const }) });
    return made;
}

/**
 * Invites each admin address as an owner of each org where the address is not a member and has no open invite, and
 * emails the invite when there is a mailer; without one it waits on the admin's Your apps. Run under a lock when
 * servers share the database
 */
export async function inviteServerAdmins(
    context: ServerOrgsContext & { readonly mailer?: Mailer; readonly origin: string },
    orgs: readonly Org[],
    admins: readonly string[]
): Promise<void> {
    for (const org of orgs) {
        for (const email of admins) {
            if (!(await context.orgs.unasked(org.id, email))) continue;
            const invite = await context.orgs.invite(MAGNETIC, org.id, { email, role: 'owner' });
            context.report('Invited an admin to a server org', { org: org.slug });
            if (context.mailer === undefined) continue;
            try {
                await context.mailer.invite({ to: email, orgName: org.name, inviterName: MAGNETIC_NAME, role: 'an owner', link: `${context.origin}/invites/${invite.token}`, expiresAt: invite.expiresAt });
            } catch (error) {
                context.report('Invite email failed', { org: org.slug, error: error instanceof Error ? error.message : String(error) });
            }
        }
    }
}

async function ensure(context: ServerOrgsContext, want: ServerOrg): Promise<Org> {
    const found = await context.orgs.bySlug(want.slug);
    if (found !== undefined) return found;
    let org: Org;
    try {
        org = await context.orgs.create(undefined, { name: want.name, slug: want.slug });
    } catch (error) {
        // another server made it between the look and the make
        if (error instanceof OrgError && error.status === 409) return (await context.orgs.bySlug(want.slug)) as Org;
        throw error;
    }
    await context.policies.set(MAGNETIC, org.id, { personalWorkspaces: false, ...(want.monthlyBudget !== undefined && { monthlyBudget: want.monthlyBudget }) });
    context.report('Made a server org', { org: org.slug });
    return org;
}
