import { randomUUID } from 'node:crypto';
import type { Database, Queryable } from '@punyts/stateui-pg';
import { BETA_ORG_NAME, betaTaken } from '../beta/Beta.js';
import { Orgs } from '../orgs/Orgs.js';
import { OrgPolicies } from '../orgs/Policies.js';

/**
 * The people of a beta on a development server (`--seed beta` or `--seed beta-full`), so each state of the beta can be
 * tried by signing in as someone in it: the admin who runs it, a person who has never signed in, people part way
 * through their allowance, out of it, given more and paying for more, and other testers holding the rest of the places.
 * See docs/design/magnetic-beta.md
 */
export type BetaScenario = 'beta' | 'beta-full';

/** A person to sign in as: a development user (`/signin/dev`) whose name and verified email the sign-in keeps */
export interface DevProfile {
    readonly name: string;
    readonly email?: string;
    /** What the sign-in button says after "Sign in as" */
    readonly label: string;
}

interface Persona extends DevProfile {
    readonly subject: string;
    readonly email: string;
    /** Days since they first signed in; undefined for someone who never has, made at their first sign-in */
    readonly daysAgo?: number;
    /** Holds a place in the beta, as a builder */
    readonly place?: boolean;
    /** Dollars of agent use spent, in requests */
    readonly spent?: number;
    /** Dollars the admin gave them, and why */
    readonly gift?: { readonly dollars: number; readonly note: string };
    /** Dollars they bought */
    readonly bought?: number;
    readonly feedback?: ReadonlyArray<{ readonly kind: 'bug' | 'comment' | 'feature'; readonly text: string; readonly done?: boolean }>;
}

/** The admin's verified email, which the server must list in its admins (`MAGNETIC_ADMIN_EMAILS`) */
export const BETA_ADMIN_EMAIL = 'avery@magnetic.test';

/** The places a beta scenario leaves open once seeded: a few for new people, or none when it is full */
const PLACES_LEFT: Readonly<Record<BetaScenario, number>> = { beta: 3, 'beta-full': 0 };

function personas(scenario: BetaScenario, allowance: number): Persona[] {
    const dollars = (value: number): string => `$${value.toFixed(2)}`;
    return [
        {
            subject: 'admin',
            name: 'Avery Admin',
            email: BETA_ADMIN_EMAIL,
            label: 'Avery, the admin who runs the beta',
            daysAgo: 14,
            spent: 3.4,
            gift: { dollars: 20, note: 'Trying the agent before the beta opens' }
        },
        {
            subject: 'newbie',
            name: 'Nell Newbie',
            email: 'nell@magnetic.test',
            label: scenario === 'beta' ? 'Nell, signing in for the first time' : 'Nell, signing in for the first time after the beta filled'
        },
        {
            subject: 'halfway',
            name: 'Hana Halfway',
            email: 'hana@magnetic.test',
            label: `Hana, ${dollars(allowance * 0.48)} of ${dollars(allowance)} used`,
            daysAgo: 9,
            place: true,
            spent: allowance * 0.48,
            feedback: [{ kind: 'feature', text: 'Could the agent show me a preview before it changes the theme?' }]
        },
        {
            subject: 'nearly-out',
            name: 'Nico Nearly',
            email: 'nico@magnetic.test',
            label: `Nico, ${dollars(allowance - 0.1)} of ${dollars(allowance)} used: one more turn`,
            daysAgo: 11,
            place: true,
            spent: allowance - 0.1
        },
        {
            subject: 'used-up',
            name: 'Uma Usedup',
            email: 'uma@magnetic.test',
            label: `Uma, all ${dollars(allowance)} used: editing by hand`,
            daysAgo: 12,
            place: true,
            spent: allowance + 0.07,
            feedback: [
                { kind: 'bug', text: 'The chat box went grey halfway through my app and I was not sure why.' },
                { kind: 'comment', text: 'Loving it so far. The live preview is great.', done: true }
            ]
        },
        {
            subject: 'gifted',
            name: 'Gia Gifted',
            email: 'gia@magnetic.test',
            label: `Gia, used ${dollars(allowance)} and given $3.00 more by the admin`,
            daysAgo: 13,
            place: true,
            spent: allowance + 1.1,
            gift: { dollars: 3, note: 'Reported the grey chat box bug' }
        },
        {
            subject: 'topped-up',
            name: 'Theo Topup',
            email: 'theo@magnetic.test',
            label: `Theo, used ${dollars(allowance)} and bought $10.00 more`,
            daysAgo: 10,
            place: true,
            spent: allowance + 3.25,
            bought: 10
        }
    ];
}

