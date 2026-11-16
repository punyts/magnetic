import { escapeHtml } from '@punyts/stateui-mcp';
import type { FeedbackFilter, FeedbackRow, Overview, PersonRow } from '../admin/Admin.js';
import { usd } from './billingPage.js';
import { htmlOpen } from './pages.js';
import type { PageLook } from './pages.js';

/** The allowance as the admin pages show it: who gets it */
export interface AllowanceInfo {
    /** Dollars once per person; undefined when agent use has no limit per person */
    readonly dollars?: number;
    /** Only the first this many people get it; undefined for everyone */
    readonly people?: number;
    /** The server's agent budget per UTC month */
    readonly monthly: number;
}

const e = (value: unknown): string => escapeHtml(String(value));
const day = (at: Date): string => at.toISOString().slice(0, 10);
const time = (at: Date): string => `${at.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
const KIND_WORDS = { bug: 'Bug', comment: 'Comment', feature: 'Feature request' } as const;

/** The admin pages' frame: a title, the sections, and what was just done or refused */
function adminPage(look: PageLook, title: string, at: 'overview' | 'feedback' | 'people', body: string, said?: { readonly notice?: string; readonly error?: string }): string {
    const link = (href: string, name: string, key: typeof at): string => `<a class="button"${key === at ? ' aria-current="page"' : ''} href="${href}">${e(name)}</a>`;
    return [
        '<!doctype html>',
        htmlOpen(look),
        '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
        `<title>${e(title)} · Magnetic admin</title>`,
        '<link rel="stylesheet" href="/assets/magnetic.css"></head>',
        '<body><main class="settings admin">',
        `<header><h1>${e(title)}</h1><nav aria-label="Admin">${link('/admin', 'Overview', 'overview')}${link('/admin/feedback', 'Feedback', 'feedback')}${link('/admin/people', 'People', 'people')}<a class="button" href="/">Your apps</a></nav></header>`,
        said?.notice === undefined ? '' : `<p class="notice" role="status">${e(said.notice)}</p>`,
        said?.error === undefined ? '' : `<p class="error" role="alert">${e(said.error)}</p>`,
        body,
        '</main></body></html>'
    ].join('\n');
}

const tile = (name: string, value: string, href?: string): string => `<div><dt>${e(name)}</dt><dd>${href === undefined ? e(value) : `<a href="${href}">${e(value)}</a>`}</dd></div>`;

/** `GET /admin`: the numbers that say how the service is going */
export function adminOverviewPage(look: PageLook, overview: Overview, allowance: AllowanceInfo): string {
    const given = allowance.dollars === undefined ? 'No limit per person' : `${usd(allowance.dollars)} once, ${allowance.people === undefined ? 'to everyone' : `to the first ${allowance.people} people`}`;
    const left = allowance.people === undefined ? undefined : Math.max(0, allowance.people - overview.people);
    return adminPage(
        look,
        'Admin',
        'overview',
        [
            '<dl class="balance">',
            tile('People', String(overview.people), '/admin/people'),
            tile('New this week', String(overview.peopleThisWeek)),
            tile('Open feedback', String(overview.openFeedback), '/admin/feedback'),
            tile('Agent use today', usd(overview.agentToday)),
            tile('Agent use this month', `${usd(overview.agentThisMonth)} of ${usd(allowance.monthly)}`),
            tile('Paid by people', usd(overview.paid)),
            tile('Given by admins', usd(overview.given)),
            '</dl>',
            `<p class="muted">Free agent use: ${e(given)}.${left === undefined ? '' : ` ${left === 0 ? 'No places are left' : `${left} ${left === 1 ? 'place is' : 'places are'} left`}.`} The month's budget counts only free use; what people paid for is not held to it.</p>`
        ].join('\n')
    );
}

