import { VaultState } from "$lib/vault.svelte";
import { ActiveVaultKind } from "$lib/vault/state/provider.svelte";
import { EnrollmentEntryKind } from "$lib/vault/state/session.svelte";
import { isoTimestamp } from "$lib/nook";
import { createLogger } from "$lib/log";
export enum SharedStorageTargetKind {
  NotBound = "not-bound",
  Bound = "bound",
}

export type SharedStorageTarget =
  | { kind: SharedStorageTargetKind.NotBound }
  | { kind: SharedStorageTargetKind.Bound; storageTargetId: string };
enum CatalogVaultLabelKind {
  Missing = "missing",
  Present = "present",
}

type CatalogVaultLabel =
  | { kind: CatalogVaultLabelKind.Missing }
  | { kind: CatalogVaultLabelKind.Present; label: string };
import {
  JoinEnrollmentState,
  NookEnrollmentIssueInput,
  NookStringValue,
  NookValueState,
  OnboardingType,
  decryptEnrollmentPayload,
  enrollmentProviderForArchitecture,
  encryptEnrollmentPayload,
  hasActiveLocalVault,
  setLocalVaultLabel,
  type NookEnrollmentProvider,
} from "$app-wasm";
import {
  bindGoogleDriveSharedFolder,
  GITHUB_PROVIDER_TYPE,
  OAUTH_FILE_PROVIDER_TYPE,
  type OAuthFilePreset,
  type StorageProvider,
} from "$lib/auth-providers";
import {
  GoogleOAuthPrompt,
  isGoogleOAuthConfigured,
  oauthTokensToConfig,
  requestGoogleDriveSharedAccess,
} from "$lib/google-oauth";
import {
  acceptICloudSharedVault,
  oauthTokensToICloudConfig,
  requestICloudWebAuthToken,
} from "$lib/icloud-oauth";
import {
  prepareSharedStorageGrant,
  providerOnboardingType,
  providerOauthPresetForProvider,
  type SharedStorageGrantOutcome,
} from "$lib/vault-architecture";
import {
  isSentinelPasswordUnlockForbiddenError,
  isSentinelVault,
} from "$lib/vault/sentinel-unlock";
import {
  intoWasmStringValue,
  requireWasmStringValue,
} from "$lib/wasm-string-value";

const log = createLogger("vault-password");

type E2ePasswordManager = {
  addVaultPasswordForE2e?: (label: string, password: string) => Promise<void>;
  updateVaultPasswordEntryForE2e?: (
    entryId: string,
    password: string,
  ) => Promise<void>;
};

export async function addVaultPassword(
  state: VaultState,
  label: string,
  password: string,
): Promise<void> {
  if (!state.hasManager) {
    state.passwordError = "Vault engine is not available.";
    return;
  }
  if (!state.isAuthenticated) {
    state.passwordError = "Unlock the vault before adding a password.";
    return;
  }
  const hadPasswords = state.passwordEntries.length > 0;
  state.passwordError = "";
  state.isPasswordBusy = true;
  try {
    const manager = state.requireManager();
    await state.enqueueStorage(() => {
      const trimmedLabel = label.trim();
      const e2eManager = manager as typeof manager & E2ePasswordManager;
      if (
        state.runtimeConfig.e2eExposeVault &&
        e2eManager.addVaultPasswordForE2e
      ) {
        return e2eManager.addVaultPasswordForE2e(trimmedLabel, password);
      }
      return manager.addVaultPassword(trimmedLabel, password);
    });
    await state.refreshPasswordEntriesList();
    log.info("vault password added", { hadPasswords, label: label.trim() });
    state.showSuccess(
      hadPasswords
        ? state.t("toasts.password_added_rotate")
        : state.t("toasts.password_set"),
    );
    await state.hydrateMultiDeviceState();
    await state.runFanOutSyncAfterLocalSave();
  } catch (e: unknown) {
    state.passwordError =
      e instanceof Error ? e.message : "Failed to add vault password.";
    throw e;
  } finally {
    state.isPasswordBusy = false;
  }
}

