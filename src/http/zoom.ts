/** The size of a card on a board and the room between two, in the board's pixels; five cards to a row */
export const APPS_BOARD = { columns: 5, width: 320, height: 120, gap: 48 } as const;

/** How long a zoom between levels takes */
const ZOOM_SECONDS = 0.24;

/**
 * The scale transitions between levels (docs/design/magnetic-zoom.md, stage 5), for the board pages' and the shell's
 * stylesheets. A zoom to another page is a cross-document view transition: both pages opt in (`@view-transition`), and
 * the element named `zoom` on each is the tile or the page that grows or shrinks. On a board page it is `.zoom-mark`,
 * placed over the tile zoomed into, or over the whole board when zooming out; the page a board zooms out to draws it
 * over its selected tile, which sits in the middle at full size. In the shell it is the body, the whole page. A zoom in
 * the page (the editor to the running app and back) is a same-document view transition, scaled by the `zoom-in` or
 * `zoom-out` class on the root. Browsers without view transitions, and people who ask for reduced motion, go straight
 * to the next level
 */
export const ZOOM_CSS = `@view-transition { navigation: auto; }
::view-transition-group(zoom) { animation-duration: ${ZOOM_SECONDS}s; animation-timing-function: cubic-bezier(0.2, 0.7, 0.3, 1); }
::view-transition-old(root), ::view-transition-new(root), ::view-transition-old(zoom), ::view-transition-new(zoom) { animation-duration: ${ZOOM_SECONDS}s; }
.zoom-mark { position: fixed; left: 0; right: 0; top: 2.25rem; bottom: 0; pointer-events: none; view-transition-name: zoom; }
.zoom-mark.tile { left: calc(50% - ${APPS_BOARD.width / 2}px); top: calc(2.25rem + (100vh - 2.25rem) / 2 - ${APPS_BOARD.height / 2}px); width: ${APPS_BOARD.width}px; height: ${APPS_BOARD.height}px; right: auto; bottom: auto; }
html.zoom-in::view-transition-old(zoom) { animation-name: zoom-past; }
html.zoom-in::view-transition-new(zoom) { animation-name: zoom-near; }
html.zoom-out::view-transition-old(zoom) { animation-name: zoom-away; }
html.zoom-out::view-transition-new(zoom) { animation-name: zoom-back; }
@keyframes zoom-past { to { transform: scale(1.15); opacity: 0; } }
@keyframes zoom-near { from { transform: scale(0.85); opacity: 0; } }
@keyframes zoom-away { to { transform: scale(0.85); opacity: 0; } }
@keyframes zoom-back { from { transform: scale(1.15); opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
    @view-transition { navigation: none; }
    ::view-transition-group(*), ::view-transition-old(*), ::view-transition-new(*) { animation: none !important; }
}
`;

/**
 * The page script's half: \`zoomInPage(direction, change)\` runs a change of level in the page as a same-document view
 * transition, or at once where there is none or motion is reduced
 */
export const ZOOM_JS = `/** Runs a change of level in the page as a scale transition: 'in' grows the next level out of this one, 'out' shrinks it back */
function zoomInPage(direction, change) {
    if (typeof document.startViewTransition !== 'function' || matchMedia('(prefers-reduced-motion: reduce)').matches) { change(); return; }
    const root = document.documentElement;
    root.classList.add('zoom-' + direction);
    document.startViewTransition(change).finished.finally(() => root.classList.remove('zoom-' + direction));
}
`;
