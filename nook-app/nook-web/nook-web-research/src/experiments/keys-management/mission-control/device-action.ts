/**
 * The affordances the local device key offers. Only this browser's own key can
 * be acted on, so no other device region ever uses these.
 *
 * It lives in a module rather than the component script because the Vite
 * script preprocessor inlines enum member reads and then drops the enum
 * object, which leaves template references to it undefined at runtime.
 */
export enum DeviceAction {
  /** @public Nothing armed; the panel shows only the device itself. */
  None = 'none',
  /** @public Reveals the passkeys not yet enrolled on this device key. */
  Enrol = 'enrol',
  /** @public Reveals the vaults that would be left without any device key. */
  Revoke = 'revoke',
}
