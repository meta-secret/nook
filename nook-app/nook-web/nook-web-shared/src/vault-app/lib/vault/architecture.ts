import type { ArchitectureActionsContext } from "$lib/vault/action-contexts";
import {
  vault_architecture_can_create_secret,
  type VaultArchitecture,
} from "$lib/vault/architecture-model";
import { NookVaultArchitecture } from "$app-wasm";
import { browserLogRuntime } from "$lib/runtime/log";

const log = browserLogRuntime.createLogger("vault-architecture");

type VaultArchitectureReplacement = {
  readonly architecture: VaultArchitecture;
};

/** Owns browser orchestration for one architecture context. */
export class VaultArchitectureActions {
  constructor(private readonly state: ArchitectureActionsContext) {}

  draftVaultArchitecture(): VaultArchitecture {
    const state = this.state;
    return NookVaultArchitecture.draft(
      state.draftDeviceMode,
      state.draftVaultType,
      state.draftReplicationType,
    );
  }

  replaceVaultArchitecture({
    architecture,
  }: VaultArchitectureReplacement): void {
    const state = this.state;
    const previous = state.vaultArchitecture;
    state.vaultArchitecture = architecture;
    if (previous !== architecture) previous.free();
  }

  applyDraftVaultArchitecture(): void {
    const state = this.state;
    const replaceVaultArchitectureArgs: Parameters<
      VaultArchitectureActions["replaceVaultArchitecture"]
    >[0] = { architecture: this.draftVaultArchitecture() };
    this.replaceVaultArchitecture(replaceVaultArchitectureArgs);
    state.architectureSecretCreationAllowed =
      vault_architecture_can_create_secret(state.vaultArchitecture);
    if (state.hasManager) {
      state.requireManager().set_vault_architecture(state.vaultArchitecture);
    }
  }

  refreshVaultArchitectureFromManager(): void {
    const state = this.state;
    if (!state.hasManager) return;
    let architecture: VaultArchitecture;
    try {
      architecture = state.requireManager()
        .vaultArchitecture as VaultArchitecture;
    } catch {
      log.warn("vault architecture metadata could not be loaded");
      return;
    }
    const replaceVaultArchitectureArgs2: Parameters<
      VaultArchitectureActions["replaceVaultArchitecture"]
    >[0] = { architecture };
    this.replaceVaultArchitecture(replaceVaultArchitectureArgs2);
    state.architectureSecretCreationAllowed =
      vault_architecture_can_create_secret(state.vaultArchitecture);
    state.draftDeviceMode = state.vaultArchitecture.device_mode;
    state.draftVaultType = state.vaultArchitecture.vault_type;
    state.draftReplicationType = state.vaultArchitecture.replication_type;
    void this.refreshArchitectureSecretCreationAllowed();
  }

  async refreshArchitectureSecretCreationAllowed(): Promise<void> {
    const state = this.state;
    const fallback = vault_architecture_can_create_secret(
      state.vaultArchitecture,
    );
    if (!state.hasManager) {
      state.architectureSecretCreationAllowed = fallback;
      return;
    }
    try {
      state.architectureSecretCreationAllowed = await state.enqueueStorage(() =>
        state.requireManager().can_create_secret_for_vault_architecture(),
      );
    } catch {
      state.architectureSecretCreationAllowed = fallback;
    }
  }
}
