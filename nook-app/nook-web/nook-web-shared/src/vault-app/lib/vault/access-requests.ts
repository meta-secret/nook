import { err, ok, type Result } from "neverthrow";
import type { OAuthFailure } from "$lib/auth/oauth-failure";
import {
  NativeVaultStorageFailure,
  type VaultStorageFailure,
} from "$lib/runtime/storage-failure";
import { I18N_KEYS } from "../../../generated/i18n-keys";
import type { VaultState } from "$lib/vault.svelte";

export enum AccessRequestDecision {
  Approve = "approve",
  Deny = "deny",
}

/** A member's answer to one device asking to open the open vault. */
export interface AccessRequestAnswer {
  readonly deviceId: string;
  readonly decision: AccessRequestDecision;
}

/**
 * Owns a member's answer to the access requests other devices wrote into
 * the open vault. Approval wraps the vault keys to the requesting device in
 * Rust; denial records the refusal. Either way the request list refreshes.
 */
export class VaultAccessRequestActions {
  constructor(private readonly vault: VaultState) {}

  async answer({
    deviceId,
    decision,
  }: AccessRequestAnswer): Promise<
    Result<AccessRequestDecision, VaultStorageFailure | OAuthFailure>
  > {
    const vault = this.vault;
    vault.errorMsg = "";
    vault.dismissSuccess();
    const answered = await vault.enqueueStorage(async () => {
      const manager = vault.admitManager();
      if (manager.isErr()) return err(manager.error);
      try {
        if (decision === AccessRequestDecision.Approve) {
          await manager.value.approve_join_request(deviceId);
        } else {
          await manager.value.deny_join_request(deviceId);
        }
        return ok(decision);
      } catch (failure) {
        return err(new NativeVaultStorageFailure(failure));
      }
    });
    if (answered.isErr()) return err(answered.error);
    const synchronized = await vault.runFanOutSyncAfterLocalSave();
    if (synchronized.isErr()) return err(synchronized.error);
    const roster = await vault.hydrateMultiDeviceState();
    if (roster.isErr()) return err(roster.error);
    vault.showSuccess(
      vault.t(
        decision === AccessRequestDecision.Approve
          ? I18N_KEYS.DevicesCardAccessGrantedToast
          : I18N_KEYS.DevicesCardAccessDeniedToast,
      ),
    );
    return ok(decision);
  }
}
