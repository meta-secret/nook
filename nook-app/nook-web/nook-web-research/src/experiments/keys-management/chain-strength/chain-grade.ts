/**
 * Local grading vocabulary for this sketch only. No scores, no percentages.
 *
 * It lives in a module rather than the component script because the Vite
 * script preprocessor inlines enum member reads and then drops the enum
 * object, which leaves template references to it undefined at runtime.
 */
export enum Grade {
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Recoverable = 'recoverable',
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Rederivable = 'rederivable',
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  SinglePoint = 'single-point',
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Absent = 'absent',
}
