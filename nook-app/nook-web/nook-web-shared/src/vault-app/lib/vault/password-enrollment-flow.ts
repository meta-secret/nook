import { NativeVaultStorageFailure } from "$lib/runtime/storage-failure";
import { err as storageErr, ok as storageOk, type Result } from "neverthrow";
import {
  VaultStorageFailure as StorageOperationFailure,
  VaultStorageFailureKind as StorageOperationFailureKind,
} from "$lib/runtime/storage-failure";
import type { NookStorageConnectArgs } from "$app-wasm";
import { I18N_KEYS } from "../../../generated/i18n-keys";
import { VaultState } from "$lib/vault.svelte";
import { isoTimestamp } from "$lib/nook";
import {
  SharedGrantProviderOutcomeKind,
  findSharedGrantProvider,
  SharedStorageTargetKind,
  type SharedStorageTarget,
} from "$lib/vault/password-enrollment";

export {
  findSharedGrantProvider,
  SharedStorageTargetKind,
  shouldFlushSharedDriveGrant,
  type SharedStorageTarget,
} from "$lib/vault/password-enrollment";
import {
  JoinEnrollmentState,
  OnboardingType,
  decrypt_enrollment_payload,
  has_active_local_vault,
  set_local_vault_label,
} from "$app-wasm";
import {
  DEFAULT_DRIVE_BACKUP_NAME,
  configuredOAuthFile,
  defaultOAuthFileConfig,
  GITHUB_PROVIDER_TYPE,
  githubPatValue,
  githubRepositoryValue,
  StorageProviderPresentation,
  LocalFolderProviderConfigurationKind,
  isConfiguredOAuthFile,
  oauth_access_token,
  OAuthFilePresentation,
  OAuthFileNameKind,
  oauthConfigurationNotApplicable,
  OAUTH_FILE_PROVIDER_TYPE,
  providerPersistenceDefaults,
  storedGoogleDriveFolder,
  storedICloudShareTarget,
  storedOAuthRemoteFileName,
  type OAuthFilePreset,
  type OAuthFileConfig,
  type StorageProvider,
} from "$lib/auth/providers";
import { GoogleOAuthPrompt, googleOAuthSession } from "$lib/auth/google/oauth";
import {
  ICLOUD_SIGN_IN_TIMEOUT_MS,
  ICloudAccountNameKind,
  iCloudOAuthSession,
} from "$lib/auth/icloud/oauth";

enum SavedEnrollmentProviderKind {
  Local = "local",
  Remote = "remote",
}

type SavedEnrollmentProvider =
  | { kind: SavedEnrollmentProviderKind.Local }
  | { kind: SavedEnrollmentProviderKind.Remote; provider: StorageProvider };

type SavedEnrollmentProviderApplication = {
  readonly selection: SavedEnrollmentProvider;
};

function isOAuthFilePreset(value: string): value is OAuthFilePreset {
  return value === "google-drive" || value === "icloud";
}

export type EnrollmentCodeConnection = {
  readonly code: string;
  readonly password: string;
};

export { PasswordEnrollmentIssue } from "$lib/vault/password-enrollment-issue";

/** Owns browser orchestration for one password enrollment flow context. */
export class PasswordEnrollmentActions {
  constructor(private readonly state: VaultState) {}

  clearEnrollmentCode() {
    const state = this.state;
    state.enrollmentCode = "";
    state.clearActiveEnrollmentEntry();
  }

