import {
  getVaultManager,
  isoTimestamp,
  type JoinRequest,
  type NookSecretRecord,
  type NookVaultSyncResult,
  type VaultItemType,
  type VaultMember,
} from "$lib/nook";
import { consumeEnrollmentFromLocation } from "$lib/enrollment-code";
import { buildSentinelOnboardingLink } from "$lib/sentinel-onboarding-link";
import { SvelteDate } from "svelte/reactivity";
import {
  chooseLocalFolderBackupDirectory,
  ensureLocalAuthProviderSnapshot,
  hasActiveLocalVault,
  hasLocalVault,
  hasRemoteCredentials as wasmHasRemoteCredentials,
  isLocalFolderBackupSupported,
  isVaultSessionLocked,
  NookBrowserLocale,
  NookClientRunModeUtil,
  NookPendingSyncConflict,
  NookRuntimeConfig,
  get_translation_catalog as getTranslationCatalog,
  parseAppLocale,
  providerWasmArgs as wasmProviderWasmArgs,
  readVaultVersion,
  setActiveVault,
  setVaultSessionLocked,
  stagedProviderLabel as wasmStagedProviderLabel,
  translateFromCatalog,
  vaultContentHash,
  wasmStorageArgs as wasmStorageArgsCore,
  type NookLocalVaultEntry,
  type NookLocalAuthProviderSnapshot,
  type NookPasswordEntrySummary,
  type NookStorageConnectArgs,
  type NookVaultManager,
  type NookAppLocale,
} from "$app-wasm";
import { APP_KIND } from "$lib/app-kind";
import {
  DEFAULT_DRIVE_BACKUP_NAME,
  DEFAULT_GITHUB_REPO,
  GITHUB_PROVIDER_TYPE,
  LOCAL_FOLDER_PROVIDER_TYPE,
  loadAuthProviders,
  LOCAL_PROVIDER_TYPE,
  NookStorageProviderKind,
  OAUTH_FILE_PROVIDER_TYPE,
  providerDefaultLabel,
  saveAuthProviders,
  storageProviderKind,
  wasmStorageModeForProvider,
  type LocalFolderConfig,
  type GoogleDriveMode,
  type ICloudMode,
  type OAuthFileConfig,
  type OAuthFilePreset,
  type StorageProvider,
  type StorageProviderType,
} from "$lib/auth-providers";
import { createLogger } from "$lib/log";
import type { PendingSyncConflict } from "$lib/vault/sync";
import type { LocalFolderMultipleVaultsIssue } from "$lib/vault/sync";
import {
  createVaultIdleSessionTracker,
  type VaultIdleSessionTracker,
} from "$lib/vault-idle-session";
import {
  isPasskeyCeremonyNotAllowedError,
  isPasskeyPrfUnavailableError,
  isPasskeyUnavailableError,
  recoverDeviceProtectionWithPasskey as recoverExistingPasskeyProtection,
  setupDeviceProtection as createPasskeyProtection,
  unlockDeviceProtection as authorizePasskeyProtection,
} from "$lib/passkey-device-protection";
import {
  canCreateSecret as architectureCanCreateSecret,
  defaultVaultArchitecture,
  validateVaultArchitecture,
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
import type {
  SentinelStoredDeliverySummary,
  SentinelUnlockSessionStatus,
  SentinelUnlockStatus,
} from "$lib/vault/sentinel-unlock";

const vaultLog = createLogger("vault");

type PendingSyncConflictDraft = {
  providerId: string;
  providerLabel: string;
  localYaml: string;
  remoteYaml: string;
  mode: string;
  pat: string;
  repo: string;
  remoteRevision?: string;
  kind?: string;
  localStoreId?: string;
  remoteStoreId?: string;
};

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

type SentinelGenesisManagerStatus = {
  active: boolean;
  participants?: Array<{
    deviceId: string;
    label?: string;
    fingerprint?: string;
  }>;
  isComplete?: boolean;
};

type SentinelGenesisFinalizeResult = {
  storeId: string;
  architecture: VaultArchitecture;
  participantDeliveries: Array<{
    deviceId: string;
    fingerprint?: string;
    [key: string]: unknown;
  }>;
};

function storageArgsTuple(
  args: NookStorageConnectArgs,
): [string, string, string] {
  return [args.mode, args.pat, args.repo];
}

function plainProvider(provider: StorageProvider): StorageProvider {
  return JSON.parse(JSON.stringify(provider)) as StorageProvider;
}

export class VaultState {
  browserLocale = new NookBrowserLocale();
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
  settingsAccordionSection = $state<"devices" | "language" | undefined>(
    "devices",
  );
  adminAccordionSection = $state<
    "vaults" | "storage" | "passwords" | undefined
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
  secrets = $state<NookSecretRecord[]>([]);

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
  joinEnrollmentPrompt = $state<"none" | "needs_request" | "pending">("none");
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
    Array<{ oldSecretId: string; candidatesJson: string }>
  >([]);
  /** Concurrent key-epoch rotations; local writes fail closed while present. */
  securityConflicts = $state<
    Array<{ eventsJson: string; reasonsJson: string }>
  >([]);
  /** User must pick local vs remote before editing when versions match but content differs. */
  pendingSyncConflict = $state<PendingSyncConflict | undefined>(undefined);
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
    if (this.securityConflicts.length > 0) {
      return this.t("auth_storage.security_conflict_edits");
    }
    if (this.syncBlocked) {
      return this.t("auth_storage.sync_blocked_edits");
    }
    if (!this.architectureCanCreateSecret) {
      return this.t("architecture_modes.sentinel_secret_creation_blocked");
    }
    return undefined;
  }

  get deviceProtectionReady(): boolean {
    return this.deviceProtectionStatus === "unlocked";
  }

  get syncProviderCount(): number {
    return this.syncProviders.length;
  }

  get syncingProviderLabel(): string | undefined {
    if (!this.syncingProviderId) return undefined;
    return (
      this.providers.find((p) => p.id === this.syncingProviderId)?.label ??
      undefined
    );
  }

  get isSyncActivityVisible(): boolean {
    return (
      this.isFanOutSyncing ||
      this.syncingProviderId !== undefined ||
      this.isSyncing ||
      this.isSaving
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
  sentinelUnlockSession = $state<SentinelUnlockSessionStatus>({
    active: false,
    collected: 0,
    threshold: 0,
    ready: false,
  });
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
    return this.passwordEntries.length > 0 || this.unlockMode === "password";
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
  private deviceAuthorizationInProgress = false;
  pendingEnrollmentFromUrl: string | undefined =
    typeof window !== "undefined" ? consumeEnrollmentFromLocation() : undefined;

  enqueueStorage<T>(operation: () => T | Promise<T>): Promise<T> {
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
    return storageArgsTuple(
      wasmStorageArgsCore(
        this.localVaultPresent,
        this.isAuthenticated,
        this.syncProviders[0]
          ? plainProvider(this.syncProviders[0])
          : undefined,
        this.storageMode,
        this.githubPat,
        this.githubRepo,
        this.oauthFile?.preset ?? undefined,
        this.oauthFile?.accessToken ?? undefined,
        this.oauthFile?.preset === "icloud" &&
          this.oauthFile.iCloudShareTarget?.trim()
          ? this.oauthFile.iCloudShareTarget.trim()
          : this.oauthFile?.folderId?.trim()
            ? `shared:${this.oauthFile.folderId.trim()}`
            : (this.oauthFile?.fileId ?? undefined),
        this.oauthFile?.fileName ?? undefined,
      ),
    );
  }

  /** WASM connect always uses the local cache when one exists (unified vault). */
  connectStorageArgs(): [string, string, string] {
    if (
      !this.isAuthenticated &&
      this.syncProviders.length > 0 &&
      this.joinEnrollmentPrompt !== "none"
    ) {
      return this.providerWasmArgs(this.syncProviders[0]!);
    }
    return this.wasmStorageArgs();
  }

  stagedRemoteStorageArgs(): [string, string, string] | undefined {
    const type = this.loginSetupType ?? this.storageMode;
    const kind = storageProviderKind(type);
    if (kind === NookStorageProviderKind.Local) {
      return undefined;
    }
    if (kind === NookStorageProviderKind.Github) {
      const pat = this.githubPat.trim();
      const repo = this.githubRepo.trim() || DEFAULT_GITHUB_REPO;
      if (!pat) {
        return undefined;
      }
      return [wasmStorageModeForProvider(GITHUB_PROVIDER_TYPE), pat, repo];
    }
    if (kind === NookStorageProviderKind.OauthFile) {
      const oauthFile = this.oauthFile;
      const token = oauthFile?.accessToken?.trim();
      if (!oauthFile || !token) {
        return undefined;
      }
      const sharedGoogleDrive =
        oauthFile.preset === "google-drive" &&
        (oauthFile.driveMode === "shared" ||
          Boolean(oauthFile.folderId?.trim()));
      // The visible shared-folder display name is not the legacy Drive backup
      // file name. Keep the validated internal name independent so ordinary
      // folder names such as "Team Vault" cannot break the connect boundary.
      const fileName = sharedGoogleDrive
        ? oauthFile.fileName?.trim() || DEFAULT_DRIVE_BACKUP_NAME
        : this.githubRepo.trim() ||
          oauthFile.fileName?.trim() ||
          DEFAULT_DRIVE_BACKUP_NAME;
      return this.providerWasmArgs({
        id: "staged-oauth-file",
        type: OAUTH_FILE_PROVIDER_TYPE,
        label: "",
        oauthFile: { ...oauthFile, accessToken: token, fileName },
        createdAt: isoTimestamp(),
      });
    }
    return undefined;
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
      storageProviderKind(this.storageMode) !==
        NookStorageProviderKind.OauthFile ||
      !this.manager ||
      !this.oauthFile
    ) {
      return;
    }
    const remoteRef = this.manager.storage_remote_ref ?? "";
    if (!remoteRef.trim() || remoteRef === this.oauthFile.fileId) {
      return;
    }
    this.oauthFile = { ...this.oauthFile, fileId: remoteRef };
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
    return (
      this.activeVaultProviders.find(
        (p) => storageProviderKind(p.type) === NookStorageProviderKind.Local,
      ) ?? undefined
    );
  }

  /** Canonical on-device vault row — alias kept while settings code migrates. */
  get activeProvider(): StorageProvider | undefined {
    return this.localProvider;
  }

  /** Providers belonging to the active vault only. */
  get activeVaultProviders(): StorageProvider[] {
    const sid = this.activeVaultStoreId?.trim();
    if (!sid) {
      return this.providers;
    }
    return this.providers.filter(
      (provider) => !provider.storeId || provider.storeId === sid,
    );
  }

  /** Cloud sync destinations for the active vault — local row omitted. */
  get syncProviders(): StorageProvider[] {
    return this.activeVaultProviders.filter(
      (p) => storageProviderKind(p.type) !== NookStorageProviderKind.Local,
    );
  }

  get hasMultipleLocalVaults(): boolean {
    return this.localVaults.length > 1;
  }

  get showLoginVaultPicker(): boolean {
    return (
      !this.isAuthenticated &&
      this.localVaults.length > 1 &&
      this.selectedLoginVaultStoreId === undefined &&
      this.loginSetupType === undefined &&
      !this.addProviderOpen &&
      isVaultSessionLocked()
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

  private async continueInitializationAfterDeviceUnlock() {
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
      this.applySentinelGenesisFinalizeResult(rawResult);
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

  get draftVaultArchitecture(): VaultArchitecture {
    return validateVaultArchitecture({
      device_mode: this.draftDeviceMode,
      vault_type: this.draftVaultType,
      replication_type: this.draftReplicationType,
      sentinel:
        this.draftVaultType === "sentinel"
          ? {
              threshold: 2,
              required_participants: 2,
              ready_participants: 0,
            }
          : undefined,
    });
  }

  applyDraftVaultArchitecture() {
    this.vaultArchitecture = this.draftVaultArchitecture;
    this.architectureSecretCreationAllowed = architectureCanCreateSecret(
      this.vaultArchitecture,
    );
    if (this.manager) {
      this.manager.setVaultArchitectureJson(
        JSON.stringify(this.vaultArchitecture),
      );
    }
  }

  refreshVaultArchitectureFromManager() {
    if (!this.manager) return;
    let architecture: VaultArchitecture;
    try {
      architecture = validateVaultArchitecture(
        JSON.parse(this.manager.vaultArchitectureJson) as VaultArchitecture,
      );
    } catch (error) {
      vaultLog.warn("vault architecture metadata could not be parsed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    this.vaultArchitecture = architecture;
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
  ) {
    if (!this.manager || this.isVerifying) return;
    this.isVerifying = true;
    this.errorMsg = "";
    let deviceIdentityUnlocked = false;
    try {
      await this.enqueueStorage(() =>
        createPasskeyProtection(this.manager!, passkeyLabel, deviceMode),
      );
      deviceIdentityUnlocked = true;
      this.deviceAuthorizationInProgress = true;
      this.deviceProtectionLockedMode = "passkey";
      await this.continueInitializationAfterDeviceUnlock();
      this.deviceProtectionStatus = "unlocked";
    } catch (error) {
      if (isPasskeyCeremonyNotAllowedError(error)) {
        vaultLog.warn("passkey creation did not finish");
        this.errorMsg = this.t("device_protection.passkey_create_not_allowed");
        return;
      }
      if (isPasskeyUnavailableError(error)) {
        vaultLog.warn(
          "passkey unavailable; offering PIN device protection fallback",
        );
        this.deviceProtectionStatus = "pin-setup";
        this.errorMsg = this.t(
          "device_protection.passkey_unavailable_pin_fallback_ready",
        );
        return;
      }
      if (isPasskeyPrfUnavailableError(error)) {
        vaultLog.warn(
          "passkey PRF unavailable; offering PIN device protection fallback",
        );
        this.deviceProtectionStatus = "pin-setup";
        this.errorMsg = this.t("device_protection.pin_fallback_ready");
        return;
      }
      vaultLog.warn("passkey device protection setup failed");
      if (
        this.deviceProtectionStatus === "unlocked" ||
        deviceIdentityUnlocked
      ) {
        void this.lockDeviceProtection();
      }
      this.errorMsg =
        error instanceof Error ? error.message : "Failed to create passkey.";
    } finally {
      this.deviceAuthorizationInProgress = false;
      this.isVerifying = false;
      this.isInitializing = false;
    }
  }

  async recoverDeviceProtectionWithPasskey() {
    if (!this.manager || this.isVerifying) return;
    this.isVerifying = true;
    this.errorMsg = "";
    let deviceIdentityUnlocked = false;
    try {
      await this.enqueueStorage(() =>
        recoverExistingPasskeyProtection(this.manager!),
      );
      deviceIdentityUnlocked = true;
      this.deviceAuthorizationInProgress = true;
      this.deviceProtectionLockedMode = "passkey";
      await this.continueInitializationAfterDeviceUnlock();
      this.deviceProtectionStatus = "unlocked";
    } catch (error) {
      if (isPasskeyCeremonyNotAllowedError(error)) {
        vaultLog.warn("passkey recovery did not finish");
        this.errorMsg = this.t(
          "device_protection.passkey_recovery_not_allowed",
        );
        return;
      }
      if (isPasskeyUnavailableError(error)) {
        vaultLog.warn(
          "passkey recovery unavailable; offering PIN device protection fallback",
        );
        this.deviceProtectionStatus = "pin-setup";
        this.errorMsg = this.t(
          "device_protection.recovery_passkey_unavailable_pin_fallback_ready",
        );
        return;
      }
      if (isPasskeyPrfUnavailableError(error)) {
        vaultLog.warn(
          "passkey recovery PRF unavailable; offering PIN device protection fallback",
        );
        this.deviceProtectionStatus = "pin-setup";
        this.errorMsg = this.t("device_protection.recovery_pin_fallback_ready");
        return;
      }
      vaultLog.warn("passkey device protection recovery failed");
      if (
        this.deviceProtectionStatus === "unlocked" ||
        deviceIdentityUnlocked
      ) {
        void this.lockDeviceProtection();
      }
      this.errorMsg =
        error instanceof Error
          ? error.message
          : "Failed to use existing passkey.";
    } finally {
      this.deviceAuthorizationInProgress = false;
      this.isVerifying = false;
      this.isInitializing = false;
    }
  }

  async setupPinDeviceProtection(pin: string, confirmPin: string) {
    if (!this.manager || this.isVerifying) return;
    this.isVerifying = true;
    this.errorMsg = "";
    let deviceIdentityUnlocked = false;
    try {
      if (pin !== confirmPin) {
        throw new Error(this.t("device_protection.pin_mismatch"));
      }
      await this.enqueueStorage(() =>
        this.manager!.finishPinDeviceProtection(pin),
      );
      deviceIdentityUnlocked = true;
      this.deviceAuthorizationInProgress = true;
      this.deviceProtectionLockedMode = "pin";
      await this.continueInitializationAfterDeviceUnlock();
      this.deviceProtectionStatus = "unlocked";
    } catch (error) {
      if (
        this.deviceProtectionStatus === "unlocked" ||
        deviceIdentityUnlocked
      ) {
        void this.lockDeviceProtection();
      }
      this.errorMsg =
        error instanceof Error ? error.message : "Failed to create PIN.";
    } finally {
      this.deviceAuthorizationInProgress = false;
      this.isVerifying = false;
      this.isInitializing = false;
    }
  }

  async unlockDeviceProtection() {
    if (!this.manager || this.isVerifying) return;
    this.isVerifying = true;
    this.errorMsg = "";
    let deviceIdentityUnlocked = false;
    try {
      await this.enqueueStorage(() =>
        authorizePasskeyProtection(this.manager!),
      );
      deviceIdentityUnlocked = true;
      this.deviceAuthorizationInProgress = true;
      this.deviceProtectionLockedMode = "passkey";
      await this.continueInitializationAfterDeviceUnlock();
      this.deviceProtectionStatus = "unlocked";
    } catch (error) {
      if (isPasskeyCeremonyNotAllowedError(error)) {
        vaultLog.warn("passkey authorization did not finish");
        this.errorMsg = this.t("device_protection.passkey_unlock_not_allowed");
        return;
      }
      if (
        this.deviceProtectionStatus === "unlocked" ||
        deviceIdentityUnlocked
      ) {
        void this.lockDeviceProtection();
      }
      this.errorMsg =
        error instanceof Error
          ? error.message
          : "Passkey authorization failed.";
    } finally {
      this.deviceAuthorizationInProgress = false;
      this.isVerifying = false;
      this.isInitializing = false;
    }
  }

  async unlockPinDeviceProtection(pin: string) {
    if (!this.manager || this.isVerifying) return;
    this.isVerifying = true;
    this.errorMsg = "";
    let deviceIdentityUnlocked = false;
    try {
      await this.enqueueStorage(() =>
        this.manager!.unlockPinDeviceIdentity(pin),
      );
      deviceIdentityUnlocked = true;
      this.deviceAuthorizationInProgress = true;
      this.deviceProtectionLockedMode = "pin";
      await this.continueInitializationAfterDeviceUnlock();
      this.deviceProtectionStatus = "unlocked";
    } catch (error) {
      if (
        this.deviceProtectionStatus === "unlocked" ||
        deviceIdentityUnlocked
      ) {
        void this.lockDeviceProtection();
      }
      this.errorMsg =
        error instanceof Error ? error.message : "PIN authorization failed.";
    } finally {
      this.deviceAuthorizationInProgress = false;
      this.isVerifying = false;
      this.isInitializing = false;
    }
  }

  async resetDeviceProtectionForRecovery() {
    if (!this.manager || this.isVerifying) return;
    this.isVerifying = true;
    this.errorMsg = "";
    try {
      await this.manager.resetDeviceProtectionForRecovery();
      this.deviceProtectionStatus = "missing";
      this.deviceProtectionLockedMode = "passkey";
      this.deviceId = "";
      this.devicePublicKey = "";
      this.providers = [];
      this.providersLoaded = false;
      this.githubPat = "";
      this.oauthFile = undefined;
      this.localFolder = undefined;
      this.storageMode = LOCAL_PROVIDER_TYPE;
      this.showSuccess(this.t("device_protection.recovery_complete"));
    } catch (error) {
      this.errorMsg =
        error instanceof Error ? error.message : "Recovery reset failed.";
    } finally {
      this.isVerifying = false;
    }
  }

  shouldAutoUnlock(): boolean {
    if (isVaultSessionLocked()) {
      return false;
    }
    if (this.localVaultPresent && this.passwordEntries.length > 0) {
      return false;
    }
    return (
      this.localVaultPresent &&
      this.syncProviders.length === 0 &&
      this.loginSetupType === undefined &&
      !this.addProviderOpen
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

  private applySentinelGenesisStatus(rawStatus: string): void {
    const status = JSON.parse(rawStatus) as SentinelGenesisManagerStatus;
    this.sentinelGenesisParticipantCount = status.participants?.length ?? 0;
    this.sentinelGenesisParticipants = (status.participants ?? []).map(
      (participant) => ({
        participantId: participant.deviceId,
        label: participant.label ?? "",
        fingerprint: participant.fingerprint ?? "",
      }),
    );
    this.sentinelGenesisStatus = status.isComplete ? "ready" : "collecting";
  }

  private applySentinelGenesisFinalizeResult(rawResult: string): void {
    const result = JSON.parse(rawResult) as SentinelGenesisFinalizeResult;
    this.sentinelGenesisStoreId = result.storeId;
    this.activeVaultStoreId = result.storeId;
    this.vaultArchitecture = validateVaultArchitecture(result.architecture);
    this.sentinelGenesisDeliveries = result.participantDeliveries.map(
      (delivery) => ({
        participantId: delivery.deviceId,
        fingerprint:
          delivery.fingerprint ??
          this.sentinelGenesisParticipants.find(
            (participant) => participant.participantId === delivery.deviceId,
          )?.fingerprint,
        payload: JSON.stringify(delivery),
        sharePayload: JSON.stringify(delivery),
      }),
    );
    this.sentinelGenesisStatus = "delivering";
  }

  async startSentinelGenesis(args: StartSentinelGenesisArgs): Promise<void> {
    if (!this.manager) throw new Error("Vault engine is not available.");
    if (this.isVerifying) return;
    this.isVerifying = true;
    this.errorMsg = "";
    this.dismissSuccess();
    this.sentinelGenesisDeliveries = [];
    this.sentinelGenesisParticipants = [];
    this.sentinelGenesisParticipantCount = 0;
    this.sentinelGenesisStoreId = undefined;
    try {
      await this.initDeviceIdentity();
      this.manager.setVaultName(args.label.trim());
      const status = await this.enqueueStorage(() =>
        this.manager!.startSentinelGenesis(
          args.participantCount,
          args.threshold,
          args.label.trim(),
        ),
      );
      this.sentinelGenesisRequest = this.manager.sentinelGenesisRequestJson();
      this.applySentinelGenesisStatus(status);
    } catch (error) {
      this.sentinelGenesisStatus = "idle";
      this.errorMsg =
        error instanceof Error
          ? error.message
          : "Failed to start Sentinel setup.";
      throw error;
    } finally {
      this.isVerifying = false;
    }
  }

  async addSentinelGenesisParticipantResponse(
    payload: string,
    participantLabel = "",
  ): Promise<void> {
    if (!this.manager) throw new Error("Vault engine is not available.");
    if (this.isVerifying) return;
    this.isVerifying = true;
    this.errorMsg = "";
    try {
      const status = await this.enqueueStorage(() =>
        this.manager!.addSentinelGenesisParticipantResponse(
          payload.trim(),
          participantLabel.trim(),
        ),
      );
      this.applySentinelGenesisStatus(status);
    } catch (error) {
      this.errorMsg =
        error instanceof Error
          ? error.message
          : "Failed to add Sentinel participant.";
      throw error;
    } finally {
      this.isVerifying = false;
    }
  }

  async createSentinelGenesisPublicKeyAnnouncement(): Promise<string> {
    if (!this.manager) throw new Error("Vault engine is not available.");
    if (this.isVerifying) return "";
    this.isVerifying = true;
    this.errorMsg = "";
    try {
      await this.initDeviceIdentity();
      return await this.enqueueStorage(() =>
        this.manager!.createSentinelGenesisPublicKeyAnnouncement(
          this.t("device_protection.passkey_label_placeholder"),
        ),
      );
    } catch (error) {
      this.errorMsg =
        error instanceof Error
          ? error.message
          : "Failed to create Sentinel public key announcement.";
      throw error;
    } finally {
      this.isVerifying = false;
    }
  }

  async rememberSentinelGenesisRequest(requestPayload: string): Promise<void> {
    if (!this.manager) throw new Error("Vault engine is not available.");
    if (this.isVerifying) return;
    this.isVerifying = true;
    this.errorMsg = "";
    try {
      await this.enqueueStorage(() =>
        this.manager!.rememberSentinelGenesisRequest(requestPayload.trim()),
      );
    } catch (error) {
      this.errorMsg =
        error instanceof Error
          ? error.message
          : "Failed to remember the Sentinel initiator request.";
      throw error;
    } finally {
      this.isVerifying = false;
    }
  }

  async createSentinelGenesisParticipantResponse(
    requestPayload: string,
  ): Promise<string> {
    if (!this.manager) throw new Error("Vault engine is not available.");
    if (this.isVerifying) return "";
    this.isVerifying = true;
    this.errorMsg = "";
    try {
      await this.initDeviceIdentity();
      return await this.enqueueStorage(() =>
        this.manager!.respondToSentinelGenesisRequest(
          requestPayload.trim(),
          this.t("device_protection.passkey_label_placeholder"),
        ),
      );
    } catch (error) {
      this.errorMsg =
        error instanceof Error
          ? error.message
          : "Failed to create Sentinel participant response.";
      throw error;
    } finally {
      this.isVerifying = false;
    }
  }

  async finalizeSentinelGenesis(): Promise<void> {
    if (!this.manager) throw new Error("Vault engine is not available.");
    if (this.isVerifying) return;
    this.isVerifying = true;
    this.errorMsg = "";
    this.sentinelGenesisStatus = "finalizing";
    try {
      const rawResult = await this.enqueueStorage(() =>
        this.manager!.finalizeSentinelGenesis(),
      );
      this.applySentinelGenesisFinalizeResult(rawResult);
    } catch (error) {
      this.sentinelGenesisStatus = "ready";
      this.errorMsg =
        error instanceof Error
          ? error.message
          : "Failed to finalize Sentinel setup.";
      throw error;
    } finally {
      this.isVerifying = false;
    }
  }

  async acceptSentinelGenesisShareDelivery(payload: string): Promise<void> {
    if (!this.manager) throw new Error("Vault engine is not available.");
    if (this.isVerifying) return;
    this.isVerifying = true;
    this.errorMsg = "";
    try {
      await this.enqueueStorage(() =>
        this.manager!.acceptSentinelGenesisShareDelivery(payload.trim()),
      );
      this.showSuccess(this.t("login.sentinel_genesis_receive_share_success"));
    } catch (error) {
      this.errorMsg =
        error instanceof Error
          ? error.message
          : "Failed to receive Sentinel share.";
      throw error;
    } finally {
      this.isVerifying = false;
    }
  }

  async completeSentinelGenesisDelivery(): Promise<void> {
    if (!this.sentinelGenesisStoreId || this.isVerifying) return;
    this.isVerifying = true;
    try {
      this.sentinelGenesisStatus = "complete";
      await setActiveVault(this.sentinelGenesisStoreId);
      await this.refreshLocalVaultCatalog();
      this.selectedLoginVaultStoreId = this.sentinelGenesisStoreId;
      this.localLoginPrepared = false;
      this.sentinelCeremonyPrompt = true;
    } finally {
      this.isVerifying = false;
    }
  }

  async prepareSentinelOnboardingLinks(): Promise<void> {
    if (!this.manager || !this.sentinelGenesisStoreId) return;
    const provider = this.syncProviders[0];
    if (!provider || provider.type === "local-folder") return;
    const providerSnapshot = JSON.parse(
      JSON.stringify({
        providers: [provider],
        activeVaultStoreId: this.sentinelGenesisStoreId,
      }),
    );
    this.sentinelGenesisDeliveries = this.sentinelGenesisDeliveries.map(
      (delivery) => {
        const sharePayload = delivery.sharePayload ?? delivery.payload;
        if (delivery.participantId === this.deviceId) {
          return { ...delivery, sharePayload };
        }
        const packageJson = this.manager!.createSentinelOnboardingPackage(
          this.sentinelGenesisRequest,
          sharePayload,
          providerSnapshot,
        );
        return {
          ...delivery,
          sharePayload,
          payload: buildSentinelOnboardingLink(packageJson),
        };
      },
    );
  }

  async acceptSentinelOnboardingPackage(packageJson: string): Promise<void> {
    if (!this.manager) throw new Error("Vault engine is not available.");
    this.errorMsg = "";
    const storeId = await this.enqueueStorage(() =>
      this.manager!.acceptSentinelOnboardingPackage(packageJson),
    );
    this.activeVaultStoreId = storeId;
    await setActiveVault(storeId);
    await this.loadProviders();
    this.applyActiveProviderCredentials();
    this.sentinelGenesisStatus = "complete";
    await this.loadDb();
  }

  async renameLocalVault(storeId: string, label: string): Promise<void> {
    return localLoginActions.renameLocalVaultLabel(this, storeId, label);
  }

  async selectVaultForUnlock(storeId: string): Promise<void> {
    return localLoginActions.selectVaultForUnlock(this, storeId);
  }

  async reloadProvidersForActiveVault(): Promise<void> {
    const snapshot = await this.enqueueStorage(() =>
      loadAuthProviders(this.manager!),
    );
    this.providers = snapshot.providers.map((p) =>
      p.label === "GitHub sync" ? { ...p, label: "GitHub" } : p,
    );
    if (snapshot.activeVaultStoreId) {
      this.activeVaultStoreId = snapshot.activeVaultStoreId;
    }
    this.applyActiveProviderCredentials();
  }

  async syncActiveVaultStoreIdToAuth(): Promise<void> {
    return localLoginActions.syncActiveVaultStoreIdToAuth(this);
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
    const trimmed = storeId.trim();
    if (
      !trimmed ||
      trimmed === this.activeVaultStoreId?.trim() ||
      this.isVerifying
    ) {
      return;
    }
    this.helpOpen = false;
    this.cancelProviderSetup();
    this.cancelAddProvider();
    this.isVerifying = true;
    try {
      await this.waitForStorageChain();
      setVaultSessionLocked(true);
      this.clearUnlockedSession();
      await this.waitForStorageChain();
      await this.chooseLoginVault(trimmed);
      this.isVerifying = true;
      await this.lockDeviceProtection();
      vaultLog.info("vault switch completed", { storeId: trimmed });
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
    this.providers = this.providers.filter(
      (provider) => provider.type === "local",
    );
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
  ): Promise<string> {
    const args =
      argsOverride ??
      (!this.isAuthenticated &&
      this.syncProviders.length > 0 &&
      this.joinEnrollmentPrompt !== "none"
        ? this.providerWasmArgs(this.syncProviders[0]!)
        : this.wasmStorageArgs());
    return (await this.enqueueStorage(async () => {
      const assessPromise = this.manager!.assess_vault_connect(...args);
      const assessTimeout = new Promise<never>((_, reject) => {
        setTimeout(
          () =>
            reject(
              new Error(
                "Connection timed out. Check your PAT, network, and try again.",
              ),
            ),
          30_000,
        );
      });
      return (await Promise.race([assessPromise, assessTimeout])) as string;
    })) as string;
  }

  async handleRemoteVaultAssessStatus(accessStatus: string): Promise<boolean> {
    if (accessStatus === "remote_missing_local_cache") {
      this.remoteVaultRecoveryPrompt = "with_cache";
      await this.refreshPasswordEntriesList();
      return true;
    }
    if (accessStatus === "remote_missing") {
      // Empty remote on first provider setup is normal — genesis runs on connect.
      if (this.loginSetupType !== undefined) {
        return false;
      }
      this.remoteVaultRecoveryPrompt = "missing_only";
      return true;
    }
    return false;
  }

  /** Clear wasm session + login password preview so UI matches the active provider. */
  resetVaultSessionState() {
    if (this.manager) {
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
    this.sentinelUnlockSession = {
      active: false,
      collected: 0,
      threshold: 0,
      ready: false,
    };
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

  clearUnlockedSession() {
    this.stopIdleSessionTracking();
    this.stopVaultSync();
    this.isAuthenticated = false;
    this.secrets = [];
    this.pendingJoins = [];
    this.vaultMembers = [];
    this.joinEnrollmentPrompt = "none";
    this.enrollSecretsKey = "";
    this.enrollMembersKey = "";
    this.sharedJoinerIdentity = "";
    this.sharedGrantInstructions = "";
    this.settingsOpen = false;
    this.enrollmentCode = "";
    this.errorMsg = "";
    const wasSentinel = this.vaultArchitecture.vault_type === "sentinel";
    this.resetVaultSessionState();
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
      if (result.secrets.length > 0) {
        this.secrets = result.secrets;
      }
      this.pendingJoins = result.pendingJoins;
      this.vaultMembers = result.vaultMembers;
      return;
    }

    vaultLog.debug("sync result (unauthenticated)", {
      changed: result.changed,
      accessStatus: result.accessStatus,
      joinEnrollmentPrompt: this.joinEnrollmentPrompt,
    });

    if (!result.changed) return;

    if (result.accessStatus) {
      vaultLog.info("sync state changed (login gate)", {
        accessStatus: result.accessStatus,
        pendingJoins: result.pendingJoins.length,
      });
    }

    if (
      result.accessStatus === "ready" &&
      this.joinEnrollmentPrompt === "pending"
    ) {
      this.joinEnrollmentPrompt = "none";
      this.showSuccess(this.t("toasts.device_approved"));
      this.scheduleAutoConnectAfterApproval();
    } else if (result.accessStatus === "ready" && this.awaitingJoinApproval) {
      // Joiner whose approval landed after the join dialog was dismissed:
      // sync says the remote vault is ready for this device, so unlock it
      // instead of leaving the user stranded on the login gate.
      this.scheduleAutoConnectAfterApproval();
    } else if (
      result.accessStatus === "join_pending" &&
      this.joinEnrollmentPrompt === "none"
    ) {
      this.joinEnrollmentPrompt = "pending";
      this.awaitingJoinApproval = true;
    }
  }

  /** Connect once the remote reports this device enrolled (post-approval). */
  private scheduleAutoConnectAfterApproval() {
    if (this.isAuthenticated || this.isVerifying || this.loginPasswordPrompt) {
      return;
    }
    // Never auto-unlock a session the user (or idle timer) explicitly locked.
    if (this.sessionExpiredByIdle || isVaultSessionLocked()) {
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
        if (
          storageProviderKind(provider.type) ===
          NookStorageProviderKind.LocalFolder
        ) {
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
      const eventLogRecords = (await this.enqueueStorage(() =>
        this.manager!.exportEventLogRecords(),
      )) as ExtensionEventLogRecord[];
      publishExtensionEventLogUpdate(vaultStoreId, eventLogRecords);
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
    if (
      provider &&
      storageProviderKind(provider.type) === NookStorageProviderKind.LocalFolder
    ) {
      return undefined;
    }
    if (provider) {
      return this.providerWasmArgs(provider);
    }
    if (
      this.syncProviders[0] &&
      storageProviderKind(this.syncProviders[0].type) ===
        NookStorageProviderKind.LocalFolder
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
    const version = Number(readVaultVersion(yaml));
    // `vaultStoreId` borrows the wasm manager; read it through the storage chain
    // so it can't alias an in-flight `&mut self` op (recursive-borrow hang).
    const managerStoreId = this.manager
      ? await this.enqueueStorage(() => this.manager!.vaultStoreId)
      : "";
    this.providers = this.providers.map((p) =>
      p.id === providerId
        ? {
            ...p,
            lastSyncedAt: isoTimestamp(),
            lastSyncedVersion: version || p.lastSyncedVersion,
            lastSyncRevision: revision ?? p.lastSyncRevision,
            lastCommonContentHash: vaultContentHash(yaml),
            storeId: managerStoreId || p.storeId,
          }
        : p,
    );
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
      this.secrets = raw as NookSecretRecord[];
      await this.refreshReplacementConflicts();
      this.scheduleFanOutSyncAfterLocalSave();
      this.showSuccess("Secret conflict resolved.");
    } catch (error: unknown) {
      this.errorMsg =
        error instanceof Error ? error.message : "Could not resolve conflict.";
    } finally {
      this.isSaving = false;
    }
  }

  async stageVaultSyncConflict(
    conflict: PendingSyncConflictDraft,
  ): Promise<void> {
    const localVersion = Number(readVaultVersion(conflict.localYaml));
    const remoteVersion = Number(readVaultVersion(conflict.remoteYaml));
    this.pendingSyncConflict = new NookPendingSyncConflict(
      conflict.providerId,
      conflict.providerLabel,
      conflict.localYaml,
      conflict.remoteYaml,
      localVersion,
      remoteVersion,
      conflict.mode,
      conflict.pat,
      conflict.repo,
      conflict.remoteRevision,
      conflict.kind,
      conflict.localStoreId,
      conflict.remoteStoreId,
    );
    this.errorMsg = "";
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
  stageSyncConflict(conflict: PendingSyncConflict) {
    return syncActions.stageSyncConflict(this, conflict);
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
    conflict: PendingSyncConflict,
  ): void {
    if (conflict.providerId !== "__pending_provider__") {
      return;
    }
    this.loginSetupType = undefined;
    this.addProviderOpen = false;
  }

  async ensureProviderSavedAfterConflict(
    conflict: PendingSyncConflict,
  ): Promise<string> {
    if (
      conflict.providerId !== "__pending_provider__" &&
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
    if (
      !provider ||
      storageProviderKind(provider.type) === NookStorageProviderKind.Local
    ) {
      throw new Error("Choose a cloud sync provider.");
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

  openSettings(
    section: "storage" | "onboard" | "admin" = "storage",
    accordion: "devices" | "language" = "devices",
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

  openAdmin(accordion: "vaults" | "storage" | "passwords" = "vaults") {
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
      this.secrets = [];
      return;
    }
    // `filter_secrets` borrows the wasm manager; route it through the storage
    // chain so a background sync's refresh can't alias an in-flight foreground
    // `&mut self` op (delete/add) and trigger a recursive-borrow hang.
    this.secrets = await this.enqueueStorage(() =>
      this.manager!.filter_secrets(""),
    );
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
    const { snapshot, migrated } = (await ensureLocalAuthProviderSnapshot(
      JSON.parse(
        JSON.stringify({
          providers: this.providers,
        }),
      ),
    )) as NookLocalAuthProviderSnapshot;
    if (migrated || snapshot.providers.length !== this.providers.length) {
      this.providers = snapshot.providers;
      await this.enqueueStorage(() =>
        saveAuthProviders(this.manager!, snapshot),
      );
    }
    this.localVaultPresent = await hasLocalVault();
    if (this.localVaultPresent) {
      this.storageMode = LOCAL_PROVIDER_TYPE;
      this.githubPat = "";
      this.oauthFile = undefined;
      this.localFolder = undefined;
    }
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

  scheduleRemoteEventOutboxFlush(): void {
    void this.flushRemoteEventOutboxNow();
  }

  async flushRemoteEventOutboxNow(provider?: StorageProvider): Promise<void> {
    if (!this.manager) return;
    const folderProvider =
      provider &&
      storageProviderKind(provider.type) === NookStorageProviderKind.LocalFolder
        ? provider
        : !provider &&
            this.syncProviders[0] &&
            storageProviderKind(this.syncProviders[0].type) ===
              NookStorageProviderKind.LocalFolder
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
