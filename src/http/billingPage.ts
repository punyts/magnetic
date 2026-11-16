import { escapeHtml } from '@punyts/stateui-mcp';
import type { Credit } from '../billing/Credits.js';
import { billingTextsOf } from './billingText.js';
import type { BillingSaid, BillingTexts } from './billingText.js';
import { htmlOpen } from './pages.js';
import type { PageLook } from './pages.js';
import { fill } from './text.js';

/** What `GET /settings/billing` shows */
export interface BillingView {
    readonly look: PageLook;
    /** The one-time allowance; undefined when agent use has no limit per person */
    readonly allowance?: number;
    /** The person has no allowance because only the first `people` got one, of `allowance` dollars */
    readonly firstOnly?: { readonly allowance: number; readonly people: number };
    readonly bought: number;
    readonly spent: number;
    readonly credits: readonly Credit[];
    /** The amounts on offer; empty when this server takes no payments */
    readonly topUps: readonly number[];
    readonly notice?: BillingSaid;
    readonly error?: BillingSaid;
    /** A payment returned from and not yet confirmed: the page offers to check again */
    readonly pending?: string;
}

const e = (value: unknown): string => escapeHtml(String(value));

/** Dollars as the page shows them */
export const usd = (dollars: number): string => `$${(Math.round(dollars * 100) / 100).toFixed(2)}`;

const said = (t: BillingTexts, what: BillingSaid): string => fill(t[what.key], { ...what.values });

/** `GET /settings/billing`: what a person has of agent use, buttons to add more, and their payments */
export function billingPage(view: BillingView): string {
    const t = billingTextsOf(view.look.language);
    const left = view.allowance === undefined ? undefined : Math.max(0, view.allowance + view.bought - view.spent);
    const balance =
        view.allowance === undefined
            ? `<p class="muted">${e(t['billing.noLimit'])}</p>`
            : [
                  '<dl class="balance">',
                  `<div><dt>${e(t['billing.included'])}</dt><dd>${e(usd(view.allowance))}</dd></div>`,
                  `<div><dt>${e(t['billing.added'])}</dt><dd>${e(usd(view.bought))}</dd></div>`,
                  `<div><dt>${e(t['billing.used'])}</dt><dd>${e(usd(view.spent))}</dd></div>`,
                  `<div><dt>${e(t['billing.left'])}</dt><dd><strong>${e(usd(left ?? 0))}</strong></dd></div>`,
                  '</dl>'
              ].join('');
    const add =
        view.allowance === undefined
            ? ''
            : view.topUps.length === 0
              ? `<p class="notice" role="note">${e(t['billing.unavailable'])}</p>`
              : [
                    `<h2>${e(t['billing.add'])}</h2>`,
                    `<p class="muted">${e(t['billing.addHint'])}</p>`,
                    `<form method="post" action="/settings/billing" class="inline">${view.topUps.map((amount) => `<button class="primary" name="amount" value="${e(amount)}">${e(fill(t['billing.addOf'], { amount: usd(amount) }))}</button>`).join(' ')}</form>`
                ].join('\n');
    const history =
        view.credits.length === 0
            ? `<p class="muted">${e(t['billing.none'])}</p>`
            : [
                  `<div class="table"><table><thead><tr><th>${e(t['billing.column.date'])}</th><th>${e(t['billing.column.what'])}</th><th>${e(t['billing.column.amount'])}</th></tr></thead><tbody>`,
                  view.credits
                      .map((credit) => `<tr><td>${e(credit.at.toISOString().slice(0, 10))}</td><td>${e(credit.kind === 'payment' ? t['billing.payment'] : t['billing.refund'])}</td><td>${e(credit.dollars < 0 ? `−${usd(-credit.dollars)}` : usd(credit.dollars))}</td></tr>`)
                      .join(''),
                  '</tbody></table></div>'
              ].join('');
    const body = [
        `<header><h1>${e(t['billing.title'])}</h1><nav><a class="button" href="/">${e(t['billing.back'])}</a></nav></header>`,
        `<p class="muted">${e(t['billing.intro'])}</p>`,
        view.notice === undefined ? '' : `<p class="notice" role="status">${e(said(t, view.notice))}${view.pending === undefined ? '' : ` <a href="/settings/billing?paid=${encodeURIComponent(view.pending)}">${e(t['billing.checkAgain'])}</a>`}</p>`,
        view.error === undefined ? '' : `<p class="error" role="alert">${e(said(t, view.error))}</p>`,
        view.firstOnly === undefined ? '' : `<p class="notice" role="note">${e(fill(t['billing.firstOnly'], { amount: usd(view.firstOnly.allowance), people: String(view.firstOnly.people) }))}</p>`,
        balance,
        add,
        `<h2>${e(t['billing.history'])}</h2>`,
        history
    ].join('\n');
    return [
        '<!doctype html>',
        htmlOpen(view.look),
        '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
        `<title>${e(t['billing.pageTitle'])}</title>`,
        '<link rel="stylesheet" href="/assets/magnetic.css"></head>',
        `<body><main class="settings">${body}</main></body></html>`
    ].join('\n');
}
