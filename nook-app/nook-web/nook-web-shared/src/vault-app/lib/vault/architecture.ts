import {
  NativeVaultStorageFailure,
  VaultStorageFailure,
  VaultStorageFailureKind,
} from "$lib/runtime/storage-failure";
import { err, ok, type Result } from "neverthrow";
import type { ArchitectureActionsContext } from "$lib/vault/action-contexts";
import {
  vault_architecture_can_create_secret,
  type VaultArchitecture,
} from "$lib/vault/architecture-model";
import { NookVaultArchitecture } from "$app-wasm";

type VaultArchitectureReplacement = {
  readonly architecture: VaultArchitecture;
};

/** Owns architecture presentation and admission of native metadata. */
export class VaultArchitectureActions {
  constructor(private readonly state: ArchitectureActionsContext) {}

  replaceVaultArchitecture({
    architecture,
  }: VaultArchitectureReplacement): void {
    const previous = this.state.vaultArchitecture;
    this.state.vaultArchitecture = architecture;
    if (previous !== architecture) previous.free();
  }

  applyDraftVaultArchitecture(): Result<void, VaultStorageFailure> {
    const state = this.state;
    let architecture: VaultArchitecture;
    try {
      architecture = NookVaultArchitecture.draft(
        state.draftDeviceMode,
        state.draftVaultType,
        state.draftReplicationType,
      );
    } catch (failure) {
      return err(new NativeVaultStorageFailure(failure));
    }
    let allowed: boolean;
    try {
      allowed = vault_architecture_can_create_secret(architecture);
    } catch (failure) {
      architecture.free();
      return err(new NativeVaultStorageFailure(failure));
    }
    if (state.hasManager) {
      const manager = state.admitManager();
      if (manager.isErr()) {
        architecture.free();
        return err(manager.error);
      }
      try {
        manager.value.set_vault_architecture(architecture);
      } catch (failure) {
        architecture.free();
        return err(new NativeVaultStorageFailure(failure));
      }
    }
    // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
    this.replaceVaultArchitecture({ architecture });
    state.architectureSecretCreationAllowed = allowed;
    return ok();
  }

  refreshVaultArchitectureFromManager(): Result<void, VaultStorageFailure> {
    const state = this.state;
    const manager = state.admitManager();
    if (manager.isErr()) return err(manager.error);
    let architecture: VaultArchitecture;
    try {
      architecture = manager.value.vaultArchitecture;
    } catch (failure) {
      return err(new NativeVaultStorageFailure(failure));
    }
    let deviceMode: VaultArchitecture["device_mode"];
    let vaultType: VaultArchitecture["vault_type"];
    let replicationType: VaultArchitecture["replication_type"];
    try {
      deviceMode = architecture.device_mode;
      vaultType = architecture.vault_type;
      replicationType = architecture.replication_type;
    } catch (failure) {
      architecture.free();
      return err(new NativeVaultStorageFailure(failure));
    }
    // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
    this.replaceVaultArchitecture({ architecture });
    state.architectureSecretCreationAllowed = false;
    state.draftDeviceMode = deviceMode;
    state.draftVaultType = vaultType;
    state.draftReplicationType = replicationType;
    void this.refreshArchitectureSecretCreationAllowed().then((permission) => {
      if (permission.isErr()) {
        const current = state.admitManager();
        if (
          current.isOk() &&
          current.value === manager.value &&
          state.vaultArchitecture === architecture
        ) {
          state.errorMsg = state.t(permission.error.translationKey);
        }
      }
    });
    return ok();
  }

  async refreshArchitectureSecretCreationAllowed(): Promise<
    Result<void, VaultStorageFailure>
  > {
    const state = this.state;
    const architecture = state.vaultArchitecture;
    const manager = state.admitManager();
    if (manager.isErr()) return err(manager.error);
    state.architectureSecretCreationAllowed = false;
    const permission = await state.enqueueStorage(async () => {
      const current = state.admitManager();
      if (current.isErr()) return err(current.error);
      if (
        current.value !== manager.value ||
        state.vaultArchitecture !== architecture
      ) {
        return err(
          new VaultStorageFailure(VaultStorageFailureKind.GenerationChanged),
        );
      }
      try {
        return ok(current.value.can_create_secret_for_vault_architecture());
      } catch (failure) {
        return err(new NativeVaultStorageFailure(failure));
      }
    });
    if (permission.isErr()) return err(permission.error);
    const current = state.admitManager();
    if (current.isErr()) return err(current.error);
    if (
      current.value !== manager.value ||
      state.vaultArchitecture !== architecture
    ) {
      return err(
        new VaultStorageFailure(VaultStorageFailureKind.GenerationChanged),
      );
    }
    state.architectureSecretCreationAllowed = permission.value;
    return ok();
  }
}
