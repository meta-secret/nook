import { I18N_KEYS } from "../../../generated/i18n-keys";
import {
  existing_vault_provider_readiness,
  JoinEnrollmentState,
  NookExistingVaultProviderReadiness,
} from "$app-wasm";
import {
  ExistingVaultImportQueueKind,
  type ExistingVaultImportQueue,
} from "$lib/vault/creation-queue";
import type { VaultState } from "$lib/vault.svelte";
import {
  ActiveVaultKind,
  LoginSetupKind,
  RecoveryDiscoveryKind,
  type ActiveVault,
} from "$lib/vault/state/provider.svelte";

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
    const setup = this.vault.loginSetup;
    if (setup.kind !== LoginSetupKind.Active) return;
    const draft = this.vault.providerDraft;
    const readiness = existing_vault_provider_readiness(draft);
    if (readiness === NookExistingVaultProviderReadiness.MissingLocalFolder) {
      this.vault.errorMsg = this.vault.t(
        I18N_KEYS.AuthStorageLocalFolderChooseErr,
      );
      return;
    }
    this.queue = {
      kind: ExistingVaultImportQueueKind.WaitingForDevice,
      request: {
        storeId,
        previousActiveVault: this.vault.activeVault,
        kind: setup.providerKind,
        draft,
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
      const selected = await this.vault.selectVaultForUnlock(pending.storeId);
      if (selected.isErr()) {
        this.vault.errorMsg = this.vault.t(selected.error.translationKey);
        return;
      }
      if (
        this.vault.activeVault.kind !== ActiveVaultKind.Open ||
        this.vault.activeVault.storeId !== pending.storeId
      ) {
        this.vault.errorMsg = this.vault.t(
          I18N_KEYS.ErrorsVaultSelectionFailed,
        );
        return;
      }
    } else {
      const prepared = await this.vault.prepareExistingVaultImportSlot();
      if (prepared.isErr()) {
        this.vault.errorMsg = this.vault.t(prepared.error.translationKey);
        return;
      }
    }
    this.vault.loginRequiresExistingVault = true;
    this.vault.activateLoginSetup(pending.kind);
    this.vault.stageProviderDraft($state.snapshot(pending.draft));
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
      const selected = await this.vault.selectVaultForUnlock(
        previousActiveVault.storeId,
      );
      if (selected.isErr()) {
        this.vault.errorMsg = this.vault.t(selected.error.translationKey);
        return;
      }
    }
    this.vault.beginLoginVaultPicker();
  }

  cancel(): void {
    this.queue = { kind: ExistingVaultImportQueueKind.Idle };
    this.vault.clearExistingVaultRecoverySummary();
  }

  private async activatePendingVault(): Promise<void> {
    if (
      this.queue.kind !== ExistingVaultImportQueueKind.WaitingForDevice ||
      !this.vault.isAuthenticated
    ) {
      return;
    }
    const pending = this.queue;
    const activated = await this.vault.activateConnectedExistingVault(
      pending.request.storeId,
    );
    if (activated.isErr()) {
      this.vault.errorMsg = this.vault.t(activated.error.translationKey);
      return;
    }
    if (this.queue === pending) this.cancel();
  }
}
