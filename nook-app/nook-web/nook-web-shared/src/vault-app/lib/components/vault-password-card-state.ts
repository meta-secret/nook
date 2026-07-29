import type { NookPasswordEntrySummary, PasswordEntryId } from '$app-wasm'

export enum ActivePasswordEntryKind {
  None = 'none',
  Selected = 'selected',
}

export type ActivePasswordEntry =
  | { kind: ActivePasswordEntryKind.None }
  | { kind: ActivePasswordEntryKind.Selected; entryId: PasswordEntryId }

export enum ResolvedPasswordEntryKind {
  Unavailable = 'unavailable',
  Available = 'available',
}

export type ResolvedPasswordEntry =
  | { kind: ResolvedPasswordEntryKind.Unavailable }
  | {
      kind: ResolvedPasswordEntryKind.Available
      entry: NookPasswordEntrySummary
    }

export enum VaultPasswordPanel {
  Idle = 'idle',
  Add = 'add',
  Rotate = 'rotate',
  Remove = 'remove',
  Issue = 'issue',
}
