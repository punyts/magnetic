import type { Database } from '@punyts/stateui-pg';

/** The languages Magnetic speaks; the first is the fallback */
export const LANGUAGES = ['en', 'de', 'fr', 'es'] as const;
export type Language = (typeof LANGUAGES)[number];

/** Each language by its own name, as the language menu offers it */
export const LANGUAGE_NAMES: Record<Language, string> = { en: 'English', de: 'Deutsch', fr: 'Français', es: 'Español' };

/** Light, dark, or whatever the system is set to */
export const MODES = ['system', 'light', 'dark'] as const;
export type Mode = (typeof MODES)[number];

/** What a person chose for how Magnetic looks and speaks */
export interface Preferences {
    readonly mode: Mode;
    readonly language: Language;
}

export function isLanguage(value: unknown): value is Language {
    return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

export function isMode(value: unknown): value is Mode {
    return typeof value === 'string' && (MODES as readonly string[]).includes(value);
}

/** The first language of an `Accept-Language` header that Magnetic speaks, by its primary tag; English otherwise */
export function languageOf(acceptLanguage: string | undefined): Language {
    const ranked = (acceptLanguage ?? '')
        .split(',')
        .map((part, index) => {
            const [tag = '', ...params] = part.trim().split(';');
            const q = params.map((param) => /^\s*q=([0-9.]+)\s*$/.exec(param)?.[1]).find((value) => value !== undefined);
            return { primary: tag.trim().toLowerCase().split('-')[0] ?? '', q: q === undefined ? 1 : Number(q), index };
        })
        .filter((entry) => entry.primary !== '' && entry.q > 0)
        .sort((a, b) => b.q - a.q || a.index - b.index);
    return ranked.map((entry) => entry.primary).find(isLanguage) ?? 'en';
}

/**
 * Each person's preferences (`user_preference`). A person who never chose has the system's mode and the language
 * their browser asks for
 */
export class PreferenceStore {
    constructor(private readonly db: Database) {}

    async read(userId: string, acceptLanguage: string | undefined): Promise<Preferences> {
        const stored = (await this.db.query<{ prefs: { mode?: unknown; language?: unknown } }>('SELECT prefs FROM user_preference WHERE user_id = $1', [userId])).rows[0]?.prefs;
        return {
            mode: isMode(stored?.mode) ? stored.mode : 'system',
            language: isLanguage(stored?.language) ? stored.language : languageOf(acceptLanguage)
        };
    }

    /** Keeps the choices given over the stored ones, and answers what holds now */
    async write(userId: string, acceptLanguage: string | undefined, change: Partial<Preferences>): Promise<Preferences> {
        const now = { ...(await this.read(userId, acceptLanguage)), ...change };
        await this.db.query('INSERT INTO user_preference (user_id, prefs, updated_at) VALUES ($1, $2, now()) ON CONFLICT (user_id) DO UPDATE SET prefs = EXCLUDED.prefs, updated_at = now()', [userId, JSON.stringify(now)]);
        return now;
    }
}
