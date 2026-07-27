import {
  getVaultManager,
  isoTimestamp,
  VaultAccessStatus,
  type JoinRequest,
  type NookImportResult,
  type NookSecretListItem,
  type NookSecretRecord,
  type NookVaultSyncResult,
  type AuthenticatorCodeView,
  type VaultItemType,
  type VaultMember,
} from "$lib/nook";
import { consumeEnrollmentFromLocation } from "$lib/enrollment-code";
import { SvelteDate } from "svelte/reactivity";
import {
  chooseLocalFolderBackupDirectory,
  hasActiveLocalVault,
  hasRemoteCredentials as wasmHasRemoteCredentials,
  isLocalFolderBackupSupported,
  isVaultSessionLocked,
  DeviceProtectionStatus,
  JoinEnrollmentState,
  NookBrowserLocale,
  NookClientRunModeUtil,
  NookRuntimeConfig,
  SentinelGenesisPhase,
  type NookSentinelGenesisDelivery,
  type NookSentinelGenesisParticipantStatus,
  NookVaultClientPolicy,
  NookVaultArchitecture,
  RemoteVaultAssessDecision,
  RemoteVaultRecoveryState,
  SentinelVaultUnlockState,
  UnauthenticatedSyncDecision,
  NookVaultSwitchState,
  activeVaultProviders as wasmActiveVaultProviders,
  get_translation_catalog as getTranslationCatalog,
  localProviderIdForActiveVault,
  oauthRemoteStorageRef,
  parseAppLocale,
  providerLabelById,
  providersVisibleWhileDeviceLocked,
  providerWasmArgs as wasmProviderWasmArgs,
  resolveErrorMessage as wasmResolveErrorMessage,
  setActiveVault,
  setVaultSessionLocked,
  stagedRemoteStorageArgs as wasmStagedRemoteStorageArgs,
  stagedProviderLabel as wasmStagedProviderLabel,
  syncProvidersForActiveVault as wasmSyncProvidersForActiveVault,
  translateWithReplacements,
  updateOauthRemoteRef,
  updateProviderSyncMetadata as wasmUpdateProviderSyncMetadata,
  wasmStorageArgs as wasmStorageArgsCore,
  type NookLocalVaultEntry,
  type NookPendingSyncConflict,
  type NookPasswordEntrySummary,
  type NookSecretPage,
  type NookStorageConnectArgs,
  type NookVaultManager,
  type NookAppLocale,
  type PasswordEntryId,
  type StartSentinelGenesisArgs,
  type StoreId,
  type VaultRecoverySummary,
} from "$app-wasm";
import { APP_KIND } from "$lib/app-kind";
import {
  DEFAULT_GITHUB_REPO,
  LOCAL_FOLDER_PROVIDER_TYPE,
  LOCAL_PROVIDER_TYPE,
  OAUTH_FILE_PROVIDER_TYPE,
  type LocalFolderConfig,
  type GoogleDriveMode,
  type ICloudMode,
  type OAuthFileConfig,
  type OAuthFilePreset,
  type StorageProvider,
  type StorageProviderType,
} from "$lib/auth-providers";
import { createLogger } from "$lib/log";
import type { LocalFolderMultipleVaultsIssue } from "$lib/vault/sync";
import {
  createVaultIdleSessionTracker,
  type VaultIdleSessionTracker,
} from "$lib/vault-idle-session";
import {
  setupDeviceProtection as createPasskeyProtection,
  unlockDeviceProtection as authorizePasskeyProtection,
} from "$lib/passkey-device-protection";
import {
  canCreateSecret as architectureCanCreateSecret,
  defaultVaultArchitecture,
  VaultType,
  type DeviceMode,
  type ReplicationType,
  type VaultArchitecture,
} from "$lib/vault-architecture";
import { publishExtensionEventLogUpdate } from "$web-shared/extension/event-log-bridge";
import type { ExtensionEventLogRecord } from "$web-shared/extension/runtime-messages";
import * as localeActions from "$lib/vault/locale";
import * as oauthActions from "$lib/vault/oauth";
import * as providersActions from "$lib/vault/providers";
import * as localLoginActions from "$lib/vault/local-login";
import * as syncActions from "$lib/vault/sync";
import * as multiDeviceActions from "$lib/vault/multi-device";
import * as secretsActions from "$lib/vault/secrets";
import * as passwordUnlockActions from "$lib/vault/password-unlock";
import * as sentinelUnlockActions from "$lib/vault/sentinel-unlock";
import * as idleSessionActions from "$lib/vault/idle-session";
import * as lifecycleActions from "$lib/vault/lifecycle";
import * as sentinelGenesisActions from "$lib/vault/sentinel-genesis";
import {
  clearTabScopedBrowserData,
  deleteLocalBrowserData as deleteBrowserData,
} from "$lib/browser-data";
import { SerialOperationQueue } from "$lib/serial-operation-queue";
import type {
  SentinelStoredDeliverySummary,
  SentinelUnlockSessionStatus,
} from "$lib/vault/sentinel-unlock";
import {
  intoWasmStringValue,
  takeWasmStringValue,
} from "$lib/wasm-string-value";

const vaultLog = createLogger("vault");

type TranslationCatalog = string;

function takeStorageArgsTuple(
  args: NookStorageConnectArgs,
): [string, string, string] {
  try {
    return [args.mode, args.pat, args.repo];
  } finally {
    args.free();
  }
}

export class VaultState {
  browserLocale = new NookBrowserLocale();
  clientPolicy = new NookVaultClientPolicy();
  runtimeConfig = new NookRuntimeConfig(
    NookClientRunModeUtil.parse(
      import.meta.env.VITE_NOOK_CLIENT_RUN_MODE ?? import.meta.env.MODE,
    ),
    import.meta.env.VITE_E2E_EXPOSE_VAULT === "true",
  );

  locale = $state<NookAppLocale>("en");
  translations = $state<TranslationCatalog>(getTranslationCatalog("en"));

  settingsOpen = $state(false);
  settingsSection = $state<"storage" | "onboard" | "admin">("storage");
  settingsAccordionSection = $state<"devices" | "language" | "danger">(
    "devices",
  );
  adminAccordionSection = $state<
    "vaults" | "storage" | "passwords" | "import-export"
  >("vaults");
  helpOpen = $state(false);

  providers = $state.raw<StorageProvider[]>([]);
  providersLoaded = $state(false);
  /** Locally cached vaults on this browser (metadata only). */
  localVaults = $state<NookLocalVaultEntry[]>([]);
  /** Active vault store_id — sync providers and local blob are scoped to this. */
  activeVaultStoreId = $state<StoreId>();
  /** Login gate: user picked a vault but has not unlocked yet. */
  selectedLoginVaultStoreId = $state<StoreId>();
  /** True when the active vault blob exists in IndexedDB. */
  localVaultPresent = $state(false);
  localLoginPrepared = $state(false);
  loginSetupType = $state<StorageProviderType>();
  loginRequiresExistingVault = $state(false);
  existingVaultRecoverySummary = $state<VaultRecoverySummary>();
  addProviderOpen = $state(false);

  storageMode = $state<StorageProviderType>(LOCAL_PROVIDER_TYPE);
  githubPat = $state("");
  githubRepo = $state(DEFAULT_GITHUB_REPO);
  oauthFile = $state.raw<OAuthFileConfig>();
  localFolder = $state.raw<LocalFolderConfig>();
  localFolderBackupSupported = $state(
    typeof window !== "undefined" && isLocalFolderBackupSupported(),
  );
  vaultArchitecture = $state<VaultArchitecture>(defaultVaultArchitecture());
  draftDeviceMode = $state<DeviceMode>("standard");
  draftVaultType = $state(VaultType.Simple);
  draftReplicationType = $state<ReplicationType>("personal");
  sentinelGenesisPhase = $state<SentinelGenesisPhase>(
    SentinelGenesisPhase.Inactive,
  );
  sentinelGenesisRequest = $state("");
  sentinelGenesisParticipantCount = $state(0);
  sentinelGenesisParticipants = $state<NookSentinelGenesisParticipantStatus[]>(
    [],
  );
  sentinelGenesisDeliveries = $state<NookSentinelGenesisDelivery[]>([]);
  sentinelGenesisStoreId = $state<StoreId>();
  oauthSetupPreset = $state<OAuthFilePreset>();
  googleOAuthBusy = $state(false);
  icloudOAuthPreparing = $state(false);
  icloudOAuthReady = $state(false);
  icloudOAuthBusy = $state(false);

  manager = $state<NookVaultManager>();
  deviceProtectionStatus = $state<DeviceProtectionStatus>(
    DeviceProtectionStatus.Loading,
  );
  deviceProtectionLockedStatus = $state<DeviceProtectionStatus>(
    DeviceProtectionStatus.Passkey,
  );
  isAuthenticated = $state(false);
  /** True when the login gate should explain that the last lock was due to idle timeout. */
  sessionExpiredByIdle = $state(false);
  secrets = $state<NookSecretListItem[]>([]);
  secretTotal = $state(0);
  secretPageOffset = $state(0);
  secretPageSize = 50;
  secretQuery = $state("");
  secretTypeFilter = $state<VaultItemType>();
  private secretPageGeneration = 0;

