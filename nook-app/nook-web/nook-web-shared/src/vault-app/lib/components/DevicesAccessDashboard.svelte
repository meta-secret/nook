<!--
PRODUCT: Nook makes local device identity and vault access understandable without exposing secrets.
USER: A person who cannot remember which passkey manager, browser, PIN, or vault relationship they used.
MOMENT: They may have no vault, a locked vault, or an unlocked vault and need one trustworthy inventory.
DIRECTION: A hairline schematic of the access chain as the subject—passkey, browser device key, vaults—with a quiet readout rail and one link's evidence inspected at a time.
DESIGN SYSTEM: Existing Nook typography, surfaces, semantic colors, controls, responsive shell, and light/dark themes.
-->
<script lang="ts">
  import { I18N_KEYS } from '../../../generated/i18n-keys'
  import { tick, untrack } from 'svelte'
  import {
    ArrowLeft,
    CircleHelp,
    Fingerprint,
    Laptop,
    LockKeyhole,
    RefreshCw,
    ShieldCheck,
  } from '@lucide/svelte'
  import {
    DeviceAccessIdentityState,
    DeviceAccessProtectionKind,
    NookDeviceAccessTextKind,
    NookDeviceVaultAccessState,
    type NookPasskeyAttachmentState,
    type NookPasskeyBackupState,
    NookPasskeyTimestampEvidenceKind,
    type PasskeyObservedBrowser,
    type PasskeyObservedPlatform,
    type PasskeyTransport,
    setDeviceAccessPasskeyProviderLabel,
  } from '$app-wasm'
  import type {
    NookDeviceAccessText,
    NookPasskeyTimestampEvidence,
  } from '$app-wasm'
  import { Button } from '$lib/components/ui/button'
  import DeviceProtectionGate from '$lib/components/DeviceProtectionGate.svelte'
  import type { VaultState } from '$lib/vault.svelte'
  import {
    dashboardElement,
    DashboardFocusTargetKind,
    DashboardLoadKind,
    type DashboardLoadState,
    type DashboardText,
    DashboardTextKind,
    type DashboardTimestamp,
    DashboardTimestampKind,
    providerSaveFocus,
    ProviderSaveFocusKind,
    ProviderSaveKind,
  } from './devices-access-dashboard-state'
  import AccessChainDiagram from './devices-access/AccessChainDiagram.svelte'
  import AccessDeviceKeyPanel from './devices-access/AccessDeviceKeyPanel.svelte'
  import AccessUnlockPanel from './devices-access/AccessUnlockPanel.svelte'
  import AccessVaultsPanel from './devices-access/AccessVaultsPanel.svelte'
  import {
    AccessChainLinkKind,
    AccessChainStage,
    accessChainTab,
    accessChainTabId,
    AccessChainTabKind,
    buildAccessChainNodes,
    identityStateLabel,
    panelDescription,
    panelTitle,
    protectionLabel,
    stageLabel,
    textValue,
    type VaultAccessView,
    verifiedVaultsLabel,
  } from './devices-access/access-chain'

  let {
    vault,
    onBack,
    onManageVaultDevices,
    onManageVaultPasswords,
  }: {
    vault: VaultState
    onBack: () => void
    onManageVaultDevices: () => void
    onManageVaultPasswords: () => void
  } = $props()

  type DashboardView = {
    protection: DeviceAccessProtectionKind
    identityState: DeviceAccessIdentityState
    deviceId: DashboardText
    credentialId: DashboardText
    userHandleId: DashboardText
    passkeyName: DashboardText
    providerLabel: DashboardText
    createdAt: DashboardTimestamp
    lastUsedAt: DashboardTimestamp
    attachment: NookPasskeyAttachmentState
    transports: PasskeyTransport[]
    backupState: NookPasskeyBackupState
    aaguid: DashboardText
    observedBrowser: PasskeyObservedBrowser
    observedPlatform: PasskeyObservedPlatform
    vaults: VaultAccessView[]
  }

  const PANEL_ID = 'devices-access-panel'

  let loadState = $state<DashboardLoadState<DashboardView>>({
    kind: DashboardLoadKind.Loading,
  })
  let selectedStage = $state(AccessChainStage.Unlock)
  let providerDraft = $state('')
  let providerSaveState = $state<ProviderSaveKind>(ProviderSaveKind.Idle)
  let pendingFocusTarget = $state<DashboardFocusTargetKind>(
    DashboardFocusTargetKind.None,
  )
  let loadGeneration = 0

  const chainNodes = $derived.by(() =>
    loadState.kind === DashboardLoadKind.Ready
      ? buildAccessChainNodes(vault, loadState.view)
      : [],
  )

  function readText(value: NookDeviceAccessText): DashboardText {
    try {
      return value.kind === NookDeviceAccessTextKind.Known
        ? { kind: DashboardTextKind.Known, value: value.value() }
        : { kind: DashboardTextKind.Unknown }
    } finally {
      value.free()
    }
  }

  function readTimestamp(
    value: NookPasskeyTimestampEvidence,
  ): DashboardTimestamp {
    try {
      if (value.kind === NookPasskeyTimestampEvidenceKind.Known) {
        return { kind: DashboardTimestampKind.Known, value: value.value() }
      }
      return value.kind === NookPasskeyTimestampEvidenceKind.NotYetObserved
        ? { kind: DashboardTimestampKind.NotYetObserved }
        : { kind: DashboardTimestampKind.Unavailable }
    } finally {
      value.free()
    }
  }

  function focusPendingDashboardTarget(): void {
    switch (pendingFocusTarget) {
      case DashboardFocusTargetKind.None:
        return
      case DashboardFocusTargetKind.ChainSelection: {
        const tab = accessChainTab(selectedStage)
        if (tab.kind === AccessChainTabKind.Missing) return
        pendingFocusTarget = DashboardFocusTargetKind.None
        tab.element.focus()
        return
      }
      case DashboardFocusTargetKind.RetryResult: {
        const target = document.querySelector<HTMLElement>(
          loadState.kind === DashboardLoadKind.Failed
            ? '[data-testid="devices-access-retry"]'
            : '[data-testid="devices-access-back"]',
        )
        if (!target) return
        pendingFocusTarget = DashboardFocusTargetKind.None
        target.focus()
        return
      }
    }
  }

  async function focusAfterProtectionReady(): Promise<void> {
    selectedStage = AccessChainStage.Unlock
    pendingFocusTarget = DashboardFocusTargetKind.ChainSelection
    if (loadState.kind !== DashboardLoadKind.Ready) return
    await tick()
    focusPendingDashboardTarget()
  }

  async function loadDashboard(): Promise<DashboardLoadKind> {
    const generation = ++loadGeneration
    // A re-read keeps the current readout on screen. Blanking it would move
    // focus and hide the link the person is reading mid-save. The check is
    // untracked because the reloading effect must not depend on its own writes.
    if (untrack(() => loadState.kind) !== DashboardLoadKind.Ready) {
      loadState = { kind: DashboardLoadKind.Loading }
    }
    try {
      const snapshotRequest = vault
        .requireManager()
        .deviceAccessSnapshotRequest()
      const snapshot = await snapshotRequest
        .resolve()
        .finally(() => snapshotRequest.free())
      try {
        const vaults = snapshot.vaults().map((entry): VaultAccessView => {
          try {
            return {
              storeId: entry.storeId,
              label: entry.label,
              verified:
                entry.accessState === NookDeviceVaultAccessState.Verified,
              verifiedAt: readText(entry.verifiedAt),
              lastLocalUpdateAt: readText(entry.lastLocalUpdateAt),
            }
          } finally {
            entry.free()
          }
        })
        const transports = snapshot.transports().map((entry) => {
          try {
            return entry.kind
          } finally {
            entry.free()
          }
        })
        if (generation !== loadGeneration) return DashboardLoadKind.Loading
        const view: DashboardView = {
          protection: snapshot.protection,
          identityState: snapshot.identityState,
          deviceId: readText(snapshot.deviceId),
          credentialId: readText(snapshot.credentialId),
          userHandleId: readText(snapshot.userHandleId),
          passkeyName: readText(snapshot.passkeyName),
          providerLabel: readText(snapshot.providerLabel),
          createdAt: readTimestamp(snapshot.createdAt),
          lastUsedAt: readTimestamp(snapshot.lastUsedAt),
          attachment: snapshot.attachment,
          transports,
          backupState: snapshot.backupState,
          aaguid: readText(snapshot.aaguid),
          observedBrowser: snapshot.observedBrowser,
          observedPlatform: snapshot.observedPlatform,
          vaults,
        }
        providerDraft = textValue(view.providerLabel)
        loadState = { kind: DashboardLoadKind.Ready, view }
        await tick()
        focusPendingDashboardTarget()
        return DashboardLoadKind.Ready
      } finally {
        snapshot.free()
      }
    } catch {
      const isCurrentGeneration = generation === loadGeneration
      if (isCurrentGeneration) {
        loadState = { kind: DashboardLoadKind.Failed }
        await tick()
        focusPendingDashboardTarget()
      }
      return isCurrentGeneration
        ? DashboardLoadKind.Failed
        : DashboardLoadKind.Loading
    }
  }

  async function retryDashboard(): Promise<void> {
    pendingFocusTarget = DashboardFocusTargetKind.RetryResult
    await loadDashboard()
  }

  async function saveProviderLabel(): Promise<void> {
    if (
      providerSaveState === ProviderSaveKind.Saving ||
      loadState.kind !== DashboardLoadKind.Ready ||
      loadState.view.credentialId.kind !== DashboardTextKind.Known
    ) {
      return
    }
    const credentialFingerprint = loadState.view.credentialId.value
    providerSaveState = ProviderSaveKind.Saving
    try {
      await setDeviceAccessPasskeyProviderLabel(
        credentialFingerprint,
        providerDraft,
      )
      const reloadedKind = await loadDashboard()
      providerSaveState = ProviderSaveKind.Idle
      if (reloadedKind === DashboardLoadKind.Failed) {
        pendingFocusTarget = DashboardFocusTargetKind.RetryResult
        await tick()
        focusPendingDashboardTarget()
      }
    } catch {
      providerSaveState = ProviderSaveKind.Failed
    } finally {
      if (loadState.kind === DashboardLoadKind.Ready) {
        await tick()
        focusAfterProviderSave()
      }
    }
  }

  function focusAfterProviderSave(): void {
    const focus = providerSaveFocus(
      selectedStage === AccessChainStage.Unlock,
      dashboardElement('devices-access-provider-label'),
    )
    if (focus.kind === ProviderSaveFocusKind.Control) {
      focus.element.focus()
      return
    }
    const tab = accessChainTab(selectedStage)
    if (tab.kind === AccessChainTabKind.Missing) return
    tab.element.focus()
  }

  function clearProviderSaveFailure(): void {
    if (providerSaveState === ProviderSaveKind.Failed) {
      providerSaveState = ProviderSaveKind.Idle
    }
  }

  $effect(() => {
    void vault.deviceProtectionStatus
    void vault.localVaults.length
    void loadDashboard()
  })
