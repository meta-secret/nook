<!--
The browser extension, seen from a vault: it fills passwords from vaults,
so it is one of the open vault's own items beside its card. Not installed:
install it. Installed: the item opens the extension's side panel beside the
vault, where a vault not yet connected connects in place (the extension
serves several vaults).
-->
<script lang="ts">
  import { ArrowUpRight, ChevronRight, Puzzle } from "@lucide/svelte";
  import { I18N_KEYS } from "../../../../generated/i18n-keys";
  import {
    ExtensionSetupOfferKind,
    type ExtensionSetupOffer,
  } from "$lib/app/extension-setup";
  import {
    ExtensionSetupStatus,
    extensionInstallationBrowser,
  } from "$lib/extension/install";
  import type { VaultState } from "$lib/vault.svelte";

  let {
    vault,
    offer,
    onOpenPanel,
  }: {
    vault: VaultState;
    offer: ExtensionSetupOffer;
    /** Show the installed extension's side panel in this window. */
    onOpenPanel: () => void;
  } = $props();

  let installing = $state(false);

  const notInstalled = $derived(
    offer.kind === ExtensionSetupOfferKind.Visible &&
      offer.setup.status === ExtensionSetupStatus.NotInstalled,
  );

  async function install(): Promise<void> {
    installing = true;
    try {
      const target =
        await extensionInstallationBrowser.loadExtensionInstallTarget();
      extensionInstallationBrowser.openExtensionInstallTarget(target);
    } finally {
      installing = false;
    }
  }
</script>

{#if offer.kind === ExtensionSetupOfferKind.Visible}
  <button
    type="button"
    class="nk-identity-menu-item nk-plate disabled:cursor-default disabled:opacity-45"
    data-testid={notInstalled
      ? "vault-extension-install"
      : "vault-pair-extension-btn"}
    disabled={notInstalled ? installing : vault.isVerifying}
    onclick={() => (notInstalled ? void install() : onOpenPanel())}
  >
    <span class="nk-vault-icon" aria-hidden="true">
      <Puzzle class="size-4" />
    </span>
    <span class="flex min-w-0 flex-1 flex-col">
      <span class="truncate text-sm font-medium text-foreground"
        >{notInstalled
          ? vault.t(I18N_KEYS.ExtensionSetupInstallCta)
          : vault.t(I18N_KEYS.ExtensionSetupVaultConnect)}</span
      >
      <span class="truncate text-xs text-muted-foreground"
        >{notInstalled
          ? vault.t(I18N_KEYS.ExtensionSetupVaultInstallTitle)
          : vault.t(I18N_KEYS.ExtensionSetupVaultConnectTitle)}</span
      >
    </span>
    {#if notInstalled}
      <ArrowUpRight
        class="size-4 flex-none text-muted-foreground opacity-60"
        aria-hidden="true"
      />
    {:else}
      <ChevronRight
        class="size-4 flex-none text-muted-foreground opacity-60"
        aria-hidden="true"
      />
    {/if}
  </button>
{/if}
