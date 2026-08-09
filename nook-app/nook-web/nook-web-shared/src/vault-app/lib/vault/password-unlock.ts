import { I18N_KEYS } from "../../../generated/i18n-keys";
import { VaultState } from "$lib/vault.svelte";
import { ActiveVaultKind } from "$lib/vault/state/provider.svelte";
import { EnrollmentEntryKind } from "$lib/vault/state/session.svelte";
import { isoTimestamp } from "$lib/nook";
import { createLogger, runtimeFailure } from "$lib/runtime/log";
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
  type NookEnrollmentProvider,
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
  isConfiguredOAuthFile,
  oauthAccessToken,
  OAuthAccessTokenKind,
  oauthFileName,
  OAuthFileNameKind,
  oauthConfigurationNotApplicable,
  OAUTH_FILE_PROVIDER_TYPE,
  providerPersistenceDefaults,
  storedGoogleDriveFolder,
  storedICloudShareTarget,
  storedOAuthCredential,
  storedOAuthRemoteFileName,
  type OAuthFilePreset,
  type OAuthFileConfig,
  type StorageProvider,
} from "$lib/auth/providers";
import {
  GoogleOAuthPrompt,
  isGoogleOAuthConfigured,
  oauthTokensToConfig,
  requestGoogleDriveSharedAccess,
} from "$lib/auth/google/oauth";
import {
  acceptICloudSharedVault,
  ICloudAccountNameKind,
  oauthTokensToICloudConfig,
  requestICloudWebAuthToken,
} from "$lib/auth/icloud/oauth";
import {
  prepareSharedStorageGrant,
  createSharedStorageTarget,
  existingSharedStorageTarget,
  providerOnboardingType,
  providerOauthPresetForProvider,
  sharedStorageGrantAccessToken,
  suggestedSharedStorageTarget,
  unavailableSharedStorageGrantCredential,
} from "$lib/vault/architecture-model";
import {
  isSentinelPasswordUnlockForbiddenError,
  isSentinelVault,
} from "$lib/vault/sentinel-unlock";

const log = createLogger("vault-password");

type E2ePasswordManager = {
  addVaultPasswordForE2e?: (args: {
    readonly label: string;
    readonly password: string;
  }) => Promise<void>;
  updateVaultPasswordEntryForE2e?: (args: {
    readonly entryId: string;
    readonly password: string;
  }) => Promise<void>;
};

export async function addVaultPassword({
  state,
  label,
  password,
}: {
  readonly state: VaultState;
  readonly label: string;
  readonly password: string;
}): Promise<void> {
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
        const addVaultPasswordForE2eArgs: Parameters<
          typeof e2eManager.addVaultPasswordForE2e
        >[0] = { label: trimmedLabel, password };
        return e2eManager.addVaultPasswordForE2e(addVaultPasswordForE2eArgs);
      }
      return manager.addVaultPassword(trimmedLabel, password);
    });
    await state.refreshPasswordEntriesList();
    const infoArgs: Parameters<typeof log.info>[1] = {
      hadPasswords,
      label: label.trim(),
    };
    log.info("vault password added", infoArgs);
    state.showSuccess(
      hadPasswords
        ? state.t(I18N_KEYS.ToastsPasswordAddedRotate)
        : state.t(I18N_KEYS.ToastsPasswordSet),
    );
    await state.hydrateMultiDeviceState();
    await state.runFanOutSyncAfterLocalSave();
  } catch (e) {
    state.passwordError =
      e instanceof Error ? e.message : "Failed to add vault password.";
    throw e;
  } finally {
    state.isPasswordBusy = false;
  }
}

export async function updateVaultPasswordEntry({
  state,
  entryId,
  password,
}: {
  readonly state: VaultState;
  readonly entryId: string;
  readonly password: string;
}): Promise<void> {
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
        const updateVaultPasswordEntryForE2eArgs: Parameters<
          typeof e2eManager.updateVaultPasswordEntryForE2e
        >[0] = { entryId, password };
        return e2eManager.updateVaultPasswordEntryForE2e(
          updateVaultPasswordEntryForE2eArgs,
        );
      }
      return manager.updateVaultPasswordEntry(entryId, password);
    });
    await state.refreshPasswordEntriesList();
    state.showSuccess(state.t(I18N_KEYS.ToastsPasswordUpdated));
    await state.runFanOutSyncAfterLocalSave();
  } catch (e) {
    state.passwordError =
      e instanceof Error ? e.message : "Failed to update vault password.";
    throw e;
  } finally {
    state.isPasswordBusy = false;
  }
}

