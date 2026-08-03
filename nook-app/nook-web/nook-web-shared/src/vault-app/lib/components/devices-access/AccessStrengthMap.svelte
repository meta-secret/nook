<!--
The chain-strength sketch translated into production truth: this browser is the
anchor, its one observed unlock identity is a distinct rounded object, and each
vault owns a row showing whether Nook has verified the route through them.
Experimental graph controls and unobservable provider inventories stay out.
-->
<script lang="ts">
  import { tick } from 'svelte'
  import {
    CircleHelp,
    Fingerprint,
    KeyRound,
    Laptop,
    Link2,
    LockKeyhole,
    ShieldCheck,
    Vault as VaultIcon,
  } from '@lucide/svelte'
  import {
    DeviceAccessIdentityState,
    DeviceAccessProtectionKind,
  } from '$app-wasm'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import type { VaultState } from '$lib/vault.svelte'
  import type { DashboardText } from '../devices-access-dashboard-state'
  import {
    type AccessChainNode,
    AccessChainLinkKind,
    AccessChainStage,
    AccessNodeDetailKind,
    accessChainTab,
    accessChainTabId,
    AccessChainTabKind,
    isPasskeyProtection,
    knownText,
    protectionLabel,
    textValue,
    type VaultAccessView,
    verifiedVaultsLabel,
  } from './access-chain'

  let {
    vault,
    nodes,
    selected,
    panelId,
    identityState,
    protection,
    passkeyName,
    providerLabel,
    vaults,
    onSelect,
  }: {
    vault: VaultState
    nodes: AccessChainNode[]
    selected: AccessChainStage
    panelId: string
    identityState: DeviceAccessIdentityState
    protection: DeviceAccessProtectionKind
    passkeyName: DashboardText
    providerLabel: DashboardText
    vaults: VaultAccessView[]
    onSelect: (stage: AccessChainStage) => void
  } = $props()

  const unlockNode = $derived(nodes[0])
  const deviceNode = $derived(nodes[1])
  const vaultsNode = $derived(nodes[2])
  const identityName = $derived(
    knownText(providerLabel) ? textValue(providerLabel) : unlockNode.title,
  )
  const identityNote = $derived(
    knownText(providerLabel) && textValue(providerLabel) !== unlockNode.title
      ? unlockNode.title
      : protectionLabel(vault, protection),
  )
  const identityIsUserNamed = $derived(
    isPasskeyProtection(protection) &&
      (knownText(providerLabel) || knownText(passkeyName)),
  )
  const deviceBandLabel = $derived(
    protection === DeviceAccessProtectionKind.CompanionSession
      ? deviceNode.title
      : vault.t(I18N_KEYS.DevicesAccessBrowserSection),
  )
  const identityStateLabel = $derived(
    identityState === DeviceAccessIdentityState.Unlocked
      ? vault.t(I18N_KEYS.DevicesAccessIdentityUnlocked)
      : identityState === DeviceAccessIdentityState.Locked
        ? vault.t(I18N_KEYS.DevicesAccessIdentityLocked)
        : vault.t(I18N_KEYS.DevicesAccessIdentityMissing),
  )
  const deviceAccessibleName = $derived(
    [
      deviceBandLabel,
      accessibleNodeName(deviceNode),
      identityStateLabel,
      protectionLabel(vault, protection),
      `${vault.t(I18N_KEYS.DevicesAccessVerifiedVaultsLabel)}: ${verifiedVaultsLabel(vault, vaults)}`,
    ].join('. '),
  )
  const unlockAccessibleName = $derived(
    [
      accessibleNodeNameWithSupportingLabel(unlockNode, identityName),
      ...(identityIsUserNamed
        ? [vault.t(I18N_KEYS.DevicesAccessProvenanceUser)]
        : []),
      identityNote,
      `${vault.t(I18N_KEYS.DevicesAccessVerifiedVaultsLabel)}: ${verifiedVaultsLabel(vault, vaults)}`,
    ].join('. '),
  )
  const vaultsAccessibleName = $derived(
    accessibleNodeNameWithSupportingLabel(
      vaultsNode,
      vault.t(I18N_KEYS.DevicesAccessVaultAccessSection),
    ),
  )

  function shortIdentifier(node: AccessChainNode): string {
    if (node.detail.kind !== AccessNodeDetailKind.Identifier) {
      return vault.t(I18N_KEYS.DevicesAccessUnknown)
    }
    return shortValue(node.detail.value)
  }

  function shortValue(value: string): string {
    const normalized = value.replaceAll('-', '').replaceAll('_', '')
    return normalized.length > 8 ? normalized.slice(-8) : normalized
  }

  function nodeIdentifier(node: AccessChainNode): string {
    return node.detail.kind === AccessNodeDetailKind.Identifier
      ? node.detail.value
      : vault.t(I18N_KEYS.DevicesAccessUnknown)
  }

  function accessibleNodeName(node: AccessChainNode): string {
    return accessibleNodeNameParts(node).join('. ')
  }

  function accessibleNodeNameWithSupportingLabel(
    node: AccessChainNode,
    supportingLabel: string,
  ): string {
    const parts = accessibleNodeNameParts(node)
    if (supportingLabel !== node.title) {
      parts.splice(1, 0, supportingLabel)
    }
    return parts.join('. ')
  }

  function accessibleNodeNameParts(node: AccessChainNode): string[] {
    const parts = [node.title]
    if (node.incoming.kind === AccessChainLinkKind.Relation) {
      parts.push(node.incoming.label)
    }
    if (
      node.detail.kind === AccessNodeDetailKind.Identifier ||
      node.detail.kind === AccessNodeDetailKind.Summary
    ) {
      parts.push(node.detail.value)
    }
    return parts
  }

  function selectionClass(stage: AccessChainStage): string {
    return selected === stage
      ? 'border-foreground ring-1 ring-foreground/15'
      : 'border-border hover:border-foreground/40'
  }

  async function moveSelection(
    from: AccessChainStage,
    offset: number,
  ): Promise<void> {
    // Follow the visible top-to-bottom order of the strength map. The domain
    // nodes remain unlock -> device -> vault because that is the access path;
    // keyboard navigation follows what the person sees on screen.
    const order = [
      AccessChainStage.DeviceKey,
      AccessChainStage.Unlock,
      AccessChainStage.Vaults,
    ]
    const current = order.indexOf(from)
    const next = order[(current + offset + order.length) % order.length]
    onSelect(next)
    await tick()
    const tab = accessChainTab(next)
    if (tab.kind === AccessChainTabKind.Missing) return
    tab.element.focus()
  }

  function handleKeydown(
    event: KeyboardEvent,
    from: AccessChainStage,
  ): void {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault()
      void moveSelection(from, 1)
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault()
      void moveSelection(from, -1)
    }
  }
