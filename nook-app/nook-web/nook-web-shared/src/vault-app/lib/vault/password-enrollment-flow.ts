import { NativeVaultStorageFailure } from "$lib/runtime/storage-failure";
import { err as storageErr, ok as storageOk, type Result } from "neverthrow";
import { Effect, Schema } from "effect";
import {
  VaultStorageFailure as StorageOperationFailure,
  VaultStorageFailureKind as StorageOperationFailureKind,
} from "$lib/runtime/storage-failure";
import type { NookStorageConnectArgs } from "$app-wasm";
import { I18N_KEYS } from "../../../generated/i18n-keys";
import { VaultState } from "$lib/vault.svelte";
import { isoTimestamp } from "$lib/nook";
import type { OAuthFailure } from "$lib/auth/oauth-failure";
import {
  SharedGrantProviderOutcomeKind,
  findSharedGrantProvider,
  SharedStorageTargetKind,
  type SharedStorageTarget,
} from "$lib/vault/password-enrollment";

export {
  findSharedGrantProvider,
  SharedStorageTargetKind,
  type SharedStorageTarget,
} from "$lib/vault/password-enrollment";
import {
  JoinEnrollmentState,
  OnboardingType,
  decrypt_enrollment_payload,
  verify_joiner_account,
} from "$app-wasm";
import {
  DEFAULT_DRIVE_BACKUP_NAME,
  configuredOAuthFile,
  defaultOAuthFileConfig,
  GITHUB_PROVIDER_TYPE,
  GOOGLE_DRIVE_OAUTH_FILE_PRESET,
  ICLOUD_OAUTH_FILE_PRESET,
  githubPatValue,
  githubRepositoryValue,
  storedGithubPat,
  storedGithubRepository,
  StorageProviderPresentation,
  LocalFolderProviderConfigurationKind,
  decodeStoredOAuthFileConfiguration,
  StoredOAuthFileConfigurationDecodeKind,
  oauth_access_token,
  OAuthFilePresentation,
  OAuthFileNameKind,
  oauthConfigurationNotApplicable,
  OAUTH_FILE_PROVIDER_TYPE,
  providerPersistenceDefaults,
  storedGoogleDriveFolder,
  storedICloudShareTarget,
  storedOAuthAccountEmail,
  storedOAuthRemoteFileName,
  type OAuthFilePreset,
  type OAuthFileConfig,
  type StorageProvider,
} from "$lib/auth/providers";
import {
  GoogleAccountIdentityKind,
  GoogleOAuthPrompt,
  googleOAuthSession,
} from "$lib/auth/google/oauth";
import {
  ICLOUD_SIGN_IN_TIMEOUT_MS,
  ICloudAccountNameKind,
  type ICloudAccountName,
  type ICloudOAuthTokens,
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

enum IdentityInviteJoinOutcome {
  Joined = "joined",
}

export enum OAuthFilePresetDecodeFailureKind {
  Invalid = "invalid-oauth-file-preset",
}

export class OAuthFilePresetDecoder {
  private constructor() {}

  static decode(value: string): Effect.Effect<
    OAuthFilePreset,
    {
      readonly kind: OAuthFilePresetDecodeFailureKind.Invalid;
      readonly cause: Schema.SchemaError;
    }
  > {
    return Schema.decodeUnknownEffect(
      Schema.Literals([
        GOOGLE_DRIVE_OAUTH_FILE_PRESET,
        ICLOUD_OAUTH_FILE_PRESET,
      ]),
    )(value).pipe(
      Effect.mapError((cause) => ({
        kind: OAuthFilePresetDecodeFailureKind.Invalid,
        cause,
      })),
    );
  }
}

export type EnrollmentCodeConnection = {
  readonly code: string;
  readonly password: string;
};

export { IdentityEnrollmentIssue } from "$lib/vault/password-enrollment-issue";

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
    StorageProvider["type"],
    StorageOperationFailure
  > {
    const state = this.state;
    if (
      selection.kind === SavedEnrollmentProviderKind.Local ||
      selection.provider.type === "local"
    ) {
      state.storageMode = "local";
      state.activateLoginSetup("local");
      return storageOk(state.storageMode);
    }

    const { provider } = selection;
    if (provider.type === "github") {
      state.storageMode = provider.type;
      state.clearLoginSetup();
      state.githubPat = githubPatValue(provider.githubPat);
      state.githubRepo = githubRepositoryValue(provider.githubRepo);
      state.clearOauthFile();
      state.clearLocalFolder();
      return storageOk(state.storageMode);
    }
    if (provider.type === "oauth-file") {
      const configuration = provider.oauthFile;
      const decodedConfiguration =
        decodeStoredOAuthFileConfiguration(configuration);
      if (
        decodedConfiguration.kind !==
        StoredOAuthFileConfigurationDecodeKind.Configured
      ) {
        return storageErr(
          new StorageOperationFailure(
            StorageOperationFailureKind.OperationFailed,
          ),
        );
      }
      state.storageMode = provider.type;
      state.clearLoginSetup();
      state.configureOauthFile(decodedConfiguration.config);
      state.githubPat = "";
      const fileName = new OAuthFilePresentation(
        decodedConfiguration.config,
      ).oauthFileName();
      if (fileName.kind === OAuthFileNameKind.Resolved) {
        state.githubRepo = fileName.fileName;
      }
      state.clearLocalFolder();
      return storageOk(state.storageMode);
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
    return storageOk(state.storageMode);
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
            const githubMount: StorageProvider = {
              ...providerPersistenceDefaults(),
              id: "enrollment-github",
              type: GITHUB_PROVIDER_TYPE,
              label: "GitHub",
              githubPat: storedGithubPat(githubPat),
              githubRepo: storedGithubRepository(githubRepo),
              createdAt: isoTimestamp(),
            };
            enrollmentStorageArgs = state.providerWasmArgs(githubMount);
          } else if (
            payload.onboardingType === OnboardingType.SharedProviderGrant
          ) {
            const presetValue = enrollmentProvider.oauthPreset;
            const decodedPreset = await Effect.runPromise(
              Effect.result(OAuthFilePresetDecoder.decode(presetValue)),
            );
            if (decodedPreset._tag === "Failure") {
              state.errorMsg = state.t(I18N_KEYS.ErrorsVaultSelectionFailed);
              return;
            }
            const preset = decodedPreset.success;
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
              // Google preselects the authorized account the link names; the
              // folder's Drive permissions decide whether it can read the vault.
              const invitedAccount = enrollmentProvider.sharedJoinerIdentity;
              const requestGoogleDriveSharedAccessArgs: Parameters<
                typeof googleOAuthSession.requestGoogleDriveSharedAccess
              >[0] = {
                prompt: GoogleOAuthPrompt.Consent,
                accountHint: invitedAccount,
              };
              const tokens =
                await googleOAuthSession.requestGoogleDriveSharedAccess(
                  requestGoogleDriveSharedAccessArgs,
                );
              if (tokens.isErr()) {
                state.errorMsg = state.t(tokens.error.translationKey);
                return;
              }
              const signedIn = await googleOAuthSession.fetchGoogleAccountEmail(
                tokens.value.accessToken,
              );
              if (signedIn.isErr()) {
                state.errorMsg = state.t(signedIn.error.translationKey);
                return;
              }
              const signedInAccount =
                signedIn.value.kind === GoogleAccountIdentityKind.Available
                  ? signedIn.value.label
                  : "";
              try {
                verify_joiner_account(invitedAccount, signedInAccount);
              } catch {
                state.errorMsg = state.t(
                  I18N_KEYS.ErrorsValidationJoinerAccountMismatch,
                );
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
                accountEmail: storedOAuthAccountEmail(signedInAccount),
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
                existingProvider.kind ===
                SharedGrantProviderOutcomeKind.Existing
                  ? existingProvider.provider.oauthFile
                  : oauthConfigurationNotApplicable();
              const decodedExistingConfiguration =
                decodeStoredOAuthFileConfiguration(existingConfiguration);
              const existingConfig =
                decodedExistingConfiguration.kind ===
                StoredOAuthFileConfigurationDecodeKind.Configured
                  ? decodedExistingConfiguration.config
                  : (() => {
                      const defaultOAuthFileConfigArgs3: Parameters<
                        typeof defaultOAuthFileConfig
                      >[0] = { preset: "icloud", fileName: "nook-events" };
                      return defaultOAuthFileConfig(
                        defaultOAuthFileConfigArgs3,
                      );
                    })();
              const existingCredential = oauth_access_token(existingConfig);
              let tokens: Result<ICloudOAuthTokens, OAuthFailure>;
              if (existingCredential.kind === "available") {
                const accountName: ICloudAccountName =
                  existingConfig.accountEmail.state === "email"
                    ? {
                        kind: ICloudAccountNameKind.Available,
                        value: existingConfig.accountEmail.value,
                      }
                    : { kind: ICloudAccountNameKind.Unavailable };
                const availableTokens: ICloudOAuthTokens = {
                  accessToken: existingCredential.token,
                  accountName,
                };
                tokens = storageOk(availableTokens);
              } else {
                const request: Parameters<
                  typeof iCloudOAuthSession.requestICloudWebAuthToken
                >[0] = {
                  signInTimeoutMs: ICLOUD_SIGN_IN_TIMEOUT_MS,
                  clickSignInControl: true,
                };
                tokens =
                  await iCloudOAuthSession.requestICloudWebAuthToken(request);
              }
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
                  existingProvider.kind ===
                  SharedGrantProviderOutcomeKind.Existing
                    ? existingProvider.provider.id
                    : "enrollment-shared-icloud",
                type: OAUTH_FILE_PROVIDER_TYPE,
                label:
                  existingProvider.kind ===
                  SharedGrantProviderOutcomeKind.Existing
                    ? existingProvider.provider.label
                    : state.t(I18N_KEYS.ProviderPickerIcloud),
                oauthFile: configuredOAuthFile(configured.value),
                createdAt:
                  existingProvider.kind ===
                  SharedGrantProviderOutcomeKind.Existing
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
            const decodedProviderConfiguration =
              decodeStoredOAuthFileConfiguration(providerConfiguration);
            if (
              storageTarget.kind === SharedStorageTargetKind.Bound &&
              preset === "google-drive" &&
              decodedProviderConfiguration.kind ===
                StoredOAuthFileConfigurationDecodeKind.Configured &&
              decodedProviderConfiguration.config.folderId.state === "root"
            ) {
              const configuredOAuthFileArgs: Parameters<
                typeof configuredOAuthFile
              >[0] = {
                ...decodedProviderConfiguration.config,
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
            const decodedPreset = await Effect.runPromise(
              Effect.result(OAuthFilePresetDecoder.decode(presetValue)),
            );
            if (decodedPreset._tag === "Failure") {
              state.errorMsg = state.t(I18N_KEYS.ErrorsVaultSelectionFailed);
              return;
            }
            const defaultOAuthFileConfigArgs: Parameters<
              typeof defaultOAuthFileConfig
            >[0] = {
              preset: decodedPreset.success,
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
            // A local provider cannot carry an identity to another app.
            state.errorMsg = state.t(
              I18N_KEYS.IdentityControlJoinLocalProvider,
            );
            return;
          }

          const identityInitialization = await state.initDeviceIdentity();
          if (identityInitialization.isErr()) {
            state.errorMsg = state.t(
              identityInitialization.error.translationKey,
            );
            return;
          }

          const identityId = payload.identityId;
          const identityLabel = payload.identityLabel;
          const joined = await state.enqueueStorage(async () => {
            const admittedManager = state.admitManager();
            if (admittedManager.isErr())
              return storageErr(admittedManager.error);
            try {
              await admittedManager.value.bind_local_identity_to_invitation(
                identityId,
              );
              await admittedManager.value.join_identity_with_invite(
                code,
                password,
                enrollmentStorageArgs.mode,
                enrollmentStorageArgs.pat,
                enrollmentStorageArgs.repo,
              );
              return storageOk(IdentityInviteJoinOutcome.Joined);
            } catch (nativeFailure) {
              return storageErr(new NativeVaultStorageFailure(nativeFailure));
            }
          });
          if (joined.isErr()) {
            state.errorMsg = state.t(joined.error.translationKey);
            return;
          }
          // The mount the join went through becomes this app's identity mount.
          const savedProvider = await state.ensureProviderSaved();
          if (savedProvider.isErr()) {
            state.errorMsg = state.t(savedProvider.error.translationKey);
            return;
          }
          state.joinEnrollmentPrompt = JoinEnrollmentState.None;
          state.loginEnrollmentCode = "";
          state.prefillEnrollmentCode = "";
          state.enrollmentFromUrlPending = false;
          const followed =
            await state.identityControl.followInviteJoin(identityLabel);
          if (followed.isErr()) {
            state.errorMsg = state.t(followed.error.translationKey);
          }
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
