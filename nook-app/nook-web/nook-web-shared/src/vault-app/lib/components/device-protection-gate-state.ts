/**
 * How the host presents the gate. Both hosts embed it in their own surface; they
 * differ in whether the gate is a numbered step of vault setup or a section a
 * host page has already introduced in its own words.
 */
export enum DeviceProtectionGateFrame {
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  SetupStep = "setup-step",
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  HostSection = "host-section",
  /** The host already titles and explains the step; the gate shows controls only. */
  Embedded = "embedded",
}

export enum DeviceProtectionSetupWorkflow {
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Authenticate = "authenticate",
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Create = "create",
  /** The extension looked for an existing passkey and the browser did not
   * return one: create one, or look on another device or password manager. */
  NotFound = "not-found",
}
