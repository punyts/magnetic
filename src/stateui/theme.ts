import type { UiToolDefinition } from '@punyts/stateui-mcp';
import { run } from './run.js';

/** The theme of Magnetic's own apps (the editor, the sign-in and link pages) */
export const MAGNETIC_THEME = 'magnetic';

/** The tokens Magnetic's pages had in CSS, light: ink, muted, line, paper, soft, accent, and the floating shadow */
const LIGHT: Record<string, string> = {
    'color.surface.base': '#ffffff',
    'color.surface.raised': '#ffffff',
    'color.surface.overlay': '#ffffff',
    'color.surface.sunken': '#f3f4f7',
    'color.text.base': '#1b1d22',
    'color.text.muted': '#5d6470',
    'color.border.base': '#d9dce2',
    'color.accent.base': '#3047d8',
    'color.accent.soft': '#e6e9fb',
    'color.accent.on': '#ffffff',
    'elevation.raised.shadow': '0 2px 6px rgba(20, 24, 40, 0.08), 0 8px 24px rgba(20, 24, 40, 0.1)'
};

/** And dark, as the pages had under `prefers-color-scheme: dark` */
const DARK: Record<string, string> = {
    'color.surface.base': '#15171c',
    'color.surface.raised': '#15171c',
    'color.surface.overlay': '#15171c',
    'color.surface.sunken': '#1e2128',
    'color.text.base': '#e8eaee',
    'color.text.muted': '#a2a8b3',
    'color.border.base': '#343842',
    'color.accent.base': '#8c9cff',
    'color.accent.soft': '#262b47',
    'color.accent.on': '#15171c',
    'elevation.raised.shadow': '0 2px 6px rgba(0, 0, 0, 0.35), 0 8px 24px rgba(0, 0, 0, 0.35)'
};

/** The corners and words the pages had: floating panels 0.75rem, controls 0.5rem, regular words and a bold name */
const SHAPE: Record<string, string> = {
    'radius.lg': '12px',
    'radius.md': '8px',
    'panel.radius': '{radius.lg}',
    // The old editor's words were in the regular weight, its buttons too; only the app's name was bold, at body size
    'text.label.weight': '{font.weight.regular}',
    'text.heading.size': '{font.size.3}',
    'text.heading.weight': '{font.weight.bold}'
};

/** Changes when the theme's tokens do, for the stamps of the apps that use it */
export const THEME_STAMP = JSON.stringify({ LIGHT, DARK, SHAPE });

/**
 * Makes or updates Magnetic's theme in a workspace with the agent's own tools: the `clean` preset with Magnetic's
 * colours, shadow and corners, and its dark overlay. Writing the same tokens again changes nothing
 */
export async function ensureMagneticTheme(tools: readonly UiToolDefinition[]): Promise<void> {
    let existing = await run(tools, 'ui_get', { kind: 'themes', name: MAGNETIC_THEME }).catch(() => undefined);
    if (existing === undefined) {
        await run(tools, 'ui_theme_create', { name: MAGNETIC_THEME, preset: 'clean' });
        existing = await run(tools, 'ui_get', { kind: 'themes', name: MAGNETIC_THEME });
    }
    const hasDark = JSON.stringify(existing['body'] ?? existing).includes('"dark"');
    const operations = [
        ...Object.entries({ ...LIGHT, ...SHAPE }).map(([path, value]) => ({ op: 'set', path, value })),
        ...(hasDark ? [] : [{ op: 'add-overlay', overlay: 'dark', kind: 'mode' }]),
        ...Object.entries(DARK).map(([path, value]) => ({ op: 'set', path, value, overlay: 'dark' }))
    ];
    const revision = existing['revision'];
    await run(tools, 'ui_theme_write', { theme: MAGNETIC_THEME, ...(typeof revision === 'number' && { expectedRevision: revision }), operations });
}
