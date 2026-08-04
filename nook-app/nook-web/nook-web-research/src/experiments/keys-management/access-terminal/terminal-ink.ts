/**
 * How one run of characters in a printed line is coloured.
 *
 * The transcript is plain monospace text so columns stay aligned; this is the
 * only decoration it carries, applied by scanning each line for identifiers
 * and state words. It lives in a module rather than the component script
 * because the Vite script preprocessor inlines enum member reads and then
 * drops the enum object, which leaves template references undefined at
 * runtime.
 */
export enum Ink {
  /** @public Ordinary text. Used from Svelte templates. */
  Plain = 'plain',
  /** @public Any short identifier. Used from Svelte templates. */
  Id = 'id',
  /** @public The device key of this browser. Used from Svelte templates. */
  Mine = 'mine',
  /** @public Something usable from this browser now. */
  Good = 'good',
  /** @public Something out of reach from this browser. */
  Warn = 'warn',
}
