import {
  isLocalDataInvalidationFailure,
  NativeVaultStorageFailure,
  VaultStorageFailure,
} from "$lib/runtime/storage-failure";
import { err, ok, type Result } from "neverthrow";
import type {
  ArchitectureActionsContext,
  VaultArchitectureRefreshSnapshot,
} from "$lib/vault/action-contexts";
import {
  vault_architecture_can_create_secret,
  type VaultArchitecture,
} from "$lib/vault/architecture-model";
import { NookVaultArchitecture } from "$app-wasm";
import {
  VaultOperationStale,
  VaultOperationStaleKind,
} from "$lib/runtime/vault-operation-stale";

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

  applyDraftVaultArchitecture(): Result<
    VaultArchitectureRefreshSnapshot,
    VaultStorageFailure
  > {
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
    const replacement: VaultArchitectureReplacement = { architecture };
    this.replaceVaultArchitecture(replacement);
    state.architectureSecretCreationAllowed = allowed;
    const snapshot: VaultArchitectureRefreshSnapshot = {
      deviceMode: state.draftDeviceMode,
      vaultType: state.draftVaultType,
      replicationType: state.draftReplicationType,
    };
    return ok(snapshot);
  }

  refreshVaultArchitectureFromManager(): Result<
    VaultArchitectureRefreshSnapshot,
    VaultStorageFailure
  > {
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
    const replacement: VaultArchitectureReplacement = { architecture };
    this.replaceVaultArchitecture(replacement);
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
    const snapshot: VaultArchitectureRefreshSnapshot = {
      deviceMode,
      vaultType,
      replicationType,
    };
    return ok(snapshot);
  }

  async refreshArchitectureSecretCreationAllowed(): Promise<
    Result<
      VaultArchitectureRefreshSnapshot | VaultOperationStale,
      VaultStorageFailure
    >
  > {
    const state = this.state;
    const architecture = state.vaultArchitecture;
    const manager = state.admitManager();
    if (manager.isErr()) return err(manager.error);
    state.architectureSecretCreationAllowed = false;
    const permission = await state.enqueueStorage(async () => {
      const current = state.admitManager();
      if (current.isErr())
        return ok(
          new VaultOperationStale(VaultOperationStaleKind.ContextReplaced),
        );
      if (
        current.value !== manager.value ||
        state.vaultArchitecture !== architecture
      ) {
        return ok(
          new VaultOperationStale(VaultOperationStaleKind.ContextReplaced),
        );
      }
      try {
        return ok(current.value.can_create_secret_for_vault_architecture());
      } catch (failure) {
        return err(new NativeVaultStorageFailure(failure));
      }
    });
    if (permission.isErr()) {
      if (isLocalDataInvalidationFailure(permission.error))
        return err(permission.error);
      const current = state.admitManager();
      if (
        current.isErr() ||
        current.value !== manager.value ||
        state.vaultArchitecture !== architecture
      )
        return ok(
          new VaultOperationStale(VaultOperationStaleKind.ContextReplaced),
        );
      return err(permission.error);
    }
    if (permission.value instanceof VaultOperationStale)
      return ok(permission.value);
    const current = state.admitManager();
    if (current.isErr())
      return ok(
        new VaultOperationStale(VaultOperationStaleKind.ContextReplaced),
      );
    if (
      current.value !== manager.value ||
      state.vaultArchitecture !== architecture
    ) {
      return ok(
        new VaultOperationStale(VaultOperationStaleKind.ContextReplaced),
      );
    }
    state.architectureSecretCreationAllowed = permission.value;
    const snapshot: VaultArchitectureRefreshSnapshot = {
      deviceMode: state.draftDeviceMode,
      vaultType: state.draftVaultType,
      replicationType: state.draftReplicationType,
    };
    return ok(snapshot);
  }
}
