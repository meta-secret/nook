<!--
The pages of an identity unlocked while none of its vaults is open, from its
overview on the hub: Sync, Devices, Add a device, Keys and Settings. They
act on the identity's log with its app key, so no vault opens for them.
Back returns to the overview.
-->
<script lang="ts">
  import { untrack } from 'svelte'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import AddDeviceFlow from '$lib/components/add-device/AddDeviceFlow.svelte'
  import AuthStorage from '$lib/components/AuthStorage.svelte'
  import { IdentityDirectoryLoader } from '$lib/components/identities/identity-directory-loader.svelte'
  import BrowserSettingsPanel from '$lib/components/settings/BrowserSettingsPanel.svelte'
  import ManageSection from '$lib/components/settings/ManageSection.svelte'
  import {
    ManageNavEntryKind,
    ManageNavLookup,
  } from '$lib/components/workspace/manage-nav'
  import type { VaultState } from '$lib/vault.svelte'
  import { IdentityPages } from '$lib/vault/identity-pages'
  import { LoginSetupKind } from '$lib/vault/state/provider.svelte'
  import { WorkspaceSection } from '$lib/vault/state/ui.svelte'
  import IdentityDevicesPanel from './IdentityDevicesPanel.svelte'
  import IdentityKeysPage from './IdentityKeysPage.svelte'
  import IdentityMountsPanel from './IdentityMountsPanel.svelte'
  import IdentityPageFrame from './IdentityPageFrame.svelte'

  let { vault }: { vault: VaultState } = $props()

  const pages = new IdentityPages(untrack(() => vault))
  const directory = new IdentityDirectoryLoader(untrack(() => vault))
  const section = $derived(vault.identityPage)
  const identityName = $derived(
    directory.currentLabel || vault.t(I18N_KEYS.WorkspaceIdentityFallback),
  )
  const adding = $derived(
    vault.addProviderOpen || vault.loginSetup.kind === LoginSetupKind.Active,
  )
  const title = $derived.by(() => {
    if (section === WorkspaceSection.Sync && adding)
      return vault.t(I18N_KEYS.SettingsAddSyncProvider)
    const entry = new ManageNavLookup(section).entry
    return entry.kind === ManageNavEntryKind.Listed
      ? vault.t(entry.item.labelKey)
      : identityName
  })
</script>

{#if section === WorkspaceSection.AddDevice}
  <AddDeviceFlow
    {vault}
    {identityName}
    onBack={() => pages.back()}
    onOpenSync={() => pages.addSyncProvider()}
    onManageAccounts={() => pages.show(WorkspaceSection.Sync)}
  />
{:else}
  <IdentityPageFrame
    identityName={section === WorkspaceSection.Settings ? '' : identityName}
    {title}
    testId={section}
    backLabel={vault.t(I18N_KEYS.WorkspaceBackToIdentities)}
    onBack={() => pages.back()}
  >
    {#if section === WorkspaceSection.Sync}
      <ManageSection
        compact
        title={vault.t(I18N_KEYS.WorkspaceSectionSync)}
        subtitle={vault.t(I18N_KEYS.WorkspaceSectionSyncDescription)}
        testId="storage-providers-section"
      >
        <AuthStorage
          {vault}
          embedded
          hostBack
          syncProviders={vault.syncProviders}
          manualProviderSync={vault.manualProviderSync}
          isVerifying={vault.isVerifying}
          isInitializing={vault.isInitializing}
          addProviderOpen={vault.addProviderOpen}
          loginSetup={vault.loginSetup}
          bind:githubPat={vault.githubPat}
          bind:githubRepo={vault.githubRepo}
          onReconnect={() => pages.connectProvider()}
          onSyncProvider={() => pages.syncLog()}
          onBeginAddProvider={() => vault.beginAddProvider()}
          onCancelAddProvider={() => vault.cancelAddProvider()}
          onBeginSetup={(
            request: Parameters<typeof vault.beginProviderSetup>[0],
          ) => vault.beginProviderSetup(request)}
          onCancelSetup={() => vault.cancelProviderSetup()}
          onRemoveProvider={(id: string) => pages.removeProvider(id)}
        />
        <IdentityMountsPanel {vault} />
      </ManageSection>
    {:else if section === WorkspaceSection.Devices}
      <IdentityDevicesPanel {vault} />
    {:else if section === WorkspaceSection.Keys}
      <IdentityKeysPage {vault} />
    {:else}
      <BrowserSettingsPanel {vault} />
    {/if}
    <!-- The access gate draws the status line under the page. -->
    {#snippet footer()}{/snippet}
  </IdentityPageFrame>
{/if}
