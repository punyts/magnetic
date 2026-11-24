/**
 * What a new app and a new screen start with in Magnetic: a screen that fills the app, laid out as a column of three
 * sections (a header row, a body column that takes the height left, and a footer row), each empty and ready for
 * components or more layouts to be dropped into it. The app node lays its screen out as a column, so the screen can
 * grow to the app's height.
 */

/** The app node's layout in a new app: a column, so its screen's `grow` fills the app */
export const STARTER_APP_LAYOUT = { type: 'column' } as const;

/** A section of the starter screen: an empty panel with a layout of its own */
function section(type: 'row' | 'column', grow: boolean): Record<string, unknown> {
    return {
        component: 'panel',
        layout: type === 'row' ? { type, gap: 'md', align: 'center' } : { type, gap: 'md' },
        ...(grow && { placement: { grow: 1 } }),
        children: {}
    };
}

/**
 * The root of a starter screen. `fill` gives it `grow`, which only an app node with a layout allows: true for apps
 * Magnetic made with `STARTER_APP_LAYOUT`, false for older ones.
 */
export function starterScreen(fill: boolean): Record<string, unknown> {
    return {
        component: 'panel',
        padding: 'none',
        layout: { type: 'column' },
        ...(fill && { placement: { grow: 1 } }),
        children: {
            header: section('row', false),
            body: section('column', true),
            footer: section('row', false)
        }
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True when a node tree holds nothing but panels: an empty screen, or the starter's sections before anything is put in them */
export function onlyPanels(node: unknown): boolean {
    if (!isRecord(node)) return true;
    if (node['component'] !== 'panel') return false;
    const children = node['children'];
    return !isRecord(children) || Object.values(children).every(onlyPanels);
}

/** True when no screen of an app has anything on it yet: a new app, before the agent or the person builds it */
export function isBlankApp(body: unknown): boolean {
    const screens = isRecord(body) && isRecord(body['screens']) ? Object.values(body['screens']) : [];
    return screens.every((screen) => onlyPanels(isRecord(screen) ? screen['root'] : undefined));
}