const FIRST = ['Ada', 'Ben', 'Cleo', 'Dev', 'Eli', 'Fay', 'Gus', 'Ida', 'Jo', 'Kai', 'Lena', 'Max', 'Noor', 'Omar', 'Pia', 'Quinn', 'Rae', 'Sam', 'Tess', 'Viv'];
const LAST = ['Okafor', 'Lindqvist', 'Moreau', 'Tanaka', 'Silva', 'Novak', 'Haddad', 'Kowalski', 'Mensah', 'Reyes'];
const MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'];

/** A repeatable sequence in [0, 1), so the testers are the same on every run */
function random(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 2 ** 32;
    };
}

/** What a tester has spent: a third nothing yet, most some, a few all of it */
function testerSpend(index: number, allowance: number, next: () => number): number {
    const kind = index % 10;
    if (kind < 3) return 0;
    if (kind < 7) return Math.round(next() * allowance * 0.6 * 100) / 100;
    if (kind < 9) return Math.round((allowance * 0.6 + next() * allowance * 0.38) * 100) / 100;
    return Math.round((allowance + next() * 0.3) * 100) / 100;
}

export interface SeededBeta {
    /** The development users to offer, in order, with their profiles */
    readonly devUsers: readonly string[];
    readonly profiles: Readonly<Record<string, DevProfile>>;
    /** The admin's email, to add to the server's admins */
    readonly adminEmail: string;
    /** What was made this run, for the log */
    readonly made: { readonly personas: number; readonly testers: number; readonly placesTaken: number; readonly places: number };
}

/**
 * Seeds the beta: the beta org and the company org with the admin as their owner (so the server invites no one), the personas with their spend, gifts, payments and feedback, and
 * testers holding places until only `PLACES_LEFT` are left. People already there are left as they are, so it runs on
 * every start; the testers' places are added or taken away to fit the scenario. `newbie` is never made: they sign in
 * fresh after a reset of the database (`npm run magnetic:reset`)
 */
