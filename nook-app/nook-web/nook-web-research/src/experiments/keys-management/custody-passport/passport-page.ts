/**
 * The two faces of the document.
 *
 * It lives in a module rather than the component script because the Vite
 * script preprocessor inlines enum member reads and then drops the enum
 * object, which leaves template references to it undefined at runtime.
 */
export enum PassportPage {
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Data = 'data',
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Stamps = 'stamps',
}
