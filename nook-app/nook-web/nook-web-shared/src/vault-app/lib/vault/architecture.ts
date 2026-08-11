import type { ArchitectureActionsContext } from "$lib/vault/action-contexts";
import {
  vault_architecture_can_create_secret,
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

export function replaceVaultArchitecture({
  state,
  architecture,
}: {
  readonly state: ArchitectureActionsContext;
  readonly architecture: VaultArchitecture;
}): void {
  const previous = state.vaultArchitecture;
  state.vaultArchitecture = architecture;
  if (previous !== architecture) previous.free();
}

export function applyDraftVaultArchitecture(
  state: ArchitectureActionsContext,
): void {
  const replaceVaultArchitectureArgs: Parameters<
    typeof replaceVaultArchitecture
  >[0] = { state, architecture: draftVaultArchitecture(state) };
  replaceVaultArchitecture(replaceVaultArchitectureArgs);
  state.architectureSecretCreationAllowed =
    vault_architecture_can_create_secret(state.vaultArchitecture);
  if (state.hasManager) {
    state.requireManager().set_vault_architecture(state.vaultArchitecture);
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
  } catch {
    log.warn("vault architecture metadata could not be loaded");
    return;
  }
  const replaceVaultArchitectureArgs2: Parameters<
    typeof replaceVaultArchitecture
  >[0] = { state, architecture };
  replaceVaultArchitecture(replaceVaultArchitectureArgs2);
  state.architectureSecretCreationAllowed =
    vault_architecture_can_create_secret(state.vaultArchitecture);
  state.draftDeviceMode = state.vaultArchitecture.device_mode;
  state.draftVaultType = state.vaultArchitecture.vault_type;
  state.draftReplicationType = state.vaultArchitecture.replication_type;
  void refreshArchitectureSecretCreationAllowed(state);
}

export async function refreshArchitectureSecretCreationAllowed(
  state: ArchitectureActionsContext,
): Promise<void> {
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