export async function removeVaultPasswordEntry({
  state,
  entryId,
}: {
  readonly state: VaultState;
  readonly entryId: string;
}): Promise<void> {
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
    state.showSuccess(state.t(I18N_KEYS.ToastsPasswordRemoved));
    await state.runFanOutSyncAfterLocalSave();
  } catch (e) {
    state.passwordError =
      e instanceof Error ? e.message : "Failed to remove vault password.";
    throw e;
  } finally {
    state.isPasswordBusy = false;
  }
}

export async function unlockWithPassword({
  state,
  entryId,
  password,
}: {
  readonly state: VaultState;
  readonly entryId: string;
  readonly password: string;
}): Promise<void> {
  if (!state.hasManager) {
    state.errorMsg = state.t(I18N_KEYS.ErrorsEngineUnavailable);
    return;
  }
  if (state.isVerifying) return;
  if (isSentinelVault(state)) {
    state.errorMsg = state.t(
      I18N_KEYS.ArchitectureModesSentinelPasswordForbidden,
    );
    state.sentinelCeremonyPrompt = true;
    return;
  }
  if (!state.hasRemoteCredentials()) {
    state.errorMsg =
      state.storageMode === "oauth-file"
        ? state.t(I18N_KEYS.ErrorsGoogleSignInRequired)
        : state.t(I18N_KEYS.ErrorsGithubCredentialsRequired);
    return;
  }
  await state.ensureOAuthTokensFresh();
  if (!entryId.trim()) {
    state.errorMsg = state.t(I18N_KEYS.ErrorsVaultPasswordRequired);
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
    const infoArgs2: Parameters<typeof log.info>[1] = {
      mode: state.storageMode,
      secrets: state.secretTotal,
      entryId,
    };
    log.info("vault unlocked with password", infoArgs2);
    state.joinEnrollmentPrompt = JoinEnrollmentState.None;
    state.loginPasswordPrompt = false;
    state.showSuccess(state.t(I18N_KEYS.ToastsVaultUnlocked));
    state.startIdleSessionTracking();
    if (state.deviceProtectionReady) {
      state.startVaultSync();
    }
  } catch (e) {
    state.isAuthenticated = false;
    const message =
      e instanceof Error ? e.message : "Failed to unlock with password.";
    const warnArgs: Parameters<typeof log.warn>[1] = { error: message };
    log.warn("vault password unlock failed", warnArgs);
    if (isSentinelPasswordUnlockForbiddenError(runtimeFailure(e))) {
      state.errorMsg = state.t(
        I18N_KEYS.ArchitectureModesSentinelPasswordForbidden,
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

function applySavedEnrollmentProvider({
  state,
  selection,
}: {
  readonly state: VaultState;
  readonly selection: SavedEnrollmentProvider;
}) {
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
    const configuration = provider.oauthFile;
    if (!isConfiguredOAuthFile(configuration)) {
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

export async function connectWithEnrollmentCode({
  state,
  code,
  password,
}: {
  readonly state: VaultState;
  readonly code: string;
  readonly password: string;
}): Promise<void> {
  if (!state.hasManager) {
    state.errorMsg = state.t(I18N_KEYS.ErrorsEngineUnavailable);
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
      const findSharedGrantProviderArgs: Parameters<
        typeof findSharedGrantProvider
      >[0] = { providers: state.providers, preset, target: storageTarget };
      const providerSelection = findSharedGrantProvider(
        findSharedGrantProviderArgs,
      );
      let sharedProvider = providerSelection;
      let sharedProviderNeedsSave = false;
      if (
        sharedProvider.kind === SharedGrantProviderKind.AuthorizationRequired &&
        preset === "google-drive"
      ) {
        if (!isGoogleOAuthConfigured()) {
          throw new Error(
            state.t(I18N_KEYS.ProviderSetupGoogleOauthUnconfigured),
          );
        }
        const requestGoogleDriveSharedAccessArgs: Parameters<
          typeof requestGoogleDriveSharedAccess
        >[0] = {
          prompt: GoogleOAuthPrompt.Consent,
        };
        const tokens = await requestGoogleDriveSharedAccess(
          requestGoogleDriveSharedAccessArgs,
        );
        const defaultOAuthFileConfigArgs2: Parameters<
          typeof defaultOAuthFileConfig
        >[0] = { preset: "google-drive", fileName: "nook-events" };
        const initialConfig: OAuthFileConfig = {
          ...defaultOAuthFileConfig(defaultOAuthFileConfigArgs2),
          folderId: storedGoogleDriveFolder(storageTarget.storageTargetId),
          driveMode: "shared",
        };
        const oauthTokensToConfigArgs: Parameters<
          typeof oauthTokensToConfig
        >[0] = { tokens, existing: configuredOAuthFile(initialConfig) };
        const oauthFile = oauthTokensToConfig(oauthTokensToConfigArgs);
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
        const existingProvider = sharedProvider;
        const existingConfiguration =
          existingProvider.kind === SharedGrantProviderKind.Existing
            ? existingProvider.provider.oauthFile
            : oauthConfigurationNotApplicable();
        const existingConfig = isConfiguredOAuthFile(existingConfiguration)
          ? existingConfiguration.config
          : (() => {
              const defaultOAuthFileConfigArgs3: Parameters<
                typeof defaultOAuthFileConfig
              >[0] = { preset: "icloud", fileName: "nook-events" };
              return defaultOAuthFileConfig(defaultOAuthFileConfigArgs3);
            })();
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
        const oauthTokensToICloudConfigArgs: Parameters<
          typeof oauthTokensToICloudConfig
        >[0] = { tokens, existing: configuredOAuthFile(sharedConfig) };
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
              : state.t(I18N_KEYS.ProviderPickerIcloud),
          oauthFile: configuredOAuthFile(
            oauthTokensToICloudConfig(oauthTokensToICloudConfigArgs),
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
        throw new Error(state.t(I18N_KEYS.ErrorsSharedProviderAccessRequired));
      }
      let provider: StorageProvider = sharedProvider.provider;
      const providerConfiguration = provider.oauthFile;
      if (
        storageTarget.kind === SharedStorageTargetKind.Bound &&
        preset === "google-drive" &&
        isConfiguredOAuthFile(providerConfiguration) &&
        providerConfiguration.config.folderId.state === "root"
      ) {
        const configuredOAuthFileArgs: Parameters<
          typeof configuredOAuthFile
        >[0] = {
          ...providerConfiguration.config,
          folderId: storedGoogleDriveFolder(storageTarget.storageTargetId),
        };
        provider = {
          ...provider,
          oauthFile: configuredOAuthFile(configuredOAuthFileArgs),
        };
      }
      const applySavedEnrollmentProviderArgs2: Parameters<
        typeof applySavedEnrollmentProvider
      >[0] = {
        state,
        selection: {
          kind: SavedEnrollmentProviderKind.Remote,
          provider,
        },
      };
      applySavedEnrollmentProvider(applySavedEnrollmentProviderArgs2);
      if (sharedProviderNeedsSave) {
        state.activateLoginSetup("oauth-file");
      }
      enrollmentStorageArgs = state.providerWasmArgs(provider);
    } else if (enrollmentProvider.type === OAUTH_FILE_PROVIDER_TYPE) {
      const enrollmentState = enrollmentOauthState(enrollmentProvider);
      const defaultOAuthFileConfigArgs: Parameters<
        typeof defaultOAuthFileConfig
      >[0] = {
        preset: enrollmentProvider.oauthPreset as OAuthFilePreset,
        fileName: DEFAULT_DRIVE_BACKUP_NAME,
      };
      const oauthFile: OAuthFileConfig = {
        ...defaultOAuthFileConfig(defaultOAuthFileConfigArgs),
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
      const applySavedEnrollmentProviderArgs: Parameters<
        typeof applySavedEnrollmentProvider
      >[0] = { state, selection };
      applySavedEnrollmentProvider(applySavedEnrollmentProviderArgs);
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
    state.showSuccess(state.t(I18N_KEYS.ToastsDeviceEnrolled));
    state.startIdleSessionTracking();
    state.startVaultSync();
  } catch (e) {
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

export async function issueEnrollmentCode({
  state,
  entryId,
  password,
  providerId,
}: {
  readonly state: VaultState;
  readonly entryId: string;
  readonly password: string;
  readonly providerId: string;
}): Promise<string> {
  if (!state.hasManager) {
    throw new Error("Vault engine is not available.");
  }
  // Password verification borrows the wasm manager synchronously (`&self`).
  // `isPasswordBusy` makes the periodic sync tick skip, but we still have to
  // wait for any *already in-flight* `&mut self` storage future to release its
  // borrow before verify runs, or wasm-bindgen's borrow detector trips.
  state.isPasswordBusy = true;
  const infoArgs3: Parameters<typeof log.info>[1] = { providerId };
  log.info("enrollment code issue started", infoArgs3);
  try {
    // Wait for the queued wasm op to settle. We deliberately do NOT
    // `resetStorageChain()` on timeout: abandoning an in-flight `&mut self`
    // future leaves its IndexedDB transaction dangling, which surfaces later as
    // "database is not open" and poisons subsequent borrows. Surface a
    // retriable error instead.
    try {
      const raceStorageTimeoutArgs: Parameters<
        typeof state.raceStorageTimeout
      >[0] = { promise: state.waitForStorageChain(), label: "Vault storage" };
      await state.raceStorageTimeout(raceStorageTimeoutArgs);
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
    const infoArgs4: Parameters<typeof log.info>[1] = { providerId };
    log.info("enrollment password verified", infoArgs4);
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
    const selectedOauth = selectedProvider.oauthFile;
    const sharedJoinerIdentity = state.sharedJoinerIdentity.trim();
    const usesSharedProviderGrant =
      providerOnboardingType(selectedProvider, state.vaultArchitecture) ===
      OnboardingType.SharedProviderGrant;
    const usesSharedICloud =
      usesSharedProviderGrant &&
      isConfiguredOAuthFile(selectedOauth) &&
      selectedOauth.config.preset === "icloud";
    const infoArgs5: Parameters<typeof log.info>[1] = {
      providerId,
      providerType: selectedProvider.type,
      usesSharedProviderGrant,
    };
    log.info("enrollment provider selected", infoArgs5);
    if (usesSharedProviderGrant && !usesSharedICloud && !sharedJoinerIdentity) {
      throw new Error(
        state.t(I18N_KEYS.ErrorsValidationSharedJoinerIdentityRequired),
      );
    }
    if (
      selectedProvider.type === "github" &&
      !usesSharedProviderGrant &&
      (!githubPat || !githubRepo)
    ) {
      throw new Error(
        state.t(I18N_KEYS.ErrorsGithubEnrollmentCredentialsRequired),
      );
    }
    state.sharedGrantInstructions = "";
    let sharedStorageTarget: SharedStorageTarget = {
      kind: SharedStorageTargetKind.NotBound,
    };
    let enrollmentProviderRow: StorageProvider = selectedProvider;
    if (usesSharedProviderGrant) {
      if (usesSharedICloud) {
        if (selectedOauth.config.iCloudShareTarget.state === "personal") {
          throw new Error(
            state.t(I18N_KEYS.ProviderSetupIcloudSharedTargetRequired),
          );
        }
        const targetId = selectedOauth.config.iCloudShareTarget.value;
        sharedStorageTarget = {
          kind: SharedStorageTargetKind.Bound,
          storageTargetId: targetId,
        };
      } else {
        if (!isConfiguredOAuthFile(selectedOauth)) {
          throw new Error(state.t(I18N_KEYS.ErrorsSharedProviderOauthRequired));
        }
        const accessCredential = oauthAccessToken(selectedOauth.config);
        const infoArgs6: Parameters<typeof log.info>[1] = { providerId };
        log.info("shared enrollment grant started", infoArgs6);
        const fileName = oauthFileName(selectedOauth.config);
        const storageTargetHint =
          fileName.kind === OAuthFileNameKind.Resolved
            ? fileName.fileName
            : githubRepo;
        const folderId = selectedOauth.config.folderId;
        const prepareSharedStorageGrantArgs: Parameters<
          typeof prepareSharedStorageGrant
        >[0] = {
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
        };
        const grant = await prepareSharedStorageGrant(
          prepareSharedStorageGrantArgs,
        );
        const infoArgs7: Parameters<typeof log.info>[1] = {
          providerId,
          grantKind: grant.kind,
        };
        log.info("shared enrollment grant prepared", infoArgs7);
        if (grant.kind === "unsupported") {
          throw new Error(state.t(grant.reasonKey));
        }
        const grantTarget = grant.target;
        if (grant.kind === "granted") {
          if (grantTarget.state === "unavailable") {
            throw new Error(
              state.t(I18N_KEYS.ProviderSetupGoogleSharedCreateFailed),
            );
          }
          sharedStorageTarget = {
            kind: SharedStorageTargetKind.Bound,
            storageTargetId: grantTarget.storageTargetId,
          };
          const tArgs2: Parameters<typeof state.t>[0] = {
            key: grant.note,
            replacements: {
              email: sharedJoinerIdentity,
              folder:
                grantTarget.state === "named"
                  ? grantTarget.storageTargetName
                  : grantTarget.storageTargetId,
            },
          };
          state.sharedGrantInstructions = state.t(tArgs2);
        } else if (grant.kind === "manual-grant-required") {
          if (grantTarget.state !== "unavailable") {
            sharedStorageTarget = {
              kind: SharedStorageTargetKind.Bound,
              storageTargetId: grantTarget.storageTargetId,
            };
          }
          const tArgs: Parameters<typeof state.t>[0] = {
            key: grant.instructionsKey,
            replacements: {
              email: grant.joinerIdentity,
              folder:
                grantTarget.state === "named"
                  ? grantTarget.storageTargetName
                  : grantTarget.state === "identified"
                    ? grantTarget.storageTargetId
                    : "shared folder",
            },
          };
          state.sharedGrantInstructions = state.t(tArgs);
        }
        if (
          sharedStorageTarget.kind === SharedStorageTargetKind.Bound &&
          isConfiguredOAuthFile(selectedOauth)
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

          if (
            (() => {
              const shouldFlushSharedDriveGrantArgs: Parameters<
                typeof shouldFlushSharedDriveGrant
              >[0] = { grant, accessCredential };
              return shouldFlushSharedDriveGrant(
                shouldFlushSharedDriveGrantArgs,
              );
            })()
          ) {
            // The target is not usable until it contains the current vault
            // event log, even when collaborator access needs manual completion.
            // Await Rust/WASM fan-out before issuing the enrollment code.
            const targetArgs: ReturnType<typeof state.providerWasmArgs> =
              state.providerWasmArgs(enrollmentProviderRow);
            await state.enqueueStorage(() =>
              state.requireManager().flushEventOutboxForProvider(...targetArgs),
            );
          }
        }
      }
      if (usesSharedICloud) {
        const targetArgs: ReturnType<typeof state.providerWasmArgs> =
          state.providerWasmArgs(enrollmentProviderRow);
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
    const infoArgs8: Parameters<typeof log.info>[1] = { providerId };
    log.info("enrollment provider payload prepared", infoArgs8);
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
    const infoArgs9: Parameters<typeof log.info>[1] = {
      providerId,
      hasVaultName: vaultName.kind === CatalogVaultLabelKind.Present,
    };
    log.info("enrollment vault name loaded", infoArgs9);
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
    const infoArgs10: Parameters<typeof log.info>[1] = { providerId };
    log.info("enrollment code issued", infoArgs10);
    return code;
  } finally {
    state.isPasswordBusy = false;
  }
}