export async function updateVaultPasswordEntry(
  state: VaultState,
  entryId: string,
  password: string,
): Promise<void> {
  if (!state.hasManager) {
    state.passwordError = "Vault engine is not available.";
    return;
  }
  state.passwordError = "";
  state.isPasswordBusy = true;
  try {
    const manager = state.requireManager();
    await state.enqueueStorage(() => {
      const e2eManager = manager as typeof manager & E2ePasswordManager;
      if (
        state.runtimeConfig.e2eExposeVault &&
        e2eManager.updateVaultPasswordEntryForE2e
      ) {
        return e2eManager.updateVaultPasswordEntryForE2e(entryId, password);
      }
      return manager.updateVaultPasswordEntry(entryId, password);
    });
    await state.refreshPasswordEntriesList();
    state.showSuccess(state.t("toasts.password_updated"));
    await state.runFanOutSyncAfterLocalSave();
  } catch (e: unknown) {
    state.passwordError =
      e instanceof Error ? e.message : "Failed to update vault password.";
    throw e;
  } finally {
    state.isPasswordBusy = false;
  }
}

export async function removeVaultPasswordEntry(
  state: VaultState,
  entryId: string,
): Promise<void> {
  if (!state.hasManager) return;
  state.passwordError = "";
  state.isPasswordBusy = true;
  try {
    await state.enqueueStorage(() =>
      state.requireManager().removeVaultPasswordEntry(entryId),
    );
    await state.refreshPasswordEntriesList();
    if (
      state.activeEnrollmentEntry.kind === EnrollmentEntryKind.Active &&
      state.activeEnrollmentEntry.entryId === entryId
    ) {
      state.enrollmentCode = "";
      state.clearActiveEnrollmentEntry();
    }
    state.showSuccess(state.t("toasts.password_removed"));
    await state.runFanOutSyncAfterLocalSave();
  } catch (e: unknown) {
    state.passwordError =
      e instanceof Error ? e.message : "Failed to remove vault password.";
    throw e;
  } finally {
    state.isPasswordBusy = false;
  }
}

export async function unlockWithPassword(
  state: VaultState,
  entryId: string,
  password: string,
): Promise<void> {
  if (!state.hasManager) {
    state.errorMsg = state.t("errors.engine_unavailable");
    return;
  }
  if (state.isVerifying) return;
  if (isSentinelVault(state)) {
    state.errorMsg = state.t("architecture_modes.sentinel_password_forbidden");
    state.sentinelCeremonyPrompt = true;
    return;
  }
  if (!state.hasRemoteCredentials()) {
    state.errorMsg =
      state.storageMode === "oauth-file"
        ? state.t("errors.google_sign_in_required")
        : state.t("errors.github_credentials_required");
    return;
  }
  await state.ensureOAuthTokensFresh();
  if (!entryId.trim()) {
    state.errorMsg = state.t("errors.vault_password_required");
    return;
  }
  state.errorMsg = "";
  state.dismissSuccess();
  state.isVerifying = true;
  try {
    const page = await state.enqueueStorage(() =>
      state
        .requireManager()
        .connectWithPassword(
          ...state.wasmStorageArgs(),
          entryId,
          password,
          state.secretPageSize,
        ),
    );
    state.applyConnectedSecretPage(page, "");
    if (state.deviceProtectionReady) {
      await state.ensureProviderSaved();
      await state.loadProviders();
    }
    await state.refreshPasswordEntriesList();
    if (state.deviceProtectionReady) {
      void state.hydrateMultiDeviceState();
    }
    state.markVaultUnlocked();
    log.info("vault unlocked with password", {
      mode: state.storageMode,
      secrets: state.secretTotal,
      entryId,
    });
    state.joinEnrollmentPrompt = JoinEnrollmentState.None;
    state.loginPasswordPrompt = false;
    state.showSuccess(state.t("toasts.vault_unlocked"));
    state.startIdleSessionTracking();
    if (state.deviceProtectionReady) {
      state.startVaultSync();
    }
  } catch (e: unknown) {
    state.isAuthenticated = false;
    const message =
      e instanceof Error ? e.message : "Failed to unlock with password.";
    log.warn("vault password unlock failed", { error: message });
    if (isSentinelPasswordUnlockForbiddenError(e)) {
      state.errorMsg = state.t(
        "architecture_modes.sentinel_password_forbidden",
      );
      state.sentinelCeremonyPrompt = true;
      return;
    }
    state.errorMsg = message;
  } finally {
    state.isVerifying = false;
  }
}

