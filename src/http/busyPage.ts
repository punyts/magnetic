import type { Language } from '../prefs/Preferences.js';
import { htmlOpen } from './pages.js';

const WORDS: Record<Language, { readonly title: string; readonly text: string; readonly again: string }> = {
    en: { title: 'One moment', text: 'Magnetic is starting up. This page will load again in a few seconds.', again: 'Try again' },
    de: { title: 'Einen Moment', text: 'Magnetic startet gerade. Diese Seite lädt in ein paar Sekunden neu.', again: 'Erneut versuchen' },
    fr: { title: 'Un instant', text: 'Magnetic démarre. Cette page se rechargera dans quelques secondes.', again: 'Réessayer' },
    es: { title: 'Un momento', text: 'Magnetic se está iniciando. Esta página se volverá a cargar en unos segundos.', again: 'Reintentar' }
};

/**
 * Whether an error is an app's instance being on another server for now, as just after the servers restart: the
 * request will work again in a few seconds
 */
export function isInstanceBusy(error: unknown): boolean {
    return error instanceof Error && /^The app's instance (is busy on|runs on) another server/.test(error.message);
}

/** A page that says to wait and loads itself again, for a page request that met a busy instance (status 503) */
export function busyPage(language: Language): string {
    const t = WORDS[language] ?? WORDS.en;
    return [
        '<!doctype html>',
        htmlOpen({ language, mode: 'system' }),
        '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
        '<meta http-equiv="refresh" content="3">',
        `<title>${t.title} · Magnetic</title>`,
        '<link rel="stylesheet" href="/assets/magnetic.css"></head>',
        `<body><main class="settings"><h1>${t.title}</h1><p>${t.text}</p><p><a class="button" href="">${t.again}</a></p></main></body></html>`
    ].join('\n');
}
