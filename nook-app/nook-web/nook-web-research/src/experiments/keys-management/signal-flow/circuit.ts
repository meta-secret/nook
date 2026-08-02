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

/** How one passkey socket sits against the device key of this browser. */
export enum Socket {
  /** @public Enrolled on this device key and presentable from here. */
  Live = 'live',
  /** @public Held in a manager this browser cannot reach. */
  Elsewhere = 'elsewhere',
  /** @public Presentable here, but enrolled on some other device key. */
  NotEnrolled = 'not-enrolled',
}
