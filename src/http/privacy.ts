import { escapeHtml as e } from '@punyts/stateui-mcp';
import { htmlOpen } from './pages.js';

/** Who runs a hosted Magnetic, for its privacy page */
export interface PrivacyContact {
    /** The person or company that runs the server */
    readonly operator: string;
    /** Where privacy requests go */
    readonly email: string;
}

/**
 * `GET /privacy`: what Magnetic keeps about a person, why, who else sees it, and how to have it deleted. Plain words,
 * readable without signing in, since a sign-in provider such as LinkedIn links to it
 */
export function privacyPage(contact: PrivacyContact): string {
    const mail = `<a href="mailto:${e(contact.email)}">${e(contact.email)}</a>`;
    return [
        '<!doctype html>',
        htmlOpen({ language: 'en', mode: 'system' }),
        '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Privacy - Magnetic</title><link rel="stylesheet" href="/assets/magnetic.css"></head>',
        '<body><main>',
        '<header><h1 class="brand"><img class="mark" src="/assets/logo.svg" alt="">Privacy</h1><a href="/">Magnetic</a></header>',
        `<p>Magnetic is run by ${e(contact.operator)}. This page says what it keeps about you, why, and who else sees it. Questions or requests: ${mail}.</p>`,
        '<h2>What we keep</h2>',
        '<ul>',
        '<li><strong>From your sign-in provider</strong> (such as LinkedIn): your name, your email address, your profile picture, and an id the provider gives you for this service. Nothing else from your profile, and we never post for you.</li>',
        '<li><strong>What you make</strong>: your apps, the data in them, the files you upload, your chats with the assistant, and the settings you choose.</li>',
        '<li><strong>What keeps the service working</strong>: a sign-in cookie, the apps and data you share and who you share them with, what the assistant costs you, and server logs of requests and errors.</li>',
        '<li><strong>What you send us</strong>: the bugs, comments and feature requests you send from the editor, with the app, the frame size and your browser; and the amounts and dates of what you pay for agent use (your card stays with the payment provider).</li>',
        '</ul>',
        '<h2>Why</h2>',
        '<p>Only to run Magnetic for you: to sign you in, keep your work, share it as you ask, keep the assistant within its spending limits, and find and fix problems. No advertising, no tracking cookies, and nothing is sold.</p>',
        '<h2>Who else sees it</h2>',
        '<ul>',
        '<li><strong>The people you share with</strong> see what you share with them, as you set it.</li>',
        '<li><strong>Anthropic</strong> receives what you ask the assistant, with the parts of your app it needs to answer, to produce its reply.</li>',
        '<li><strong>Stripe</strong>, the payment provider, handles what you pay for agent use, under its own privacy policy.</li>',
        '<li><strong>The hosting provider</strong> stores the service\'s data and logs on our behalf.</li>',
        '<li>Anyone else only if the law requires it.</li>',
        '</ul>',
        '<h2>How long</h2>',
        '<p>Your account and work stay until you delete them or ask us to. Backups of the database are kept for up to 7 days and server logs for up to 30, so a deletion leaves them within that time.</p>',
        '<h2>Your choices</h2>',
        `<p>You can delete your apps at any time. To get a copy of what we keep about you, correct it, or delete your account and everything in it, write to ${mail}. You can also remove this service's access in your sign-in provider's settings.</p>`,
        '<p class="muted">Last changed 15 November 2026.</p>',
        '</main></body></html>'
    ].join('\n');
}
