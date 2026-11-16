import { escapeHtml } from '@punyts/stateui-mcp';
import type { Language } from '../prefs/Preferences.js';
import { usd } from './billingPage.js';
import { htmlOpen } from './pages.js';
import type { PageLook } from './pages.js';
import { fill } from './text.js';

/** The words of the beta page, in each language Magnetic speaks; every language has every key (the type checks it) */
const EN = {
    'beta.pageTitle': 'The Magnetic beta',
    'beta.join': 'Join the Magnetic beta',
    'beta.joinText': '{left} of its {places} places are left.',
    'beta.joinTextOpen': 'Everyone who joins is welcome.',
    'beta.gets': 'Each place comes with {amount} of agent use, on us: ask the agent to build an app or change one.',
    'beta.joinButton': 'Join the beta',
    'beta.in': 'You are in the beta',
    'beta.inText': 'You have {amount} of agent use, on us. Make an app on Your apps and ask the agent to build it.',
    'beta.inTextNoAmount': 'Make an app on Your apps and ask the agent to build it.',
    'beta.run': 'You run the beta org. Your own agent use does not come from its places.',
    'beta.full': 'The beta is full',
    'beta.fullText': 'It has reached its {places} people. Try again after the beta test.',
    'beta.feedback': 'Tell us what you find with the bug button at the top of the editor.',
    'beta.apps': 'Your apps'
};
type BetaTexts = Record<keyof typeof EN, string>;

const DE: BetaTexts = {
    'beta.pageTitle': 'Die Magnetic-Beta',
    'beta.join': 'Bei der Magnetic-Beta mitmachen',
    'beta.joinText': '{left} ihrer {places} Plätze sind noch frei.',
    'beta.joinTextOpen': 'Alle, die mitmachen, sind willkommen.',
    'beta.gets': 'Jeder Platz bringt {amount} Agentennutzung, auf uns: Lass den Agenten eine App bauen oder ändern.',
    'beta.joinButton': 'Mitmachen',
    'beta.in': 'Du bist in der Beta',
    'beta.inText': 'Du hast {amount} Agentennutzung, auf uns. Lege unter Deine Apps eine App an und lass den Agenten sie bauen.',
    'beta.inTextNoAmount': 'Lege unter Deine Apps eine App an und lass den Agenten sie bauen.',
    'beta.run': 'Du betreust die Beta-Organisation. Deine eigene Agentennutzung kommt nicht aus ihren Plätzen.',
    'beta.full': 'Die Beta ist voll',
    'beta.fullText': 'Sie hat ihre {places} Personen erreicht. Versuche es nach dem Betatest wieder.',
    'beta.feedback': 'Sag uns, was dir auffällt, mit dem Käfer-Knopf oben im Editor.',
    'beta.apps': 'Deine Apps'
};
const FR: BetaTexts = {
    'beta.pageTitle': 'La bêta de Magnetic',
    'beta.join': 'Rejoindre la bêta de Magnetic',
    'beta.joinText': 'Il reste {left} de ses {places} places.',
    'beta.joinTextOpen': 'Toute personne qui la rejoint est la bienvenue.',
    'beta.gets': 'Chaque place donne {amount} d’utilisation de l’agent, offerts : demandez à l’agent de créer une app ou d’en modifier une.',
    'beta.joinButton': 'Rejoindre la bêta',
    'beta.in': 'Vous êtes dans la bêta',
    'beta.inText': 'Vous avez {amount} d’utilisation de l’agent, offerts. Créez une app dans Vos apps et demandez à l’agent de la construire.',
    'beta.inTextNoAmount': 'Créez une app dans Vos apps et demandez à l’agent de la construire.',
    'beta.run': 'Vous gérez l’organisation de la bêta. Votre propre utilisation de l’agent ne vient pas de ses places.',
    'beta.full': 'La bêta est complète',
    'beta.fullText': 'Elle a atteint ses {places} personnes. Réessayez après la bêta.',
    'beta.feedback': 'Dites-nous ce que vous trouvez avec le bouton insecte en haut de l’éditeur.',
    'beta.apps': 'Vos apps'
};
const ES: BetaTexts = {
    'beta.pageTitle': 'La beta de Magnetic',
    'beta.join': 'Únete a la beta de Magnetic',
    'beta.joinText': 'Quedan {left} de sus {places} plazas.',
    'beta.joinTextOpen': 'Todas las personas que se unan son bienvenidas.',
    'beta.gets': 'Cada plaza trae {amount} de uso del agente, por nuestra cuenta: pide al agente que cree una app o que cambie una.',
    'beta.joinButton': 'Unirme a la beta',
    'beta.in': 'Estás en la beta',
    'beta.inText': 'Tienes {amount} de uso del agente, por nuestra cuenta. Crea una app en Tus apps y pide al agente que la construya.',
    'beta.inTextNoAmount': 'Crea una app en Tus apps y pide al agente que la construya.',
    'beta.run': 'Llevas la organización de la beta. Tu propio uso del agente no sale de sus plazas.',
    'beta.full': 'La beta está completa',
    'beta.fullText': 'Ya tiene sus {places} personas. Vuelve a intentarlo después de la beta.',
    'beta.feedback': 'Cuéntanos lo que encuentres con el botón del insecto arriba en el editor.',
    'beta.apps': 'Tus apps'
};
const ALL: Record<Language, BetaTexts> = { en: EN, de: DE, fr: FR, es: ES };

/** What the beta link shows a signed-in person */
export type BetaView =
    | { readonly state: 'open'; readonly left?: number; readonly places?: number; readonly amount?: number; readonly action: string }
    | { readonly state: 'in'; readonly amount?: number }
    | { readonly state: 'runs' }
    | { readonly state: 'full'; readonly places: number };

const e = (value: unknown): string => escapeHtml(String(value));

/** `GET /beta/<code>`: join the beta, you are in it, or it is full */
export function betaPage(look: PageLook, view: BetaView): string {
    const t = ALL[look.language] ?? EN;
    const p = (text: string, muted = false): string => `<p${muted ? ' class="muted"' : ''}>${e(text)}</p>`;
    const apps = `<p><a class="button primary" href="/">${e(t['beta.apps'])}</a></p>`;
    const body =
        view.state === 'open'
            ? [
                  `<h1>${e(t['beta.join'])}</h1>`,
                  p(view.left !== undefined && view.places !== undefined ? fill(t['beta.joinText'], { left: String(view.left), places: String(view.places) }) : t['beta.joinTextOpen']),
                  view.amount === undefined ? '' : p(fill(t['beta.gets'], { amount: usd(view.amount) })),
                  `<form method="post" action="${e(view.action)}"><button class="primary">${e(t['beta.joinButton'])}</button></form>`
              ]
            : view.state === 'in'
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
