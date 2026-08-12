import { I18N_KEYS } from "../../../generated/i18n-keys";
import type { VaultState } from "$lib/vault.svelte";
import { VaultAccessStatus, type NookSecretRecord } from "$lib/nook";
import { createLogger, runtimeFailure } from "$lib/runtime/log";
import {
  JoinEnrollmentState,
  ProviderSyncFailureHandling,
  ProviderSyncFreshness,
  ProviderSyncVisibility,
  RemoteVaultRecoveryState,
  VaultConnectGateDecision,
  VaultConnectProbeDecision,
} from "$app-wasm";
import { syncLocalFolderProvider } from "$lib/vault/sync.svelte";
import {
  isSentinelCeremonyRequiredError,
  refreshSentinelUnlockStatus,
  surfaceSentinelCeremonyIfNeeded,
} from "$lib/vault/sentinel-unlock";
import { LoginSetupKind } from "$lib/vault/state/provider.svelte";
import { startVaultDiscoveryTimeout } from "$lib/vault/vault-discovery-timeout";

enum StorageConnectionKind {
  Configured = "configured",
  RemoteRecovery = "remote-recovery",
}

type StorageConnection =
  | { kind: StorageConnectionKind.Configured }
  | {
      kind: StorageConnectionKind.RemoteRecovery;
      args: [string, string, string];
    };

const log = createLogger("connect");

type SecretRecordCollection = ReadonlyArray<NookSecretRecord>;

function freeSecretRecords(records: SecretRecordCollection) {
  for (const record of records) record.free();
}

export async function loadDb(state: VaultState) {
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
    await state.initDeviceIdentity();
    await state.ensureOAuthTokensFresh();

    if (
      !state.isAuthenticated &&
      state.loginSetup.kind === LoginSetupKind.Active &&
      state.loginSetup.providerType === "local-folder"
    ) {
      const saved = await state.ensureProviderSaved();
      if (!saved) return;
      const provider =
        state.syncProviders[state.syncProviders.length - 1] ??
        state.providers[state.providers.length - 1];
      if (provider?.type === "local-folder") {
        const syncLocalFolderProviderArgs: Parameters<
          typeof syncLocalFolderProvider
        >[0] = { state, provider };
        await syncLocalFolderProvider(syncLocalFolderProviderArgs);
      }
    }

    if (!state.isAuthenticated && state.syncProviders.length > 0) {
      const syncProviderRequest: Parameters<typeof state.syncProviderById>[0] =
        {
          providerId: state.syncProviders[0]!.id,
          visibility: ProviderSyncVisibility.Quiet,
          failureHandling: ProviderSyncFailureHandling.Capture,
        };
      await state.syncProviderById(syncProviderRequest);
    }

    let accessStatus = await state.assessVaultConnectStatus();
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
    if (probeDecision === VaultConnectProbeDecision.ReassessFirstSyncProvider) {
      const providerArgs = state.providerWasmArgs(state.syncProviders[0]!);
      const remoteStatus = await state.assessVaultConnectStatus(providerArgs);
      log.debug("loadDb provider re-assess");
      if (remoteStatus === VaultAccessStatus.Ready) {
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
      await state.ensureProviderSaved();
      await state.refreshPasswordEntriesList();
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
      log.debug("loadDb connect");
      const connectPromise =
        state.remoteVaultRecoveryState === RemoteVaultRecoveryState.ConnectFresh
          ? state.requireManager().connect_fresh(...connectArgs)
          : state.requireManager().connect(...connectArgs);
      state.remoteVaultRecoveryState = RemoteVaultRecoveryState.None;
      const startVaultDiscoveryTimeoutArgs: Parameters<
        typeof startVaultDiscoveryTimeout
      >[0] = {
        message: state.t(I18N_KEYS.ToastsErrorTimeout),
        timeoutMs: 30_000,
      };
      const timeout = startVaultDiscoveryTimeout(
        startVaultDiscoveryTimeoutArgs,
      );
      try {
        return (await Promise.race([
          connectPromise,
          timeout.completion,
        ])) as NookSecretRecord[];
      } finally {
        timeout.cancel();
      }
    });
    freeSecretRecords(rawRecords);
    const loadSecretPageArgs: Parameters<typeof state.loadSecretPage>[0] = {
      query: "",
      requestedOffset: 0,
    };
    await state.loadSecretPage(loadSecretPageArgs);
    // Load sync providers before unlocking the UI. Otherwise a fast local
    // edit (especially delete, which used to fire-and-forget fan-out) can run
    // while `syncProviders` is still empty and never push the event remotely.
    state.syncOAuthRemoteRefFromManager();
    await state.ensureProviderSaved();
    const providerLoadOptions: Parameters<typeof state.loadProviders>[0] = {
      ensureLocalRow: false,
    };
    await state.loadProviders(providerLoadOptions);
    await state.promoteSessionVaultToLocalIfNeeded();
    await state.refreshPasswordEntriesList();
    await state.hydrateMultiDeviceState();
    state.markVaultUnlocked();
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
          typeof surfaceSentinelCeremonyIfNeeded
        >[0] = { state, failure: runtimeFailure(e) };
        return surfaceSentinelCeremonyIfNeeded(
          surfaceSentinelCeremonyIfNeededArgs,
        );
      })()
    ) {
      state.refreshVaultArchitectureFromManager();
      await refreshSentinelUnlockStatus(state);
      return;
    }
    if (isSentinelCeremonyRequiredError(runtimeFailure(e))) {
      state.sentinelCeremonyPrompt = true;
      state.errorMsg = "";
      return;
    }
    state.errorMsg = state.resolveErrorMessage(message);
  } finally {
    if (state.isAuthenticated) {
      try {
        await state.syncFromStorage(ProviderSyncFreshness.Forced);
      } catch {
        // Post-unlock sync should not block the login gate.
      }
      state.startIdleSessionTracking();
      state.startVaultSync();
    }
    state.isVerifying = false;
  }
}
