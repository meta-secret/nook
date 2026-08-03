/**
 * The one severity a vault line carries on the status board.
 *
 * It lives in a module rather than the component script because the Vite
 * script preprocessor inlines enum member reads and then drops the enum
 * object, which leaves template references to it undefined at runtime.
 */
export enum BoardStatus {
  /** @public Two or more passkeys open this vault from this browser. */
  Ready = 'ready',
  /** @public Exactly one passkey opens it from this browser. */
  Single = 'single',
  /** @public Passkeys exist, but none of them works from this browser. */
  Locked = 'locked',
  /** @public No passkey reaches this vault at all. */
  Severed = 'severed',
}

/** Whether a vault row on the board is showing its detail. */
export enum RowKind {
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Closed = 'closed',
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Open = 'open',
}

export type Row =
  | { kind: RowKind.Closed }
  | { kind: RowKind.Open; vaultId: string }
