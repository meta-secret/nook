import { I18N_KEYS } from "../../../generated/i18n-keys";
import { LoginSetupKind } from "$lib/vault/state/provider.svelte";
import { WorkspaceSection } from "$lib/vault/state/ui.svelte";
import type { VaultState } from "$lib/vault.svelte";

/**
 * The pages of an identity unlocked while none of its vaults is open: its
 * overview beside its card on the hub, and its Sync, Devices, Add a device,
 * Keys and Settings pages. They act on the identity's own log, so they need
 * its app key, not a vault.
 */
export class IdentityPages {
  constructor(private readonly vault: VaultState) {}

  /** The pages that open without a vault. */
  private static readonly sections: readonly WorkspaceSection[] = [
    WorkspaceSection.Sync,
    WorkspaceSection.Devices,
    WorkspaceSection.AddDevice,
    WorkspaceSection.Keys,
    WorkspaceSection.Settings,
  ];

  /** One of the pages is open, in place of the hub, for the unlocked
   * identity; with a vault open, the workspace has its own. */
  get pageShown(): boolean {
    const vault = this.vault;
    return (
      vault.deviceProtectionReady &&
      !vault.isAuthenticated &&
      IdentityPages.sections.includes(vault.identityPage)
    );
  }

  /** Open a page or the overview; Identities leaves for the hub. */
  show(section: WorkspaceSection): void {
    this.vault.identityPage = section;
  }

  /** A page chosen from the card or its checklist: Sync opens to add a
   * provider, as "Add a sync provider" asks. */
  manage(section: WorkspaceSection): void {
    if (section === WorkspaceSection.Sync) this.addSyncProvider();
    else this.show(section);
  }

  addSyncProvider(): void {
    this.vault.beginAddProvider();
    this.show(WorkspaceSection.Sync);
  }

  /** Back returns to the overview the page was opened from; leaving Sync
   * while adding a provider drops that provider. */
  back(): void {
    const vault = this.vault;
    if (
      vault.addProviderOpen ||
      vault.loginSetup.kind === LoginSetupKind.Active
    ) {
      vault.cancelProviderSetup();
      vault.cancelAddProvider();
    }
    this.show(WorkspaceSection.Overview);
  }

  /** Save the provider just set up, then copy the identity's log to every
   * provider it is kept on; a fresh identity gets its log here, as it is
   * now in use. Setup then ends on the identity's card, with a line saying
   * it is set up and synced; a vault it holds that this browser does not
   * opens its panel there, so Open is the next step. With none being set
   * up, only the copy runs. */
  async connectProvider(): Promise<void> {
    const vault = this.vault;
    const adding = vault.loginSetup.kind === LoginSetupKind.Active;
    if (adding) {
      const saved = await vault.ensureProviderSaved();
      if (saved.isErr()) {
        vault.errorMsg = vault.t(saved.error.translationKey);
        return;
      }
    }
    const ensured = await vault.identityControl.refresh();
    if (ensured.isErr()) {
      vault.errorMsg = vault.t(ensured.error.translationKey);
      return;
    }
    if (!(await this.synced()) || !adding) return;
    this.show(WorkspaceSection.Identities);
    const snapshot = vault.identityControl.snapshot;
    const request: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.ProviderIdentitiesSetUpHere,
      replacements: {
        identity:
          snapshot === false || !snapshot.identityLabel
            ? vault.t(I18N_KEYS.WorkspaceIdentityFallback)
            : snapshot.identityLabel,
      },
    };
    vault.showSuccess(vault.t(request));
    const away = vault.identityControl.grantedVaultElsewhere();
    if (away !== false) vault.vaultPanelStoreId = away.storeId;
  }

  async removeProvider(id: string): Promise<void> {
    const vault = this.vault;
    const removed = await vault.removeProvider(id);
    if (removed.isErr()) vault.errorMsg = vault.t(removed.error.translationKey);
  }

  async syncLog(): Promise<void> {
    await this.synced();
  }

  /** Copy the identity's log to its providers; a failure says why. */
  private async synced(): Promise<boolean> {
    const vault = this.vault;
    const mounted = await vault.identityControl.syncWithMounts();
    if (mounted.isOk()) return true;
    vault.errorMsg = vault.t(mounted.error.translationKey);
    return false;
  }
}