export function clearEnrollmentCode(state: VaultState) {
  state.enrollmentCode = "";
  state.clearActiveEnrollmentEntry();
}

enum SavedEnrollmentProviderKind {
  Local = "local",
  Remote = "remote",
}

type SavedEnrollmentProvider =
  | { kind: SavedEnrollmentProviderKind.Local }
  | { kind: SavedEnrollmentProviderKind.Remote; provider: StorageProvider };

function applySavedEnrollmentProvider(
  state: VaultState,
  selection: SavedEnrollmentProvider,
) {
  if (
    selection.kind === SavedEnrollmentProviderKind.Local ||
    selection.provider.type === "local"
  ) {
    state.storageMode = "local";
    state.activateLoginSetup("local");
    return;
  }

  const { provider } = selection;
  state.storageMode = provider.type;
  state.clearLoginSetup();
  if (provider.type === "github") {
    state.githubPat = provider.githubPat ?? "";
    state.githubRepo = provider.githubRepo ?? "";
    state.clearOauthFile();
    state.clearLocalFolder();
    return;
  }
  if (provider.type === "oauth-file") {
    if (!provider.oauthFile) {
      throw new Error(
        "OAuth enrollment provider is missing its configuration.",
      );
    }
    state.configureOauthFile(provider.oauthFile);
    state.githubPat = "";
    state.githubRepo = provider.oauthFile?.fileName ?? state.githubRepo;
    state.clearLocalFolder();
    return;
  }

  if (!provider.localFolder) {
    throw new Error(
      "Local-folder enrollment provider is missing its configuration.",
    );
  }
  state.configureLocalFolder(provider.localFolder);
  state.githubPat = "";
  state.clearOauthFile();
}

export enum SharedGrantProviderKind {
  Existing = "existing",
  AuthorizationRequired = "authorization-required",
}

export type SharedGrantProvider =
  | { kind: SharedGrantProviderKind.Existing; provider: StorageProvider }
  | { kind: SharedGrantProviderKind.AuthorizationRequired };

export function findSharedGrantProvider(
  providers: StorageProvider[],
  preset: string,
  target: SharedStorageTarget,
): SharedGrantProvider {
  const withToken = providers.filter(
    (provider) =>
      provider.type === "oauth-file" &&
      provider.oauthFile?.preset === preset &&
      Boolean(provider.oauthFile.accessToken?.trim()),
  );
  if (target.kind === SharedStorageTargetKind.Bound) {
    const provider = withToken.find(
      (provider) =>
        provider.oauthFile?.folderId === target.storageTargetId ||
        provider.oauthFile?.iCloudShareTarget === target.storageTargetId,
    );
    return provider
      ? { kind: SharedGrantProviderKind.Existing, provider }
      : { kind: SharedGrantProviderKind.AuthorizationRequired };
  }
  const provider = withToken[0];
  return provider
    ? { kind: SharedGrantProviderKind.Existing, provider }
    : { kind: SharedGrantProviderKind.AuthorizationRequired };
}

export function shouldFlushSharedDriveGrant(
  grant: SharedStorageGrantOutcome,
  accessToken?: string,
): boolean {
  return grant.kind !== "unsupported" && Boolean(accessToken?.trim());
}

function enrollmentSharedStorageTarget(
  value: NookStringValue,
): SharedStorageTarget {
  try {
    return value.state === NookValueState.Value
      ? {
          kind: SharedStorageTargetKind.Bound,
          storageTargetId: value.string.trim(),
        }
      : { kind: SharedStorageTargetKind.NotBound };
  } finally {
    value.free();
  }
}

