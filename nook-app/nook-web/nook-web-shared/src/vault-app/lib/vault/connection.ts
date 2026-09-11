import {
  ProviderSyncActions,
  ProviderSyncOutcome,
} from "$lib/vault/provider-sync.svelte";
import { NativeVaultStorageFailure } from "$lib/runtime/storage-failure";
import { err as storageErr, ok as storageOk } from "neverthrow";

import { VaultRecoveryErrorKind } from "$app-wasm";
import type { NookStorageConnectArgs } from "$app-wasm";
import { I18N_KEYS } from "../../../generated/i18n-keys";
import type { VaultState } from "$lib/vault.svelte";
import { VaultAccessStatus, type NookSecretRecord } from "$lib/nook";
import { browserLogRuntime } from "$lib/runtime/log";
import {
  JoinEnrollmentState,
  ProviderSyncFailureHandling,
  ProviderSyncFreshness,
  ProviderSyncVisibility,
  RemoteVaultRecoveryState,
  VaultConnectGateDecision,
  VaultConnectProbeDecision,
} from "$app-wasm";
import { SentinelUnlockActions } from "$lib/vault/sentinel-unlock";
import { LoginSetupKind } from "$lib/vault/state/provider.svelte";
import { VaultDiscoveryTimeout } from "$lib/vault/vault-discovery-timeout";

enum StorageConnectionKind {
  Configured = "configured",
  RemoteRecovery = "remote-recovery",
}

type StorageConnection =
  | { kind: StorageConnectionKind.Configured }
  | {
      kind: StorageConnectionKind.RemoteRecovery;
      args: NookStorageConnectArgs;
    };

const log = browserLogRuntime.createLogger("connect");

type SecretRecordCollection = ReadonlyArray<NookSecretRecord>;

/** Owns browser orchestration for one connection context. */
export class VaultConnectionActions {
  constructor(private readonly state: VaultState) {}

  private freeSecretRecords(records: SecretRecordCollection) {
    for (const record of records) record.free();
  }