/** `GET /admin/feedback`: what people sent from the editor, open first by default, with Done and Reopen */
export function adminFeedbackPage(look: PageLook, rows: readonly FeedbackRow[], filter: FeedbackFilter, said?: { readonly notice?: string; readonly error?: string }): string {
    const query = (change: Partial<Record<'status' | 'kind', string>>): string => {
        const params = new URLSearchParams({ status: filter.status ?? 'all', ...(filter.kind !== undefined && { kind: filter.kind }), ...change });
        if (params.get('kind') === '') params.delete('kind');
        return `/admin/feedback?${params.toString()}`;
    };
    const chip = (label: string, href: string, on: boolean): string => `<a class="chip"${on ? ' aria-current="true"' : ''} href="${e(href)}">${e(label)}</a>`;
    const filters = [
        '<div class="row" aria-label="Show">',
        chip('Open', query({ status: 'open' }), filter.status === 'open'),
        chip('Done', query({ status: 'done' }), filter.status === 'done'),
        chip('All', query({ status: 'all' }), filter.status === undefined),
        '<span class="muted">·</span>',
        chip('Every kind', query({ kind: '' }), filter.kind === undefined),
        ...(['bug', 'comment', 'feature'] as const).map((kind) => chip(`${KIND_WORDS[kind]}s`, query({ kind }), filter.kind === kind)),
        '</div>'
    ].join('');
    const back = query({});
    const items =
        rows.length === 0
            ? '<p class="muted">Nothing here.</p>'
            : `<ul class="list feedback">${rows
                  .map((row) => {
                      const where = [row.appName === null ? undefined : `in ${row.appName}`, row.context['size'], row.context['language']].filter((part) => part !== undefined && part !== '').join(' · ');
                      const mail = row.email === null ? '' : ` <a href="mailto:${e(row.email)}?subject=${e(encodeURIComponent(`Your ${KIND_WORDS[row.kind].toLowerCase()} on Magnetic`))}">${e(row.email)}</a>`;
                      return [
                          `<li class="${row.status}">`,
                          `<div class="row"><span class="chip">${e(KIND_WORDS[row.kind])}</span><strong>${e(row.userName)}</strong>${mail}<span class="muted">${e(time(row.at))}${where === '' ? '' : ` · ${e(where)}`}</span></div>`,
                          `<p class="said">${e(row.text)}</p>`,
                          row.userAgent === null ? '' : `<p class="muted small">${e(row.userAgent)}</p>`,
                          `<form method="post" action="/admin/feedback/${e(row.id)}" class="inline"><input type="hidden" name="back" value="${e(back)}">`,
                          row.status === 'open' ? '<button name="status" value="done">Done</button>' : `<span class="muted">Done ${e(row.handledAt === null ? '' : day(row.handledAt))}</span> <button class="link" name="status" value="open">Reopen</button>`,
                          '</form>',
                          '</li>'
                      ].join('');
                  })
                  .join('\n')}</ul>`;
    return adminPage(look, 'Feedback', 'feedback', [filters, items].join('\n'), said);
}

/** `GET /admin/people`: everyone in sign-in order, whether they got the allowance, what they used, and Give */
export function adminPeoplePage(look: PageLook, people: readonly PersonRow[], allowance: AllowanceInfo, said?: { readonly notice?: string; readonly error?: string }): string {
    const free = (row: PersonRow): number => (allowance.dollars === undefined ? 0 : allowance.people === undefined || row.place <= allowance.people ? allowance.dollars : 0);
    const rows = people
        .map((row) => {
            const left = allowance.dollars === undefined ? undefined : Math.max(0, free(row) + row.paid + row.given - row.spent);
            return [
                '<tr>',
                `<td>${row.place}</td>`,
                `<td><strong>${e(row.name)}</strong>${row.email === null ? '' : `<br><span class="muted">${e(row.email)}${row.emailVerified ? '' : ' (not verified)'}</span>`}</td>`,
                `<td>${e(day(row.createdAt))}</td>`,
                `<td>${e(usd(free(row)))}</td>`,
                `<td>${e(usd(row.paid))}</td>`,
                `<td>${e(usd(row.given))}</td>`,
                `<td>${e(usd(row.spent))}${row.lastAgentUse === null ? '' : `<br><span class="muted">${e(day(row.lastAgentUse))}</span>`}</td>`,
                `<td>${left === undefined ? '–' : e(usd(left))}</td>`,
                `<td><form method="post" action="/admin/people/${e(row.id)}/give" class="give"><input name="dollars" inputmode="decimal" size="4" placeholder="$" aria-label="Dollars to give ${e(row.name)}"><input name="note" placeholder="Why" aria-label="Why give ${e(row.name)} agent use"><button>Give</button></form></td>`,
                '</tr>'
            ].join('');
        })
        .join('\n');
    return adminPage(
        look,
        'People',
        'people',
        [
            `<p class="muted">In the order they first signed in, which is the order free agent use goes by. Giving adds agent use to what they have, as a payment would.</p>`,
            `<div class="table"><table><thead><tr><th>#</th><th>Person</th><th>Joined</th><th>Free</th><th>Paid</th><th>Given</th><th>Used</th><th>Left</th><th>Give agent use</th></tr></thead><tbody>${rows}</tbody></table></div>`
        ].join('\n'),
        said
    );
}

/** `GET /admin` for someone who is not an admin: as if there were no such page */
export const NOT_ADMIN = 'No such page.';
