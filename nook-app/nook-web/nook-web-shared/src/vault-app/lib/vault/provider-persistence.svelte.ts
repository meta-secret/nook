/**
 * Saving the sync provider being set up: the save policy in Rust decides the
 * rows, then they are kept for the identity in use, or for an identity just
 * added beside it under that identity's own key.
 */
import { err as storageErr, ok as storageOk, type Result } from "neverthrow";
import {
  NativeVaultStorageFailure,
  ProviderDraftIncompleteFailure,
  VaultStorageFailure as StorageOperationFailure,
  VaultStorageFailureKind as StorageOperationFailureKind,
} from "$lib/runtime/storage-failure";
import { browserLogRuntime } from "$lib/runtime/log";
import type {
  ProviderActionsContext,
  ProviderSaveContext,
} from "$lib/vault/action-contexts";
import { generate_id, isoTimestamp } from "$lib/nook";
import {
  activeVaultScope,
  scopedProviderVault,
  unscopedProviderVault,
  unselectedVaultScope,
} from "$lib/auth/providers";
import {
  apply_provider_save_policy,
  existing_provider_save_setup,
  new_provider_save_setup,
  NookProviderSaveOutcomeState,
  type AuthProvidersSnapshot,
  type DuplicateProviderHandling,
  type NookProviderSaveOutcome,
  type ProviderDraft,
  type ProviderSaveRequest,
  type ProviderSaveSetup,
  type ProviderVaultScope,
} from "$app-wasm";
import {
  ActiveVaultKind,
  LoginSetupKind,
  LoginVaultSelectionKind,
} from "$lib/vault/state/provider.svelte";
import type { ProviderPersistenceOptions } from "$lib/vault/providers.svelte";

const log = browserLogRuntime.createLogger("vault-providers");

function providerSaveSetup(
  loginSetup: ProviderActionsContext["loginSetup"],
): ProviderSaveSetup {
  switch (loginSetup.kind) {
    case LoginSetupKind.Active:
      return new_provider_save_setup();
    case LoginSetupKind.Inactive:
      return existing_provider_save_setup();
  }
}

/** Confirms provider persistence without exposing credential-bearing provider state. */
export enum ProviderSaveOutcome {
  Saved = "saved",
}

/** The rows a provider being set up joins, and where it is kept. */
type ProviderSaveTarget = {
  readonly snapshot: AuthProvidersSnapshot;
  readonly providerStoreId: ProviderVaultScope;
  readonly duplicates: DuplicateProviderHandling;
};

/** An explicit add refuses a duplicate; any other save keeps the saved row. */
class DuplicateHandling {
  static of(explicitAdd: boolean): DuplicateProviderHandling {
    switch (explicitAdd) {
      case true:
        return "reject";
      case false:
        return "keepExisting";
    }
  }
}

export class ProviderPersistenceActions {
  constructor(private readonly state: ProviderSaveContext) {}

  private async providerStoreIdForSave(): Promise<
    Result<
      | ReturnType<typeof scopedProviderVault>
      | ReturnType<typeof unscopedProviderVault>,
      StorageOperationFailure
    >
  > {
    const state = this.state;
    if (!state.hasManager)
      return storageOk(
        state.selectedLoginVault.kind === LoginVaultSelectionKind.Selected
          ? scopedProviderVault(state.selectedLoginVault.storeId)
          : unscopedProviderVault(),
      );
    const storeId = await state.enqueueStorage(async () => {
      const manager = state.admitManager();
      if (manager.isErr()) return storageErr(manager.error);
      try {
        return storageOk(manager.value.vaultStoreId.trim());
      } catch (failure) {
        return storageErr(new NativeVaultStorageFailure(failure));
      }
    });
    if (storeId.isErr()) return storageErr(storeId.error);
    if (storeId.value) return storageOk(scopedProviderVault(storeId.value));
    return storageOk(
      state.selectedLoginVault.kind === LoginVaultSelectionKind.Selected
        ? scopedProviderVault(state.selectedLoginVault.storeId)
        : unscopedProviderVault(),
    );
  }

  /** The save of the provider being set up, onto the rows it joins. */
  private saveRequest(target: ProviderSaveTarget): ProviderSaveRequest {
    const state = this.state;
    return {
      snapshot: target.snapshot,
      providerStoreId: target.providerStoreId,
      setup: providerSaveSetup(state.loginSetup),
      duplicates: target.duplicates,
      draft: state.providerDraft,
      newProviderId: generate_id(),
      createdAt: isoTimestamp(),
    };
  }