</script>

<section
  class="mx-auto w-full max-w-5xl space-y-8 pb-4"
  data-testid="devices-access-dashboard"
>
  <header class="flex items-start gap-3 border-b border-border/60 pb-5">
    <Button
      type="button"
      variant="ghost"
      size="icon"
      class="mt-0.5 shrink-0"
      aria-label={vault.t(I18N_KEYS.CommonBack)}
      data-testid="devices-access-back"
      onclick={onBack}
    >
      <ArrowLeft class="size-4" />
    </Button>
    <div class="min-w-0 space-y-1">
      <h1
        class="text-2xl font-semibold tracking-tight text-balance text-foreground sm:text-3xl"
      >
        {vault.t(I18N_KEYS.DevicesAccessTitle)}
      </h1>
      <p
        class="max-w-[70ch] text-sm leading-relaxed text-pretty text-muted-foreground"
      >
        {vault.t(I18N_KEYS.DevicesAccessDescription)}
      </p>
    </div>
  </header>

  {#if loadState.kind === DashboardLoadKind.Loading}
    <div
      class="flex min-h-56 items-center justify-center gap-2 text-sm text-muted-foreground"
      role="status"
    >
      <RefreshCw class="size-4 animate-spin" />
      {vault.t(I18N_KEYS.DevicesAccessLoading)}
    </div>
  {:else if loadState.kind === DashboardLoadKind.Failed}
    <div
      class="rounded-xl border border-destructive/30 bg-destructive/5 p-5"
      role="alert"
    >
      <p class="font-medium text-foreground">
        {vault.t(I18N_KEYS.DevicesAccessLoadFailed)}
      </p>
      <Button
        type="button"
        variant="outline"
        class="mt-3"
        data-testid="devices-access-retry"
        onclick={() => void retryDashboard()}
      >
        <RefreshCw class="size-4" />
        {vault.t(I18N_KEYS.DevicesAccessTryAgain)}
      </Button>
    </div>
  {:else}
    {@const view = loadState.view}
    <div class="grid gap-8 lg:grid-cols-[11.5rem_minmax(0,1fr)] lg:gap-10">
      <aside
        class="order-2 space-y-4 lg:order-1"
        data-testid="devices-access-rail"
      >
        <dl class="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-1">
          <div>
            <dt class="access-micro-label text-muted-foreground">
              {vault.t(I18N_KEYS.DevicesAccessStatusLabel)}
            </dt>
            <dd
              class="mt-1.5 flex items-start gap-1.5 text-sm text-foreground"
              data-testid="devices-access-identity-state"
            >
              {#if view.identityState === DeviceAccessIdentityState.Unlocked}
                <ShieldCheck
                  class="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400"
                />
              {:else if view.identityState === DeviceAccessIdentityState.Locked}
                <LockKeyhole
                  class="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400"
                />
              {:else}
                <CircleHelp
                  class="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                />
              {/if}
              <span>{identityStateLabel(vault, view.identityState)}</span>
            </dd>
          </div>
          <div>
            <dt class="access-micro-label text-muted-foreground">
              {vault.t(I18N_KEYS.DevicesAccessProtectionLabel)}
            </dt>
            <dd class="mt-1.5 text-sm text-foreground">
              {protectionLabel(vault, view.protection)}
            </dd>
          </div>
          <div>
            <dt class="access-micro-label text-muted-foreground">
              {vault.t(I18N_KEYS.DevicesAccessVerifiedVaultsLabel)}
            </dt>
            <dd class="mt-1.5 text-sm text-foreground">
              {verifiedVaultsLabel(vault, view.vaults)}
            </dd>
          </div>
        </dl>

        <div class="h-px bg-border"></div>

        <details data-testid="devices-access-legend">
          <summary
            class="access-micro-label min-h-11 cursor-pointer list-none py-3 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {vault.t(I18N_KEYS.DevicesAccessEvidenceLegend)}
          </summary>
          <dl class="space-y-3 pb-1 text-xs">
            <div class="flex gap-2">
              <ShieldCheck
                class="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400"
              />
              <div>
                <dt class="font-medium text-foreground">
                  {vault.t(I18N_KEYS.DevicesAccessProvenanceVerified)}
                </dt>
                <dd class="text-muted-foreground">
                  {vault.t(I18N_KEYS.DevicesAccessProvenanceVerifiedDesc)}
                </dd>
              </div>
            </div>
            <div class="flex gap-2">
              <Laptop class="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <div>
                <dt class="font-medium text-foreground">
                  {vault.t(I18N_KEYS.DevicesAccessProvenanceBrowser)}
                </dt>
                <dd class="text-muted-foreground">
                  {vault.t(I18N_KEYS.DevicesAccessProvenanceBrowserDesc)}
                </dd>
              </div>
            </div>
            <div class="flex gap-2">
              <Fingerprint
                class="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
              />
              <div>
                <dt class="font-medium text-foreground">
                  {vault.t(I18N_KEYS.DevicesAccessProvenanceUser)}
                </dt>
                <dd class="text-muted-foreground">
                  {vault.t(I18N_KEYS.DevicesAccessProvenanceUserDesc)}
                </dd>
              </div>
            </div>
            <div class="flex gap-2">
              <CircleHelp
                class="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
              />
              <div>
                <dt class="font-medium text-foreground">
                  {vault.t(I18N_KEYS.DevicesAccessProvenanceUnknown)}
                </dt>
                <dd class="text-muted-foreground">
                  {vault.t(I18N_KEYS.DevicesAccessProvenanceUnknownDesc)}
                </dd>
              </div>
            </div>
          </dl>
        </details>
      </aside>

      <div class="order-1 min-w-0 lg:order-2">
        {#if view.protection === DeviceAccessProtectionKind.Missing}
          <div class="space-y-3" data-testid="devices-access-chain-preview">
            <p class="access-micro-label text-muted-foreground">
              {vault.t(I18N_KEYS.DevicesAccessChainLabel)}
            </p>
            <ol class="flex flex-wrap items-center gap-x-3 gap-y-2">
              {#each chainNodes as node (node.stage)}
                {#if node.incoming.kind === AccessChainLinkKind.Relation}
                  <li class="access-micro-label text-muted-foreground">
                    {node.incoming.label}
                  </li>
                {/if}
                <li
                  class="rounded-lg border border-dashed border-border px-2.5 py-1.5 text-sm text-muted-foreground"
                >
                  {stageLabel(vault, node.stage, view.protection)}
                </li>
              {/each}
            </ol>
          </div>
          <div
            class="mt-8 border-t border-border/70 pt-6"
            data-testid="devices-access-prepare-browser"
          >
            <DeviceProtectionGate
              {vault}
              embedded
              showsSetupStep={false}
              onProtectionReady={() => void focusAfterProtectionReady()}
            />
          </div>
        {:else}
          <div class="space-y-4">
            <div class="flex flex-wrap items-baseline justify-between gap-x-4">
              <p class="access-micro-label text-muted-foreground">
                {vault.t(I18N_KEYS.DevicesAccessChainLabel)}
              </p>
              <p class="text-xs text-muted-foreground">
                {vault.t(I18N_KEYS.DevicesAccessChainHint)}
              </p>
            </div>
            <AccessChainDiagram
              nodes={chainNodes}
              selected={selectedStage}
              label={vault.t(I18N_KEYS.DevicesAccessChainLabel)}
              panelId={PANEL_ID}
              onSelect={(stage) => {
                selectedStage = stage
              }}
            />
          </div>

          <div
            id={PANEL_ID}
            role="tabpanel"
            aria-labelledby={accessChainTabId(selectedStage)}
            tabindex="0"
            class="mt-8 border-t border-border/70 pt-6"
            data-testid="devices-access-panel"
          >
            <h2 class="text-base font-semibold text-foreground">
              {panelTitle(vault, selectedStage, view.protection)}
            </h2>
            <p
              class="mt-1 max-w-[70ch] text-sm leading-relaxed text-pretty text-muted-foreground"
            >
              {panelDescription(vault, selectedStage, view.protection)}
            </p>
            <div class="mt-5">
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
                  onSaveProviderLabel={() => void saveProviderLabel()}
                  onProviderDraftInput={clearProviderSaveFailure}
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
        {/if}
      </div>
    </div>
  {/if}
</section>