  errorMsg = $state("");
  successMsg = $state("");
  isVerifying = $state(false);
  isSaving = $state(false);
  isInitializing = $state(true);

  deviceId = $state("");
  devicePublicKey = $state("");
  pendingJoins = $state<JoinRequest[]>([]);
  vaultMembers = $state<VaultMember[]>([]);
  enrollSecretsKey = $state("");
  enrollMembersKey = $state("");
  sharedJoinerIdentity = $state("");
  sharedGrantInstructions = $state("");
  joinEnrollmentPrompt = $state<JoinEnrollmentState>(JoinEnrollmentState.None);
  /**
   * True from the moment this device sends a join request until it unlocks.
   * Survives the join dialog being dismissed, so background sync can still
   * auto-connect when the approval lands (`applyVaultSyncResult`).
   */
  awaitingJoinApproval = $state(false);
  lastSyncedAt = $state<SvelteDate>();
  isSyncing = $state(false);
  /** Provider id currently running a manual sync (Settings UI). */
  syncingProviderId = $state<string>();
  /** Background push to all sync providers after a local vault mutation. */
  isFanOutSyncing = $state(false);
  /** Concurrent secret replacement conflicts from the event log projection. */
  replacementConflicts = $state<
    Array<{
      oldSecretId: string;
      candidates: Array<{ eventId: string; secretId: string }>;
    }>
  >([]);
  /** Concurrent key-epoch rotations; local writes fail closed while present. */
  securityConflicts = $state<Array<{ events: string[]; reasons: string[] }>>(
    [],
  );
  /** User must pick local vs remote before editing when versions match but content differs. */
  pendingSyncConflict = $state<NookPendingSyncConflict>();
  /** Local-folder provider points at a folder that contains several vault event logs. */
  localFolderMultipleVaultsIssue = $state<LocalFolderMultipleVaultsIssue>();
  private architectureSecretCreationAllowed = $state(true);

  get syncBlocked(): boolean {
    return this.pendingSyncConflict !== undefined;
  }

  get syncConflictLabel(): string {
    return syncActions.syncConflictLabel(this);
  }

  get editsBlocked(): boolean {
    return this.clientPolicy.editsBlocked(
      this.securityConflicts.length,
      this.syncBlocked,
      this.architectureCanCreateSecret,
    );
  }

  get architectureCanCreateSecret(): boolean {
    return this.architectureSecretCreationAllowed;
  }

  get editBlockMessage(): string | undefined {
    return this.clientPolicy.editBlockMessage(
      this.securityConflicts.length,
      this.syncBlocked,
      this.architectureCanCreateSecret,
      this.translations,
      this.locale,
    );
  }

  get deviceProtectionReady(): boolean {
    return this.deviceProtectionStatus === DeviceProtectionStatus.Unlocked;
  }

  get syncProviderCount(): number {
    return this.syncProviders.length;
  }

  get syncingProviderLabel(): string | undefined {
    if (!this.syncingProviderId) return undefined;
    return providerLabelById(
      $state.snapshot({
        providers: this.providers,
        ...(this.activeVaultStoreId
          ? { activeVaultStoreId: this.activeVaultStoreId }
          : {}),
      }),
      this.syncingProviderId,
    );
  }

  get isSyncActivityVisible(): boolean {
    return this.clientPolicy.isSyncActivityVisible(
      this.isFanOutSyncing,
      this.syncingProviderId !== undefined,
      this.isSyncing,
      this.isSaving,
    );
  }

  /** Open the login password form after Connect finds a password-mode vault. */
  loginPasswordPrompt = $state(false);
  /** Sentinel vault needs a signed, session-bound quorum ceremony. */
  sentinelCeremonyPrompt = $state(false);
  sentinelUnlockStatus = $state<SentinelVaultUnlockState>(
    SentinelVaultUnlockState.NotSentinel,
  );
  /** Public, signed Sentinel unlock request. It contains no share material. */
  sentinelUnlockRequest = $state("");
  /** Rust-owned unlock-session progress rendered by the web layer. */
  sentinelUnlockSession = $state<SentinelUnlockSessionStatus>(
    sentinelUnlockActions.inactiveSentinelUnlockSession(),
  );
  /** Provider-free encrypted deliveries available to this protected device. */
  sentinelStoredDeliveries = $state<SentinelStoredDeliverySummary[]>([]);
  /** Missing-remote prompt and the selected recovery connection path. */
  remoteVaultRecoveryState = $state<RemoteVaultRecoveryState>(
    RemoteVaultRecoveryState.None,
  );
  isPasswordBusy = $state(false);
  passwordError = $state("");
  enrollmentCode = $state("");
  prefillEnrollmentCode = $state("");
  enrollmentFromUrlPending = $state(false);
  loginEnrollmentCode = $state("");
  passwordEntries = $state<NookPasswordEntrySummary[]>([]);
  selectedPasswordEntryId = $state<PasswordEntryId>();
  activeEnrollmentEntryId = $state<PasswordEntryId>();

  get hasPasswordEnvelope(): boolean {
    return this.passwordEntries.length > 0;
  }

  successDismissTimer: ReturnType<typeof setTimeout> | undefined;
  idleSessionTracker: VaultIdleSessionTracker | undefined;
  syncTimer: ReturnType<typeof setInterval> | undefined;
  initPromise: Promise<void> | undefined;
  private storageQueue = new SerialOperationQueue();
  private localDataDeletionStarted = false;
  /** Internal browser-orchestration flag shared with the device-protection actions. */
  deviceAuthorizationInProgress = false;
  pendingEnrollmentFromUrl =
    typeof window !== "undefined" ? consumeEnrollmentFromLocation() : undefined;

  enqueueStorage<T>(operation: () => T | Promise<T>): Promise<T> {
    if (this.localDataDeletionStarted) {
      return Promise.reject(new Error("Local browser data deletion is active"));
    }
    return this.storageQueue.enqueue(operation);
  }

  /** E2E/dev: wait for the serialized wasm storage queue to finish. */
  waitForStorageChain(): Promise<void> {
    return this.storageQueue.onIdle();
  }

  /** E2E/dev: reset a stuck storage queue (abandons in-flight wasm work). */
  resetStorageChain(): void {
    this.storageQueue.reset();
  }

  static storageOpTimeoutMs = 20_000;

  raceStorageTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
    const timeoutMs = VaultState.storageOpTimeoutMs;
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  }

  wasmStorageArgs(): [string, string, string] {
    const syncProvider = this.syncProviders[0];
    return takeStorageArgsTuple(
      wasmStorageArgsCore(
        this.localVaultPresent,
        this.isAuthenticated,
        syncProvider ? $state.snapshot(syncProvider) : undefined,
        this.storageMode,
        this.githubPat,
        this.githubRepo,
        this.oauthFile?.preset,
        this.oauthFile?.accessToken,
        this.oauthFile
          ? oauthRemoteStorageRef($state.snapshot(this.oauthFile))
          : undefined,
        this.oauthFile?.fileName,
      ),
    );
  }

  /** WASM connect always uses the local cache when one exists (unified vault). */
  connectStorageArgs(): [string, string, string] {
    if (this.shouldUseJoinProviderForConnect()) {
      return this.providerWasmArgs(this.syncProviders[0]!);
    }
    return this.wasmStorageArgs();
  }

  shouldUseJoinProviderForConnect(): boolean {
    return this.clientPolicy.shouldUseJoinProviderForConnect(
      this.isAuthenticated,
      this.syncProviders.length,
      this.joinEnrollmentPrompt,
    );
  }

  stagedRemoteStorageArgs(): [string, string, string] | undefined {
    const type = this.loginSetupType ?? this.storageMode;
    const args = wasmStagedRemoteStorageArgs(
      type,
      this.githubPat || undefined,
      this.githubRepo || undefined,
      this.oauthFile ? $state.snapshot(this.oauthFile) : undefined,
    );
    return args ? takeStorageArgsTuple(args) : undefined;
  }

  stagedProviderLabel(): string {
    return wasmStagedProviderLabel(
      this.loginSetupType ?? this.storageMode,
      this.githubRepo,
      this.oauthFile?.fileName,
      this.oauthFile?.preset,
      this.oauthSetupPreset,
    );
  }

  hasRemoteCredentials(): boolean {
    return wasmHasRemoteCredentials(
      this.storageMode,
      this.githubPat,
      this.oauthFile?.accessToken,
      this.localFolder?.handleId,
    );
  }

  syncOAuthRemoteRefFromManager() {
    if (
      this.storageMode !== OAUTH_FILE_PROVIDER_TYPE ||
      !this.manager ||
      !this.oauthFile
    ) {
      return;
    }
    const updated = updateOauthRemoteRef(
      $state.snapshot(this.oauthFile),
      this.manager.storage_remote_ref ?? "",
    );
    if (updated) this.oauthFile = updated;
  }

  async ensureOAuthTokensFresh(): Promise<void> {
    return oauthActions.ensureOAuthTokensFresh(this);
  }

  selectGoogleDriveMode(mode: GoogleDriveMode): void {
    oauthActions.selectGoogleDriveMode(this, mode);
  }

  selectICloudMode(mode: ICloudMode): void {
    oauthActions.selectICloudMode(this, mode);
  }

  async chooseLocalFolderBackupDirectory(): Promise<void> {
    this.refreshLocalFolderBackupSupport();
    if (!this.localFolderBackupSupported) {
      throw new Error(
        this.t("provider_setup.local_folder_unsupported_browser"),
      );
    }
    const folder = await chooseLocalFolderBackupDirectory();
    this.localFolder = {
      directoryName: folder.directoryName,
      handleId: folder.handleId,
    };
  }

  refreshLocalFolderBackupSupport(): void {
    this.localFolderBackupSupported =
      typeof window !== "undefined" && isLocalFolderBackupSupported();
  }

  dismissSuccess() {
    if (this.successDismissTimer !== undefined) {
      clearTimeout(this.successDismissTimer);
      this.successDismissTimer = undefined;
    }
    this.successMsg = "";
  }

  dismissError() {
    this.errorMsg = "";
  }

  showSuccess(message: string) {
    this.dismissSuccess();
    this.successMsg = message;
    this.successDismissTimer = setTimeout(() => {
      this.dismissSuccess();
    }, 5000);
  }

  get localProvider(): StorageProvider | undefined {
    const id = localProviderIdForActiveVault(
      $state.snapshot({
        providers: this.providers,
        ...(this.activeVaultStoreId
          ? { activeVaultStoreId: this.activeVaultStoreId }
          : {}),
      }),
      this.activeVaultStoreId,
    );
    return id
      ? this.providers.find((provider) => provider.id === id)
      : undefined;
  }

  /** Providers belonging to the active vault only. */
  get activeVaultProviders(): StorageProvider[] {
    return wasmActiveVaultProviders(
      $state.snapshot({
        providers: this.providers,
        ...(this.activeVaultStoreId
          ? { activeVaultStoreId: this.activeVaultStoreId }
          : {}),
      }),
      this.activeVaultStoreId,
    ).providers;
  }

  /** Cloud sync destinations for the active vault — local row omitted. */
  get syncProviders(): StorageProvider[] {
    return wasmSyncProvidersForActiveVault(
      $state.snapshot({
        providers: this.providers,
        ...(this.activeVaultStoreId
          ? { activeVaultStoreId: this.activeVaultStoreId }
          : {}),
      }),
      this.activeVaultStoreId,
    ).providers;
  }

  get hasMultipleLocalVaults(): boolean {
    return this.localVaults.length > 1;
  }

  get showLoginVaultPicker(): boolean {
    return this.clientPolicy.shouldShowLoginVaultPicker(
      this.isAuthenticated,
      this.localVaults.length,
      this.selectedLoginVaultStoreId !== undefined,
      this.loginSetupType !== undefined,
      this.addProviderOpen,
      isVaultSessionLocked(),
    );
  }

  providerWasmArgs(provider: StorageProvider): [string, string, string] {
    return takeStorageArgsTuple(
      wasmProviderWasmArgs($state.snapshot(provider)),
    );
  }

  async updateLocale(
    newLocale: NookAppLocale,
    options?: { preferWasm?: boolean },
  ) {
    return localeActions.updateLocale(this, newLocale, options);
  }

  resolveErrorMessage(message: string): string {
    return wasmResolveErrorMessage(this.translations, this.locale, message);
  }

  t = (key: string, replacements?: Record<string, string>): string => {
    const entries = replacements ? Object.entries(replacements) : [];
    return translateWithReplacements(
      this.translations,
      this.locale,
      key,
      entries.map(([name]) => name),
      entries.map(([, value]) => value),
    );
  };

  async init() {
    return lifecycleActions.init(this);
  }

  async initOnce() {
    vaultLog.info("app init started");
    this.isInitializing = true;
    let deviceIdentityUnlocked = false;
    if (!this.isVerifying) {
      this.errorMsg = "";
    }
    try {
      const savedLocale = takeWasmStringValue(
        parseAppLocale(
          intoWasmStringValue(localStorage.getItem("nook_locale") ?? undefined),
        ),
      ) as NookAppLocale | undefined;
      const browserLocale = this.browserLocale.appLocale() as NookAppLocale;
      const locale = savedLocale ?? browserLocale;
      await this.updateLocale(locale);
      await localLoginActions.refreshLocalVaultCatalog(this);
      this.manager = await getVaultManager();
      if (this.manager.vaultApplication !== APP_KIND) {
        throw new Error(
          this.t("app.capability_mismatch", {
            app: APP_KIND,
            wasm: this.manager.vaultApplication,
          }),
        );
      }
      await this.updateLocale(locale, { preferWasm: true });
      this.deviceProtectionStatus = await this.manager.deviceProtectionStatus();
      const persistedDeviceMode =
        await this.manager.deviceProtectionDeviceMode();
      if (
        persistedDeviceMode === "standard" ||
        persistedDeviceMode === "anti-hacker"
      ) {
        this.draftDeviceMode = persistedDeviceMode;
      }
      if (this.deviceProtectionStatus === DeviceProtectionStatus.Pin) {
        this.deviceProtectionLockedStatus = DeviceProtectionStatus.Pin;
      } else if (
        this.deviceProtectionStatus === DeviceProtectionStatus.Passkey
      ) {
        this.deviceProtectionLockedStatus = DeviceProtectionStatus.Passkey;
      }

      const autoAuthorizeE2e =
        this.runtimeConfig.e2eExposeVault &&
        localStorage.getItem("nook_e2e_manual_passkey") !== "true";
      if (!this.deviceProtectionReady && autoAuthorizeE2e) {
        if (this.deviceProtectionStatus === DeviceProtectionStatus.Passkey) {
          await this.enqueueStorage(() =>
            authorizePasskeyProtection(this.manager!),
          );
        } else if (this.deviceProtectionStatus === DeviceProtectionStatus.Pin) {
          return;
        } else {
          await this.enqueueStorage(() =>
            createPasskeyProtection(this.manager!, ""),
          );
        }
        deviceIdentityUnlocked = true;
        this.deviceAuthorizationInProgress = true;
      }

      if (!this.deviceProtectionReady && !deviceIdentityUnlocked) {
        // Empty-device Landing → Sentinel: show create flow before passkey.
        // Existing-vault unlock stays in LoginGate with passkey authorization
        // presented by PasskeyAuthOverlay.
        //
        // `#enroll=` joins an existing vault — promote the code into LoginGate
        // before returning so the create-vault landing never swallows onboarding.
        if (this.pendingEnrollmentFromUrl) {
          const code = this.pendingEnrollmentFromUrl;
          this.pendingEnrollmentFromUrl = undefined;
          this.prefillEnrollmentCode = code;
          this.enrollmentFromUrlPending = true;
        }
        if (!this.localVaultPresent && this.localVaults.length === 0) {
          try {
            await this.loadProviders({ ensureLocalRow: true });
            this.applyActiveProviderCredentials();
          } catch (error) {
            vaultLog.warn("empty-device provider load deferred until passkey", {
              error: error instanceof Error ? error.message : String(error),
            });
            this.providersLoaded = true;
          }
        }
        return;
      }
      await this.continueInitializationAfterDeviceUnlock();
      this.deviceProtectionStatus = DeviceProtectionStatus.Unlocked;
    } catch (error) {
      if (
        this.deviceProtectionStatus === DeviceProtectionStatus.Unlocked ||
        deviceIdentityUnlocked
      ) {
        void this.lockDeviceProtection();
      }
      this.deviceProtectionStatus =
        this.deviceProtectionStatus === DeviceProtectionStatus.Loading
          ? DeviceProtectionStatus.Error
          : this.deviceProtectionStatus;
      this.errorMsg =
        error instanceof Error
          ? error.message
          : "Failed to initialize Nook Session Manager.";
    } finally {
      this.deviceAuthorizationInProgress = false;
      this.isInitializing = false;
    }
  }

  async continueInitializationAfterDeviceUnlock() {
    if (!this.manager) return;
    await this.initDeviceIdentity({ allowPendingAuthorization: true });
    if (
      await this.enqueueStorage(() =>
        this.manager!.hasPendingSentinelGenesisFinalization(),
      )
    ) {
      const rawResult = await this.enqueueStorage(() =>
        this.manager!.resumePendingSentinelGenesisFinalization(),
      );
      sentinelGenesisActions.applyFinalizeResult(this, rawResult);
    }
    await this.loadProviders({ ensureLocalRow: true });
    await localLoginActions.refreshLocalVaultCatalog(this);
    if (!this.activeVaultStoreId) {
      this.activeVaultStoreId = this.localVaults[0]?.storeId;
    }
    if (this.activeVaultStoreId) {
      await setActiveVault(this.activeVaultStoreId).catch(() => undefined);
    }
    this.localVaultPresent = await hasActiveLocalVault();
    if (this.localVaultPresent) {
      this.storageMode = LOCAL_PROVIDER_TYPE;
      this.githubPat = "";
      this.oauthFile = undefined;
      this.localFolder = undefined;
    } else {
      this.applyActiveProviderCredentials();
    }
    const hasPendingEnrollment = Boolean(this.pendingEnrollmentFromUrl);
    if (this.localVaultPresent) {
      this.storageMode = LOCAL_PROVIDER_TYPE;
      await this.refreshPasswordEntriesList();
    }
    const autoUnlock = !hasPendingEnrollment && this.shouldAutoUnlock();
    if (autoUnlock) {
      await this.loadDb();
      if (!this.isAuthenticated && this.localProvider) {
        void this.refreshPasswordEntriesList();
      }
    } else {
      await this.refreshDeviceState();
    }

    if (this.pendingEnrollmentFromUrl && !this.isAuthenticated) {
      const code = this.pendingEnrollmentFromUrl;
      this.pendingEnrollmentFromUrl = undefined;
      this.prefillEnrollmentCode = code;
      this.enrollmentFromUrlPending = true;
    }

    // A password-only session may have queued local event-log writes while
    // provider credentials were still sealed. Once passkey/PIN authorization
    // reloads those credentials, flush the pending events before normal polling
    // resumes so remote replicas do not wait for another user edit.
    if (this.isAuthenticated) {
      await this.runFanOutSyncAfterLocalSave();
      this.startVaultSync();
    }

    vaultLog.info("app init finished", {
      localVaultPresent: this.localVaultPresent,
      authenticated: this.isAuthenticated,
      providers: this.providers.length,
      syncProviders: this.syncProviders.length,
      deviceId: this.deviceId || undefined,
    });
  }

  async initDeviceIdentity(options?: { allowPendingAuthorization?: boolean }) {
    if (
      !this.manager ||
      (!this.deviceProtectionReady &&
        !this.deviceAuthorizationInProgress &&
        !options?.allowPendingAuthorization)
    ) {
      throw new Error(
        this.t("errors.device_protection.authorization_required"),
      );
    }
    const identity = await this.enqueueStorage(() => ({
      deviceId: this.manager!.device_id,
      devicePublicKey: this.manager!.device_public_key,
    }));
    this.deviceId = identity.deviceId;
    this.devicePublicKey = identity.devicePublicKey;
  }

  async authorizeWithExternalDeviceIdentity(
    adopt: (manager: NookVaultManager) => Promise<void>,
    options?: { deferInitialization?: boolean },
  ): Promise<boolean> {
    if (!this.manager) return false;
    const priorDeviceProtectionStatus = this.deviceProtectionStatus;
    this.errorMsg = "";
    this.isVerifying = true;
    this.deviceAuthorizationInProgress = true;
    try {
      await this.enqueueStorage(() => adopt(this.manager!));
      if (options?.deferInitialization) {
        await this.initDeviceIdentity({ allowPendingAuthorization: true });
      } else {
        await this.continueInitializationAfterDeviceUnlock();
      }
      this.deviceProtectionStatus = DeviceProtectionStatus.Unlocked;
      vaultLog.info("extension identity adopted", {
        deviceId: this.deviceId,
      });
      return true;
    } catch (error) {
      await this.enqueueStorage(() =>
        this.manager!.rollbackExtensionIdentityHandoff(),
      );
      this.deviceProtectionStatus =
        priorDeviceProtectionStatus === DeviceProtectionStatus.Unlocked
          ? this.deviceProtectionLockedStatus
          : priorDeviceProtectionStatus;
      this.errorMsg = this.t("extension.connect.identity_handoff_failed");
      vaultLog.warn("extension identity handoff failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    } finally {
      this.deviceAuthorizationInProgress = false;
      this.isVerifying = false;
    }
  }

  get draftVaultArchitecture(): VaultArchitecture {
    return NookVaultArchitecture.draft(
      this.draftDeviceMode,
      this.draftVaultType,
      this.draftReplicationType,
    );
  }

  replaceVaultArchitecture(architecture: VaultArchitecture): void {
    const previous = this.vaultArchitecture;
    this.vaultArchitecture = architecture;
    if (previous !== architecture) previous.free();
  }

  applyDraftVaultArchitecture() {
    this.replaceVaultArchitecture(this.draftVaultArchitecture);
    this.architectureSecretCreationAllowed = architectureCanCreateSecret(
      this.vaultArchitecture,
    );
    if (this.manager) {
      this.manager.setVaultArchitecture(this.vaultArchitecture);
    }
  }

  refreshVaultArchitectureFromManager() {
    if (!this.manager) return;
    let architecture: VaultArchitecture;
    try {
      architecture = this.manager.vaultArchitecture as VaultArchitecture;
    } catch (error) {
      vaultLog.warn("vault architecture metadata could not be loaded", {
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    this.replaceVaultArchitecture(architecture);
    this.architectureSecretCreationAllowed = architectureCanCreateSecret(
      this.vaultArchitecture,
    );
    this.draftDeviceMode = this.vaultArchitecture.device_mode;
    this.draftVaultType = this.vaultArchitecture.vault_type;
    this.draftReplicationType = this.vaultArchitecture.replication_type;
    void this.refreshArchitectureSecretCreationAllowed();
  }

  async refreshArchitectureSecretCreationAllowed(): Promise<void> {
    const fallback = architectureCanCreateSecret(this.vaultArchitecture);
    if (!this.manager) {
      this.architectureSecretCreationAllowed = fallback;
      return;
    }
    try {
      this.architectureSecretCreationAllowed = await this.enqueueStorage(() =>
        this.manager!.canCreateSecretForVaultArchitecture(),
      );
    } catch {
      this.architectureSecretCreationAllowed = fallback;
    }
  }

  shouldAutoUnlock(): boolean {
    return this.clientPolicy.shouldAutoUnlock(
      isVaultSessionLocked(),
      this.localVaultPresent,
      this.passwordEntries.length,
      this.syncProviders.length,
      this.loginSetupType !== undefined,
      this.addProviderOpen,
    );
  }

  /** Prepare login gate for local vault unlock (password or device keys). */
  async prepareLocalLogin(): Promise<void> {
    return localLoginActions.prepareLocalLogin(this);
  }

  /**
   * First-time setup: create an empty local vault secured by this device's keys.
   */
  async createLocalVaultWithDeviceKeys(label?: string): Promise<void> {
    return localLoginActions.createLocalVaultWithDeviceKeys(this, label);
  }

  async startSentinelGenesis(args: StartSentinelGenesisArgs): Promise<void> {
    return sentinelGenesisActions.start(this, $state.snapshot(args));
  }

  async renameLocalVault(storeId: StoreId, label: string): Promise<void> {
    return localLoginActions.renameLocalVaultLabel(this, storeId, label);
  }

  async selectVaultForUnlock(storeId: StoreId): Promise<void> {
    return localLoginActions.selectVaultForUnlock(this, storeId);
  }

  async prepareExistingVaultImportSlot(): Promise<void> {
    return localLoginActions.prepareExistingVaultImportSlot(this);
  }

  async reloadProvidersForActiveVault(): Promise<void> {
    const snapshot = await this.enqueueStorage(() =>
      this.manager!.loadAuthProviders(),
    );
    this.providers = snapshot.providers;
    if (snapshot.activeVaultStoreId) {
      this.activeVaultStoreId = snapshot.activeVaultStoreId;
    }
    this.applyActiveProviderCredentials();
  }

  async syncActiveVaultStoreIdToAuth(): Promise<void> {
    return localLoginActions.syncActiveVaultStoreIdToAuth(this);
  }

  async activateConnectedExistingVault(storeId: StoreId): Promise<void> {
    return localLoginActions.activateConnectedExistingVault(this, storeId);
  }

  beginLoginVaultPicker() {
    this.selectedLoginVaultStoreId = undefined;
    this.localLoginPrepared = false;
    this.resetVaultSessionState();
  }

  async chooseLoginVault(storeId: StoreId) {
    await this.selectVaultForUnlock(storeId);
    this.selectedLoginVaultStoreId = storeId;
  }

  async refreshLocalVaultCatalog(): Promise<void> {
    return localLoginActions.refreshLocalVaultCatalog(this);
  }

  /** Lock and open the login unlock step for another vault on this device. */
  async switchToVault(storeId: StoreId): Promise<void> {
    const switchDecision = this.clientPolicy.vaultSwitchTarget(
      storeId,
      this.activeVaultStoreId !== undefined,
      this.activeVaultStoreId ?? "",
      this.isVerifying,
    );
    if (switchDecision.state !== NookVaultSwitchState.Switch) {
      switchDecision.free();
      return;
    }
    const target = switchDecision.target();
    switchDecision.free();
    this.helpOpen = false;
    this.cancelProviderSetup();
    this.cancelAddProvider();
    this.isVerifying = true;
    try {
      await this.waitForStorageChain();
      setVaultSessionLocked(true);
      this.clearUnlockedSession();
      await this.waitForStorageChain();
      await this.chooseLoginVault(target);
      this.isVerifying = true;
      await this.lockDeviceProtection();
      vaultLog.info("vault switch completed", { storeId: target });
    } catch (error) {
      this.errorMsg =
        error instanceof Error ? error.message : "Failed to switch vaults.";
    } finally {
      this.isVerifying = false;
    }
  }

  lockDeviceProtection(): Promise<void> {
    this.deviceProtectionStatus = this.deviceProtectionLockedStatus;
    this.deviceAuthorizationInProgress = false;
    this.deviceId = "";
    this.devicePublicKey = "";
    // Sync-provider credentials are sealed to the protected device identity.
    // Keep only the non-secret local row in memory while that identity is
    // locked; passkey/PIN authorization reloads the sealed providers.
    this.providers = providersVisibleWhileDeviceLocked(
      $state.snapshot({
        providers: this.providers,
        ...(this.activeVaultStoreId
          ? { activeVaultStoreId: this.activeVaultStoreId }
          : {}),
      }),
    ).providers;
    this.providersLoaded = this.providers.length > 0;
    this.githubPat = "";
    this.oauthFile = undefined;
    this.localFolder = undefined;
    if (this.localVaultPresent) {
      this.storageMode = LOCAL_PROVIDER_TYPE;
    }
    if (!this.manager) return Promise.resolve();
    return this.enqueueStorage(() => this.manager!.lockDeviceIdentity()).catch(
      () => {
        // Persisted identity remains wrapped even if the manager is tearing down.
      },
    );
  }

  async loadProviders(options?: { ensureLocalRow?: boolean }) {
    return providersActions.loadProviders(this, options);
  }

  applyActiveProviderCredentials() {
    return providersActions.applyActiveProviderCredentials(this);
  }

  async persistProviders(opts?: { replace?: boolean }) {
    return providersActions.persistProviders(this, opts);
  }

  beginProviderSetup(type: StorageProviderType, oauthPreset?: OAuthFilePreset) {
    return providersActions.beginProviderSetup(this, type, oauthPreset);
  }

  beginExistingVaultOpen() {
    this.loginRequiresExistingVault = true;
    this.remoteVaultRecoveryState = RemoteVaultRecoveryState.None;
    this.errorMsg = "";
  }

  cancelExistingVaultOpen() {
    this.loginRequiresExistingVault = false;
    this.remoteVaultRecoveryState = RemoteVaultRecoveryState.None;
    this.errorMsg = "";
  }

  beginAddProvider() {
    return providersActions.beginAddProvider(this);
  }

  cancelAddProvider() {
    return providersActions.cancelAddProvider(this);
  }

  cancelProviderSetup() {
    return providersActions.cancelProviderSetup(this);
  }

  async refreshPasswordEntriesList(): Promise<boolean> {
    return secretsActions.refreshPasswordEntriesList(this);
  }

  clearRemoteVaultRecovery() {
    return syncActions.clearRemoteVaultRecovery(this);
  }

  /** User chose to restore a deleted remote vault from the browser cache. */
  async confirmRecoverRemoteVault(): Promise<void> {
    return syncActions.confirmRecoverRemoteVault(this);
  }

  /** User chose to create a fresh vault file on remote storage. */
  async confirmCreateFreshRemoteVault(): Promise<void> {
    return syncActions.confirmCreateFreshRemoteVault(this);
  }

  async assessVaultConnectStatus(
    argsOverride?: [string, string, string],
  ): Promise<VaultAccessStatus> {
    const args = argsOverride ?? this.connectStorageArgs();
    return (await this.enqueueStorage(async () => {
      const assessPromise = this.manager!.assess_vault_connect(...args);
      const assessTimeout = new Promise<never>((_, reject) => {
        setTimeout(() => {
          const timeoutError = new Error(
            "Connection timed out. Check your PAT, network, and try again.",
          );
          timeoutError.name = providersActions.VAULT_ASSESS_TIMEOUT_ERROR_NAME;
          reject(timeoutError);
        }, 30_000);
      });
      return await Promise.race([assessPromise, assessTimeout]);
    })) as VaultAccessStatus;
  }

  async handleRemoteVaultAssessStatus(
    accessStatus: VaultAccessStatus,
  ): Promise<boolean> {
    const decision = this.clientPolicy.remoteVaultAssessDecision(
      accessStatus,
      this.loginRequiresExistingVault,
      this.loginSetupType !== undefined,
    );
    switch (decision) {
      case RemoteVaultAssessDecision.PromptRecoveryFromCache:
        this.remoteVaultRecoveryState =
          RemoteVaultRecoveryState.PromptWithCache;
        await this.refreshPasswordEntriesList();
        return true;
      case RemoteVaultAssessDecision.RejectMissingExistingVault:
        this.remoteVaultRecoveryState = RemoteVaultRecoveryState.None;
        this.errorMsg = this.t("auth_storage.existing_vault_not_found");
        return true;
      case RemoteVaultAssessDecision.PromptMissingRemote:
        this.remoteVaultRecoveryState =
          RemoteVaultRecoveryState.PromptMissingOnly;
        return true;
      default:
        return false;
    }
  }

  /** Clear wasm session + login password preview so UI matches the active provider. */
  resetVaultSessionState(resetManager = true) {
    if (resetManager && this.manager) {
      void this.enqueueStorage(() => this.manager!.resetVaultSession()).catch(
        () => {
          // Engine may be tearing down.
        },
      );
    }
    this.passwordEntries = [];
    this.selectedPasswordEntryId = undefined;
    this.loginPasswordPrompt = false;
    this.sentinelCeremonyPrompt = false;
    this.sentinelUnlockStatus = SentinelVaultUnlockState.NotSentinel;
    this.sentinelUnlockRequest = "";
    this.sentinelUnlockSession.free();
    this.sentinelUnlockSession =
      sentinelUnlockActions.inactiveSentinelUnlockSession();
    for (const delivery of this.sentinelStoredDeliveries) delivery.free();
    this.sentinelStoredDeliveries = [];
    sentinelGenesisActions.releaseResults(this);
    this.sentinelGenesisPhase = SentinelGenesisPhase.Inactive;
    this.sentinelGenesisRequest = "";
    this.sentinelGenesisStoreId = undefined;
    this.sharedJoinerIdentity = "";
    this.sharedGrantInstructions = "";
  }

  ensureIdleSessionTracker() {
    if (this.idleSessionTracker) return;
    this.idleSessionTracker = createVaultIdleSessionTracker({
      timeoutMs: this.runtimeConfig.resolveVaultIdleTimeoutMs(
        intoWasmStringValue(
          import.meta.env.VITE_VAULT_IDLE_TIMEOUT_MS ?? undefined,
        ),
      ),
      warningMs: this.runtimeConfig.resolveVaultIdleWarningMs(
        intoWasmStringValue(
          import.meta.env.VITE_VAULT_IDLE_WARNING_MS ?? undefined,
        ),
      ),
      onExpire: () => this.lockVaultDueToIdle(),
      onWarning: () => this.showIdleLockWarning(),
    });
  }

  startIdleSessionTracking() {
    return idleSessionActions.startIdleSessionTracking(this);
  }

  stopIdleSessionTracking() {
    return idleSessionActions.stopIdleSessionTracking(this);
  }

  showIdleLockWarning() {
    if (!this.isAuthenticated) return;
    this.showSuccess(this.t("session.idle_warning"));
  }

  lockVaultDueToIdle() {
    if (!this.isAuthenticated) return;
    this.sessionExpiredByIdle = true;
    this.lockVault();
  }

  markVaultUnlocked() {
    setVaultSessionLocked(false);
    this.isAuthenticated = true;
    this.awaitingJoinApproval = false;
    this.sessionExpiredByIdle = false;
    this.refreshVaultArchitectureFromManager();
    vaultLog.info("vault session unlocked", { secrets: this.secrets.length });
    void this.publishExtensionEventLogUpdate();
  }

  clearUnlockedSession(resetManager = true) {
    this.secretPageGeneration += 1;
    this.stopIdleSessionTracking();
    this.stopVaultSync();
    this.isAuthenticated = false;
    for (const secret of this.secrets) secret.free();
    this.secrets = [];
    this.secretTotal = 0;
    this.secretPageOffset = 0;
    this.secretQuery = "";
    this.secretTypeFilter = undefined;
    this.pendingJoins = [];
    this.vaultMembers = [];
    this.joinEnrollmentPrompt = JoinEnrollmentState.None;
    this.enrollSecretsKey = "";
    this.enrollMembersKey = "";
    this.sharedJoinerIdentity = "";
    this.sharedGrantInstructions = "";
    this.settingsOpen = false;
    this.enrollmentCode = "";
    this.errorMsg = "";
    const wasSentinel =
      this.vaultArchitecture.vault_type === VaultType.Sentinel;
    this.resetVaultSessionState(resetManager);
    if (wasSentinel) {
      this.sentinelCeremonyPrompt = true;
      this.sentinelUnlockStatus = SentinelVaultUnlockState.CeremonyRequired;
    }
  }

  /** Drop a saved sync provider from this browser. Local vault row cannot be removed. */
  async removeProvider(id: string): Promise<void> {
    return providersActions.removeProvider(this, id);
  }

  async ensureProviderSaved(): Promise<boolean> {
    return providersActions.ensureProviderSaved(this);
  }

  startVaultSync() {
    return syncActions.startVaultSync(this);
  }

  stopVaultSync() {
    return syncActions.stopVaultSync(this);
  }

  applyVaultSyncResult(result: NookVaultSyncResult) {
    if (this.isAuthenticated) {
      this.pendingJoins = result.pendingJoins;
      this.vaultMembers = result.vaultMembers;
      return;
    }

    vaultLog.debug("sync result (unauthenticated)", {
      changed: result.changed,
      accessStatus: result.accessStatus,
      joinEnrollmentPrompt: this.joinEnrollmentPrompt,
    });

    if (result.accessStatus !== undefined) {
      vaultLog.info("sync state changed (login gate)", {
        accessStatus: result.accessStatus,
        pendingJoins: result.pendingJoins.length,
      });
    }

    const decision = this.clientPolicy.unauthenticatedSyncDecision(
      result.changed,
      result.accessStatus !== undefined,
      result.accessStatus ?? VaultAccessStatus.NewVault,
      this.joinEnrollmentPrompt,
      this.awaitingJoinApproval,
    );
    switch (decision) {
      case UnauthenticatedSyncDecision.Approved:
        this.joinEnrollmentPrompt = JoinEnrollmentState.None;
        this.showSuccess(this.t("toasts.device_approved"));
        this.scheduleAutoConnectAfterApproval();
        break;
      case UnauthenticatedSyncDecision.AutoConnect:
        this.scheduleAutoConnectAfterApproval();
        break;
      case UnauthenticatedSyncDecision.MarkJoinPending:
        this.joinEnrollmentPrompt = JoinEnrollmentState.Pending;
        this.awaitingJoinApproval = true;
        break;
    }
  }

  /** Connect once the remote reports this device enrolled (post-approval). */
  private scheduleAutoConnectAfterApproval() {
    if (
      !this.clientPolicy.shouldAutoConnectAfterApproval(
        this.isAuthenticated,
        this.isVerifying,
        this.loginPasswordPrompt,
        this.sessionExpiredByIdle,
        isVaultSessionLocked(),
      )
    ) {
      return;
    }
    vaultLog.info("scheduling auto-connect after join approval");
    // Fire-and-forget outside the sync call stack: loadDb serializes wasm
    // access through the storage chain and guards itself with isVerifying.
    setTimeout(() => {
      if (this.isAuthenticated || this.isVerifying) return;
      void this.loadDb();
    }, 0);
  }

  /**
   * Read multi-device state + unlock mode from the wasm manager.
   *
   * Async because every call into the wasm manager (even sync `&self`
   * methods) shares the same wasm-bindgen borrow with in-flight async
   * `&mut self` calls like `sync_vault_from_storage`. Routing through
   * `enqueueStorage` guarantees these reads observe a quiescent
   * manager rather than racing it.
   */
  async hydrateMultiDeviceState(): Promise<void> {
    if (!this.manager || !this.isAuthenticated) return;
    const mergedJoins: JoinRequest[] = [];
    try {
      for (const provider of this.syncProviders) {
        if (provider.type === LOCAL_FOLDER_PROVIDER_TYPE) {
          await syncActions.syncLocalFolderProvider(this, provider);
          continue;
        }
        const [mode, pat, repo] = this.providerWasmArgs(provider);
        const joins = (await this.enqueueStorage(() =>
          this.manager!.mergeRemoteJoinsFromProvider(mode, pat, repo),
        )) as JoinRequest[];
        if (joins.length > 0) {
          mergedJoins.push(...joins);
        }
      }
    } catch {
      // Merge can fail transiently while wasm is busy; still read session joins.
    }
    try {
      const snapshot = await this.enqueueStorage(async () => {
        await Promise.resolve();
        try {
          await this.manager!.ensureVaultRosterHydrated();
        } catch {
          // Roster repair is best-effort; still read the current session.
        }
        let pendingJoins: JoinRequest[];
        let vaultMembers: VaultMember[];
        try {
          pendingJoins = this.manager!.list_pending_joins();
        } catch {
          pendingJoins = [];
        }
        try {
          vaultMembers = this.manager!.list_vault_members();
        } catch {
          vaultMembers = [];
        }
        return {
          pendingJoins,
          vaultMembers,
        };
      });
      this.pendingJoins =
        snapshot.pendingJoins.length > 0 ? snapshot.pendingJoins : mergedJoins;
      this.vaultMembers = snapshot.vaultMembers;
      await this.refreshPasswordEntriesList();
    } catch {
      this.vaultMembers = [];
    }
  }

  async syncFromStorage(options?: { force?: boolean }) {
    return syncActions.syncFromStorage(this, options);
  }

  /** Pull local vault from every sync provider (background / manual refresh). */
  async syncFromSyncProviders(options?: {
    quiet?: boolean;
    force?: boolean;
  }): Promise<void> {
    if (!this.manager) return;
    if (
      !this.clientPolicy.shouldSyncFromProviders(
        this.syncBlocked,
        options?.force ?? false,
        this.isVerifying,
        this.isSaving,
        this.isPasswordBusy,
        this.isSyncing,
        this.syncProviders.length,
      )
    ) {
      return;
    }

    this.isSyncing = true;
    try {
      for (const provider of this.syncProviders) {
        if (this.syncBlocked) break;
        await this.syncProviderById(provider.id, {
          quiet: options?.quiet ?? true,
        });
      }
      if (this.isAuthenticated) {
        await this.hydrateMultiDeviceState();
      }
      await this.publishExtensionEventLogUpdate();
      this.lastSyncedAt = new SvelteDate();
    } catch {
      // Background sync should not interrupt the UI.
    } finally {
      this.isSyncing = false;
    }
  }

  async manualSync() {
    return syncActions.manualSync(this);
  }

  /** Sync local event log with one provider. */
  async syncProviderById(
    providerId: string,
    options?: { quiet?: boolean; propagateError?: boolean },
  ): Promise<void> {
    return syncActions.syncProviderById(this, providerId, options);
  }

  fanOutSyncChain: Promise<void> = Promise.resolve();

  /** Push the local vault to every connected sync provider (after CRUD or manual sync). */
  async fanOutSyncToProviders(options?: { quiet?: boolean }): Promise<void> {
    return syncActions.fanOutSyncToProviders(this, options);
  }

  async runFanOutSyncToProviders(options?: { quiet?: boolean }): Promise<void> {
    if (this.isFanOutSyncing) return;

    this.isFanOutSyncing = true;
    try {
      for (const provider of this.syncProviders) {
        if (this.syncBlocked) break;
        await this.syncProviderById(provider.id, {
          quiet: options?.quiet ?? true,
        });
      }
    } finally {
      this.isFanOutSyncing = false;
    }
  }

  async runFanOutSyncAfterLocalSave(): Promise<void> {
    await this.publishExtensionEventLogUpdate();
    if (!this.deviceProtectionReady) return;
    if (this.syncProviders.length === 0) {
      await this.flushRemoteEventOutboxNow();
      return;
    }
    for (const provider of this.syncProviders) {
      if (this.syncBlocked) break;
      await this.flushRemoteEventOutboxNow(provider);
    }
  }

  async publishExtensionEventLogUpdate(): Promise<void> {
    if (!this.manager) return;
    try {
      const vaultStoreId =
        this.activeVaultStoreId ??
        (await this.enqueueStorage(() => this.manager!.vaultStoreId));
      const eventLogRecords = await this.enqueueStorage(() =>
        this.manager!.exportEventLogRecords(),
      );
      try {
        publishExtensionEventLogUpdate(
          vaultStoreId,
          eventLogRecords.toArray() as ExtensionEventLogRecord[],
        );
      } finally {
        eventLogRecords.free();
      }
    } catch {
      // The extension bridge is optional and must never make a vault save fail.
      vaultLog.warn("extension event-log notification failed");
    }
  }

  scheduleFanOutSyncAfterLocalSave(): void {
    void this.runFanOutSyncAfterLocalSave();
  }

  remoteEventProviderArgs(
    provider?: StorageProvider,
  ): [string, string, string] | undefined {
    if (provider && provider.type === LOCAL_FOLDER_PROVIDER_TYPE) {
      return undefined;
    }
    if (provider) {
      return this.providerWasmArgs(provider);
    }
    if (
      this.syncProviders[0] &&
      this.syncProviders[0].type === LOCAL_FOLDER_PROVIDER_TYPE
    ) {
      return undefined;
    }
    if (this.syncProviders.length > 0) {
      return this.providerWasmArgs(this.syncProviders[0]!);
    }
    if (this.hasRemoteCredentials()) {
      return this.wasmStorageArgs();
    }
    return undefined;
  }

  async updateProviderSyncMetadata(
    providerId: string,
    yaml: string,
    revision: string | undefined,
  ): Promise<void> {
    // `vaultStoreId` borrows the wasm manager; read it through the storage chain
    // so it can't alias an in-flight `&mut self` op (recursive-borrow hang).
    const managerStoreId = this.manager
      ? await this.enqueueStorage(() => this.manager!.vaultStoreId)
      : "";
    this.providers = wasmUpdateProviderSyncMetadata(
      $state.snapshot({
        providers: this.providers,
        ...(this.activeVaultStoreId
          ? { activeVaultStoreId: this.activeVaultStoreId }
          : {}),
      }),
      providerId,
      yaml,
      intoWasmStringValue(revision),
      intoWasmStringValue(managerStoreId || undefined),
      isoTimestamp(),
    ).providers;
    await this.persistProviders();
    this.lastSyncedAt = new SvelteDate();
  }

  async refreshReplacementConflicts(): Promise<void> {
    return syncActions.refreshReplacementConflicts(this);
  }

  async resolveReplacementConflict(
    oldSecretId: string,
    chosenSecretId: string,
  ): Promise<void> {
    if (!this.manager || this.isSaving) return;
    this.isSaving = true;
    this.errorMsg = "";
    try {
      const raw = await this.enqueueStorage(() =>
        this.manager!.resolveProjectionConflict(oldSecretId, chosenSecretId),
      );
      for (const record of raw as NookSecretRecord[]) record.free();
      await this.refreshSecretsFromSession();
      await this.refreshReplacementConflicts();
      this.scheduleFanOutSyncAfterLocalSave();
      this.showSuccess(this.t("toasts.secret_conflict_resolved"));
    } catch (error: unknown) {
      this.errorMsg =
        error instanceof Error
          ? error.message
          : this.t("errors.conflict_resolution_failed");
    } finally {
      this.isSaving = false;
    }
  }

  clearPendingSyncConflict() {
    this.pendingSyncConflict = undefined;
  }

  dismissLocalFolderMultipleVaultsIssue() {
    this.localFolderMultipleVaultsIssue = undefined;
  }

  async disconnectLocalFolderMultipleVaultsProvider(): Promise<void> {
    const issue = this.localFolderMultipleVaultsIssue;
    if (!issue) return;
    this.localFolderMultipleVaultsIssue = undefined;
    await this.removeProvider(issue.providerId);
  }

  async chooseReplacementLocalFolderForIssue(): Promise<void> {
    const issue = this.localFolderMultipleVaultsIssue;
    if (!issue) return;
    this.localFolderMultipleVaultsIssue = undefined;
    if (this.providers.some((provider) => provider.id === issue.providerId)) {
      await this.removeProvider(issue.providerId);
    }
    this.errorMsg = "";
    this.settingsOpen = true;
    this.settingsSection = "admin";
    this.adminAccordionSection = "storage";
    this.beginAddProvider();
    this.beginProviderSetup(LOCAL_FOLDER_PROVIDER_TYPE);
  }

  /** E2E / dev: open the conflict dialog without reaching remote storage. */
  stageSyncConflict(conflict: NookPendingSyncConflict) {
    return syncActions.stageSyncConflict(this, conflict);
  }

  async stageStagedProviderSyncIssue(
    args: [string, string, string],
  ): Promise<boolean> {
    return syncActions.stageStagedProviderSyncIssue(this, args);
  }

  async resolveSyncConflictImportRemote(): Promise<void> {
    return syncActions.resolveSyncConflictImportRemote(this);
  }

  async resolveSyncConflictKeepLocal(): Promise<void> {
    return syncActions.resolveSyncConflictKeepLocal(this);
  }

  async resolveSyncConflictKeepRemote(): Promise<void> {
    return syncActions.resolveSyncConflictKeepRemote(this);
  }

  finishStagedProviderConnectAfterConflict(
    conflict: NookPendingSyncConflict,
  ): void {
    if (!conflict.isPendingProvider) {
      return;
    }
    this.loginSetupType = undefined;
    this.addProviderOpen = false;
  }

  async ensureProviderSavedAfterConflict(
    conflict: NookPendingSyncConflict,
  ): Promise<string> {
    if (
      !conflict.isPendingProvider &&
      this.providers.some((p) => p.id === conflict.providerId)
    ) {
      return conflict.providerId;
    }
    const saved = await this.ensureProviderSaved();
    if (!saved) {
      throw new Error(this.t("auth_storage.duplicate_sync_provider"));
    }
    const provider =
      this.syncProviders[this.syncProviders.length - 1] ??
      this.providers[this.providers.length - 1];
    if (!provider || provider.type === LOCAL_PROVIDER_TYPE) {
      throw new Error(this.t("errors.cloud_sync_provider_required"));
    }
    return provider.id;
  }

  /** Settings: connect a new sync provider and reconcile with local vault. */
  async connectAndSyncStagedProvider(): Promise<void> {
    return providersActions.connectAndSyncStagedProvider(this);
  }

  async discoverStagedVaultStoreId(): Promise<StoreId> {
    return providersActions.discoverStagedVaultStoreId(this);
  }

  openSettings(
    section: "storage" | "onboard" | "admin" = "storage",
    accordion: "devices" | "language" | "danger" = "devices",
  ) {
    this.helpOpen = false;
    this.settingsSection = section;
    if (section === "storage") {
      this.cancelProviderSetup();
      this.cancelAddProvider();
      this.settingsAccordionSection = accordion;
    }
    this.settingsOpen = true;
    void this.refreshDeviceState();
  }

  openAdmin(
    accordion: "vaults" | "storage" | "passwords" | "import-export" = "vaults",
  ) {
    this.helpOpen = false;
    this.cancelProviderSetup();
    this.cancelAddProvider();
    this.adminAccordionSection = accordion;
    this.settingsSection = "admin";
    this.settingsOpen = true;
    void this.refreshLocalVaultCatalog();
    void this.refreshDeviceState();
  }

  closeSettings() {
    this.cancelProviderSetup();
    this.cancelAddProvider();
    this.settingsOpen = false;
  }

  async deleteLocalBrowserData(): Promise<void> {
    if (!this.manager || this.isSaving || this.localDataDeletionStarted) return;
    this.errorMsg = "";
    this.dismissSuccess();
    this.isSaving = true;
    this.stopIdleSessionTracking();
    this.stopVaultSync();
    try {
      const manager = this.manager;
      await deleteBrowserData(() => {
        const deletion = this.enqueueStorage(() =>
          manager.deleteLocalBrowserData(),
        );
        this.localDataDeletionStarted = true;
        return deletion;
      });
    } catch (error: unknown) {
      const managerWasZeroized = this.localDataDeletionStarted;
      setVaultSessionLocked(true);
      this.clearUnlockedSession(!managerWasZeroized);
      this.localDataDeletionStarted = false;
      this.errorMsg =
        error instanceof Error
          ? error.message
          : this.t("settings.delete_local_error");
      this.isSaving = false;
    }
  }

  async handleRemoteLocalBrowserDataDeletion(): Promise<void> {
    if (this.localDataDeletionStarted) return;
    const resetManager = this.manager
      ? this.enqueueStorage(() => this.manager!.resetVaultSession())
      : this.waitForStorageChain();
    this.localDataDeletionStarted = true;
    this.stopIdleSessionTracking();
    this.stopVaultSync();
    setVaultSessionLocked(true);
    this.clearUnlockedSession(false);
    await resetManager;
    clearTabScopedBrowserData();
  }

  /** End the in-memory session and return to the login gate (encrypted vault + sync providers stay on disk). */
  lockVault() {
    this.beginLoginVaultPicker();
    return idleSessionActions.lockVault(this);
  }

  openHelp() {
    this.settingsOpen = false;
    this.helpOpen = true;
  }

  closeHelp() {
    this.helpOpen = false;
  }

  async refreshSecretsFromSession() {
    if (!this.manager) {
      for (const secret of this.secrets) secret.free();
      this.secrets = [];
      this.secretTotal = 0;
      this.secretPageOffset = 0;
      return;
    }
    // Page queries borrow the wasm manager; route them through the storage
    // chain so a background sync's refresh can't alias an in-flight foreground
    // `&mut self` op (delete/add) and trigger a recursive-borrow hang.
    await this.loadSecretPage(this.secretQuery, this.secretPageOffset);
  }

  async loadSecretPage(query: string, requestedOffset = 0) {
    if (!this.manager) return;
    const generation = this.secretPageGeneration;
    const page = await this.enqueueStorage(() =>
      this.manager!.queryPreparedSecretPage(
        query,
        intoWasmStringValue(this.secretTypeFilter),
        requestedOffset,
        this.secretPageSize,
      ),
    );
    let records = page.takeItems();
    let total = page.total;
    let offset = page.offset;
    page.free();
    if (generation !== this.secretPageGeneration) {
      for (const record of records) record.free();
      return;
    }

    if (records.length === 0 && total > 0 && offset >= total) {
      const lastOffset = this.clientPolicy.normalizedSecretPageOffset(
        total,
        offset,
        this.secretPageSize,
      );
      const lastPage = await this.enqueueStorage(() =>
        this.manager!.querySecretPage(
          query,
          intoWasmStringValue(this.secretTypeFilter),
          lastOffset,
          this.secretPageSize,
        ),
      );
      records = lastPage.takeItems();
      total = lastPage.total;
      offset = lastPage.offset;
      lastPage.free();
      if (generation !== this.secretPageGeneration) {
        for (const record of records) record.free();
        return;
      }
    }

    for (const secret of this.secrets) secret.free();
    this.secrets = records;
    this.secretTotal = total;
    this.secretPageOffset = offset;
    this.secretQuery = query;
  }

  applyConnectedSecretPage(page: NookSecretPage, query: string) {
    const records = page.takeItems();
    const total = page.total;
    const offset = page.offset;
    page.free();
    for (const secret of this.secrets) secret.free();
    this.secrets = records;
    this.secretTotal = total;
    this.secretPageOffset = offset;
    this.secretQuery = query;
  }

  async decryptSecret(id: string): Promise<NookSecretRecord> {
    if (!this.manager) {
      throw new Error("Vault manager is not initialized.");
    }
    return this.enqueueStorage(() => this.manager!.decryptSecret(id));
  }

  async currentAuthenticatorCode(id: string): Promise<AuthenticatorCodeView> {
    if (!this.manager) {
      throw new Error("Vault manager is not initialized.");
    }
    const unixSeconds = Math.floor(Date.now() / 1000);
    const result = await this.enqueueStorage(() =>
      this.manager!.currentAuthenticatorCode(id, unixSeconds),
    );
    try {
      return {
        code: result.code,
        secondsRemaining: result.secondsRemaining,
        period: result.period,
        expiresAtUnixSeconds: result.expiresAtUnixSeconds,
      };
    } finally {
      result.free();
    }
  }

  async refreshDeviceState() {
    return multiDeviceActions.refreshDeviceState(this);
  }

  /** Refresh event-log joins from providers (manual sync + provider poll). */
  async refreshPendingJoinsFromProviders() {
    return multiDeviceActions.refreshPendingJoinsFromProviders(this);
  }

  async approveJoin(joinDeviceId: string) {
    return multiDeviceActions.approveJoin(this, joinDeviceId);
  }

  async denyJoin(joinDeviceId: string) {
    return multiDeviceActions.denyJoin(this, joinDeviceId);
  }

  async renameDevice(authId: string, label: string) {
    return multiDeviceActions.renameDevice(this, authId, label);
  }

  async revokeDevice(authId: string) {
    return multiDeviceActions.revokeDevice(this, authId);
  }

  async createFreshVault() {
    return lifecycleActions.createFreshVault(this);
  }

  async enrollAndConnect() {
    return multiDeviceActions.enrollAndConnect(this);
  }

  generatePassword(
    length: number,
    lowercase: boolean,
    uppercase: boolean,
    numbers: boolean,
    symbols: boolean,
  ): string {
    return secretsActions.generatePassword(
      this,
      length,
      lowercase,
      uppercase,
      numbers,
      symbols,
    );
  }

  async connectStagedProvider(): Promise<void> {
    return providersActions.connectStagedProvider(this);
  }

  async loadDb() {
    return secretsActions.loadDb(this);
  }

  async promoteSessionVaultToLocalIfNeeded(): Promise<void> {
    return providersActions.promoteSessionVaultToLocalIfNeeded(this);
  }

  async addVaultPassword(label: string, password: string): Promise<void> {
    return passwordUnlockActions.addVaultPassword(this, label, password);
  }

  async updateVaultPasswordEntry(
    entryId: PasswordEntryId,
    password: string,
  ): Promise<void> {
    return passwordUnlockActions.updateVaultPasswordEntry(
      this,
      entryId,
      password,
    );
  }

  async removeVaultPasswordEntry(entryId: PasswordEntryId): Promise<void> {
    return passwordUnlockActions.removeVaultPasswordEntry(this, entryId);
  }

  /**
   * Issue a base64url-encoded enrollment payload (provider creds + password
   * entry id) for the joining device to scan or paste. The password is verified
   * locally before any payload is generated but is not embedded in the QR.
   *
   * Async because the wasm manager has `&mut self` background tasks
   * (`sync_vault_from_storage`); the verify call has to go through the
   * shared storage chain or wasm-bindgen rejects it as a recursive borrow.
   */
  async issueEnrollmentCode(
    entryId: PasswordEntryId,
    password: string,
    providerId = this.syncProviders[0]?.id ?? "",
  ): Promise<string> {
    return passwordUnlockActions.issueEnrollmentCode(
      this,
      entryId,
      password,
      providerId,
    );
  }

  clearEnrollmentCode() {
    return passwordUnlockActions.clearEnrollmentCode(this);
  }

  /**
   * Unlock the vault with a labelled password entry.
   */
  async unlockWithPassword(
    entryId: PasswordEntryId,
    password: string,
  ): Promise<void> {
    return passwordUnlockActions.unlockWithPassword(this, entryId, password);
  }

  async refreshSentinelUnlockStatus(): Promise<SentinelVaultUnlockState> {
    const status =
      await sentinelUnlockActions.refreshSentinelUnlockStatus(this);
    await this.refreshArchitectureSecretCreationAllowed();
    return status;
  }

  /**
   * Joining-side: parse an enrollment code, restore provider credentials, and
   * self-enrol via `connectWithPassword`. Skips approval entirely.
   */
  async connectWithEnrollmentCode(code: string, password = ""): Promise<void> {
    return passwordUnlockActions.connectWithEnrollmentCode(
      this,
      code,
      password,
    );
  }

  async handleAddSecret(id: string, type: VaultItemType, data: string) {
    return secretsActions.handleAddSecret(this, id, type, data);
  }

  async handleBitwardenImport(
    json: string,
    password: string,
  ): Promise<NookImportResult> {
    return secretsActions.handleBitwardenImport(this, json, password);
  }

  async handleLastPassImport(csv: string): Promise<NookImportResult> {
    return secretsActions.handleLastPassImport(this, csv);
  }

  async handleOnePasswordImport(
    archive: Uint8Array,
  ): Promise<NookImportResult> {
    return secretsActions.handleOnePasswordImport(this, archive);
  }

  async handleApplePasswordsImport(csv: string): Promise<NookImportResult> {
    return secretsActions.handleApplePasswordsImport(this, csv);
  }

  async handleChromePasswordsImport(csv: string): Promise<NookImportResult> {
    return secretsActions.handleChromePasswordsImport(this, csv);
  }

  async handleGoogleAuthenticatorImport(
    migrationUris: string[],
  ): Promise<NookImportResult> {
    return secretsActions.handleGoogleAuthenticatorImport(this, migrationUris);
  }

  async handleProtonPassImport(
    exportBytes: Uint8Array,
  ): Promise<NookImportResult> {
    return secretsActions.handleProtonPassImport(this, exportBytes);
  }

  async flushRemoteEventOutboxNow(provider?: StorageProvider): Promise<void> {
    if (!this.manager) return;
    const folderProvider =
      provider && provider.type === LOCAL_FOLDER_PROVIDER_TYPE
        ? provider
        : !provider &&
            this.syncProviders[0] &&
            this.syncProviders[0].type === LOCAL_FOLDER_PROVIDER_TYPE
          ? this.syncProviders[0]
          : undefined;
    if (folderProvider) {
      try {
        await syncActions.syncLocalFolderProvider(this, folderProvider);
      } catch (error) {
        vaultLog.warn("local backup sync skipped", {
          providerId: folderProvider.id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }
    const args = this.remoteEventProviderArgs(provider);
    if (!args) return;
    try {
      await this.enqueueStorage(() =>
        this.manager!.flushEventOutboxForProvider(...args),
      );
    } catch (error) {
      vaultLog.warn("event outbox flush skipped", {
        providerId: provider?.id ?? "active",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async handleDeleteSecret(id: string) {
    return secretsActions.handleDeleteSecret(this, id);
  }

  async handleReplaceSecret(oldId: string, type: VaultItemType, data: string) {
    return secretsActions.handleReplaceSecret(this, oldId, type, data);
  }
}
