/**
 * How one connected identifier is drawn in the detail view.
 *
 * It lives in a module rather than the component script because the Vite
 * script preprocessor inlines enum member reads and then drops the enum
 * object, which leaves template references to it undefined at runtime.
 */
export enum ChipMark {
  /** @public The device key of the browser this person is sitting in. */
  Mine = 'mine',
  /** @public It exists, but it cannot be reached from this browser. */
  Away = 'away',
  /** @public An ordinary neighbour, reachable from here. */
  Plain = 'plain',
}
