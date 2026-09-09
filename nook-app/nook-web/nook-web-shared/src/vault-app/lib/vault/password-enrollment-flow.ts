import { I18N_KEYS } from "../../../generated/i18n-keys";
import { VaultState } from "$lib/vault.svelte";
import { isoTimestamp } from "$lib/nook";
import {
  enrollmentOauthState,
  findSharedGrantProvider,
  SharedGrantProviderKind,
  SharedStorageTargetKind,
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
  oauthAccessToken,
  OAuthAccessTokenKind,
  OAuthFilePresentation,
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
  }: SavedEnrollmentProviderApplication) {
    const state = this.state;
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
      const fileName = new OAuthFilePresentation(
        configuration.config,
      ).oauthFileName();
      if (fileName.kind === OAuthFileNameKind.Resolved) {
        state.githubRepo = fileName.fileName;
      }
      state.clearLocalFolder();
      return;
    }

    const configuration = new StorageProviderPresentation(
      provider,
    ).localFolderProviderConfiguration();
    if (configuration.kind === LocalFolderProviderConfigurationKind.Missing) {
      throw new Error(
        "Local-folder enrollment provider is missing its configuration.",
      );
    }
    state.configureLocalFolder(configuration.config);
    state.githubPat = "";
    state.clearOauthFile();
  }

  private async localVaultHasPasswordEntries(): Promise<boolean> {
    const state = this.state;
    if (!state.hasManager) return false;
    if (!state.localVaultPresent && !(await has_active_local_vault()))
      return false;
    try {
      const entries = await state.enqueueStorage(() =>
        state.requireManager().fetch_vault_password_entries("local", "", ""),
      );
      return entries.length > 0;
    } catch {
      return false;
    }
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
      const payload = decrypt_enrollment_payload(code, password);
      const enrollmentProvider = payload.provider;
      const entryId = payload.entryId.trim();
      const unlockPassword = password.trim();
      if (!entryId) {
        throw new Error(
          "Enrollment code is missing a vault password entry id.",
        );
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
      } else if (
        payload.onboardingType === OnboardingType.SharedProviderGrant
      ) {
        const preset = enrollmentProvider.oauthPreset as OAuthFilePreset;
        const storageTarget: SharedStorageTarget = {
          kind: SharedStorageTargetKind.Bound,
          storageTargetId: enrollmentProvider.sharedStorageTargetId,
        };
        const providerLoadOptions: Parameters<typeof state.loadProviders>[0] = {
          ensureLocalRow: false,
        };
        await state.loadProviders(providerLoadOptions);
        const findSharedGrantProviderArgs: Parameters<
          typeof findSharedGrantProvider
        >[0] = { providers: state.providers, preset, target: storageTarget };
        const providerSelection = findSharedGrantProvider(
          findSharedGrantProviderArgs,
        );
        let sharedProvider = providerSelection;
        let sharedProviderNeedsSave = false;
        if (
          sharedProvider.kind ===
            SharedGrantProviderKind.AuthorizationRequired &&
          preset === "google-drive"
        ) {
          if (!googleOAuthSession.isGoogleOAuthConfigured()) {
            throw new Error(
              state.t(I18N_KEYS.ProviderSetupGoogleOauthUnconfigured),
            );
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
          const defaultOAuthFileConfigArgs2: Parameters<
            typeof defaultOAuthFileConfig
          >[0] = { preset: "google-drive", fileName: "nook-events" };
          const initialConfig: OAuthFileConfig = {
            ...defaultOAuthFileConfig(defaultOAuthFileConfigArgs2),
            folderId: storedGoogleDriveFolder(storageTarget.storageTargetId),
            driveMode: "shared",
          };
          const oauthTokensToConfigArgs: Parameters<
            typeof googleOAuthSession.oauthTokensToConfig
          >[0] = { tokens, existing: configuredOAuthFile(initialConfig) };
          const oauthFile = googleOAuthSession.oauthTokensToConfig(
            oauthTokensToConfigArgs,
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
              : await (() => {
                  const request: Parameters<
                    typeof iCloudOAuthSession.requestICloudWebAuthToken
                  >[0] = {
                    signInTimeoutMs: ICLOUD_SIGN_IN_TIMEOUT_MS,
                    clickSignInControl: true,
                  };
                  return iCloudOAuthSession.requestICloudWebAuthToken(request);
                })();
          const accepted = await iCloudOAuthSession.acceptICloudSharedVault(
            storageTarget.storageTargetId,
          );
          const sharedConfig: OAuthFileConfig = {
            ...existingConfig,
            iCloudMode: "shared",
            iCloudShareTarget: storedICloudShareTarget(
              accepted.storageTargetId,
            ),
            fileName:
              existingConfig.fileName.state === "fileName"
                ? existingConfig.fileName
                : storedOAuthRemoteFileName("nook-events"),
          };
          const oauthTokensToICloudConfigArgs: Parameters<
            typeof iCloudOAuthSession.oauthTokensToICloudConfig
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
              iCloudOAuthSession.oauthTokensToICloudConfig(
                oauthTokensToICloudConfigArgs,
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
            state.t(I18N_KEYS.ErrorsSharedProviderAccessRequired),
          );
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
          PasswordEnrollmentActions["applySavedEnrollmentProvider"]
        >[0] = {
          selection: {
            kind: SavedEnrollmentProviderKind.Remote,
            provider,
          },
        };
        this.applySavedEnrollmentProvider(applySavedEnrollmentProviderArgs2);
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
          accessToken: storedOAuthCredential(
            enrollmentProvider.oauthAccessToken,
          ),
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
        const fileName = new OAuthFilePresentation(oauthFile).oauthFileName();
        if (fileName.kind === OAuthFileNameKind.Resolved) {
          state.githubRepo = fileName.fileName;
        }
        state.clearLocalFolder();
        enrollmentStorageArgs = state.providerWasmArgs(oauthProvider);
      } else {
        const providerLoadOptions2: Parameters<typeof state.loadProviders>[0] =
          {
            ensureLocalRow: false,
          };
        await state.loadProviders(providerLoadOptions2);
        const hasLocalPasswordEntries =
          await this.localVaultHasPasswordEntries();
        let selection: SavedEnrollmentProvider = {
          kind: SavedEnrollmentProviderKind.Local,
        };
        if (!hasLocalPasswordEntries) {
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
        this.applySavedEnrollmentProvider(applySavedEnrollmentProviderArgs);
        enrollmentStorageArgs =
          selection.kind === SavedEnrollmentProviderKind.Remote
            ? state.providerWasmArgs(selection.provider)
            : ["local", "", ""];
      }

      await state.initDeviceIdentity();

      const page = await state.enqueueStorage(() =>
        state
          .requireManager()
          .connect_with_password(
            ...enrollmentStorageArgs,
            entryId,
            unlockPassword,
            state.secretPageSize,
          ),
      );
      const connectedPageArgs: Parameters<
        typeof state.applyConnectedSecretPage
      >[0] = { page, query: "" };
      state.applyConnectedSecretPage(connectedPageArgs);
      const vaultName = payload.vaultName.trim();
      const vaultStoreId = (
        await state.enqueueStorage(() => state.requireManager().vaultStoreId)
      ).trim();
      if (vaultName && vaultStoreId) {
        await state.enqueueStorage(() =>
          state.requireManager().set_vault_name(vaultName),
        );
        await set_local_vault_label(vaultStoreId, vaultName);
      }
      // Password enrollment downloads an existing vault into this browser. Make
      // that inherited store the active local catalog entry before saving the
      // transferred provider credentials.
      await state.refreshLocalVaultCatalog();
      await state.syncActiveVaultStoreIdToAuth();
      await state.ensureProviderSaved();
      const providerLoadOptions3: Parameters<typeof state.loadProviders>[0] = {
        ensureLocalRow: false,
      };
      await state.loadProviders(providerLoadOptions3);
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
}
