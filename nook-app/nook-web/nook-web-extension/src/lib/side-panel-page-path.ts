/**
 * The single side-panel page. The manifest's `side_panel.default_path` and the
 * service worker's side-panel sender check both use this path, so the panel
 * is the only extension page these routes answer.
 */
export const SIDE_PANEL_PAGE_PATH = 'side-panel/index.html'