  private applySavedEnrollmentProvider({
    selection,
  }: SavedEnrollmentProviderApplication): Result<
    void,
    StorageOperationFailure
  > {
    const state = this.state;
    if (
      selection.kind === SavedEnrollmentProviderKind.Local ||
      selection.provider.type === "local"
    ) {
      state.storageMode = "local";
      state.activateLoginSetup("local");
      return storageOk();
    }

    const { provider } = selection;
    if (provider.type === "github") {
      state.storageMode = provider.type;
      state.clearLoginSetup();
      state.githubPat = githubPatValue(provider.githubPat);
      state.githubRepo = githubRepositoryValue(provider.githubRepo);
      state.clearOauthFile();
      state.clearLocalFolder();
      return storageOk();
    }
    if (provider.type === "oauth-file") {
      const configuration = provider.oauthFile;
      if (!isConfiguredOAuthFile(configuration)) {
        return storageErr(
          new StorageOperationFailure(
            StorageOperationFailureKind.OperationFailed,
          ),
        );
      }
      state.storageMode = provider.type;
      state.clearLoginSetup();
      state.configureOauthFile(configuration.config);
      state.githubPat = "";
      const fileName = new OAuthFilePresentation(
        configuration.config,
      ).oauthFileName();
      if (fileName.kind === OAuthFileNameKind.Resolved) {
        state.githubRepo = fileName.fileName;
      }
      state.clearLocalFolder();
      return storageOk();
    }

    const configuration = new StorageProviderPresentation(
      provider,
    ).localFolderProviderConfiguration();
    if (configuration.kind === LocalFolderProviderConfigurationKind.Missing) {
      return storageErr(
        new StorageOperationFailure(
          StorageOperationFailureKind.LocalFolderRequired,
        ),
      );
    }
    state.storageMode = provider.type;
    state.clearLoginSetup();
    state.configureLocalFolder(configuration.config);
    state.githubPat = "";
    state.clearOauthFile();
    return storageOk();
  }

  private async localVaultHasPasswordEntries(): Promise<
    Result<boolean, StorageOperationFailure>
  > {
    const state = this.state;
    let present = state.localVaultPresent;
    if (!present) {
      try {
        present = await has_active_local_vault();
      } catch (failure) {
        return storageErr(new NativeVaultStorageFailure(failure));
      }
    }
    if (!present) return storageOk(false);
    const entries = await state.enqueueStorage(async () => {
      const manager = state.admitManager();
      if (manager.isErr()) return storageErr(manager.error);
      try {
        return storageOk(
          await manager.value.fetch_vault_password_entries("local", "", ""),
        );
      } catch (failure) {
        return storageErr(new NativeVaultStorageFailure(failure));
      }
    });
    if (entries.isErr()) return storageErr(entries.error);
    return storageOk(entries.value.length > 0);
  }

