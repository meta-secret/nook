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
}

export enum DeviceProtectionSetupWorkflow {
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Authenticate = "authenticate",
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Create = "create",
}
