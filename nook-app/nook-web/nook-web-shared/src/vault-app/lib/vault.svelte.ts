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
  JoinEnrollmentState,
  NookBrowserLocale,
  NookClientRunModeUtil,
  NookRuntimeConfig,
  NookVaultClientPolicy,
  NookVaultArchitecture,
  RemoteVaultAssessDecision,
  UnauthenticatedSyncDecision,
  VaultEditBlockReason,
  activeVaultProviders as wasmActiveVaultProviders,
  get_translation_catalog as getTranslationCatalog,
  localProviderIdForActiveVault,
  oauthRemoteStorageRef,
  parseAppLocale,
  providerLabelById,
  providersVisibleWhileDeviceLocked,
  providerWasmArgs as wasmProviderWasmArgs,
  setActiveVault,
  setVaultSessionLocked,
  stagedRemoteStorageArgs as wasmStagedRemoteStorageArgs,
  stagedProviderLabel as wasmStagedProviderLabel,
  syncProvidersForActiveVault as wasmSyncProvidersForActiveVault,
  translateFromCatalog,
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
} from "$app-wasm";
import { APP_KIND } from "$lib/app-kind";
import {
  DEFAULT_GITHUB_REPO,
  LOCAL_FOLDER_PROVIDER_TYPE,
  LOCAL_PROVIDER_TYPE,
  OAUTH_FILE_PROVIDER_TYPE,
  providerDefaultLabel,
  wasmStorageModeForProvider,
  type AuthProvidersSnapshot,
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
  type DeviceMode,
  type ReplicationType,
  type VaultArchitecture,
  type VaultType,
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
import * as deviceProtectionActions from "$lib/vault/device-protection";
import * as sentinelGenesisActions from "$lib/vault/sentinel-genesis";
import {
  clearTabScopedBrowserData,
  deleteLocalBrowserData as deleteBrowserData,
} from "$lib/browser-data";
import type {
  SentinelStoredDeliverySummary,
  SentinelUnlockSessionStatus,
  SentinelUnlockStatus,
} from "$lib/vault/sentinel-unlock";

const vaultLog = createLogger("vault");

type TranslationCatalog = string;

export type SentinelGenesisStatus =
  | "idle"
  | "collecting"
  | "ready"
  | "finalizing"
  | "delivering"
  | "complete";

export type SentinelGenesisDelivery = {
  participantId: string;
  fingerprint?: string;
  payload: string;
  sharePayload?: string;
};

export type SentinelGenesisParticipantSummary = {
  participantId: string;
  label: string;
  fingerprint: string;
};

export type StartSentinelGenesisArgs = {
  label: string;
  participantCount: number;
  threshold: number;
};

function storageArgsTuple(
  args: NookStorageConnectArgs,
): [string, string, string] {
  return [args.mode, args.pat, args.repo];
}

function plainProvider(provider: StorageProvider): StorageProvider {
  return JSON.parse(JSON.stringify(provider)) as StorageProvider;
}

function plainProviders(providers: StorageProvider[]): StorageProvider[] {
  return JSON.parse(JSON.stringify(providers)) as StorageProvider[];
}

function plainProviderSnapshot(
  providers: StorageProvider[],
  activeVaultStoreId?: string,
): AuthProvidersSnapshot {
  const snapshot: AuthProvidersSnapshot = {
    providers: plainProviders(providers),
  };
  if (activeVaultStoreId) snapshot.activeVaultStoreId = activeVaultStoreId;
  return snapshot;
}

function plainOAuthFile(config: OAuthFileConfig): OAuthFileConfig {
  return JSON.parse(JSON.stringify(config)) as OAuthFileConfig;
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
  settingsAccordionSection = $state<
    "devices" | "language" | "danger" | undefined
  >("devices");
  adminAccordionSection = $state<
    "vaults" | "storage" | "passwords" | "import-export" | undefined
  >("vaults");
  helpOpen = $state(false);

  providers = $state<StorageProvider[]>([]);
  providersLoaded = $state(false);
  /** Locally cached vaults on this browser (metadata only). */
  localVaults = $state<NookLocalVaultEntry[]>([]);
  /** Active vault store_id — sync providers and local blob are scoped to this. */
  activeVaultStoreId = $state<string | undefined>(undefined);
  /** Login gate: user picked a vault but has not unlocked yet. */
  selectedLoginVaultStoreId = $state<string | undefined>(undefined);
  /** True when the active vault blob exists in IndexedDB. */
  localVaultPresent = $state(false);
  localLoginPrepared = $state(false);
  loginSetupType = $state<StorageProviderType | undefined>(undefined);
  loginRequiresExistingVault = $state(false);
  addProviderOpen = $state(false);

  storageMode = $state<StorageProviderType>(LOCAL_PROVIDER_TYPE);
  githubPat = $state("");
  githubRepo = $state(DEFAULT_GITHUB_REPO);
  oauthFile = $state<OAuthFileConfig | undefined>(undefined);
  localFolder = $state<LocalFolderConfig | undefined>(undefined);
  localFolderBackupSupported = $state(
    typeof window !== "undefined" && isLocalFolderBackupSupported(),
  );
  vaultArchitecture = $state<VaultArchitecture>(defaultVaultArchitecture());
  draftDeviceMode = $state<DeviceMode>("standard");
  draftVaultType = $state<VaultType>("simple");
  draftReplicationType = $state<ReplicationType>("personal");
  sentinelGenesisStatus = $state<SentinelGenesisStatus>("idle");
  sentinelGenesisRequest = $state("");
  sentinelGenesisParticipantCount = $state(0);
  sentinelGenesisParticipants = $state<SentinelGenesisParticipantSummary[]>([]);
  sentinelGenesisDeliveries = $state<SentinelGenesisDelivery[]>([]);
  sentinelGenesisStoreId = $state<string | undefined>(undefined);
  oauthSetupPreset = $state<OAuthFilePreset | undefined>(undefined);
  googleOAuthBusy = $state(false);
  icloudOAuthPreparing = $state(false);
  icloudOAuthReady = $state(false);
  icloudOAuthBusy = $state(false);

  manager = $state<NookVaultManager | undefined>(undefined);
  deviceProtectionStatus = $state<
    | "loading"
    | "missing"
    | "plaintext"
    | "passkey"
    | "pin"
    | "pin-setup"
    | "unlocked"
    | "error"
  >("loading");
  deviceProtectionLockedMode = $state<"passkey" | "pin">("passkey");
  isAuthenticated = $state(false);
  /** True when the login gate should explain that the last lock was due to idle timeout. */
  sessionExpiredByIdle = $state(false);
  secrets = $state<NookSecretListItem[]>([]);
  secretTotal = $state(0);
  secretPageOffset = $state(0);
  secretPageSize = 50;
  secretQuery = $state("");
  secretTypeFilter = $state<VaultItemType | undefined>(undefined);
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
  lastSyncedAt = $state<SvelteDate | undefined>(undefined);
  isSyncing = $state(false);
  /** Provider id currently running a manual sync (Settings UI). */
  syncingProviderId = $state<string | undefined>(undefined);
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
  pendingSyncConflict = $state<NookPendingSyncConflict | undefined>(undefined);
  /** Local-folder provider points at a folder that contains several vault event logs. */
  localFolderMultipleVaultsIssue = $state<
    LocalFolderMultipleVaultsIssue | undefined
  >(undefined);
  private architectureSecretCreationAllowed = $state(true);

  get syncBlocked(): boolean {
    return this.pendingSyncConflict !== undefined;
  }

  get syncConflictLabel(): string {
    return syncActions.syncConflictLabel(this);
  }

  get editsBlocked(): boolean {
    return this.editBlockReason !== undefined;
  }

  get architectureCanCreateSecret(): boolean {
    return this.architectureSecretCreationAllowed;
  }

  get editBlockReason(): string | undefined {
    const reason = this.clientPolicy.editBlockReason(
      this.securityConflicts.length,
      this.syncBlocked,
      this.architectureCanCreateSecret,
    );
    switch (reason) {
      case VaultEditBlockReason.SecurityConflict:
        return this.t("auth_storage.security_conflict_edits");
      case VaultEditBlockReason.SyncConflict:
        return this.t("auth_storage.sync_blocked_edits");
      case VaultEditBlockReason.Architecture:
        return this.t("architecture_modes.sentinel_secret_creation_blocked");
      default:
        return undefined;
    }
  }

  get deviceProtectionReady(): boolean {
    return this.deviceProtectionStatus === "unlocked";
  }

  get syncProviderCount(): number {
    return this.syncProviders.length;
  }

  get syncingProviderLabel(): string | undefined {
    if (!this.syncingProviderId) return undefined;
    return providerLabelById(
      plainProviderSnapshot(this.providers, this.activeVaultStoreId),
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

  unlockMode = $state<"keys" | "password">("keys");
  /** Remote vault unlock mode detected on the login screen (before session open). */
  loginUnlockMode = $state<"unknown" | "keys" | "password">("unknown");
  /** Open the login password form after Connect finds a password-mode vault. */
  loginPasswordPrompt = $state(false);
  /** Sentinel vault needs a signed, session-bound quorum ceremony. */
  sentinelCeremonyPrompt = $state(false);
  sentinelUnlockStatus = $state<SentinelUnlockStatus>("not_sentinel");
  /** Public, signed Sentinel unlock request. It contains no share material. */
  sentinelUnlockRequest = $state("");
  /** Rust-owned unlock-session progress rendered by the web layer. */
  sentinelUnlockSession = $state<SentinelUnlockSessionStatus>(
    sentinelUnlockActions.inactiveSentinelUnlockSession(),
  );
  /** Provider-free encrypted deliveries available to this protected device. */
  sentinelStoredDeliveries = $state<SentinelStoredDeliverySummary[]>([]);
  /** Remote vault file missing on storage — prompt before unlock. */
  remoteVaultRecoveryPrompt = $state<"none" | "with_cache" | "missing_only">(
    "none",
  );
  /** How the next unlock should connect after the user confirms recovery. */
  pendingConnectRecovery = $state<"none" | "from_cache" | "fresh">("none");
  isPasswordBusy = $state(false);
  passwordError = $state("");
  enrollmentCode = $state("");
  prefillEnrollmentCode = $state("");
  enrollmentFromUrlPending = $state(false);
  loginEnrollmentCode = $state("");
  passwordEntries = $state<NookPasswordEntrySummary[]>([]);
  selectedPasswordEntryId = $state<string | undefined>(undefined);
  activeEnrollmentEntryId = $state<string | undefined>(undefined);

  get hasPasswordEnvelope(): boolean {
    return this.clientPolicy.hasPasswordEnvelope(
      this.passwordEntries.length,
      this.unlockMode === "password",
    );
  }

  /** Default 60s in production; dev/e2e may override via VITE_VAULT_SYNC_INTERVAL_MS. */
  syncIntervalMs(): number {
    return this.runtimeConfig.resolveVaultSyncIntervalMs(
      import.meta.env.VITE_VAULT_SYNC_INTERVAL_MS ?? undefined,
    );
  }

  successDismissTimer: ReturnType<typeof setTimeout> | undefined = undefined;
  idleSessionTracker: VaultIdleSessionTracker | undefined = undefined;
  syncTimer: ReturnType<typeof setInterval> | undefined = undefined;
  initPromise: Promise<void> | undefined = undefined;
  storageChain: Promise<unknown> = Promise.resolve();
  private localDataDeletionStarted = false;
  /** Internal browser-orchestration flag shared with the device-protection actions. */
  deviceAuthorizationInProgress = false;
  pendingEnrollmentFromUrl: string | undefined =
    typeof window !== "undefined" ? consumeEnrollmentFromLocation() : undefined;

  enqueueStorage<T>(operation: () => T | Promise<T>): Promise<T> {
    if (this.localDataDeletionStarted) {
      return Promise.reject(new Error("Local browser data deletion is active"));
    }
    const next = this.storageChain.then(() => operation());
    this.storageChain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  /** E2E/dev: wait for the serialized wasm storage queue to finish. */
  waitForStorageChain(): Promise<void> {
    return lifecycleActions.waitForStorageChain(this);
  }

  /** E2E/dev: reset a stuck storage queue (abandons in-flight wasm work). */
  resetStorageChain(): void {
    return lifecycleActions.resetStorageChain(this);
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
    return storageArgsTuple(
      wasmStorageArgsCore(
        this.localVaultPresent,
        this.isAuthenticated,
        syncProvider ? plainProvider(syncProvider) : undefined,
        this.storageMode,
        this.githubPat,
        this.githubRepo,
        this.oauthFile?.preset ?? undefined,
        this.oauthFile?.accessToken ?? undefined,
        this.oauthFile
          ? oauthRemoteStorageRef(plainOAuthFile(this.oauthFile))
          : undefined,
        this.oauthFile?.fileName ?? undefined,
      ),
    );
  }

  /** WASM connect always uses the local cache when one exists (unified vault). */
  connectStorageArgs(): [string, string, string] {
    if (
      !this.isAuthenticated &&
      this.syncProviders.length > 0 &&
      this.joinEnrollmentPrompt !== JoinEnrollmentState.None
    ) {
      return this.providerWasmArgs(this.syncProviders[0]!);
    }
    return this.wasmStorageArgs();
  }

  stagedRemoteStorageArgs(): [string, string, string] | undefined {
    const type = this.loginSetupType ?? this.storageMode;
    const args = wasmStagedRemoteStorageArgs(
      type,
      this.githubPat || undefined,
      this.githubRepo || undefined,
      this.oauthFile ? plainOAuthFile(this.oauthFile) : undefined,
    );
    if (!args) return undefined;
    try {
      return storageArgsTuple(args);
    } finally {
      args.free();
    }
  }

  stagedProviderLabel(): string {
    return wasmStagedProviderLabel(
      this.loginSetupType ?? this.storageMode,
      this.githubRepo,
      this.oauthFile?.fileName ?? undefined,
      this.oauthFile?.preset ?? undefined,
      this.oauthSetupPreset ?? undefined,
    );
  }

  /**
   * Check whether a staged remote provider exists before connect.
   */
  async reconcileStagedRemoteWithLocal(options?: {
    providerId?: string;
    quiet?: boolean;
  }): Promise<"ok" | "skip"> {
    void options;
    return this.stagedRemoteStorageArgs() ? "ok" : "skip";
  }

  hasRemoteCredentials(): boolean {
    return wasmHasRemoteCredentials(
      this.storageMode,
      this.githubPat,
      this.oauthFile?.accessToken ?? undefined,
      this.localFolder?.handleId ?? undefined,
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
      plainOAuthFile(this.oauthFile),
      this.manager.storage_remote_ref ?? "",
    );
    if (updated) this.oauthFile = updated;
  }

  async ensureOAuthTokensFresh(): Promise<void> {
    return oauthActions.ensureOAuthTokensFresh(this);
  }

  async signInWithGoogle(): Promise<void> {
    return oauthActions.signInWithGoogle(this);
  }

  selectGoogleDriveMode(mode: GoogleDriveMode): void {
    oauthActions.selectGoogleDriveMode(this, mode);
  }

  async createGoogleSharedFolder(collaboratorEmail: string): Promise<string> {
    return oauthActions.createGoogleSharedFolder(this, collaboratorEmail);
  }

  async useGoogleSharedFolder(folderRef: string): Promise<string> {
    return oauthActions.useGoogleSharedFolder(this, folderRef);
  }

  selectICloudMode(mode: ICloudMode): void {
    oauthActions.selectICloudMode(this, mode);
  }

  async createICloudSharedProvider(): Promise<void> {
    return oauthActions.createICloudSharedProvider(this);
  }

  async useICloudSharedProvider(shareReference: string): Promise<void> {
    return oauthActions.useICloudSharedProvider(this, shareReference);
  }

  async prepareICloudSignIn(): Promise<void> {
    return oauthActions.prepareICloudSignIn(this);
  }

  async signInWithICloud(options?: {
    clickPreparedControl?: boolean;
  }): Promise<void> {
    return oauthActions.signInWithICloud(this, options);
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

  clearLoginPasswordPrompt() {
    this.loginPasswordPrompt = false;
  }

  dismissJoinEnrollment() {
    return multiDeviceActions.dismissJoinEnrollment(this);
  }

  async confirmJoinRequest() {
    return multiDeviceActions.confirmJoinRequest(this);
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
      plainProviderSnapshot(this.providers, this.activeVaultStoreId),
      this.activeVaultStoreId ?? undefined,
    );
    return id
      ? this.providers.find((provider) => provider.id === id)
      : undefined;
  }

  /** Canonical on-device vault row — alias kept while settings code migrates. */
  get activeProvider(): StorageProvider | undefined {
    return this.localProvider;
  }

  /** Providers belonging to the active vault only. */
  get activeVaultProviders(): StorageProvider[] {
    return wasmActiveVaultProviders(
      plainProviderSnapshot(this.providers, this.activeVaultStoreId),
      this.activeVaultStoreId ?? undefined,
    ).providers;
  }

  /** Cloud sync destinations for the active vault — local row omitted. */
  get syncProviders(): StorageProvider[] {
    return wasmSyncProvidersForActiveVault(
      plainProviderSnapshot(this.providers, this.activeVaultStoreId),
      this.activeVaultStoreId ?? undefined,
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
    return storageArgsTuple(wasmProviderWasmArgs(plainProvider(provider)));
  }

  get hasProviders(): boolean {
    return this.providers.length > 0;
  }

  get activeProviderLabel(): string {
    return this.activeProvider?.label ?? providerDefaultLabel(this.storageMode);
  }

  async updateLocale(
    newLocale: NookAppLocale,
    options?: { preferWasm?: boolean },
  ) {
    return localeActions.updateLocale(this, newLocale, options);
  }

  resolveErrorMessage(message: string): string {
    const stripped = message
      .replace(/^GitHub error:\s*/i, "")
      .replace(/^Drive error:\s*/i, "")
      .replace(/^Database error:\s*/i, "")
      .trim();
    if (stripped.startsWith("errors.")) {
      return this.t(stripped);
    }
    if (message.startsWith("errors.")) {
      return this.t(message);
    }
    return message;
  }

  t = (key: string, replacements?: Record<string, string>): string => {
    let text = translateFromCatalog(this.translations, this.locale, key);
    if (replacements) {
      for (const [k, v] of Object.entries(replacements)) {
        text = text.replace(`{${k}}`, v);
      }
    }
    return text;
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
      const savedLocale = parseAppLocale(
        localStorage.getItem("nook_locale") ?? undefined,
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
      this.deviceProtectionStatus =
        (await this.manager.deviceProtectionStatus()) as
          | "missing"
          | "plaintext"
          | "passkey"
          | "pin"
          | "unlocked";
      const persistedDeviceMode =
        await this.manager.deviceProtectionDeviceMode();
      if (
        persistedDeviceMode === "standard" ||
        persistedDeviceMode === "anti-hacker"
      ) {
        this.draftDeviceMode = persistedDeviceMode;
      }
      if (this.deviceProtectionStatus === "pin") {
        this.deviceProtectionLockedMode = "pin";
      } else if (this.deviceProtectionStatus === "passkey") {
        this.deviceProtectionLockedMode = "passkey";
      }

      const autoAuthorizeE2e =
        this.runtimeConfig.e2eExposeVault &&
        localStorage.getItem("nook_e2e_manual_passkey") !== "true";
      if (!this.deviceProtectionReady && autoAuthorizeE2e) {
        if (this.deviceProtectionStatus === "passkey") {
          await this.enqueueStorage(() =>
            authorizePasskeyProtection(this.manager!),
          );
        } else if (this.deviceProtectionStatus === "pin") {
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
      this.deviceProtectionStatus = "unlocked";
    } catch (error) {
      if (
        this.deviceProtectionStatus === "unlocked" ||
        deviceIdentityUnlocked
      ) {
        void this.lockDeviceProtection();
      }
      this.deviceProtectionStatus =
        this.deviceProtectionStatus === "loading"
          ? "error"
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
      this.activeVaultStoreId = this.localVaults[0]?.storeId ?? undefined;
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
        void this.probeLoginUnlockMode();
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
      this.deviceProtectionStatus = "unlocked";
      vaultLog.info("extension identity adopted", {
        deviceId: this.deviceId,
      });
      return true;
    } catch (error) {
      await this.enqueueStorage(() =>
        this.manager!.rollbackExtensionIdentityHandoff(),
      );
      this.deviceProtectionStatus =
        priorDeviceProtectionStatus === "unlocked"
          ? this.deviceProtectionLockedMode
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

  async setupDeviceProtection(
    passkeyLabel = "",
    deviceMode = this.draftDeviceMode,
  ): Promise<void> {
    return deviceProtectionActions.setupDeviceProtection(
      this,
      passkeyLabel,
      deviceMode,
    );
  }

  async recoverDeviceProtectionWithPasskey(): Promise<void> {
    return deviceProtectionActions.recoverDeviceProtectionWithPasskey(this);
  }

  async setupPinDeviceProtection(
    pin: string,
    confirmPin: string,
  ): Promise<void> {
    return deviceProtectionActions.setupPinDeviceProtection(
      this,
      pin,
      confirmPin,
    );
  }

  async unlockDeviceProtection(): Promise<void> {
    return deviceProtectionActions.unlockDeviceProtection(this);
  }

  async unlockPinDeviceProtection(pin: string): Promise<void> {
    return deviceProtectionActions.unlockPinDeviceProtection(this, pin);
  }

  async resetDeviceProtectionForRecovery(): Promise<void> {
    return deviceProtectionActions.resetDeviceProtectionForRecovery(this);
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
    return sentinelGenesisActions.start(this, args);
  }

  async addSentinelGenesisParticipantResponse(
    payload: string,
    participantLabel = "",
  ): Promise<void> {
    return sentinelGenesisActions.addParticipantResponse(
      this,
      payload,
      participantLabel,
    );
  }

  async createSentinelGenesisPublicKeyAnnouncement(): Promise<string> {
    return sentinelGenesisActions.createPublicKeyAnnouncement(this);
  }

  async rememberSentinelGenesisRequest(requestPayload: string): Promise<void> {
    return sentinelGenesisActions.rememberRequest(this, requestPayload);
  }

  async createSentinelGenesisParticipantResponse(
    requestPayload: string,
  ): Promise<string> {
    return sentinelGenesisActions.createParticipantResponse(
      this,
      requestPayload,
    );
  }

  async finalizeSentinelGenesis(): Promise<void> {
    return sentinelGenesisActions.finalize(this);
  }

  async acceptSentinelGenesisShareDelivery(payload: string): Promise<void> {
    return sentinelGenesisActions.acceptShareDelivery(this, payload);
  }

  async completeSentinelGenesisDelivery(): Promise<void> {
    return sentinelGenesisActions.completeDelivery(this);
  }

  async prepareSentinelOnboardingLinks(): Promise<void> {
    return sentinelGenesisActions.prepareOnboardingLinks(this);
  }

  async acceptSentinelOnboardingPackage(packageJson: string): Promise<void> {
    return sentinelGenesisActions.acceptOnboardingPackage(this, packageJson);
  }

  async renameLocalVault(storeId: string, label: string): Promise<void> {
    return localLoginActions.renameLocalVaultLabel(this, storeId, label);
  }

  async selectVaultForUnlock(storeId: string): Promise<void> {
    return localLoginActions.selectVaultForUnlock(this, storeId);
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

  async activateConnectedExistingVault(storeId: string): Promise<void> {
    return localLoginActions.activateConnectedExistingVault(this, storeId);
  }

  beginLoginVaultPicker() {
    this.selectedLoginVaultStoreId = undefined;
    this.localLoginPrepared = false;
    this.resetVaultSessionState();
  }

  async chooseLoginVault(storeId: string) {
    await this.selectVaultForUnlock(storeId);
    this.selectedLoginVaultStoreId = storeId;
  }

  async refreshLocalVaultCatalog(): Promise<void> {
    return localLoginActions.refreshLocalVaultCatalog(this);
  }

  /** Lock and open the login unlock step for another vault on this device. */
  async switchToVault(storeId: string): Promise<void> {
    const target = this.clientPolicy.vaultSwitchTarget(
      storeId,
      this.activeVaultStoreId ?? undefined,
      this.isVerifying,
    );
    if (!target) return;
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
    this.deviceProtectionStatus = this.deviceProtectionLockedMode;
    this.deviceAuthorizationInProgress = false;
    this.deviceId = "";
    this.devicePublicKey = "";
    // Sync-provider credentials are sealed to the protected device identity.
    // Keep only the non-secret local row in memory while that identity is
    // locked; passkey/PIN authorization reloads the sealed providers.
    this.providers = providersVisibleWhileDeviceLocked(
      plainProviderSnapshot(this.providers, this.activeVaultStoreId),
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

  /** @deprecated Use {@link createLocalVaultWithDeviceKeys}. Backup passwords belong in Settings. */
  async createLocalVault(password: string): Promise<void> {
    return localLoginActions.createLocalVault(this, password);
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
    this.remoteVaultRecoveryPrompt = "none";
    this.pendingConnectRecovery = "none";
    this.errorMsg = "";
  }

  cancelExistingVaultOpen() {
    this.loginRequiresExistingVault = false;
    this.remoteVaultRecoveryPrompt = "none";
    this.pendingConnectRecovery = "none";
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

  /**
   * Detect whether the vault unlocks with device keys or a password envelope.
   */
  async probeLoginUnlockMode(): Promise<void> {
    return localLoginActions.probeLoginUnlockMode(this);
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
    const args =
      argsOverride ??
      (!this.isAuthenticated &&
      this.syncProviders.length > 0 &&
      this.joinEnrollmentPrompt !== JoinEnrollmentState.None
        ? this.providerWasmArgs(this.syncProviders[0]!)
        : this.wasmStorageArgs());
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
        this.remoteVaultRecoveryPrompt = "with_cache";
        await this.refreshPasswordEntriesList();
        return true;
      case RemoteVaultAssessDecision.RejectMissingExistingVault:
        this.remoteVaultRecoveryPrompt = "none";
        this.pendingConnectRecovery = "none";
        this.errorMsg = this.t("auth_storage.existing_vault_not_found");
        return true;
      case RemoteVaultAssessDecision.PromptMissingRemote:
        this.remoteVaultRecoveryPrompt = "missing_only";
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
    this.loginUnlockMode = "unknown";
    this.loginPasswordPrompt = false;
    this.sentinelCeremonyPrompt = false;
    this.sentinelUnlockStatus = "not_sentinel";
    this.sentinelUnlockRequest = "";
    this.sentinelUnlockSession.free();
    this.sentinelUnlockSession =
      sentinelUnlockActions.inactiveSentinelUnlockSession();
    for (const delivery of this.sentinelStoredDeliveries) delivery.free();
    this.sentinelStoredDeliveries = [];
    this.sharedJoinerIdentity = "";
    this.sharedGrantInstructions = "";
  }

  ensureIdleSessionTracker() {
    if (this.idleSessionTracker) return;
    this.idleSessionTracker = createVaultIdleSessionTracker({
      timeoutMs: this.runtimeConfig.resolveVaultIdleTimeoutMs(
        import.meta.env.VITE_VAULT_IDLE_TIMEOUT_MS ?? undefined,
      ),
      warningMs: this.runtimeConfig.resolveVaultIdleWarningMs(
        import.meta.env.VITE_VAULT_IDLE_WARNING_MS ?? undefined,
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
    const wasSentinel = this.vaultArchitecture.vault_type === "sentinel";
    this.resetVaultSessionState(resetManager);
    if (wasSentinel) {
      this.sentinelCeremonyPrompt = true;
      this.sentinelUnlockStatus = "ceremony_required";
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
      result.accessStatus ?? undefined,
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
          unlockMode: this.manager!.vaultUnlockMode(),
        };
      });
      this.pendingJoins =
        snapshot.pendingJoins.length > 0 ? snapshot.pendingJoins : mergedJoins;
      this.vaultMembers = snapshot.vaultMembers;
      this.unlockMode = "keys";
      await this.refreshPasswordEntriesList();
    } catch {
      this.vaultMembers = [];
      this.unlockMode = "keys";
    }
  }

  async refreshPasswordEnvelopeState(): Promise<void> {
    await this.refreshPasswordEntriesList();
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
    if (this.syncBlocked) return;
    if (!options?.force && this.isVerifying) return;
    if (!options?.force && this.isSaving) return;
    if (!options?.force && this.isPasswordBusy) return;
    if (!options?.force && this.isSyncing) return;
    if (this.syncProviders.length === 0) return;

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
      plainProviderSnapshot(this.providers, this.activeVaultStoreId),
      providerId,
      yaml,
      revision ?? undefined,
      managerStoreId || undefined,
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

  async reloadSessionFromLocal(): Promise<void> {
    if (!this.manager) return;
    const raw = await this.enqueueStorage(() =>
      this.manager!.sync_vault_from_storage(
        wasmStorageModeForProvider(LOCAL_PROVIDER_TYPE),
        "",
        "",
      ),
    );
    this.applyVaultSyncResult(raw);
    await this.refreshSecretsFromSession();
    await this.hydrateMultiDeviceState();
  }

  /** Settings: connect a new sync provider and reconcile with local vault. */
  async connectAndSyncStagedProvider(): Promise<void> {
    return providersActions.connectAndSyncStagedProvider(this);
  }

  async discoverStagedVaultStoreId(): Promise<string> {
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

  filterSecrets(query: string): NookSecretRecord[] {
    return secretsActions.filterSecrets(this, query);
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
      this.manager!.querySecretPage(
        query,
        this.secretTypeFilter,
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
          this.secretTypeFilter,
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
        expiresAtUnixSeconds: unixSeconds + result.secondsRemaining,
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

  async requestVaultAccess() {
    return multiDeviceActions.requestVaultAccess(this);
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
    entryId: string,
    password: string,
  ): Promise<void> {
    return passwordUnlockActions.updateVaultPasswordEntry(
      this,
      entryId,
      password,
    );
  }

  async removeVaultPasswordEntry(entryId: string): Promise<void> {
    return passwordUnlockActions.removeVaultPasswordEntry(this, entryId);
  }

  /** @deprecated Use addVaultPassword — kept for older callers. */
  async setVaultPassword(password: string): Promise<void> {
    return passwordUnlockActions.setVaultPassword(this, password);
  }

  async removeVaultPassword(): Promise<void> {
    return passwordUnlockActions.removeVaultPassword(this);
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
    entryId: string,
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
  async unlockWithPassword(entryId: string, password: string): Promise<void> {
    return passwordUnlockActions.unlockWithPassword(this, entryId, password);
  }

  isSentinelVault(): boolean {
    return sentinelUnlockActions.isSentinelVault(this);
  }

  async getSentinelUnlockStatus(): Promise<SentinelUnlockStatus> {
    return sentinelUnlockActions.getSentinelUnlockStatus(this);
  }

  async refreshSentinelUnlockStatus(): Promise<SentinelUnlockStatus> {
    const status =
      await sentinelUnlockActions.refreshSentinelUnlockStatus(this);
    await this.refreshArchitectureSecretCreationAllowed();
    return status;
  }

  async startSentinelUnlock(): Promise<void> {
    return sentinelUnlockActions.startSentinelUnlock(this);
  }

  async addSentinelUnlockResponse(response: string): Promise<void> {
    return sentinelUnlockActions.addSentinelUnlockResponse(this, response);
  }

  async refreshSentinelUnlockSession(): Promise<void> {
    return sentinelUnlockActions.refreshSentinelUnlockSession(this);
  }

  async listSentinelStoredDeliveries(): Promise<
    SentinelStoredDeliverySummary[]
  > {
    return sentinelUnlockActions.listSentinelStoredDeliveries(this);
  }

  async createSentinelUnlockResponse(
    storeId: string,
    request: string,
  ): Promise<string> {
    return sentinelUnlockActions.createSentinelUnlockResponse(
      this,
      storeId,
      request,
    );
  }

  async finalizeSentinelUnlock(): Promise<void> {
    return sentinelUnlockActions.finalizeSentinelUnlock(this);
  }

  isSentinelCeremonyRequiredError(err: unknown): boolean {
    return sentinelUnlockActions.isSentinelCeremonyRequiredError(err);
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

  scheduleRemoteEventOutboxFlush(): void {
    void this.flushRemoteEventOutboxNow();
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