  async loadDb() {
    const state = this.state;
    if (state.isInitializing) {
      state.errorMsg = state.t(I18N_KEYS.ErrorsEngineLoading);
      return;
    }

    if (!state.hasManager) {
      state.errorMsg = state.t(I18N_KEYS.ErrorsEngineUnavailable);
      return;
    }

    if (state.isVerifying) {
      state.errorMsg = state.t(I18N_KEYS.ErrorsConnectionInProgress);
      return;
    }

    state.errorMsg = "";
    state.dismissSuccess();
    state.isVerifying = true;
    try {
      log.info("device identity caller: provider connection");
      const identityInitialization = await state.initDeviceIdentity();
      if (identityInitialization.isErr()) {
        state.errorMsg = state.t(identityInitialization.error.translationKey);
        return;
      }
      const refreshedTokens = await state.ensureOAuthTokensFresh();
      if (refreshedTokens.isErr()) {
        state.errorMsg = state.t(refreshedTokens.error.translationKey);
        return;
      }

      if (
        !state.isAuthenticated &&
        state.loginSetup.kind === LoginSetupKind.Active &&
        state.loginSetup.providerType === "local-folder"
      ) {
        const saved = await state.ensureProviderSaved();
        if (saved.isErr()) {
          state.errorMsg = state.t(saved.error.translationKey);
          return;
        }
        const [provider = state.providers[state.providers.length - 1]] = [
          state.syncProviders[state.syncProviders.length - 1],
        ];
        if (provider?.type === "local-folder") {
          const syncLocalFolderProviderArgs: Parameters<
            ProviderSyncActions["syncLocalFolderProvider"]
          >[0] = { provider };
          const localSync = await new ProviderSyncActions(
            state,
          ).syncLocalFolderProvider(syncLocalFolderProviderArgs);
          if (localSync.isErr()) {
            state.errorMsg = state.t(localSync.error.translationKey);
            return;
          }
        }
      }

      if (!state.isAuthenticated && state.syncProviders.length > 0) {
        const syncProviderRequest: Parameters<
          typeof state.syncProviderById
        >[0] = {
          providerId: state.syncProviders[0]!.id,
          visibility: ProviderSyncVisibility.Quiet,
          failureHandling: ProviderSyncFailureHandling.Capture,
        };
        const providerSync = await state.syncProviderById(syncProviderRequest);
        if (providerSync.isErr()) {
          state.errorMsg = state.t(providerSync.error.translationKey);
          return;
        }
        if (providerSync.value !== ProviderSyncOutcome.Synced) return;
      }

      const assessment = await state.assessVaultConnectStatus();
      if (assessment.isErr()) {
        state.errorMsg = state.t(assessment.error.translationKey);
        return;
      }
      let accessStatus = assessment.value;
      let storageConnection: StorageConnection = {
        kind: StorageConnectionKind.Configured,
      };
      log.debug("loadDb assess");

      // A joiner device keeps a pre-approval projection in the local cache
      // (join row, no auth envelope). Once the join is approved remotely, the
      // local cache is stale and keeps reporting join_pending/needs_enrollment
      // forever. The sync provider remote is authoritative for enrollment
      // state, so re-assess against it and connect there when it is ready.
      const probeDecision = state.clientPolicy.vault_connect_probe_decision(
        accessStatus,
        state.isAuthenticated,
        state.syncProviders.length,
      );
      if (
        probeDecision === VaultConnectProbeDecision.ReassessFirstSyncProvider
      ) {
        const providerArgs = state.providerWasmArgs(state.syncProviders[0]!);
        const remoteStatus = await state.assessVaultConnectStatus(providerArgs);
        log.debug("loadDb provider re-assess");
        if (remoteStatus.isErr()) {
          state.errorMsg = state.t(remoteStatus.error.translationKey);
          return;
        }
        if (remoteStatus.value === VaultAccessStatus.Ready) {
          accessStatus = VaultAccessStatus.Ready;
          storageConnection = {
            kind: StorageConnectionKind.RemoteRecovery,
            args: providerArgs,
          };
        }
      }

      if (
        !state.clientPolicy.remote_recovery_connect_confirmed(
          state.remoteVaultRecoveryState,
        ) &&
        (await state.handleRemoteVaultAssessStatus(accessStatus))
      ) {
        return;
      }

      if (
        state.clientPolicy.vault_connect_password_lookup_required(accessStatus)
      ) {
        const savedProvider1 = await state.ensureProviderSaved();
        if (savedProvider1.isErr()) {
          state.errorMsg = state.t(savedProvider1.error.translationKey);
          return;
        }
        const passwordRefresh1 = await state.refreshPasswordEntriesList();
        if (passwordRefresh1.isErr()) {
          state.errorMsg = state.t(passwordRefresh1.error.translationKey);
          return;
        }
      }
      const gateDecision = state.clientPolicy.vault_connect_gate_decision(
        accessStatus,
        state.passwordEntries.length,
      );
      switch (gateDecision) {
        case VaultConnectGateDecision.PromptForPassword:
          state.loginPasswordPrompt = true;
          state.joinEnrollmentPrompt = JoinEnrollmentState.None;
          return;
        case VaultConnectGateDecision.RequestEnrollment:
          state.joinEnrollmentPrompt = JoinEnrollmentState.NeedsRequest;
          state.startVaultSync();
          return;
        case VaultConnectGateDecision.AwaitJoinApproval:
          state.joinEnrollmentPrompt = JoinEnrollmentState.Pending;
          state.awaitingJoinApproval = true;
          state.startVaultSync();
          return;
        case VaultConnectGateDecision.Connect:
          break;
      }

      const rawRecords = await state.enqueueStorage(async () => {
        const connectArgs =
          storageConnection.kind === StorageConnectionKind.RemoteRecovery
            ? storageConnection.args
            : state.connectStorageArgs();
        const admitted = state.admitManager();
        if (admitted.isErr()) return storageErr(admitted.error);
        const recovery = state.remoteVaultRecoveryState;
        state.remoteVaultRecoveryState = RemoteVaultRecoveryState.None;
        const operation = (async () => {
          try {
            const records =
              recovery === RemoteVaultRecoveryState.ConnectFresh
                ? await admitted.value.connect_fresh(
                    connectArgs.mode,
                    connectArgs.pat,
                    connectArgs.repo,
                  )
                : await admitted.value.connect(
                    connectArgs.mode,
                    connectArgs.pat,
                    connectArgs.repo,
                  );
            return storageOk(records);
          } catch (nativeFailure) {
            return storageErr(new NativeVaultStorageFailure(nativeFailure));
          }
        })();
        // eslint-disable-next-line nook-typed-api/no-raw-object-arguments, nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
        return new VaultDiscoveryTimeout({ timeoutMs: 30_000 }).waitFor({
          operation,
          releaseLateValue: (records) => this.freeSecretRecords(records),
        });
      });
      if (rawRecords.isErr()) {
        state.isAuthenticated = false;
        const surfaced = await new SentinelUnlockActions(
          state,
          // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
        ).surfaceSentinelCeremonyIfNeeded({
          recoveryKind: rawRecords.error.recoveryKind,
        });
        if (!surfaced)
          state.errorMsg = state.t(rawRecords.error.translationKey);
        return;
      }
      this.freeSecretRecords(rawRecords.value);
      const loadSecretPageArgs: Parameters<typeof state.loadSecretPage>[0] = {
        query: "",
        requestedOffset: 0,
      };
      const secretRefresh1 = await state.loadSecretPage(loadSecretPageArgs);
      if (secretRefresh1.isErr()) {
        state.errorMsg = state.t(secretRefresh1.error.translationKey);
        return;
      }
      // Load sync providers before unlocking the UI. Otherwise a fast local
      // edit (especially delete, which used to fire-and-forget fan-out) can run
      // while `syncProviders` is still empty and never push the event remotely.
      const remoteConfiguration = state.syncOAuthRemoteRefFromManager();
      if (remoteConfiguration.isErr()) {
        state.errorMsg = state.t(remoteConfiguration.error.translationKey);
        return;
      }
      const savedProvider2 = await state.ensureProviderSaved();
      if (savedProvider2.isErr()) {
        state.errorMsg = state.t(savedProvider2.error.translationKey);
        return;
      }
      const providerLoadOptions: Parameters<typeof state.loadProviders>[0] = {
        ensureLocalRow: false,
      };
      const loadedProviders1 = await state.loadProviders(providerLoadOptions);
      if (loadedProviders1.isErr()) {
        state.errorMsg = state.t(loadedProviders1.error.translationKey);
        return;
      }
      const promoted = await state.promoteSessionVaultToLocalIfNeeded();
      if (promoted.isErr()) {
        state.errorMsg = state.t(promoted.error.translationKey);
        return;
      }
      const passwordRefresh2 = await state.refreshPasswordEntriesList();
      if (passwordRefresh2.isErr()) {
        state.errorMsg = state.t(passwordRefresh2.error.translationKey);
        return;
      }
      const rosterRefresh1 = await state.hydrateMultiDeviceState();
      if (rosterRefresh1.isErr()) {
        state.errorMsg = state.t(rosterRefresh1.error.translationKey);
        return;
      }
      const unlocked = state.markVaultUnlocked();
      if (unlocked.isErr()) {
        state.errorMsg = state.t(unlocked.error.translationKey);
        return;
      }
      log.info("vault connected");
      if (state.storageMode === "local") {
        state.showSuccess(state.t(I18N_KEYS.ToastsLocalLoaded));
      } else if (state.storageMode === "local-folder") {
        state.showSuccess(state.t(I18N_KEYS.ToastsLocalFolderConnected));
      } else if (state.storageMode === "oauth-file") {
        state.showSuccess(state.t(I18N_KEYS.ToastsGoogleDriveConnected));
      } else {
        state.showSuccess(state.t(I18N_KEYS.ToastsGithubConnected));
      }
    } catch (e) {
      state.isAuthenticated = false;
      const message = e instanceof Error ? e.message : String(e);
      log.warn("loadDb failed" + " " + JSON.stringify(message));
      if (
        await (() => {
          const surfaceSentinelCeremonyIfNeededArgs: Parameters<
            SentinelUnlockActions["surfaceSentinelCeremonyIfNeeded"]
          >[0] = {
            recoveryKind: browserLogRuntime
              .runtimeFailure(e)
              .vaultRecoveryKind(),
          };
          return new SentinelUnlockActions(
            state,
          ).surfaceSentinelCeremonyIfNeeded(
            surfaceSentinelCeremonyIfNeededArgs,
          );
        })()
      ) {
        const architecture = state.refreshVaultArchitectureFromManager();
        if (architecture.isErr()) {
          state.errorMsg = state.t(architecture.error.translationKey);
          return;
        }
        await new SentinelUnlockActions(state).refreshSentinelUnlockStatus();
        return;
      }
      if (
        browserLogRuntime.runtimeFailure(e).vaultRecoveryKind() ===
        VaultRecoveryErrorKind.SentinelCeremonyRequired
      ) {
        state.sentinelCeremonyPrompt = true;
        state.errorMsg = "";
        return;
      }
      state.errorMsg = state.resolveErrorMessage(message);
    } finally {
      if (state.isAuthenticated) {
        const synchronized = await state.syncFromStorage(
          ProviderSyncFreshness.Forced,
        );
        if (synchronized.isErr())
          state.errorMsg = state.t(synchronized.error.translationKey);
        state.startIdleSessionTracking();
        state.startVaultSync();
      }
      state.isVerifying = false;
    }
  }
}
