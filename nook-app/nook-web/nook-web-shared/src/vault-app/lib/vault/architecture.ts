import type { ArchitectureActionsContext } from "$lib/vault/action-contexts";
import {
  canCreateSecret,
  type VaultArchitecture,
} from "$lib/vault/architecture-model";
import { NookVaultArchitecture } from "$app-wasm";
import { createLogger } from "$lib/runtime/log";

const log = createLogger("vault-architecture");

export function draftVaultArchitecture(
  state: ArchitectureActionsContext,
): VaultArchitecture {
  return NookVaultArchitecture.draft(
    state.draftDeviceMode,
    state.draftVaultType,
    state.draftReplicationType,
  );
}

export function replaceVaultArchitecture(
  state: ArchitectureActionsContext,
  architecture: VaultArchitecture,
): void {
  const previous = state.vaultArchitecture;
  state.vaultArchitecture = architecture;
  if (previous !== architecture) previous.free();
}

export function applyDraftVaultArchitecture(
  state: ArchitectureActionsContext,
): void {
  replaceVaultArchitecture(state, draftVaultArchitecture(state));
  state.architectureSecretCreationAllowed = canCreateSecret(
    state.vaultArchitecture,
  );
  if (state.hasManager) {
    state.requireManager().setVaultArchitecture(state.vaultArchitecture);
  }
}

export function refreshVaultArchitectureFromManager(
  state: ArchitectureActionsContext,
): void {
  if (!state.hasManager) return;
  let architecture: VaultArchitecture;
  try {
    architecture = state.requireManager()
      .vaultArchitecture as VaultArchitecture;
  } catch (error) {
    log.warn("vault architecture metadata could not be loaded", {
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }
  replaceVaultArchitecture(state, architecture);
  state.architectureSecretCreationAllowed = canCreateSecret(
    state.vaultArchitecture,
  );
  state.draftDeviceMode = state.vaultArchitecture.device_mode;
  state.draftVaultType = state.vaultArchitecture.vault_type;
  state.draftReplicationType = state.vaultArchitecture.replication_type;
  void refreshArchitectureSecretCreationAllowed(state);
}

export async function refreshArchitectureSecretCreationAllowed(
  state: ArchitectureActionsContext,
): Promise<void> {
  const fallback = canCreateSecret(state.vaultArchitecture);
  if (!state.hasManager) {
    state.architectureSecretCreationAllowed = fallback;
    return;
  }
  try {
    state.architectureSecretCreationAllowed = await state.enqueueStorage(() =>
      state.requireManager().canCreateSecretForVaultArchitecture(),
    );
  } catch {
    state.architectureSecretCreationAllowed = fallback;
  }
}
