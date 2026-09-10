import { ok, err, type Result } from "neverthrow";
import {
  NativeVaultStorageFailure,
  type VaultStorageFailure,
} from "$lib/runtime/storage-failure";
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
  ): Promise<Result<VaultAccessStatus, VaultStorageFailure>>;
};

/** Assess whether device keys or backup passwords can unlock the active vault. */
export class LoginUnlockPresentation {
  constructor(private readonly request: LoginUnlockCapabilityState) {}
  async refresh(): Promise<Result<void, VaultStorageFailure>> {
    const state = this.request;
    if (!state.hasManager || !state.localVaultPresent) {
      state.loginDeviceKeysCapable = true;
      return ok(undefined);
    }
    const accessStatus = await state.assessVaultConnectStatus({
      mode: "local",
      pat: "",
      repo: "",
    });
    if (accessStatus.isErr()) return err(accessStatus.error);
    try {
      const decision = login_unlock_decision(
        accessStatus.value,
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
    } catch (failure) {
      return err(new NativeVaultStorageFailure(failure));
    }
    return ok(undefined);
  }
}