  async connectWithEnrollmentCode({
    code,
    password,
  }: EnrollmentCodeConnection): Promise<void> {
    const state = this.state;
    if (!state.hasManager) {
      state.errorMsg = state.t(I18N_KEYS.ErrorsEngineUnavailable);
      return;
    }
    state.errorMsg = "";
    state.dismissSuccess();
    state.isVerifying = true;
    state.isPasswordBusy = true;
    try {
      let payload: ReturnType<typeof decrypt_enrollment_payload>;
      try {
        payload = decrypt_enrollment_payload(code, password);
      } catch (failure) {
        state.errorMsg = state.t(
          new NativeVaultStorageFailure(failure).translationKey,
        );
        return;
      }
      try {
        let enrollmentProvider: typeof payload.provider;
        try {
          enrollmentProvider = payload.provider;
        } catch (failure) {
          state.errorMsg = state.t(
            new NativeVaultStorageFailure(failure).translationKey,
          );
          return;
        }
        try {
          const entryId = payload.entryId.trim();
          const unlockPassword = password.trim();
          if (!entryId) {
            state.errorMsg = state.t(I18N_KEYS.ErrorsVaultSelectionFailed);
            return;
          }
          if (!unlockPassword) {
            state.errorMsg = state.t(I18N_KEYS.ErrorsVaultPasswordRequired);
            return;
          }

          let enrollmentStorageArgs: NookStorageConnectArgs;
          if (enrollmentProvider.type === GITHUB_PROVIDER_TYPE) {
            const githubPat = enrollmentProvider.githubPat;
            const githubRepo = enrollmentProvider.githubRepo;
            state.storageMode = "github";
            state.githubPat = githubPat;
            state.githubRepo = githubRepo;
            state.activateLoginSetup("github");
            enrollmentStorageArgs = {
              mode: "github",
              pat: githubPat,
              repo: githubRepo,
            };
          } else if (
            payload.onboardingType === OnboardingType.SharedProviderGrant
          ) {
            const presetValue = enrollmentProvider.oauthPreset;
            if (!isOAuthFilePreset(presetValue)) {
              state.errorMsg = state.t(I18N_KEYS.ErrorsVaultSelectionFailed);
              return;
            }
            const preset = presetValue;
            const storageTarget: SharedStorageTarget = {
              kind: SharedStorageTargetKind.Bound,
              storageTargetId: enrollmentProvider.sharedStorageTargetId,
            };
            const providerLoadOptions: Parameters<
              typeof state.loadProviders
            >[0] = {
              ensureLocalRow: false,
            };
            const loadedProviders1 =
              await state.loadProviders(providerLoadOptions);
            if (loadedProviders1.isErr()) {
              state.errorMsg = state.t(loadedProviders1.error.translationKey);
              return;
            }
            const findSharedGrantProviderArgs: Parameters<
              typeof findSharedGrantProvider
            >[0] = {
              providers: state.providers,
              preset,
              target: storageTarget,
            };
            const providerSelection = findSharedGrantProvider(
              findSharedGrantProviderArgs,
            );
            let sharedProvider = providerSelection;
            let sharedProviderNeedsSave = false;
            if (
              sharedProvider.kind ===
                SharedGrantProviderOutcomeKind.AuthorizationRequired &&
              preset === "google-drive"
            ) {
              if (!googleOAuthSession.isGoogleOAuthConfigured()) {
                state.errorMsg = state.t(
                  I18N_KEYS.ProviderSetupGoogleOauthUnconfigured,
                );
                return;
              }
              const requestGoogleDriveSharedAccessArgs: Parameters<
                typeof googleOAuthSession.requestGoogleDriveSharedAccess
              >[0] = {
                prompt: GoogleOAuthPrompt.Consent,
              };
              const tokens =
                await googleOAuthSession.requestGoogleDriveSharedAccess(
                  requestGoogleDriveSharedAccessArgs,
                );
              if (tokens.isErr()) {
                state.errorMsg = state.t(tokens.error.translationKey);
                return;
              }
              const defaultOAuthFileConfigArgs2: Parameters<
                typeof defaultOAuthFileConfig
              >[0] = { preset: "google-drive", fileName: "nook-events" };
              const initialConfig: OAuthFileConfig = {
                ...defaultOAuthFileConfig(defaultOAuthFileConfigArgs2),
                folderId: storedGoogleDriveFolder(
                  storageTarget.storageTargetId,
                ),
                driveMode: "shared",
              };
              const oauthTokensToConfigArgs: Parameters<
                typeof googleOAuthSession.oauthTokensToConfig
              >[0] = {
                tokens: tokens.value,
                existing: configuredOAuthFile(initialConfig),
              };
              const oauthFile = googleOAuthSession.oauthTokensToConfig(
                oauthTokensToConfigArgs,
              );
              if (oauthFile.isErr()) {
                state.errorMsg = state.t(oauthFile.error.translationKey);
                return;
              }
              sharedProvider = {
                kind: SharedGrantProviderOutcomeKind.Existing,
                provider: {
                  ...providerPersistenceDefaults(),
                  id: "enrollment-shared-oauth",
                  type: OAUTH_FILE_PROVIDER_TYPE,
                  label: "Shared Google Drive",
                  oauthFile: configuredOAuthFile(oauthFile.value),
                  createdAt: isoTimestamp(),
                },
              };
              sharedProviderNeedsSave = true;
            }
            if (preset === "icloud") {
              const existingProvider = sharedProvider;
              const existingConfiguration =
                existingProvider.kind === SharedGrantProviderOutcomeKind.Existing
                  ? existingProvider.provider.oauthFile
                  : oauthConfigurationNotApplicable();
              const existingConfig = isConfiguredOAuthFile(
                existingConfiguration,
              )
                ? existingConfiguration.config
                : (() => {
                    const defaultOAuthFileConfigArgs3: Parameters<
                      typeof defaultOAuthFileConfig
                    >[0] = { preset: "icloud", fileName: "nook-events" };
                    return defaultOAuthFileConfig(defaultOAuthFileConfigArgs3);
                  })();
              const existingCredential = oauth_access_token(existingConfig);
              const tokens =
                existingCredential.kind === "available"
                  ? // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
                    storageOk({
                      accessToken: existingCredential.token,
                      accountName:
                        existingConfig.accountEmail.state === "email"
                          ? {
                              kind: ICloudAccountNameKind.Available as const,
                              value: existingConfig.accountEmail.value,
                            }
                          : {
                              kind: ICloudAccountNameKind.Unavailable as const,
                            },
                    })
                  : await (() => {
                      const request: Parameters<
                        typeof iCloudOAuthSession.requestICloudWebAuthToken
                      >[0] = {
                        signInTimeoutMs: ICLOUD_SIGN_IN_TIMEOUT_MS,
                        clickSignInControl: true,
                      };
                      return iCloudOAuthSession.requestICloudWebAuthToken(
                        request,
                      );
                    })();
              if (tokens.isErr()) {
                state.errorMsg = state.t(tokens.error.translationKey);
                return;
              }
              const accepted = await iCloudOAuthSession.acceptICloudSharedVault(
                storageTarget.storageTargetId,
              );
              if (accepted.isErr()) {
                state.errorMsg = state.t(accepted.error.translationKey);
                return;
              }
              const sharedConfig: OAuthFileConfig = {
                ...existingConfig,
                iCloudMode: "shared",
                iCloudShareTarget: storedICloudShareTarget(
                  accepted.value.storageTargetId,
                ),
                fileName:
                  existingConfig.fileName.state === "fileName"
                    ? existingConfig.fileName
                    : storedOAuthRemoteFileName("nook-events"),
              };
              const oauthTokensToICloudConfigArgs: Parameters<
                typeof iCloudOAuthSession.oauthTokensToICloudConfig
              >[0] = {
                tokens: tokens.value,
                existing: configuredOAuthFile(sharedConfig),
              };
              const configured = iCloudOAuthSession.oauthTokensToICloudConfig(
                oauthTokensToICloudConfigArgs,
              );
              if (configured.isErr()) {
                state.errorMsg = state.t(configured.error.translationKey);
                return;
              }
              const provider: StorageProvider = {
                ...providerPersistenceDefaults(),
                id:
                  existingProvider.kind === SharedGrantProviderOutcomeKind.Existing
                    ? existingProvider.provider.id
                    : "enrollment-shared-icloud",
                type: OAUTH_FILE_PROVIDER_TYPE,
                label:
                  existingProvider.kind === SharedGrantProviderOutcomeKind.Existing
                    ? existingProvider.provider.label
                    : state.t(I18N_KEYS.ProviderPickerIcloud),
                oauthFile: configuredOAuthFile(configured.value),
                createdAt:
                  existingProvider.kind === SharedGrantProviderOutcomeKind.Existing
                    ? existingProvider.provider.createdAt
                    : isoTimestamp(),
              };
              sharedProvider = {
                kind: SharedGrantProviderOutcomeKind.Existing,
                provider,
              };
              sharedProviderNeedsSave =
                provider.id === "enrollment-shared-icloud";
            }
            if (
              sharedProvider.kind ===
              SharedGrantProviderOutcomeKind.AuthorizationRequired
            ) {
              state.errorMsg = state.t(
                I18N_KEYS.ErrorsSharedProviderAccessRequired,
              );
              return;
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
                folderId: storedGoogleDriveFolder(
                  storageTarget.storageTargetId,
                ),
              };
              provider = {
                ...provider,
                oauthFile: configuredOAuthFile(configuredOAuthFileArgs),
              };
            }
            const applySavedEnrollmentProviderArgs2: Parameters<
              PasswordEnrollmentActions["applySavedEnrollmentProvider"]
            >[0] = {
              selection: {
                kind: SavedEnrollmentProviderKind.Remote,
                provider,
              },
            };
            const applied = this.applySavedEnrollmentProvider(
              applySavedEnrollmentProviderArgs2,
            );
            if (applied.isErr()) {
              state.errorMsg = state.t(applied.error.translationKey);
              return;
            }
            if (sharedProviderNeedsSave) {
              state.activateLoginSetup("oauth-file");
            }
            enrollmentStorageArgs = state.providerWasmArgs(provider);
          } else if (enrollmentProvider.type === OAUTH_FILE_PROVIDER_TYPE) {
            const presetValue = enrollmentProvider.oauthPreset;
            if (!isOAuthFilePreset(presetValue)) {
              state.errorMsg = state.t(I18N_KEYS.ErrorsVaultSelectionFailed);
              return;
            }
            const defaultOAuthFileConfigArgs: Parameters<
              typeof defaultOAuthFileConfig
            >[0] = {
              preset: presetValue,
              fileName: DEFAULT_DRIVE_BACKUP_NAME,
            };
            const defaults = defaultOAuthFileConfig(defaultOAuthFileConfigArgs);
            let oauthFile: ReturnType<
              typeof enrollmentProvider.oauth_configuration
            >;
            try {
              oauthFile = enrollmentProvider.oauth_configuration(defaults);
            } catch (failure) {
              state.errorMsg = state.t(
                new NativeVaultStorageFailure(failure).translationKey,
              );
              return;
            }
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
            const fileName = new OAuthFilePresentation(
              oauthFile,
            ).oauthFileName();
            if (fileName.kind === OAuthFileNameKind.Resolved) {
              state.githubRepo = fileName.fileName;
            }
            state.clearLocalFolder();
            enrollmentStorageArgs = state.providerWasmArgs(oauthProvider);
          } else {
            const providerLoadOptions2: Parameters<
              typeof state.loadProviders
            >[0] = {
              ensureLocalRow: false,
            };
            const loadedProviders2 =
              await state.loadProviders(providerLoadOptions2);
            if (loadedProviders2.isErr()) {
              state.errorMsg = state.t(loadedProviders2.error.translationKey);
              return;
            }
            const hasLocalPasswordEntries =
              await this.localVaultHasPasswordEntries();
            let selection: SavedEnrollmentProvider = {
              kind: SavedEnrollmentProviderKind.Local,
            };
            if (hasLocalPasswordEntries.isErr()) {
              state.errorMsg = state.t(
                hasLocalPasswordEntries.error.translationKey,
              );
              return;
            }
            if (!hasLocalPasswordEntries.value) {
              const [
                candidate = state.providers.find(
                  (provider) => provider.type !== "local",
                ),
              ] = [state.syncProviders[0]];
              if (candidate && candidate.type !== "local") {
                selection = {
                  kind: SavedEnrollmentProviderKind.Remote,
                  provider: candidate,
                };
              }
            }
            const applySavedEnrollmentProviderArgs: Parameters<
              PasswordEnrollmentActions["applySavedEnrollmentProvider"]
            >[0] = { selection };
            const applied = this.applySavedEnrollmentProvider(
              applySavedEnrollmentProviderArgs,
            );
            if (applied.isErr()) {
              state.errorMsg = state.t(applied.error.translationKey);
              return;
            }
            enrollmentStorageArgs =
              selection.kind === SavedEnrollmentProviderKind.Remote
                ? state.providerWasmArgs(selection.provider)
                : { mode: "local", pat: "", repo: "" };
          }

          const identityInitialization = await state.initDeviceIdentity();
          if (identityInitialization.isErr()) {
            state.errorMsg = state.t(
              identityInitialization.error.translationKey,
            );
            return;
          }

          const page = await state.enqueueStorage(async () => {
            const admittedManager = state.admitManager();
            if (admittedManager.isErr())
              return storageErr(admittedManager.error);
            try {
              return storageOk(
                await admittedManager.value.connect_with_password(
                  enrollmentStorageArgs.mode,
                  enrollmentStorageArgs.pat,
                  enrollmentStorageArgs.repo,
                  entryId,
                  unlockPassword,
                  state.secretPageSize,
                ),
              );
            } catch (nativeFailure) {
              return storageErr(new NativeVaultStorageFailure(nativeFailure));
            }
          });
          if (page.isErr()) {
            state.errorMsg = state.t(page.error.translationKey);
            return;
          }
          const connectedPageArgs: Parameters<
            typeof state.applyConnectedSecretPage
          >[0] = { page: page.value, query: "" };
          state.applyConnectedSecretPage(connectedPageArgs);
          const vaultName = payload.vaultName.trim();
          const storedId = await state.enqueueStorage(async () => {
            const manager = state.admitManager();
            if (manager.isErr()) return storageErr(manager.error);
            try {
              return storageOk(manager.value.vaultStoreId);
            } catch (failure) {
              return storageErr(new NativeVaultStorageFailure(failure));
            }
          });
          if (storedId.isErr()) {
            state.errorMsg = state.t(storedId.error.translationKey);
            return;
          }
          const vaultStoreId = storedId.value.trim();
          if (vaultName && vaultStoreId) {
            const renamed = await state.enqueueStorage(async () => {
              const admittedManager = state.admitManager();
              if (admittedManager.isErr())
                return storageErr(admittedManager.error);
              try {
                return storageOk(
                  await admittedManager.value.set_vault_name(vaultName),
                );
              } catch (nativeFailure) {
                return storageErr(new NativeVaultStorageFailure(nativeFailure));
              }
            });
            if (renamed.isErr()) {
              state.errorMsg = state.t(renamed.error.translationKey);
              return;
            }
            try {
              await set_local_vault_label(vaultStoreId, vaultName);
            } catch (failure) {
              state.errorMsg = state.t(
                new NativeVaultStorageFailure(failure).translationKey,
              );
              return;
            }
          }
          // Password enrollment downloads an existing vault into this browser. Make
          // that inherited store the active local catalog entry before saving the
          // transferred provider credentials.
          const catalogRefresh1 = await state.refreshLocalVaultCatalog();
          if (catalogRefresh1.isErr()) {
            state.errorMsg = state.t(catalogRefresh1.error.translationKey);
            return;
          }
          const activeVaultPersistence =
            await state.syncActiveVaultStoreIdToAuth();
          if (activeVaultPersistence.isErr()) {
            state.errorMsg = state.t(
              activeVaultPersistence.error.translationKey,
            );
            return;
          }
          const savedProvider1 = await state.ensureProviderSaved();
          if (savedProvider1.isErr()) {
            state.errorMsg = state.t(savedProvider1.error.translationKey);
            return;
          }
          const providerLoadOptions3: Parameters<
            typeof state.loadProviders
          >[0] = {
            ensureLocalRow: false,
          };
          const loadedProviders3 =
            await state.loadProviders(providerLoadOptions3);
          if (loadedProviders3.isErr()) {
            state.errorMsg = state.t(loadedProviders3.error.translationKey);
            return;
          }
          const passwordRefresh1 = await state.refreshPasswordEntriesList();
          if (passwordRefresh1.isErr()) {
            state.errorMsg = state.t(passwordRefresh1.error.translationKey);
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
          state.joinEnrollmentPrompt = JoinEnrollmentState.None;
          state.loginEnrollmentCode = "";
          state.prefillEnrollmentCode = "";
          state.enrollmentFromUrlPending = false;
          state.showSuccess(state.t(I18N_KEYS.ToastsDeviceEnrolled));
          state.startIdleSessionTracking();
          state.startVaultSync();
        } finally {
          enrollmentProvider.free();
        }
      } finally {
        payload.free();
      }
    } finally {
      state.isPasswordBusy = false;
      state.isVerifying = false;
    }
  }
}
