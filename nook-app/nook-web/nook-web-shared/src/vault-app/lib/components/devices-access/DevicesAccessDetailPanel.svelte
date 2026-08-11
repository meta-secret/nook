<script lang="ts">
  import { tick } from 'svelte'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import type { VaultState } from '$lib/vault.svelte'
  import type { DashboardView } from '../devices-access-dashboard-state'
  import { ProviderSaveKind } from '../devices-access-dashboard-state'
  import AccessDeviceKeyPanel from './AccessDeviceKeyPanel.svelte'
  import AccessUnlockPanel from './AccessUnlockPanel.svelte'
  import AccessVaultsPanel from './AccessVaultsPanel.svelte'
  import {
    AccessChainStage,
    AccessChainTabKind,
    accessChainTab,
    accessChainTabId,
    panelDescription,
    panelTitle,
  } from './access-chain'

  let {
    vault,
    view,
    selectedStage = $bindable(),
    providerDraft = $bindable(),
    providerSaveState,
    onSaveProviderLabel,
    onProviderDraftInput,
    onManageVaultDevices,
    onManageVaultPasswords,
  }: {
    vault: VaultState
    view: DashboardView
    selectedStage: AccessChainStage
    providerDraft: string
    providerSaveState: ProviderSaveKind
    onSaveProviderLabel: () => void
    onProviderDraftInput: () => void
    onManageVaultDevices: () => void
    onManageVaultPasswords: () => void
  } = $props()

  const panelId = 'devices-access-panel'
  const panelContentId = 'devices-access-panel-content'

  async function navigateDetailTabs({
    event,
    currentStage,
  }: {
    readonly event: KeyboardEvent
    readonly currentStage: AccessChainStage
  }): Promise<void> {
    const stages = [
      AccessChainStage.Unlock,
      AccessChainStage.DeviceKey,
      AccessChainStage.Vaults,
    ] as const
    let nextIndex = stages.indexOf(currentStage)
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (nextIndex + 1) % stages.length
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (nextIndex - 1 + stages.length) % stages.length
    } else if (event.key === 'Home') {
      nextIndex = 0
    } else if (event.key === 'End') {
      nextIndex = stages.length - 1
    } else {
      return
    }
    event.preventDefault()
    selectedStage = stages[nextIndex]
    await tick()
    const tab = accessChainTab(selectedStage)
    if (tab.kind === AccessChainTabKind.Mounted) tab.element.focus()
  }
</script>

<div
  id={panelId}
  class="mt-10 border-t border-border/70 pt-6"
  data-testid="devices-access-panel"
