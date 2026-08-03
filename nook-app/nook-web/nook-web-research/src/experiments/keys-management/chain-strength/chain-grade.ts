/**
 * How many independent ways back into a vault there are, graded.
 *
 * It lives in a module rather than the component script because the Vite
 * script preprocessor inlines enum member reads and then drops the enum
 * object, which leaves template references to it undefined at runtime.
 */
export enum Redundancy {
  /** @public No passkey reaches this vault at all. */
  Severed = 'severed',
  /** @public Exactly one passkey reaches it. */
  Single = 'single',
  /** @public Several passkeys, all living in the same manager. */
  OneManager = 'one-manager',
  /** @public Several passkeys, spread across several managers. */
  Spread = 'spread',
}

/**
 * Whether one passkey → device key → vault strand can be walked from the
 * browser you are sitting in, and if not, which link is the one that stops it.
 */
export enum PathReach {
  /** @public The passkey is here and the device key is this browser's own. */
  Now = 'now',
  /** @public The strand runs through a device key that is not this browser's. */
  OtherDevice = 'other-device',
  /** @public The passkey itself cannot be presented from this browser. */
  PasskeyElsewhere = 'passkey-elsewhere',
}
