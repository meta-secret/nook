import type { NookStorageConnectArgs } from "$app-wasm";
import {
  VaultAccessStatus,
  login_unlock_decision,
  PasswordEntryPresence,
  LoginDeviceKeyAvailability,
  LoginPasswordPromptUpdate,
  type NookPasswordEntrySummary,
} from "$app-wasm";

type VaultConnectAssessment = NookStorageConnectArgs;

type LoginUnlockCapabilityState = {
  hasManager: boolean;
  localVaultPresent: boolean;
  loginDeviceKeysCapable: boolean;
  loginPasswordPrompt: boolean;
  passwordEntries: readonly NookPasswordEntrySummary[];
  assessVaultConnectStatus(
    args: VaultConnectAssessment,
  ): Promise<VaultAccessStatus>;
};

/** Assess whether device keys or backup passwords can unlock the active vault. */
export class LoginUnlockPresentation {
  constructor(private readonly request: LoginUnlockCapabilityState) {}
  async refresh(): Promise<void> {
    const state = this.request;

    state.loginDeviceKeysCapable = true;
    if (!state.hasManager || !state.localVaultPresent) {
      return;
    }
    try {
      const accessStatus = await state.assessVaultConnectStatus({
        mode: "local",
        pat: "",
        repo: "",
      });
      const decision = login_unlock_decision(
        accessStatus,
        state.passwordEntries.length > 0
          ? PasswordEntryPresence.Present
          : PasswordEntryPresence.Absent,
      );
      try {
        state.loginDeviceKeysCapable =
          decision.device_keys === LoginDeviceKeyAvailability.Enabled;
        if (decision.password_prompt === LoginPasswordPromptUpdate.Offer)
          state.loginPasswordPrompt = true;
      } finally {
        decision.free();
      }
    } catch {
      // Device identity may be locked; keep device-keys enabled until unlock
      // ceremony can assess membership.
      state.loginDeviceKeysCapable = true;
    }
  }
}