  /** The saved outcome, or the failure of a save Rust's policy refused. */
  private savedOutcome(
    outcome: NookProviderSaveOutcome,
  ): Result<ProviderSaveOutcome, StorageOperationFailure> {
    switch (outcome.state) {
      case NookProviderSaveOutcomeState.Saved:
        return storageOk(ProviderSaveOutcome.Saved);
      case NookProviderSaveOutcomeState.Duplicate:
        return storageErr(
          new StorageOperationFailure(
            StorageOperationFailureKind.DuplicateProvider,
          ),
        );
      case NookProviderSaveOutcomeState.Incomplete:
        return storageErr(new ProviderDraftIncompleteFailure(outcome.gap));
    }
  }

  /** Save the provider being set up for an identity added beside the one
   * in use, under that identity's own key here: the sign-in that found it
   * serves it too. The identity in use and its providers stay as they are. */
  async saveProviderForAddedIdentity(
    identityId: string,
  ): Promise<Result<ProviderSaveOutcome, StorageOperationFailure>> {
    const state = this.state;
    const target: ProviderSaveTarget = {
      snapshot: { providers: [], activeVaultStoreId: unselectedVaultScope() },
      providerStoreId: unscopedProviderVault(),
      duplicates: DuplicateHandling.of(true),
    };
    const outcome = apply_provider_save_policy(this.saveRequest(target));
    try {
      const admitted = this.savedOutcome(outcome);
      if (admitted.isErr()) return storageErr(admitted.error);
      const snapshot = outcome.snapshot;
      return await state.enqueueStorage(async () => {
        const manager = state.admitManager();
        if (manager.isErr()) return storageErr(manager.error);
        try {
          await manager.value.save_added_identity_providers(
            identityId,
            snapshot,
          );
          return storageOk(ProviderSaveOutcome.Saved);
        } catch (failure) {
          return storageErr(new NativeVaultStorageFailure(failure));
        }
      });
    } finally {
      outcome.free();
    }
  }

  /** Save a provider an invite gave beside the one the join went through:
   * a new row, or the saved one it duplicates. The setup in progress and the
   * provider in use stay as they are. */
  async saveInvitedProvider(
    draft: ProviderDraft,
  ): Promise<Result<ProviderSaveOutcome, StorageOperationFailure>> {
    const state = this.state;
    const scope = await this.providerStoreIdForSave();
    if (scope.isErr()) return storageErr(scope.error);
    const request: ProviderSaveRequest = {
      snapshot: {
        providers: $state.snapshot(state.providers),
        activeVaultStoreId:
          state.activeVault.kind === ActiveVaultKind.Open
            ? activeVaultScope(state.activeVault.storeId)
            : unselectedVaultScope(),
      },
      providerStoreId: scope.value,
      setup: new_provider_save_setup(),
      duplicates: DuplicateHandling.of(false),
      draft,
      newProviderId: generate_id(),
      createdAt: isoTimestamp(),
    };
    const outcome = apply_provider_save_policy(request);
    try {
      const admitted = this.savedOutcome(outcome);
      if (admitted.isErr()) return storageErr(admitted.error);
      const persistenceOptions: ProviderPersistenceOptions = {
        replace: false,
        providers: outcome.snapshot.providers,
      };
      const persistence = await state.persistProviders(persistenceOptions);
      if (persistence.isErr()) return storageErr(persistence.error);
      log.info("invited sync provider saved");
      return storageOk(ProviderSaveOutcome.Saved);
    } finally {
      outcome.free();
    }
  }

  async ensureProviderSaved(): Promise<
    Result<ProviderSaveOutcome, StorageOperationFailure>
  > {
    const state = this.state;
    const scope = await this.providerStoreIdForSave();
    if (scope.isErr()) return storageErr(scope.error);
    const target: ProviderSaveTarget = {
      snapshot: {
        providers: $state.snapshot(state.providers),
        activeVaultStoreId:
          state.activeVault.kind === ActiveVaultKind.Open
            ? activeVaultScope(state.activeVault.storeId)
            : unselectedVaultScope(),
      },
      providerStoreId: scope.value,
      duplicates: DuplicateHandling.of(
        state.addProviderOpen ||
          (state.isAuthenticated &&
            state.loginSetup.kind === LoginSetupKind.Active),
      ),
    };
    const outcome = apply_provider_save_policy(this.saveRequest(target));
    try {
      const admitted = this.savedOutcome(outcome);
      if (admitted.isErr()) return storageErr(admitted.error);
      const persistenceOptions: ProviderPersistenceOptions = {
        replace: false,
        providers: outcome.snapshot.providers,
      };
      const persistence = await state.persistProviders(persistenceOptions);
      if (persistence.isErr()) {
        return storageErr(persistence.error);
      }
      state.stageProviderDraft(outcome.draft);
      state.clearLoginSetup();
      state.loginRequiresExistingVault = false;
      state.addProviderOpen = false;
      state.applyActiveProviderCredentials();
      log.info("sync provider saved");
      return storageOk(ProviderSaveOutcome.Saved);
    } finally {
      outcome.free();
    }
  }
}
