import { VaultAccessStatus, type NookPasswordEntrySummary } from "$app-wasm";

type LoginUnlockCapabilityState = {
  hasManager: boolean;
  localVaultPresent: boolean;
  loginDeviceKeysCapable: boolean;
  loginPasswordPrompt: boolean;
  passwordEntries: readonly NookPasswordEntrySummary[];
  assessVaultConnectStatus(
    args?: [string, string, string],
  ): Promise<VaultAccessStatus>;
};

/** Assess whether device keys or backup passwords can unlock the active vault. */
export async function refreshLoginUnlockCapabilities(
  state: LoginUnlockCapabilityState,
): Promise<void> {
  state.loginDeviceKeysCapable = true;
  if (!state.hasManager || !state.localVaultPresent) {
    return;
  }
  try {
    const accessStatus = await state.assessVaultConnectStatus([
      "local",
      "",
      "",
    ]);
    if (
      accessStatus === VaultAccessStatus.NeedsEnrollment ||
      accessStatus === VaultAccessStatus.JoinPending
    ) {
      state.loginDeviceKeysCapable = false;
      if (state.passwordEntries.length > 0) {
        state.loginPasswordPrompt = true;
      }
    }
  } catch {
    // Device identity may be locked; keep device-keys enabled until unlock
    // ceremony can assess membership.
    state.loginDeviceKeysCapable = true;
  }
}
