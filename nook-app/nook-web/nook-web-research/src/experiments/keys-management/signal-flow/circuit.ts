import type { Passkey, Vault } from '../_shared/key-graph'

/**
 * Board vocabulary for the signal-flow sketch.
 *
 * These live in a module rather than the component script because the Vite
 * script preprocessor inlines enum member reads and then drops the enum
 * object, which leaves template references to it undefined at runtime.
 */

/** Where the current stops on the route passkey → this device key → vault. */
export enum Circuit {
  /** @public The pulse reaches the vault. */
  Closed = 'closed',
  /** @public The seated passkey cannot be presented from this browser. */
  PasskeyElsewhere = 'passkey-elsewhere',
  /** @public The seated passkey is not enrolled on this device key. */
  NotEnrolled = 'not-enrolled',
  /** @public This device key is not enrolled in the slotted vault. */
  VaultUnreachable = 'vault-unreachable',
  /** @public This browser holds no device key at all. */
  NoDeviceKey = 'no-device-key',
}

/** Whether the socket above the board holds a passkey right now. */
export enum SeatKind {
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Empty = 'empty',
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Seated = 'seated',
}

/** What sits in the passkey socket above the board. */
export type Seat =
  | { kind: SeatKind.Empty }
  | { kind: SeatKind.Seated; passkey: Passkey }

/** Whether the slot below the board holds a vault right now. */
export enum SlotKind {
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Empty = 'empty',
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Slotted = 'slotted',
}

/** What sits in the vault slot below the board. */
export type Slot =
  | { kind: SlotKind.Empty }
  | { kind: SlotKind.Slotted; vault: Vault }

/** How one passkey socket sits against the device key of this browser. */
export enum Socket {
  /** @public Enrolled on this device key and presentable from here. */
  Live = 'live',
  /** @public Held in a manager this browser cannot reach. */
  Elsewhere = 'elsewhere',
  /** @public Presentable here, but enrolled on some other device key. */
  NotEnrolled = 'not-enrolled',
}
