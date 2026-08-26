import { I18N_KEYS } from "../../../generated/i18n-keys";
import {
  JoinEnrollmentState,
  NookExistingVaultProviderReadiness,
} from "$app-wasm";
import {
  GITHUB_PROVIDER_TYPE,
  LOCAL_FOLDER_PROVIDER_TYPE,
  OAUTH_FILE_PROVIDER_TYPE,
} from "$lib/auth/providers";
import {
  ExistingVaultImportQueueKind,
  type ExistingVaultImportQueue,
} from "$lib/vault/creation-queue";
import type { VaultState } from "$lib/vault.svelte";
import { prepareExistingVaultProvider } from "$lib/vault/existing-vault-provider.svelte";
import {
  ActiveVaultKind,
  LocalVaultCatalogKind,
  LoginSetupKind,
  LoginVaultSelectionKind,
  RecoveryDiscoveryKind,
  type ActiveVault,
} from "$lib/vault/state/provider.svelte";

export function loginUnlockStoreId(vault: VaultState): string {
  if (vault.activeVault.kind === ActiveVaultKind.Open) {
    const storeId = vault.activeVault.storeId.trim();
    if (storeId) return storeId;
  }
  if (vault.selectedLoginVault.kind === LoginVaultSelectionKind.Selected) {
    const storeId = vault.selectedLoginVault.storeId.trim();
    if (storeId) return storeId;
  }
  if (vault.localVaultCatalog.kind === LocalVaultCatalogKind.Available) {
    const storeId = vault.localVaultCatalog.first.storeId.trim();
    if (storeId) return storeId;
  }
  return "";
}

/** Browser orchestration for an existing-vault import retained across device unlock. */
type ExistingVaultPasswordUnlock = {
  readonly entryId: string;
  readonly password: string;
};

export class ExistingVaultImportLifecycle {
  queue = $state<ExistingVaultImportQueue>({
    kind: ExistingVaultImportQueueKind.Idle,
  });

  constructor(private readonly vault: VaultState) {}

  get waitingForDevice(): boolean {
    return this.queue.kind === ExistingVaultImportQueueKind.WaitingForDevice;
  }

  remember(storeId: string): void {
    if (this.vault.loginSetup.kind !== LoginSetupKind.Active) return;
    const prepareExistingVaultProviderArgs: Parameters<
      typeof prepareExistingVaultProvider
    >[0] = { state: this.vault, setupType: this.vault.loginSetup.providerType };
    const preparation = prepareExistingVaultProvider(
      prepareExistingVaultProviderArgs,
    );
    if (
      preparation.kind === NookExistingVaultProviderReadiness.MissingOauthFile
    ) {
      this.vault.errorMsg = this.vault.t(
        I18N_KEYS.ErrorsCloudSyncProviderRequired,
      );
      return;
    }
    if (
      preparation.kind === NookExistingVaultProviderReadiness.MissingLocalFolder
    ) {
      this.vault.errorMsg = this.vault.t(
        I18N_KEYS.AuthStorageLocalFolderChooseErr,
      );
      return;
    }
    if (preparation.kind !== NookExistingVaultProviderReadiness.Ready) return;
    this.queue = {
      kind: ExistingVaultImportQueueKind.WaitingForDevice,
      request: {
        storeId,
        previousActiveVault: this.vault.activeVault,
        provider: preparation.provider,
      },
    };
  }

  async resume(): Promise<void> {
    if (this.queue.kind !== ExistingVaultImportQueueKind.WaitingForDevice) {
      await this.vault.loadDb();
      return;
    }
    const pending = this.queue.request;
    if (this.vault.isAuthenticated) this.vault.clearUnlockedSession();
    const existingLocalVault = this.vault.localVaults.some(
      (entry) => entry.storeId === pending.storeId,
    );
    if (existingLocalVault) {
      await this.vault.selectVaultForUnlock(pending.storeId);
      if (
        this.vault.activeVault.kind !== ActiveVaultKind.Open ||
        this.vault.activeVault.storeId !== pending.storeId
      ) {
        throw new Error(this.vault.t(I18N_KEYS.ErrorsVaultSelectionFailed));
      }
    } else {
      await this.vault.prepareExistingVaultImportSlot();
    }
    this.vault.loginRequiresExistingVault = true;
    this.vault.activateLoginSetup(pending.provider.setupType);
    this.vault.storageMode = pending.provider.setupType;
    this.vault.githubPat =
      pending.provider.setupType === GITHUB_PROVIDER_TYPE
        ? pending.provider.githubPat
        : "";
    this.vault.githubRepo =
      pending.provider.setupType === GITHUB_PROVIDER_TYPE
        ? pending.provider.githubRepo
        : "";
    if (pending.provider.setupType === OAUTH_FILE_PROVIDER_TYPE) {
      this.vault.configureOauthFile(pending.provider.oauthFile);
    } else {
      this.vault.clearOauthFile();
    }
    if (pending.provider.setupType === LOCAL_FOLDER_PROVIDER_TYPE) {
      this.vault.configureLocalFolder(pending.provider.localFolder);
    } else {
      this.vault.clearLocalFolder();
    }
    const recoveryDiscovery = this.vault.recoveryDiscovery;
    await this.vault.connectStagedProvider();
    if (this.vault.isAuthenticated) {
      await this.activatePendingVault();
      return;
    }
    if (this.vault.loginPasswordPrompt) {
      if (
        recoveryDiscovery.kind === RecoveryDiscoveryKind.Found &&
        recoveryDiscovery.summary.passwordEntries.length
      ) {
        const entries = recoveryDiscovery.summary.passwordEntries;
        if (entries.length === 1) {
          for (const entry of entries) this.vault.selectPasswordEntry(entry.id);
        } else {
          this.vault.clearSelectedPasswordEntry();
        }
      }
      return;
    }
    if (
      this.vault.joinEnrollmentPrompt !== JoinEnrollmentState.None ||
      this.vault.sentinelCeremonyPrompt
    ) {
      return;
    }
  }

  async unlockWithPassword({
    entryId,
    password,
  }: ExistingVaultPasswordUnlock): Promise<void> {
    const unlockRequest: Parameters<typeof this.vault.unlockWithPassword>[0] = {
      entryId,
      password,
    };
    await this.vault.unlockWithPassword(unlockRequest);
    if (!this.vault.isAuthenticated) return;
    if (this.waitingForDevice) {
      await this.activatePendingVault();
    } else {
      this.cancel();
    }
  }

  async finish(): Promise<void> {
    if (!this.waitingForDevice || !this.vault.isAuthenticated) return;
    await this.activatePendingVault();
  }

  async leave(): Promise<void> {
    const previousActiveVault: ActiveVault =
      this.queue.kind === ExistingVaultImportQueueKind.WaitingForDevice
        ? this.queue.request.previousActiveVault
        : { kind: ActiveVaultKind.Closed };
    this.cancel();
    if (previousActiveVault.kind === ActiveVaultKind.Open) {
      await this.vault.selectVaultForUnlock(previousActiveVault.storeId);
    }
    this.vault.beginLoginVaultPicker();
  }

  cancel(): void {
    this.queue = { kind: ExistingVaultImportQueueKind.Idle };
    this.vault.clearExistingVaultRecoverySummary();
  }

  private async activatePendingVault(): Promise<void> {
    if (this.queue.kind !== ExistingVaultImportQueueKind.WaitingForDevice) {
      return;
    }
    await this.vault.activateConnectedExistingVault(this.queue.request.storeId);
    this.cancel();
  }
}
