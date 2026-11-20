import type { Database } from '@punyts/stateui-pg';

/** The views of the editor whose place is kept per person */
export const KEPT_VIEWS = ['statenet'] as const;
export type KeptView = (typeof KEPT_VIEWS)[number];

/** Where a view was left: the offset of its content in screen pixels, and its zoom */
export interface KeptPlace {
    readonly x: number;
    readonly y: number;
    readonly zoom: number;
}

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;
/** The farthest a view is kept from its origin, in screen pixels */
const MOST_OFFSET = 1_000_000;

/** Whether a name is a view whose place is kept */
export function isKeptView(name: unknown): name is KeptView {
    return typeof name === 'string' && (KEPT_VIEWS as readonly string[]).includes(name);
}

/** The place a value holds, or undefined when it is not `{ x, y, zoom }` of finite numbers in range */
export function keptPlaceOf(value: unknown): KeptPlace | undefined {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
    const { x, y, zoom } = value as Record<string, unknown>;
    const offset = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= MOST_OFFSET;
    if (!offset(x) || !offset(y) || typeof zoom !== 'number' || !Number.isFinite(zoom) || zoom < MIN_ZOOM || zoom > MAX_ZOOM) return undefined;
    return { x, y, zoom };
}

/**
 * Where each person left a view of the editor, per app (`editor_view`, docs/design/magnetic-statenet-diagram.md), so the
 * view opens as they left it in any browser
 */
export class EditorViews {
    constructor(
        private readonly db: Database,
        private readonly now: () => Date = () => new Date()
    ) {}

    /** Where the person left the view of the app, if they moved it */
    async of(userId: string, appId: string, view: KeptView): Promise<KeptPlace | undefined> {
        const rows = (await this.db.query<{ value: unknown }>('SELECT value FROM editor_view WHERE user_id = $1 AND app_id = $2 AND view = $3', [userId, appId, view])).rows;
        return rows[0] === undefined ? undefined : keptPlaceOf(rows[0].value);
    }

    /** Keeps where the person left the view of the app */
    async keep(userId: string, appId: string, view: KeptView, place: KeptPlace): Promise<void> {
        await this.db.query(
            `INSERT INTO editor_view (user_id, app_id, view, value, kept_at) VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (user_id, app_id, view) DO UPDATE SET value = $4, kept_at = $5`,
            [userId, appId, view, JSON.stringify({ x: place.x, y: place.y, zoom: place.zoom }), this.now()]
        );
    }
}