export async function seedBeta(db: Database, options: { readonly scenario: BetaScenario; readonly slug: string; readonly places: number; readonly allowance: number; readonly budget?: number; readonly internal?: { readonly slug: string; readonly budget?: number }; readonly now?: Date }): Promise<SeededBeta> {
    const now = options.now ?? new Date();
    const list = personas(options.scenario, options.allowance);
    const day = 24 * 60 * 60 * 1000;
    let madePersonas = 0;
    const ids = new Map<string, string>();
    for (const persona of list) {
        if (persona.daysAgo === undefined) continue;
        const existing = await userOf(db, 'dev', persona.subject);
        if (existing !== undefined) {
            ids.set(persona.subject, existing);
            continue;
        }
        const id = await makeUser(db, 'dev', persona.subject, persona, new Date(now.getTime() - persona.daysAgo * day));
        ids.set(persona.subject, id);
        madePersonas++;
    }
    const adminId = ids.get('admin') as string;
    let org = (await db.query<{ id: string }>('SELECT id::text AS id FROM org WHERE slug = $1', [options.slug])).rows[0];
    if (org === undefined) {
        const made = await new Orgs(db).create(adminId, { name: BETA_ORG_NAME, slug: options.slug });
        await new OrgPolicies(db, () => [], async () => undefined).set(adminId, made.id, { personalWorkspaces: false, ...(options.budget !== undefined && { monthlyBudget: options.budget }) });
        await db.query('UPDATE org SET created_at = $2 WHERE id = $1', [made.id, new Date(now.getTime() - 13.5 * day)]);
        await db.query('UPDATE org_member SET joined_at = $3 WHERE org_id = $1 AND user_id = $2', [made.id, adminId, new Date(now.getTime() - 13.5 * day)]);
        org = { id: made.id };
    }
    const orgId = org.id;
    const internal = options.internal;
    if (internal !== undefined && (await db.query('SELECT 1 FROM org WHERE slug = $1', [internal.slug])).rows.length === 0) {
        const made = await new Orgs(db).create(adminId, { name: internal.slug, slug: internal.slug });
        await new OrgPolicies(db, () => [], async () => undefined).set(adminId, made.id, { personalWorkspaces: false, ...(internal.budget !== undefined && { monthlyBudget: internal.budget }) });
    }

    // The personas' places, spend and the rest, made once with them
    for (const [index, persona] of list.entries()) {
        const id = ids.get(persona.subject);
        if (id === undefined || persona.daysAgo === undefined) continue;
        if ((await db.query('SELECT 1 FROM agent_request WHERE user_id = $1 LIMIT 1', [id])).rows.length > 0) continue;
        const since = new Date(now.getTime() - persona.daysAgo * day);
        if (persona.place === true) await db.query("INSERT INTO org_member (org_id, user_id, role, joined_at) VALUES ($1, $2, 'builder', $3) ON CONFLICT DO NOTHING", [orgId, id, new Date(since.getTime() + 60_000)]);
        await spend(db, id, persona.spent ?? 0, since, now, random(index + 1));
        if (persona.gift !== undefined)
            await db.query("INSERT INTO agent_credit (id, user_id, kind, dollars, provider, provider_ref, note, given_by, at) VALUES ($1, $2, 'gift', $3, 'admin', $4, $5, $6, $7)", [
                randomUUID(),
                id,
                persona.gift.dollars,
                `gift:${randomUUID()}`,
                persona.gift.note,
                adminId,
                new Date(now.getTime() - 2 * day)
            ]);
        if (persona.bought !== undefined)
            await db.query("INSERT INTO agent_credit (id, user_id, kind, dollars, provider, provider_ref, payment_intent, at) VALUES ($1, $2, 'payment', $3, 'stripe', $4, $5, $6)", [
                randomUUID(),
                id,
                persona.bought,
                `cs_seed_${persona.subject}`,
                `pi_seed_${persona.subject}`,
                new Date(now.getTime() - 3 * day)
            ]);
        for (const [order, note] of (persona.feedback ?? []).entries())
            await db.query('INSERT INTO feedback (id, user_id, kind, text, context, user_agent, at, status, handled_by, handled_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)', [
                randomUUID(),
                id,
                note.kind,
                note.text,
                JSON.stringify({ frame: '1280x800', screen: 'home' }),
                'Mozilla/5.0 (seeded)',
                new Date(now.getTime() - (order + 1) * 0.7 * day),
                note.done === true ? 'done' : 'open',
                note.done === true ? adminId : null,
                note.done === true ? new Date(now.getTime() - 0.2 * day) : null
            ]);
    }

    // The testers: as many places as the scenario fills, in the order they joined
    const others = (await betaTaken(db, options.slug)) - (await testerPlaces(db, orgId));
    const wanted = Math.max(0, options.places - others - PLACES_LEFT[options.scenario]);
    let madeTesters = 0;
    for (let index = 0; index < wanted; index++) {
        const subject = `tester-${String(index + 1).padStart(3, '0')}`;
        if ((await userOf(db, 'seed', subject)) !== undefined) continue;
        const next = random(1000 + index);
        const first = FIRST[index % FIRST.length] as string;
        const last = LAST[Math.floor(index / FIRST.length) % LAST.length] as string;
        // Spread over the beta's 13 days, in order, so the earliest testers hold the earliest places
        const since = new Date(now.getTime() - (13 - (index / Math.max(1, wanted)) * 12.5) * day);
        const id = await makeUser(db, 'seed', subject, { name: `${first} ${last}`, email: `${first}.${last}.${index + 1}@example.com`.toLowerCase() }, since);
        await db.query("INSERT INTO org_member (org_id, user_id, role, joined_at) VALUES ($1, $2, 'builder', $3)", [orgId, id, new Date(since.getTime() + 60_000)]);
        await spend(db, id, testerSpend(index, options.allowance, next), since, now, next);
        if (index % 17 === 5) await db.query("INSERT INTO feedback (id, user_id, kind, text, at) VALUES ($1, $2, 'comment', $3, $4)", [randomUUID(), id, 'Built a reading list app in ten minutes. Nice!', new Date(since.getTime() + day)]);
        madeTesters++;
    }
    // Testers who joined before keep their places up to the wanted number; past it they leave (a reseed from full to open)
    await db.query(
        `INSERT INTO org_member (org_id, user_id, role, joined_at)
         SELECT $1, i.user_id, 'builder', u.created_at + interval '1 minute' FROM identity i JOIN app_user u ON u.id = i.user_id
          WHERE i.provider = 'seed' AND i.subject <= $2
         ON CONFLICT DO NOTHING`,
        [orgId, `tester-${String(wanted).padStart(3, '0')}`]
    );
    await db.query("DELETE FROM org_member m USING identity i WHERE m.org_id = $1 AND i.user_id = m.user_id AND i.provider = 'seed' AND i.subject > $2", [orgId, `tester-${String(wanted).padStart(3, '0')}`]);

    return {
        devUsers: list.map((persona) => persona.subject),
        profiles: Object.fromEntries(list.map((persona) => [persona.subject, { name: persona.name, email: persona.email, label: persona.label }])),
        adminEmail: BETA_ADMIN_EMAIL,
        made: { personas: madePersonas, testers: madeTesters, placesTaken: await betaTaken(db, options.slug), places: options.places }
    };
}