function enrollmentOauthOptionalFields(provider: NookEnrollmentProvider): {
  refreshToken?: string;
  expiresAt?: string;
  fileId?: string;
  fileName?: string;
  accountEmail?: string;
} {
  const refreshToken = provider.oauthRefreshToken;
  const expiresAt = provider.oauthExpiresAt;
  const fileId = provider.oauthFileId;
  const fileName = provider.oauthFileName;
  const accountEmail = provider.oauthAccountEmail;
  try {
    return {
      ...(refreshToken.state === NookValueState.Value
        ? { refreshToken: refreshToken.string }
        : {}),
      ...(expiresAt.state === NookValueState.Value
        ? { expiresAt: expiresAt.string }
        : {}),
      ...(fileId.state === NookValueState.Value
        ? { fileId: fileId.string }
        : {}),
      ...(fileName.state === NookValueState.Value
        ? { fileName: fileName.string }
        : {}),
      ...(accountEmail.state === NookValueState.Value
        ? { accountEmail: accountEmail.string }
        : {}),
    };
  } finally {
    refreshToken.free();
    expiresAt.free();
    fileId.free();
    fileName.free();
    accountEmail.free();
  }
}

async function localVaultHasPasswordEntries(
  state: VaultState,
): Promise<boolean> {
  if (!state.hasManager) return false;
  if (!state.localVaultPresent && !(await hasActiveLocalVault())) return false;
  try {
    const entries = await state.enqueueStorage(() =>
      state.requireManager().fetchVaultPasswordEntries("local", "", ""),
    );
    return entries.length > 0;
  } catch {
    return false;
  }
}

