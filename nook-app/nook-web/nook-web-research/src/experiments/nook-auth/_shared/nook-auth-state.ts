export enum DemoVaultPresence {
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Empty = 'empty',
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Existing = 'existing',
}

export enum NookAuthChoice {
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  None = 'none',
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Simple = 'simple',
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Sentinel = 'sentinel',
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Unlock = 'unlock',
}

export enum NookAuthStage {
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Home = 'home',
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Simple = 'simple',
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Sentinel = 'sentinel',
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Unlock = 'unlock',
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Passkey = 'passkey',
}