async function userOf(db: Queryable, provider: string, subject: string): Promise<string | undefined> {
    return (await db.query<{ user_id: string }>('SELECT user_id::text AS user_id FROM identity WHERE provider = $1 AND subject = $2', [provider, subject])).rows[0]?.user_id;
}

async function makeUser(db: Database, provider: string, subject: string, profile: { readonly name: string; readonly email: string }, createdAt: Date): Promise<string> {
    const id = randomUUID();
    await db.transaction(async (tx) => {
        await tx.query('INSERT INTO app_user (id, name, email, email_verified, created_at) VALUES ($1, $2, $3, true, $4)', [id, profile.name, profile.email, createdAt]);
        await tx.query('INSERT INTO identity (provider, subject, user_id, created_at) VALUES ($1, $2, $3, $4)', [provider, subject, id, createdAt]);
    });
    return id;
}

/** The testers holding places now */
async function testerPlaces(db: Queryable, orgId: string): Promise<number> {
    return (await db.query<{ count: number }>("SELECT count(*)::int AS count FROM org_member m JOIN identity i ON i.user_id = m.user_id WHERE m.org_id = $1 AND i.provider = 'seed'", [orgId])).rows[0]?.count ?? 0;
}

/** Spends `dollars` in requests of a few cents to half a dollar, between `since` and now */
async function spend(db: Queryable, userId: string, dollars: number, since: Date, now: Date, next: () => number): Promise<void> {
    let left = Math.round(dollars * 1_000_000) / 1_000_000;
    const span = now.getTime() - since.getTime();
    const rows: unknown[][] = [];
    while (left > 0.000001) {
        const cost = Math.min(left, Math.round((0.04 + next() * 0.4) * 1_000_000) / 1_000_000);
        left = Math.round((left - cost) * 1_000_000) / 1_000_000;
        const model = MODELS[Math.floor(next() * MODELS.length)] as string;
        rows.push([userId, model, Math.round(cost * 150_000), Math.round(cost * 30_000), cost, new Date(since.getTime() + next() * span)]);
    }
    for (const row of rows) await db.query('INSERT INTO agent_request (user_id, workspace_id, model, input_tokens, output_tokens, dollars, at) VALUES ($1, $1, $2, $3, $4, $5, $6)', row);
}