export async function connectWithEnrollmentCode(
  state: VaultState,
  code: string,
  password = "",
): Promise<void> {
  if (!state.hasManager) {
    state.errorMsg = state.t("errors.engine_unavailable");
    return;
  }
  state.errorMsg = "";
  state.dismissSuccess();
  state.isVerifying = true;
  state.isPasswordBusy = true;
  try {
    const payload = decryptEnrollmentPayload(code, password);
    const enrollmentProvider = payload.provider;
    const entryId = payload.entryId.trim();
    const unlockPassword = password.trim();
    if (!entryId) {
      throw new Error("Enrollment code is missing a vault password entry id.");
    }
    if (!unlockPassword) {
      throw new Error("Enter the vault password for state onboarding QR.");
    }

    let enrollmentStorageArgs: [string, string, string];
    if (enrollmentProvider.type === GITHUB_PROVIDER_TYPE) {
      const githubPat = requireWasmStringValue(enrollmentProvider.githubPat);
      const githubRepo = requireWasmStringValue(enrollmentProvider.githubRepo);
      state.storageMode = "github";
      state.githubPat = githubPat;
      state.githubRepo = githubRepo;
      state.activateLoginSetup("github");
      enrollmentStorageArgs = ["github", githubPat, githubRepo];
    } else if (payload.onboardingType === OnboardingType.SharedProviderGrant) {
      const preset = requireWasmStringValue(
        enrollmentProvider.oauthPreset,
      ) as OAuthFilePreset;
      const storageTarget = enrollmentSharedStorageTarget(
        enrollmentProvider.sharedStorageTargetId,
      );
      await state.loadProviders();
      const providerSelection = findSharedGrantProvider(
        state.providers,
        preset,
        storageTarget,
      );
      let sharedProvider = providerSelection;
      let sharedProviderNeedsSave = false;
      if (
        sharedProvider.kind === SharedGrantProviderKind.AuthorizationRequired &&
        preset === "google-drive"
      ) {
        if (!isGoogleOAuthConfigured()) {
          throw new Error(state.t("provider_setup.google_oauth_unconfigured"));
        }
        const tokens = await requestGoogleDriveSharedAccess({
          prompt: GoogleOAuthPrompt.Consent,
        });
        const oauthFile = oauthTokensToConfig(tokens, {
          preset: "google-drive",
          accessToken: tokens.accessToken,
          ...(storageTarget.kind === SharedStorageTargetKind.Bound
            ? { folderId: storageTarget.storageTargetId }
            : {}),
          fileName: "nook-events",
          driveMode: "shared",
          iCloudMode: "private",
        });
        sharedProvider = {
          kind: SharedGrantProviderKind.Existing,
          provider: {
            id: "enrollment-shared-oauth",
            type: "oauth-file",
            label: "Shared Google Drive",
            oauthFile,
            createdAt: isoTimestamp(),
          },
        };
        sharedProviderNeedsSave = true;
      }
      if (preset === "icloud") {
        if (storageTarget.kind === SharedStorageTargetKind.NotBound) {
          throw new Error(
            state.t("provider_setup.icloud_shared_target_required"),
          );
        }
        const existingProvider =
          sharedProvider.kind === SharedGrantProviderKind.Existing
            ? sharedProvider.provider
            : false;
        const existingToken = existingProvider
          ? existingProvider.oauthFile?.accessToken?.trim()
          : false;
        const existingAccountName = existingProvider
          ? existingProvider.oauthFile?.accountEmail
          : false;
        const tokens = existingToken
          ? {
              accessToken: existingToken,
              ...(existingAccountName
                ? { accountName: existingAccountName }
                : {}),
            }
          : await requestICloudWebAuthToken();
        const accepted = await acceptICloudSharedVault(
          storageTarget.storageTargetId,
        );
        const provider = {
          id: existingProvider
            ? existingProvider.id
            : "enrollment-shared-icloud",
          type: "oauth-file" as const,
          label: existingProvider
            ? existingProvider.label
            : state.t("provider_picker.icloud"),
          oauthFile: oauthTokensToICloudConfig(tokens, {
            ...(existingProvider && existingProvider.oauthFile
              ? existingProvider.oauthFile
              : {
                  preset: "icloud",
                  accessToken: tokens.accessToken,
                  driveMode: "private",
                  iCloudMode: "shared",
                }),
            iCloudMode: "shared",
            iCloudShareTarget: accepted.storageTargetId,
            fileName:
              existingProvider && existingProvider.oauthFile?.fileName
                ? existingProvider.oauthFile.fileName
                : "nook-events",
          }),
          createdAt: existingProvider
            ? existingProvider.createdAt
            : isoTimestamp(),
        };
        sharedProvider = {
          kind: SharedGrantProviderKind.Existing,
          provider,
        };
        sharedProviderNeedsSave = provider.id === "enrollment-shared-icloud";
      }
      if (
        sharedProvider.kind === SharedGrantProviderKind.AuthorizationRequired
      ) {
        throw new Error(
          "Shared-provider enrollment requires this browser to have matching provider access before connecting.",
        );
      }
      let provider = sharedProvider.provider;
      if (
        storageTarget.kind === SharedStorageTargetKind.Bound &&
        preset === "google-drive" &&
        provider.oauthFile &&
        !provider.oauthFile.folderId
      ) {
        provider = {
          ...provider,
          oauthFile: {
            ...provider.oauthFile,
            folderId: storageTarget.storageTargetId,
          },
        };
      }
      applySavedEnrollmentProvider(state, {
        kind: SavedEnrollmentProviderKind.Remote,
        provider,
      });
      if (sharedProviderNeedsSave) {
        state.activateLoginSetup("oauth-file");
      }
      enrollmentStorageArgs = state.providerWasmArgs(provider);
    } else if (enrollmentProvider.type === OAUTH_FILE_PROVIDER_TYPE) {
      const optionalOauthFields =
        enrollmentOauthOptionalFields(enrollmentProvider);
      const oauthProvider: StorageProvider = {
        id: "enrollment-oauth",
        type: "oauth-file",
        label: "Enrollment OAuth provider",
        oauthFile: {
          preset: requireWasmStringValue(
            enrollmentProvider.oauthPreset,
          ) as OAuthFilePreset,
          accessToken: requireWasmStringValue(
            enrollmentProvider.oauthAccessToken,
          ),
          ...optionalOauthFields,
          driveMode: "private",
          iCloudMode: "private",
        },
        createdAt: isoTimestamp(),
      };
      state.storageMode = "oauth-file";
      state.activateLoginSetup("oauth-file");
      const oauthFile = oauthProvider.oauthFile;
      if (!oauthFile) {
        throw new Error("Enrollment OAuth provider configuration is required");
      }
      state.configureOauthFile(oauthFile);
      state.githubPat = "";
      state.githubRepo = oauthProvider.oauthFile?.fileName ?? state.githubRepo;
      state.clearLocalFolder();
      enrollmentStorageArgs = state.providerWasmArgs(oauthProvider);
    } else {
      await state.loadProviders();
      const hasLocalPasswordEntries = await localVaultHasPasswordEntries(state);
      const candidate = hasLocalPasswordEntries
        ? false
        : (state.syncProviders[0] ??
          state.providers.find((provider) => provider.type !== "local"));
      const selection: SavedEnrollmentProvider =
        candidate && candidate.type !== "local"
          ? {
              kind: SavedEnrollmentProviderKind.Remote,
              provider: candidate,
            }
          : { kind: SavedEnrollmentProviderKind.Local };
      applySavedEnrollmentProvider(state, selection);
      enrollmentStorageArgs =
        selection.kind === SavedEnrollmentProviderKind.Remote
          ? state.providerWasmArgs(selection.provider)
          : ["local", "", ""];
    }

    await state.initDeviceIdentity();

    const page = await state.enqueueStorage(() =>
      state
        .requireManager()
        .connectWithPassword(
          ...enrollmentStorageArgs,
          entryId,
          unlockPassword,
          state.secretPageSize,
        ),
    );
    state.applyConnectedSecretPage(page, "");
    const vaultName = payload.vaultName?.trim();
    const vaultStoreId = (
      await state.enqueueStorage(() => state.requireManager().vaultStoreId)
    ).trim();
    if (vaultName && vaultStoreId) {
      await state.enqueueStorage(() =>
        state.requireManager().setVaultName(vaultName),
      );
      await setLocalVaultLabel(vaultStoreId, vaultName);
    }
    // Password enrollment downloads an existing vault into this browser. Make
    // that inherited store the active local catalog entry before saving the
    // transferred provider credentials.
    await state.refreshLocalVaultCatalog();
    await state.syncActiveVaultStoreIdToAuth();
    await state.ensureProviderSaved();
    await state.loadProviders();
    await state.refreshPasswordEntriesList();
    void state.hydrateMultiDeviceState();
    state.markVaultUnlocked();
    state.joinEnrollmentPrompt = JoinEnrollmentState.None;
    state.loginEnrollmentCode = "";
    state.prefillEnrollmentCode = "";
    state.enrollmentFromUrlPending = false;
    state.showSuccess(state.t("toasts.device_enrolled"));
    state.startIdleSessionTracking();
    state.startVaultSync();
  } catch (e: unknown) {
    state.isAuthenticated = false;
    state.errorMsg =
      e instanceof Error
        ? e.message
        : "Failed to enroll with the provided code.";
  } finally {
    state.isPasswordBusy = false;
    state.isVerifying = false;
  }
}

