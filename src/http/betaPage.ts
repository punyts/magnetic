import { escapeHtml } from '@punyts/stateui-mcp';
import type { Language } from '../prefs/Preferences.js';
import { usd } from './billingPage.js';
import { htmlOpen } from './pages.js';
import type { PageLook } from './pages.js';
import { fill } from './text.js';

/** The words of the beta page, in each language Magnetic speaks; every language has every key (the type checks it) */
const EN = {
    'beta.pageTitle': 'The Magnetic beta',
    'beta.in': 'You are in the beta',
    'beta.inText': 'You have {amount} of agent use, on us. Make an app on Your apps and ask the agent to build it.',
    'beta.inTextNoAmount': 'Make an app on Your apps and ask the agent to build it.',
    'beta.run': 'You run the beta org. Your own agent use does not come from its places.',
    'beta.full': 'The beta is full',
    'beta.fullText': 'It has reached its {places} people. We’ll contact you when we run the next beta test.',
    'beta.feedback': 'Tell us what you find with the bug button at the top of the editor.',
    'beta.apps': 'Your apps'
};
type BetaTexts = Record<keyof typeof EN, string>;

const DE: BetaTexts = {
    'beta.pageTitle': 'Die Magnetic-Beta',
    'beta.in': 'Du bist in der Beta',
    'beta.inText': 'Du hast {amount} Agentennutzung, auf uns. Lege unter Deine Apps eine App an und lass den Agenten sie bauen.',
    'beta.inTextNoAmount': 'Lege unter Deine Apps eine App an und lass den Agenten sie bauen.',
    'beta.run': 'Du betreust die Beta-Organisation. Deine eigene Agentennutzung kommt nicht aus ihren Plätzen.',
    'beta.full': 'Die Beta ist voll',
    'beta.fullText': 'Sie hat ihre {places} Personen erreicht. Wir melden uns, wenn wir den nächsten Betatest starten.',
    'beta.feedback': 'Sag uns, was dir auffällt, mit dem Käfer-Knopf oben im Editor.',
    'beta.apps': 'Deine Apps'
};
const FR: BetaTexts = {
    'beta.pageTitle': 'La bêta de Magnetic',
    'beta.in': 'Vous êtes dans la bêta',
    'beta.inText': 'Vous avez {amount} d’utilisation de l’agent, offerts. Créez une app dans Vos apps et demandez à l’agent de la construire.',
    'beta.inTextNoAmount': 'Créez une app dans Vos apps et demandez à l’agent de la construire.',
    'beta.run': 'Vous gérez l’organisation de la bêta. Votre propre utilisation de l’agent ne vient pas de ses places.',
    'beta.full': 'La bêta est complète',
    'beta.fullText': 'Elle a atteint ses {places} personnes. Nous vous contacterons lors du prochain test bêta.',
    'beta.feedback': 'Dites-nous ce que vous trouvez avec le bouton insecte en haut de l’éditeur.',
    'beta.apps': 'Vos apps'
};
const ES: BetaTexts = {
    'beta.pageTitle': 'La beta de Magnetic',
    'beta.in': 'Estás en la beta',
    'beta.inText': 'Tienes {amount} de uso del agente, por nuestra cuenta. Crea una app en Tus apps y pide al agente que la construya.',
    'beta.inTextNoAmount': 'Crea una app en Tus apps y pide al agente que la construya.',
    'beta.run': 'Llevas la organización de la beta. Tu propio uso del agente no sale de sus plazas.',
    'beta.full': 'La beta está completa',
    'beta.fullText': 'Ya tiene sus {places} personas. Te avisaremos cuando hagamos la próxima prueba beta.',
    'beta.feedback': 'Cuéntanos lo que encuentres con el botón del insecto arriba en el editor.',
    'beta.apps': 'Tus apps'
};
const ALL: Record<Language, BetaTexts> = { en: EN, de: DE, fr: FR, es: ES };

/** What the beta link shows a signed-in person */
export type BetaView =
    | { readonly state: 'in'; readonly amount?: number }
    | { readonly state: 'runs' }
    | { readonly state: 'full'; readonly places: number };

const e = (value: unknown): string => escapeHtml(String(value));

/** `GET /beta/<code>`: you are in the beta, you run it, or it is full */
export function betaPage(look: PageLook, view: BetaView): string {
    const t = ALL[look.language] ?? EN;
    const p = (text: string, muted = false): string => `<p${muted ? ' class="muted"' : ''}>${e(text)}</p>`;
    const apps = `<p><a class="button primary" href="/">${e(t['beta.apps'])}</a></p>`;
    const body =
        view.state === 'in'
            ? [`<h1>${e(t['beta.in'])}</h1>`, p(view.amount === undefined || view.amount === 0 ? t['beta.inTextNoAmount'] : fill(t['beta.inText'], { amount: usd(view.amount) })), p(t['beta.feedback'], true), apps]
            : view.state === 'runs'
              ? [`<h1>${e(t['beta.in'])}</h1>`, p(t['beta.run']), apps]
              : [`<h1>${e(t['beta.full'])}</h1>`, p(fill(t['beta.fullText'], { places: String(view.places) })), apps];
    return [
        '<!doctype html>',
        htmlOpen(look),
        '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
        `<title>${e(t['beta.pageTitle'])} · Magnetic</title>`,
        '<link rel="stylesheet" href="/assets/magnetic.css"></head>',
        '<body><main class="settings beta">',
        ...body,
        '</main></body></html>'
    ].join('\n');
}