</script>

<div data-testid="devices-access-chain">
  <div
    class="space-y-8"
    role="tablist"
    aria-orientation="vertical"
    aria-label={vault.t(I18N_KEYS.DevicesAccessChainLabel)}
  >
  <button
    type="button"
    role="tab"
    id={accessChainTabId(AccessChainStage.DeviceKey)}
    aria-selected={selected === AccessChainStage.DeviceKey}
    aria-controls={panelId}
    aria-label={deviceAccessibleName}
    tabindex={selected === AccessChainStage.DeviceKey ? 0 : -1}
    class="min-h-24 w-full border bg-card px-4 py-4 text-left transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none motion-reduce:transition-none sm:px-5 {selectionClass(
      AccessChainStage.DeviceKey,
    )}"
    data-testid="devices-access-node-device-key"
    onclick={() => onSelect(AccessChainStage.DeviceKey)}
    onkeydown={(event) => handleKeydown(event, AccessChainStage.DeviceKey)}
  >
    <span class="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
      <span class="min-w-0">
        <span class="access-micro-label block text-muted-foreground">
          {deviceBandLabel}
        </span>
        <span
          class="mt-1.5 flex items-center gap-2 font-mono text-2xl tracking-[0.08em] text-foreground"
          title={nodeIdentifier(deviceNode)}
        >
          <Laptop class="size-5 shrink-0" aria-hidden="true" />
          <span class="truncate">{shortIdentifier(deviceNode)}</span>
        </span>
        <span class="mt-1.5 block text-xs text-muted-foreground">
          {protectionLabel(vault, protection)}
        </span>
      </span>
      <span
        class="grid grid-cols-2 gap-x-6 gap-y-2 text-left sm:grid-cols-3"
        data-testid="devices-access-rail"
      >
        <span>
          <span class="access-micro-label block text-muted-foreground">
            {vault.t(I18N_KEYS.DevicesAccessStatusLabel)}
          </span>
          <span class="mt-1 flex items-center gap-1.5 text-xs text-foreground">
            {#if identityState === DeviceAccessIdentityState.Unlocked}
              <ShieldCheck
                class="size-3.5 text-emerald-600 dark:text-emerald-400"
                aria-hidden="true"
              />
            {:else if identityState === DeviceAccessIdentityState.Locked}
              <LockKeyhole
                class="size-3.5 text-amber-600 dark:text-amber-400"
                aria-hidden="true"
              />
            {:else}
              <CircleHelp
                class="size-3.5 text-muted-foreground"
                aria-hidden="true"
              />
            {/if}
            <span data-testid="devices-access-identity-state">
              {identityStateLabel}
            </span>
          </span>
        </span>
        <span>
          <span class="access-micro-label block text-muted-foreground">
            {vault.t(I18N_KEYS.DevicesAccessVerifiedVaultsLabel)}
          </span>
          <span class="mt-1 block text-xs text-foreground">
            {verifiedVaultsLabel(vault, vaults)}
          </span>
        </span>
        <span class="col-span-2 sm:col-span-1">
          <span class="access-micro-label block text-muted-foreground">
            {deviceNode.caption}
          </span>
          <span class="mt-1 block truncate text-xs text-foreground">
            {deviceNode.title}
          </span>
        </span>
      </span>
    </span>
    <span class="sr-only">
      {#if deviceNode.incoming.kind === AccessChainLinkKind.Relation}
        {deviceNode.incoming.label}
      {/if}
      {nodeIdentifier(deviceNode)}
    </span>
  </button>

  <section role="presentation">
    <div
      class="access-micro-label flex items-center gap-1.5 text-muted-foreground"
      aria-hidden="true"
    >
      <Fingerprint class="size-3.5" aria-hidden="true" />
      {vault.t(I18N_KEYS.DevicesAccessIdentitiesSection)}
    </div>
    <button
      type="button"
      role="tab"
      id={accessChainTabId(AccessChainStage.Unlock)}
      aria-selected={selected === AccessChainStage.Unlock}
      aria-controls={panelId}
      aria-label={unlockAccessibleName}
      tabindex={selected === AccessChainStage.Unlock ? 0 : -1}
      class="mt-3 flex min-h-14 w-full items-center gap-3 rounded-r-md rounded-l-full border bg-card py-2 pr-3 pl-2 text-left transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none motion-reduce:transition-none sm:max-w-sm {selectionClass(
        AccessChainStage.Unlock,
      )}"
      data-testid="devices-access-node-unlock"
      onclick={() => onSelect(AccessChainStage.Unlock)}
      onkeydown={(event) => handleKeydown(event, AccessChainStage.Unlock)}
    >
      <span
        class="grid size-9 shrink-0 place-items-center rounded-full border-2 border-foreground/55 bg-muted/45"
        aria-hidden="true"
      >
        {#if isPasskeyProtection(protection)}
          <Fingerprint class="size-4" />
        {:else if protection === DeviceAccessProtectionKind.PinOrPassphrase}
          <KeyRound class="size-4" />
        {:else}
          <Link2 class="size-4" />
        {/if}
      </span>
      <span class="min-w-0 flex-1">
        {#if unlockNode.detail.kind === AccessNodeDetailKind.Identifier}
          <span class="flex min-w-0 items-center gap-2">
            <span class="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {identityName}
            </span>
            {#if identityIsUserNamed}
              <span class="access-micro-label shrink-0 text-muted-foreground">
                {vault.t(I18N_KEYS.DevicesAccessProvenanceUser)}
              </span>
            {/if}
          </span>
          <span
            class="mt-0.5 block truncate font-mono text-base tracking-[0.08em] text-foreground"
            title={unlockNode.detail.value}
          >
            {shortIdentifier(unlockNode)}
          </span>
        {:else}
          <span class="block truncate text-xs text-muted-foreground">
            {unlockNode.caption}
          </span>
          <span class="mt-0.5 block text-sm font-medium text-foreground">
            {unlockNode.title}
          </span>
        {/if}
      </span>
      <span class="max-w-[45%] shrink-0 text-right">
        <span class="block text-[0.65rem] leading-tight font-medium text-foreground">
          {identityNote}
        </span>
        <span class="mt-1 block text-[0.65rem] text-muted-foreground">
          {verifiedVaultsLabel(vault, vaults)}
        </span>
      </span>
    </button>
  </section>

  <section role="presentation">
    <button
      type="button"
      role="tab"
      id={accessChainTabId(AccessChainStage.Vaults)}
      aria-selected={selected === AccessChainStage.Vaults}
      aria-controls={panelId}
      aria-label={vaultsAccessibleName}
      tabindex={selected === AccessChainStage.Vaults ? 0 : -1}
      class="flex min-h-11 w-full items-center justify-between gap-3 rounded-sm px-1 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      data-testid="devices-access-node-vaults"
      onclick={() => onSelect(AccessChainStage.Vaults)}
      onkeydown={(event) => handleKeydown(event, AccessChainStage.Vaults)}
    >
      <span class="access-micro-label flex items-center gap-1.5 text-muted-foreground">
        <VaultIcon class="size-3.5" aria-hidden="true" />
        {vault.t(I18N_KEYS.DevicesAccessVaultAccessSection)}
      </span>
      <span
        class="text-xs {selected === AccessChainStage.Vaults
          ? 'text-foreground'
          : 'text-muted-foreground'}"
      >
        {vaultsNode.detail.kind === AccessNodeDetailKind.Summary
          ? vaultsNode.detail.value
          : vaultsNode.title}
      </span>
      {#if vaultsNode.incoming.kind === AccessChainLinkKind.Relation}
        <span class="sr-only">{vaultsNode.incoming.label}</span>
      {/if}
    </button>
  </section>
  </div>

  {#if selected === AccessChainStage.Vaults}
    {#if vaults.length === 0}
      <div class="mt-2 border border-dashed border-border px-4 py-5">
        <p class="text-sm text-muted-foreground">
          {vault.t(I18N_KEYS.DevicesAccessNoVaultsReady)}
        </p>
      </div>
    {:else}
      <ul class="mt-2 space-y-3" data-testid="devices-access-strength-vaults">
        {#each vaults as entry (entry.storeId)}
          <li
            class="border bg-card transition-colors duration-150 motion-reduce:transition-none {selected ===
            AccessChainStage.Vaults
              ? 'border-foreground/45'
              : 'border-border'}"
          >
            <div class="grid sm:grid-cols-[12rem_minmax(0,1fr)]">
              <div class="min-w-0 border-b border-border px-4 py-3 sm:border-r sm:border-b-0">
                <span class="flex items-center gap-2">
                  <VaultIcon
                    class="size-3.5 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span class="truncate text-sm font-medium text-foreground">
                    {entry.label}
                  </span>
                  <span
                    class="ml-auto shrink-0 text-[0.65rem] font-medium tracking-[0.08em] uppercase {entry.verified
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-muted-foreground'}"
                  >
                    {entry.verified
                      ? vault.t(I18N_KEYS.DevicesAccessOpensHere)
                      : vault.t(I18N_KEYS.DevicesAccessAccessUnknown)}
                  </span>
                </span>
                <span
                  class="mt-3 flex items-center gap-1.5 text-[0.65rem] font-medium tracking-[0.08em] uppercase {entry.verified
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-muted-foreground'}"
                >
                  <span
                    class="size-2 rounded-full {entry.verified
                      ? 'bg-emerald-600 dark:bg-emerald-400'
                      : 'border border-muted-foreground/50'}"
                    aria-hidden="true"
                  ></span>
                  {entry.verified
                    ? vault.t(I18N_KEYS.DevicesAccessRouteVerified)
                    : vault.t(I18N_KEYS.DevicesAccessRouteUnverified)}
                </span>
              </div>

              {#if entry.verified}
                <div class="flex min-w-0 flex-wrap items-center gap-2 bg-muted/25 px-4 py-3">
                  <span class="hidden h-px w-4 bg-border sm:block" aria-hidden="true"></span>
                  <span
                    class="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-foreground px-2 py-1 text-[0.65rem] font-medium tracking-[0.08em] text-background uppercase"
                  >
                    <Laptop class="size-3" aria-hidden="true" />
                    {deviceNode.title}
                  </span>
                  <span class="h-px w-5 bg-border" aria-hidden="true"></span>
                  <span
                    class="size-2 shrink-0 rounded-full bg-emerald-600 dark:bg-emerald-400"
                    aria-hidden="true"
                  ></span>
                  <span
                    class="shrink-0 border-b border-foreground/35 font-mono text-xs tracking-[0.06em] text-foreground"
                  >
                    {shortIdentifier(deviceNode)}
                  </span>
                  <span
                    class="ml-auto inline-flex items-center gap-1 text-[0.65rem] font-medium tracking-[0.08em] text-emerald-700 uppercase dark:text-emerald-400"
                  >
                    <ShieldCheck class="size-3" aria-hidden="true" />
                    {vault.t(I18N_KEYS.DevicesAccessProvenanceVerified)}
                  </span>
                </div>
              {:else}
                <div class="flex items-center gap-3 px-4 py-5">
                  <span class="flex-1 border-t border-dashed border-border" aria-hidden="true"></span>
                  <span class="text-xs text-muted-foreground">
                    {vault.t(I18N_KEYS.DevicesAccessLinkUnverified)}
                  </span>
                  <span class="flex-1 border-t border-dashed border-border" aria-hidden="true"></span>
                </div>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</div>
