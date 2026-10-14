<!--
The browser extension, seen from a vault: it fills passwords from vaults,
so its one control lives on the vault page. Not installed: install it.
Installed without this vault: connect this vault too (the extension serves
several vaults). Connected: a quiet tag says so.
-->
<script lang="ts">
  import { Puzzle } from "@lucide/svelte";
  import { I18N_KEYS } from "../../../../generated/i18n-keys";
  import { Button } from "$lib/components/ui/button";
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
    onConnect,
  }: {
    vault: VaultState;
    offer: ExtensionSetupOffer;
    /** Ask the installed extension to connect the open vault. */
    onConnect: () => void;
  } = $props();

  let installing = $state(false);

  const status = $derived(
    offer.kind === ExtensionSetupOfferKind.Visible
      ? offer.setup.status
      : ExtensionSetupStatus.Paired,
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
  {#if status === ExtensionSetupStatus.NotInstalled}
    <Button
      type="button"
      variant="outline"
      size="sm"
      title={vault.t(I18N_KEYS.ExtensionSetupVaultInstallTitle)}
      data-testid="vault-extension-install"
      disabled={installing}
      onclick={() => void install()}
    >
      <Puzzle class="size-4" />
      <span class="hidden sm:inline"
        >{vault.t(I18N_KEYS.ExtensionSetupInstallCta)}</span
      >
    </Button>
  {:else if status === ExtensionSetupStatus.Paired}
    <span
      class="nk-tag nk-tag-success inline-flex items-center gap-1"
      title={vault.t(I18N_KEYS.ExtensionSetupVaultConnectedTitle)}
      data-testid="vault-extension-connected"
    >
      <Puzzle class="size-3" aria-hidden="true" />
      {vault.t(I18N_KEYS.ExtensionSetupVaultConnected)}
    </span>
  {:else}
    <Button
      type="button"
      variant="outline"
      size="sm"
      title={vault.t(I18N_KEYS.ExtensionSetupVaultConnectTitle)}
      data-testid="vault-pair-extension-btn"
      disabled={vault.isVerifying}
      onclick={onConnect}
    >
      <Puzzle class="size-4" />
      <span class="hidden sm:inline"
        >{vault.t(I18N_KEYS.ExtensionSetupVaultConnect)}</span
      >
    </Button>
  {/if}
{/if}