export async function issueEnrollmentCode(
  state: VaultState,
  entryId: string,
  password: string,
  providerId = state.syncProviders[0]?.id ?? "",
): Promise<string> {
  if (!state.hasManager) {
    throw new Error("Vault engine is not available.");
  }
  // Password verification borrows the wasm manager synchronously (`&self`).
  // `isPasswordBusy` makes the periodic sync tick skip, but we still have to
  // wait for any *already in-flight* `&mut self` storage future to release its
  // borrow before verify runs, or wasm-bindgen's borrow detector trips.
  state.isPasswordBusy = true;
  log.info("enrollment code issue started", { providerId });
  try {
    // Wait for the queued wasm op to settle. We deliberately do NOT
    // `resetStorageChain()` on timeout: abandoning an in-flight `&mut self`
    // future leaves its IndexedDB transaction dangling, which surfaces later as
    // "database is not open" and poisons subsequent borrows. Surface a
    // retriable error instead.
    try {
      await state.raceStorageTimeout(
        state.waitForStorageChain(),
        "Vault storage",
      );
    } catch {
      throw new Error("Vault storage is busy. Try again.");
    }
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The target entry is already loaded in memory after `addVaultPassword`.
    // Only hit storage when it is genuinely missing — a redundant refresh can
    // otherwise queue behind (or race) background sync work and stall
    // enrollment on the shared storage chain.
    if (!state.passwordEntries.some((entry) => entry.id === entryId)) {
      const refreshed = await state.refreshPasswordEntriesList();
      if (!refreshed || state.passwordEntries.length === 0) {
        throw new Error(
          "Add a backup vault password first; enrollment codes wrap that password.",
        );
      }
      if (!state.passwordEntries.some((entry) => entry.id === entryId)) {
        throw new Error(
          "Password entry not found. Wait for sync to finish and try again.",
        );
      }
    }
    // `verifyVaultPassword` returns false on a wrong password but can also
    // throw if the underlying age decryptor rejects — treat both as "wrong
    // password" so the UI message stays predictable.
    let verified: boolean;
    try {
      verified = await state.enqueueStorage(async () => {
        await Promise.resolve();
        return state.requireManager().verifyVaultPassword(entryId, password);
      });
    } catch {
      verified = false;
    }
    if (!verified) {
      throw new Error("Password does not match the vault.");
    }
    log.info("enrollment password verified", { providerId });
    const selectedProvider = state.providers.find((p) => p.id === providerId);
    if (!selectedProvider) {
      throw new Error("Choose a sync provider.");
    }
    if (selectedProvider.type === "local") {
      throw new Error(
        "Choose a cloud sync provider — local vault is already on state device.",
      );
    }
    if (selectedProvider.type === "local-folder") {
      throw new Error(
        "Local backup folders cannot be embedded in enrollment codes. Choose a cloud provider or have the other browser choose the same folder.",
      );
    }
    const githubPat = selectedProvider.githubPat?.trim() ?? "";
    const githubRepo = selectedProvider.githubRepo?.trim() ?? "";
    const sharedJoinerIdentity = state.sharedJoinerIdentity.trim();
    const usesSharedProviderGrant =
      providerOnboardingType(selectedProvider, state.vaultArchitecture) ===
      OnboardingType.SharedProviderGrant;
    const usesSharedICloud =
      usesSharedProviderGrant &&
      selectedProvider.oauthFile?.preset === "icloud";
    log.info("enrollment provider selected", {
      providerId,
      providerType: selectedProvider.type,
      usesSharedProviderGrant,
    });
    if (usesSharedProviderGrant && !usesSharedICloud && !sharedJoinerIdentity) {
      throw new Error(
        state.t("errors.validation.shared_joiner_identity_required"),
      );
    }
    if (
      selectedProvider.type === "github" &&
      !usesSharedProviderGrant &&
      (!githubPat || !githubRepo)
    ) {
      throw new Error(
        "GitHub sync provider is missing credentials. Reconnect in Settings and try again.",
      );
    }
    state.sharedGrantInstructions = "";
    let sharedStorageTarget: SharedStorageTarget = {
      kind: SharedStorageTargetKind.NotBound,
    };
    let enrollmentProviderRow = selectedProvider;
    if (usesSharedProviderGrant) {
      if (usesSharedICloud) {
        const targetId = selectedProvider.oauthFile?.iCloudShareTarget?.trim();
        if (!targetId) {
          throw new Error(
            state.t("provider_setup.icloud_shared_target_required"),
          );
        }
        sharedStorageTarget = {
          kind: SharedStorageTargetKind.Bound,
          storageTargetId: targetId,
        };
      } else {
        const accessToken = selectedProvider.oauthFile?.accessToken?.trim();
        log.info("shared enrollment grant started", { providerId });
        const storageTargetHint =
          selectedProvider.oauthFile?.fileName ?? selectedProvider.githubRepo;
        const grant = await prepareSharedStorageGrant({
          providerType: selectedProvider.type,
          oauthPreset: providerOauthPresetForProvider(selectedProvider),
          joinerIdentityKind: "email",
          joinerIdentity: sharedJoinerIdentity,
          ...(storageTargetHint ? { storageTargetHint } : {}),
          storageTargetId: selectedProvider.oauthFile?.folderId,
          accessToken,
        });
        log.info("shared enrollment grant prepared", {
          providerId,
          grantKind: grant.kind,
        });
        if (grant.kind === "unsupported") {
          throw new Error(state.t(grant.reasonKey));
        }
        if (grant.kind === "granted") {
          sharedStorageTarget = {
            kind: SharedStorageTargetKind.Bound,
            storageTargetId: grant.storageTargetId,
          };
          state.sharedGrantInstructions = state.t(grant.note, {
            email: sharedJoinerIdentity,
            folder: grant.storageTargetName ?? grant.storageTargetId,
          });
        } else if (grant.kind === "manual-grant-required") {
          if (grant.storageTargetId) {
            sharedStorageTarget = {
              kind: SharedStorageTargetKind.Bound,
              storageTargetId: grant.storageTargetId,
            };
          }
          state.sharedGrantInstructions = state.t(grant.instructionsKey, {
            email: grant.joinerIdentity,
            folder:
              grant.storageTargetName ??
              grant.storageTargetId ??
              "shared folder",
          });
        }
        if (
          sharedStorageTarget.kind === SharedStorageTargetKind.Bound &&
          selectedProvider.oauthFile
        ) {
          const updatedOauth = bindGoogleDriveSharedFolder(
            selectedProvider.oauthFile,
            sharedStorageTarget.storageTargetId,
          );
          enrollmentProviderRow = {
            ...selectedProvider,
            oauthFile: updatedOauth,
          };
          state.configureOauthFile(updatedOauth);
          state.providers = state.providers.map((row) =>
            row.id === selectedProvider.id ? enrollmentProviderRow : row,
          );
          await state.persistProviders();

          if (shouldFlushSharedDriveGrant(grant, accessToken)) {
            // The target is not usable until it contains the current vault
            // event log, even when collaborator access needs manual completion.
            // Await Rust/WASM fan-out before issuing the enrollment code.
            const targetArgs = state.providerWasmArgs(enrollmentProviderRow);
            await state.enqueueStorage(() =>
              state.requireManager().flushEventOutboxForProvider(...targetArgs),
            );
          }
        }
      }
      if (usesSharedICloud) {
        const targetArgs = state.providerWasmArgs(enrollmentProviderRow);
        await state.enqueueStorage(() =>
          state.requireManager().flushEventOutboxForProvider(...targetArgs),
        );
      }
    }
    const provider: NookEnrollmentProvider = enrollmentProviderForArchitecture(
      enrollmentProviderRow,
      state.vaultArchitecture,
      usesSharedProviderGrant && !usesSharedICloud
        ? intoWasmStringValue(sharedJoinerIdentity)
        : NookStringValue.unavailable(),
      sharedStorageTarget.kind === SharedStorageTargetKind.Bound
        ? intoWasmStringValue(sharedStorageTarget.storageTargetId)
        : NookStringValue.unavailable(),
    );
    log.info("enrollment provider payload prepared", { providerId });
    const managerVaultName = await state.enqueueStorage(
      () => state.requireManager().vaultName,
    );
    let catalogVaultName: CatalogVaultLabel = {
      kind: CatalogVaultLabelKind.Missing,
    };
    if (state.activeVault.kind === ActiveVaultKind.Open) {
      for (const entry of state.localVaults) {
        const label = entry.label.trim();
        if (entry.storeId === state.activeVault.storeId && label) {
          catalogVaultName = {
            kind: CatalogVaultLabelKind.Present,
            label,
          };
          break;
        }
      }
    }
    // The local catalog is the durable browser-level label index. Keep it as
    // the enrollment fallback while older/synced projections without
    // `vault_name` are still supported.
    const vaultName = (() => {
      try {
        return managerVaultName.state === NookValueState.Value
          ? NookStringValue.value(managerVaultName.string)
          : catalogVaultName.kind === CatalogVaultLabelKind.Present
            ? NookStringValue.value(catalogVaultName.label)
            : NookStringValue.unavailable();
      } finally {
        managerVaultName.free();
      }
    })();
    const payload = (() => {
      try {
        log.info("enrollment vault name loaded", {
          providerId,
          hasVaultName: vaultName.state === NookValueState.Value,
        });
        return new NookEnrollmentIssueInput(
          provider,
          vaultName,
          entryId,
          isoTimestamp(),
        );
      } finally {
        vaultName.free();
      }
    })();
    const selectedPassword = state.passwordEntries.find(
      (e) => e.id === entryId,
    );
    const code = encryptEnrollmentPayload(
      payload,
      password,
      selectedPassword?.label ?? "",
    );
    state.enrollmentCode = code;
    state.beginEnrollmentEntry(entryId);
    log.info("enrollment code issued", { providerId });
    return code;
  } finally {
    state.isPasswordBusy = false;
  }
}
