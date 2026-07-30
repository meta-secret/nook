import { VaultState } from "$lib/vault.svelte";
import { ActiveVaultKind } from "$lib/vault/state/provider.svelte";
import { EnrollmentEntryKind } from "$lib/vault/state/session.svelte";
import { isoTimestamp } from "$lib/nook";
import { createLogger } from "$lib/log";
import {
  enrollmentOauthState,
  findSharedGrantProvider,
  SharedGrantProviderKind,
  SharedStorageTargetKind,
  shouldFlushSharedDriveGrant,
  type SharedStorageTarget,
} from "$lib/vault/password-enrollment";
export {
  findSharedGrantProvider,
  SharedGrantProviderKind,
  SharedStorageTargetKind,
  shouldFlushSharedDriveGrant,
  type SharedGrantProvider,
  type SharedStorageTarget,
} from "$lib/vault/password-enrollment";

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
  NookVaultNameState,
  OnboardingType,
  decryptEnrollmentPayload,
  enrollmentICloudSharedProviderForArchitecture,
  enrollmentProviderForArchitecture,
  enrollmentSharedProviderForArchitecture,
  encryptLabeledEnrollmentPayload,
  encryptUnlabeledEnrollmentPayload,
  hasActiveLocalVault,
  setLocalVaultLabel,
} from "$app-wasm";
import {
  bindGoogleDriveSharedFolder,
  configuredOAuthFile,
  defaultOAuthFileConfig,
  GITHUB_PROVIDER_TYPE,
  githubPatValue,
  githubRepositoryValue,
  localFolderProviderConfiguration,
  LocalFolderProviderConfigurationKind,
  oauthAccessToken,
  OAuthAccessTokenKind,
  oauthFileName,
  OAuthFileNameKind,
  oauthProviderConfiguration,
  OAuthProviderConfigurationKind,
  OAUTH_FILE_PROVIDER_TYPE,
  providerPersistenceDefaults,
  storedGoogleDriveFolder,
  storedICloudShareTarget,
  storedOAuthCredential,
  storedOAuthRemoteFileName,
  type OAuthFilePreset,
  type OAuthFileConfig,
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
  ICloudAccountNameKind,
  oauthTokensToICloudConfig,
  requestICloudWebAuthToken,
} from "$lib/icloud-oauth";
import {
  prepareSharedStorageGrant,
  createSharedStorageTarget,
  existingSharedStorageTarget,
  providerOnboardingType,
  providerOauthPresetForProvider,
  sharedStorageGrantAccessToken,
  suggestedSharedStorageTarget,
  unavailableSharedStorageGrantCredential,
} from "$lib/vault-architecture";
import {
  isSentinelPasswordUnlockForbiddenError,
  isSentinelVault,
} from "$lib/vault/sentinel-unlock";

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
    state.githubPat = githubPatValue(provider.githubPat);
    state.githubRepo = githubRepositoryValue(provider.githubRepo);
    state.clearOauthFile();
    state.clearLocalFolder();
    return;
  }
  if (provider.type === "oauth-file") {
    const configuration = oauthProviderConfiguration(provider);
    if (configuration.kind === OAuthProviderConfigurationKind.Missing) {
      throw new Error(
        "OAuth enrollment provider is missing its configuration.",
      );
    }
    state.configureOauthFile(configuration.config);
    state.githubPat = "";
    const fileName = oauthFileName(configuration.config);
    if (fileName.kind === OAuthFileNameKind.Resolved) {
      state.githubRepo = fileName.fileName;
    }
    state.clearLocalFolder();
    return;
  }

  const configuration = localFolderProviderConfiguration(provider);
  if (configuration.kind === LocalFolderProviderConfigurationKind.Missing) {
    throw new Error(
      "Local-folder enrollment provider is missing its configuration.",
    );
  }
  state.configureLocalFolder(configuration.config);
  state.githubPat = "";
  state.clearOauthFile();
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
      const githubPat = enrollmentProvider.githubPat;
      const githubRepo = enrollmentProvider.githubRepo;
      state.storageMode = "github";
      state.githubPat = githubPat;
      state.githubRepo = githubRepo;
      state.activateLoginSetup("github");
      enrollmentStorageArgs = ["github", githubPat, githubRepo];
    } else if (payload.onboardingType === OnboardingType.SharedProviderGrant) {
      const preset = enrollmentProvider.oauthPreset as OAuthFilePreset;
      const storageTarget: SharedStorageTarget = {
        kind: SharedStorageTargetKind.Bound,
        storageTargetId: enrollmentProvider.sharedStorageTargetId,
      };
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
        const initialConfig: OAuthFileConfig = {
          ...defaultOAuthFileConfig("google-drive", "nook-events"),
          folderId: storedGoogleDriveFolder(storageTarget.storageTargetId),
          driveMode: "shared",
        };
        const oauthFile = oauthTokensToConfig(
          tokens,
          configuredOAuthFile(initialConfig),
        );
        sharedProvider = {
          kind: SharedGrantProviderKind.Existing,
          provider: {
            ...providerPersistenceDefaults(),
            id: "enrollment-shared-oauth",
            type: OAUTH_FILE_PROVIDER_TYPE,
            label: "Shared Google Drive",
            oauthFile: configuredOAuthFile(oauthFile),
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
        const existingProvider = sharedProvider;
        const existingConfiguration =
          existingProvider.kind === SharedGrantProviderKind.Existing
            ? oauthProviderConfiguration(existingProvider.provider)
            : { kind: OAuthProviderConfigurationKind.Missing as const };
        const existingConfig =
          existingConfiguration.kind ===
          OAuthProviderConfigurationKind.Configured
            ? existingConfiguration.config
            : defaultOAuthFileConfig("icloud", "nook-events");
        const existingCredential = oauthAccessToken(existingConfig);
        const tokens =
          existingCredential.kind === OAuthAccessTokenKind.Available
            ? {
                accessToken: existingCredential.token,
                accountName:
                  existingConfig.accountEmail.state === "email"
                    ? {
                        kind: ICloudAccountNameKind.Available as const,
                        value: existingConfig.accountEmail.value,
                      }
                    : { kind: ICloudAccountNameKind.Unavailable as const },
              }
            : await requestICloudWebAuthToken();
        const accepted = await acceptICloudSharedVault(
          storageTarget.storageTargetId,
        );
        const sharedConfig: OAuthFileConfig = {
          ...existingConfig,
          iCloudMode: "shared",
          iCloudShareTarget: storedICloudShareTarget(accepted.storageTargetId),
          fileName:
            existingConfig.fileName.state === "fileName"
              ? existingConfig.fileName
              : storedOAuthRemoteFileName("nook-events"),
        };
        const provider: StorageProvider = {
          ...providerPersistenceDefaults(),
          id:
            existingProvider.kind === SharedGrantProviderKind.Existing
              ? existingProvider.provider.id
              : "enrollment-shared-icloud",
          type: OAUTH_FILE_PROVIDER_TYPE,
          label:
            existingProvider.kind === SharedGrantProviderKind.Existing
              ? existingProvider.provider.label
              : state.t("provider_picker.icloud"),
          oauthFile: configuredOAuthFile(
            oauthTokensToICloudConfig(
              tokens,
              configuredOAuthFile(sharedConfig),
            ),
          ),
          createdAt:
            existingProvider.kind === SharedGrantProviderKind.Existing
              ? existingProvider.provider.createdAt
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
      const providerConfiguration = oauthProviderConfiguration(provider);
      if (
        storageTarget.kind === SharedStorageTargetKind.Bound &&
        preset === "google-drive" &&
        providerConfiguration.kind ===
          OAuthProviderConfigurationKind.Configured &&
        providerConfiguration.config.folderId.state === "root"
      ) {
        provider = {
          ...provider,
          oauthFile: configuredOAuthFile({
            ...providerConfiguration.config,
            folderId: storedGoogleDriveFolder(storageTarget.storageTargetId),
          }),
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
      const enrollmentState = enrollmentOauthState(enrollmentProvider);
      const oauthFile: OAuthFileConfig = {
        ...defaultOAuthFileConfig(
          enrollmentProvider.oauthPreset as OAuthFilePreset,
        ),
        accessToken: storedOAuthCredential(enrollmentProvider.oauthAccessToken),
        ...enrollmentState,
      };
      const oauthProvider: StorageProvider = {
        ...providerPersistenceDefaults(),
        id: "enrollment-oauth",
        type: OAUTH_FILE_PROVIDER_TYPE,
        label: "Enrollment OAuth provider",
        oauthFile: configuredOAuthFile(oauthFile),
        createdAt: isoTimestamp(),
      };
      state.storageMode = "oauth-file";
      state.activateLoginSetup("oauth-file");
      state.configureOauthFile(oauthFile);
      state.githubPat = "";
      const fileName = oauthFileName(oauthFile);
      if (fileName.kind === OAuthFileNameKind.Resolved) {
        state.githubRepo = fileName.fileName;
      }
      state.clearLocalFolder();
      enrollmentStorageArgs = state.providerWasmArgs(oauthProvider);
    } else {
      await state.loadProviders();
      const hasLocalPasswordEntries = await localVaultHasPasswordEntries(state);
      let selection: SavedEnrollmentProvider = {
        kind: SavedEnrollmentProviderKind.Local,
      };
      if (!hasLocalPasswordEntries) {
        const candidate =
          state.syncProviders[0] ??
          state.providers.find((provider) => provider.type !== "local");
        if (candidate && candidate.type !== "local") {
          selection = {
            kind: SavedEnrollmentProviderKind.Remote,
            provider: candidate,
          };
        }
      }
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
    const vaultName = payload.vaultName.trim();
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
    const githubPat = githubPatValue(selectedProvider.githubPat);
    const githubRepo = githubRepositoryValue(selectedProvider.githubRepo);
    const selectedOauth = oauthProviderConfiguration(selectedProvider);
    const sharedJoinerIdentity = state.sharedJoinerIdentity.trim();
    const usesSharedProviderGrant =
      providerOnboardingType(selectedProvider, state.vaultArchitecture) ===
      OnboardingType.SharedProviderGrant;
    const usesSharedICloud =
      usesSharedProviderGrant &&
      selectedOauth.kind === OAuthProviderConfigurationKind.Configured &&
      selectedOauth.config.preset === "icloud";
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
        if (
          selectedOauth.kind === OAuthProviderConfigurationKind.Missing ||
          selectedOauth.config.iCloudShareTarget.state === "personal"
        ) {
          throw new Error(
            state.t("provider_setup.icloud_shared_target_required"),
          );
        }
        const targetId = selectedOauth.config.iCloudShareTarget.value;
        sharedStorageTarget = {
          kind: SharedStorageTargetKind.Bound,
          storageTargetId: targetId,
        };
      } else {
        if (selectedOauth.kind === OAuthProviderConfigurationKind.Missing) {
          throw new Error(
            "Shared-provider enrollment requires OAuth configuration.",
          );
        }
        const accessCredential = oauthAccessToken(selectedOauth.config);
        log.info("shared enrollment grant started", { providerId });
        const fileName = oauthFileName(selectedOauth.config);
        const storageTargetHint =
          fileName.kind === OAuthFileNameKind.Resolved
            ? fileName.fileName
            : githubRepo;
        const folderId = selectedOauth.config.folderId;
        const grant = await prepareSharedStorageGrant({
          providerType: selectedProvider.type,
          oauthPreset: providerOauthPresetForProvider(selectedProvider),
          joinerIdentityKind: "email",
          joinerIdentity: sharedJoinerIdentity,
          storageTargetHint: suggestedSharedStorageTarget(
            storageTargetHint || "shared folder",
          ),
          storageTarget:
            folderId.state === "folderId"
              ? existingSharedStorageTarget(folderId.value)
              : createSharedStorageTarget(),
          credential:
            accessCredential.kind === OAuthAccessTokenKind.Available
              ? sharedStorageGrantAccessToken(accessCredential.token)
              : unavailableSharedStorageGrantCredential(),
        });
        log.info("shared enrollment grant prepared", {
          providerId,
          grantKind: grant.kind,
        });
        if (grant.kind === "unsupported") {
          throw new Error(state.t(grant.reasonKey));
        }
        const grantTarget = grant.target;
        if (grant.kind === "granted") {
          if (grantTarget.state === "unavailable") {
            throw new Error(
              state.t("provider_setup.google_shared_create_failed"),
            );
          }
          sharedStorageTarget = {
            kind: SharedStorageTargetKind.Bound,
            storageTargetId: grantTarget.storageTargetId,
          };
          state.sharedGrantInstructions = state.t(grant.note, {
            email: sharedJoinerIdentity,
            folder:
              grantTarget.state === "named"
                ? grantTarget.storageTargetName
                : grantTarget.storageTargetId,
          });
        } else if (grant.kind === "manual-grant-required") {
          if (grantTarget.state !== "unavailable") {
            sharedStorageTarget = {
              kind: SharedStorageTargetKind.Bound,
              storageTargetId: grantTarget.storageTargetId,
            };
          }
          state.sharedGrantInstructions = state.t(grant.instructionsKey, {
            email: grant.joinerIdentity,
            folder:
              grantTarget.state === "named"
                ? grantTarget.storageTargetName
                : grantTarget.state === "identified"
                  ? grantTarget.storageTargetId
                  : "shared folder",
          });
        }
        if (
          sharedStorageTarget.kind === SharedStorageTargetKind.Bound &&
          selectedOauth.kind === OAuthProviderConfigurationKind.Configured
        ) {
          const updatedOauth = bindGoogleDriveSharedFolder(
            selectedOauth.config,
            sharedStorageTarget.storageTargetId,
          );
          enrollmentProviderRow = {
            ...selectedProvider,
            oauthFile: configuredOAuthFile(updatedOauth),
          };
          state.configureOauthFile(updatedOauth);
          state.providers = state.providers.map((row) =>
            row.id === selectedProvider.id ? enrollmentProviderRow : row,
          );
          await state.persistProviders();

          if (shouldFlushSharedDriveGrant(grant, accessCredential)) {
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
    const provider: NookEnrollmentProvider =
      usesSharedProviderGrant &&
      sharedStorageTarget.kind === SharedStorageTargetKind.Bound
        ? usesSharedICloud
          ? enrollmentICloudSharedProviderForArchitecture(
              enrollmentProviderRow,
              state.vaultArchitecture,
              sharedStorageTarget.storageTargetId,
            )
          : enrollmentSharedProviderForArchitecture(
              enrollmentProviderRow,
              state.vaultArchitecture,
              sharedJoinerIdentity,
              sharedStorageTarget.storageTargetId,
            )
        : enrollmentProviderForArchitecture(
            enrollmentProviderRow,
            state.vaultArchitecture,
          );
    log.info("enrollment provider payload prepared", { providerId });
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
    const manager = state.requireManager();
    const vaultName: CatalogVaultLabel =
      manager.vaultNameState === NookVaultNameState.Named
        ? {
            kind: CatalogVaultLabelKind.Present,
            label: manager.vaultName,
          }
        : catalogVaultName;
    log.info("enrollment vault name loaded", {
      providerId,
      hasVaultName: vaultName.kind === CatalogVaultLabelKind.Present,
    });
    const payload =
      vaultName.kind === CatalogVaultLabelKind.Present
        ? NookEnrollmentIssueInput.named(
            provider,
            vaultName.label,
            entryId,
            isoTimestamp(),
          )
        : NookEnrollmentIssueInput.unnamed(provider, entryId, isoTimestamp());
    const selectedPassword = state.passwordEntries.find(
      (e) => e.id === entryId,
    );
    const code =
      selectedPassword && selectedPassword.label.trim()
        ? encryptLabeledEnrollmentPayload(
            payload,
            password,
            selectedPassword.label,
          )
        : encryptUnlabeledEnrollmentPayload(payload, password);
    state.enrollmentCode = code;
    state.beginEnrollmentEntry(entryId);
    log.info("enrollment code issued", { providerId });
    return code;
  } finally {
    state.isPasswordBusy = false;
  }
}