>
  <div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
    <div>
      <p class="access-micro-label text-muted-foreground">
        {vault.t(I18N_KEYS.DevicesAccessBridgeDetails)}
      </p>
      <h2 class="mt-1.5 text-base font-semibold text-foreground">
        {(() => { const panelTitleArgs: Parameters<typeof panelTitle>[0] = { vault, stage: selectedStage, protection: view.protection }; return panelTitle(panelTitleArgs); })()}
      </h2>
      <p
        class="mt-1 max-w-[70ch] text-sm leading-relaxed text-pretty text-muted-foreground"
      >
        {(() => { const panelDescriptionArgs: Parameters<typeof panelDescription>[0] = { vault, stage: selectedStage, protection: view.protection }; return panelDescription(panelDescriptionArgs); })()}
      </p>
    </div>
    <div
      class="grid w-full grid-cols-3 border border-border bg-card p-1 sm:w-auto"
      role="tablist"
      aria-label={vault.t(I18N_KEYS.DevicesAccessBridgeDetails)}
    >
      <button
        type="button"
        role="tab"
        id={accessChainTabId(AccessChainStage.Unlock)}
        aria-selected={selectedStage === AccessChainStage.Unlock}
        aria-controls={panelContentId}
        tabindex={selectedStage === AccessChainStage.Unlock ? 0 : -1}
        class:active={selectedStage === AccessChainStage.Unlock}
        class="detail-tab"
        data-testid="devices-access-node-unlock"
        onclick={() => (selectedStage = AccessChainStage.Unlock)}
        onkeydown={(event) =>
          void (() => { const navigateDetailTabsArgs: Parameters<typeof navigateDetailTabs>[0] = { event, currentStage: AccessChainStage.Unlock }; return navigateDetailTabs(navigateDetailTabsArgs); })()}
        >{vault.t(I18N_KEYS.DevicesAccessBridgeDetailProtection)}</button
      >
      <button
        type="button"
        role="tab"
        id={accessChainTabId(AccessChainStage.DeviceKey)}
        aria-selected={selectedStage === AccessChainStage.DeviceKey}
        aria-controls={panelContentId}
        tabindex={selectedStage === AccessChainStage.DeviceKey ? 0 : -1}
        class:active={selectedStage === AccessChainStage.DeviceKey}
        class="detail-tab"
        data-testid="devices-access-node-device-key"
        onclick={() => (selectedStage = AccessChainStage.DeviceKey)}
        onkeydown={(event) =>
          void (() => { const navigateDetailTabsArgs: Parameters<typeof navigateDetailTabs>[0] = { event, currentStage: AccessChainStage.DeviceKey }; return navigateDetailTabs(navigateDetailTabsArgs); })()}
        >{vault.t(I18N_KEYS.DevicesAccessBridgeDetailDevice)}</button
      >
      <button
        type="button"
        role="tab"
        id={accessChainTabId(AccessChainStage.Vaults)}
        aria-selected={selectedStage === AccessChainStage.Vaults}
        aria-controls={panelContentId}
        tabindex={selectedStage === AccessChainStage.Vaults ? 0 : -1}
        class:active={selectedStage === AccessChainStage.Vaults}
        class="detail-tab"
        data-testid="devices-access-node-vaults"
        onclick={() => (selectedStage = AccessChainStage.Vaults)}
        onkeydown={(event) =>
          void (() => { const navigateDetailTabsArgs: Parameters<typeof navigateDetailTabs>[0] = { event, currentStage: AccessChainStage.Vaults }; return navigateDetailTabs(navigateDetailTabsArgs); })()}
        >{vault.t(I18N_KEYS.DevicesAccessBridgeDetailVaults)}</button
      >
    </div>
  </div>
  <div
    id={panelContentId}
    class="mt-5"
    role="tabpanel"
    aria-labelledby={accessChainTabId(selectedStage)}
  >
    {#if selectedStage === AccessChainStage.Unlock}
      <AccessUnlockPanel
        {vault}
        protection={view.protection}
        passkeyName={view.passkeyName}
        credentialId={view.credentialId}
        userHandleId={view.userHandleId}
        providerLabel={view.providerLabel}
        createdAt={view.createdAt}
        lastUsedAt={view.lastUsedAt}
        attachment={view.attachment}
        transports={view.transports}
        backupState={view.backupState}
        aaguid={view.aaguid}
        observedBrowser={view.observedBrowser}
        observedPlatform={view.observedPlatform}
        bind:providerDraft
        {providerSaveState}
        {onSaveProviderLabel}
        {onProviderDraftInput}
      />
    {:else if selectedStage === AccessChainStage.DeviceKey}
      <AccessDeviceKeyPanel
        {vault}
        protection={view.protection}
        deviceId={view.deviceId}
      />
    {:else}
      <AccessVaultsPanel
        {vault}
        vaults={view.vaults}
        {onManageVaultDevices}
        {onManageVaultPasswords}
      />
    {/if}
  </div>
</div>

<style>
  .detail-tab {
    min-width: 0;
    min-height: 2.5rem;
    flex: 1 1 0;
    padding: 0.5rem 0.8rem;
    color: var(--muted-foreground);
    font-size: 0.75rem;
    font-weight: 500;
    line-height: 1.25;
    overflow-wrap: anywhere;
  }
  .detail-tab.active {
    background: var(--foreground);
    color: var(--background);
  }
  .detail-tab:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
</style>
