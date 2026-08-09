<!--
THESIS: Identity Bridge is an operational map, not a dashboard of disconnected facts.
OWN-WORLD: Nook's restrained security surfaces, semantic tokens, evidence-aware language, and real local state remain intact.
STORY: Choose the current identity context or a vault, follow verified device-key evidence without inferring an identity grant, then inspect or manage the selected layer below.
FIRST VIEWPORT: Navigation, plain-language consequence, and the complete relationship graph appear before supporting controls.
FORM: The approved Identity Bridge hierarchy becomes the production interaction model; graph nodes explain relationships while standard panels retain every existing action.
-->
<script lang="ts">
  import { I18N_KEYS } from '../../../generated/i18n-keys'
  import { tick, untrack } from 'svelte'
  import { ArrowLeft, RefreshCw } from '@lucide/svelte'
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
  import { DeviceProtectionGateFrame } from '$lib/components/device-protection-gate-state'
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
  import AccessStrengthPreview from './devices-access/AccessStrengthPreview.svelte'
  import AccessDeviceKeyPanel from './devices-access/AccessDeviceKeyPanel.svelte'
  import AccessUnlockPanel from './devices-access/AccessUnlockPanel.svelte'
  import AccessVaultsPanel from './devices-access/AccessVaultsPanel.svelte'
  import {
    AccessChainStage,
    accessChainTab,
    accessChainTabId,
    AccessChainTabKind,
    deviceKeyTitle,
    formatAccessDate,
    identityStateLabel,
    panelDescription,
    panelTitle,
    protectionLabel,
    textValue,
    type VaultAccessView,
  } from './devices-access/access-chain'
  import IdentityBridgeGraph from './devices-access/IdentityBridgeGraph.svelte'
  import IdentityBridgeNavigation from './devices-access/IdentityBridgeNavigation.svelte'
  import {
    IdentityBridgeDeviceIconKind,
    IdentityBridgePerspective,
    IdentityBridgeVaultSelectionKind,
    type IdentityBridgeCopy,
    type IdentityBridgeVaultSelection,
  } from './devices-access/identity-bridge-model'

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
  const PANEL_CONTENT_ID = 'devices-access-panel-content'

  const stateRuneArgs: Parameters<typeof $state>[0] = {
    kind: DashboardLoadKind.Loading,
  };
  let loadState = $state<DashboardLoadState<DashboardView>>(stateRuneArgs)
  let selectedStage = $state(AccessChainStage.Unlock)
  let selectedPerspective = $state(IdentityBridgePerspective.Identities)
  const stateRuneArgs2: Parameters<typeof $state>[0] = {
    kind: IdentityBridgeVaultSelectionKind.Empty,
  };
  let selectedVault = $state<IdentityBridgeVaultSelection>(stateRuneArgs2)
  let providerDraft = $state('')
  let providerSaveState = $state<ProviderSaveKind>(ProviderSaveKind.Idle)
  let pendingFocusTarget = $state<DashboardFocusTargetKind>(
    DashboardFocusTargetKind.None,
  )
  let loadGeneration = 0

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
        if (
          selectedVault.kind === IdentityBridgeVaultSelectionKind.Empty ||
          !view.vaults.some(
            (entry) =>
              selectedVault.kind ===
                IdentityBridgeVaultSelectionKind.Selected &&
              entry.storeId === selectedVault.storeId,
          )
        ) {
          selectedVault = { kind: IdentityBridgeVaultSelectionKind.Empty }
          for (const entry of view.vaults) {
            selectedVault = {
              kind: IdentityBridgeVaultSelectionKind.Selected,
              storeId: entry.storeId,
            }
            break
          }
        }
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
    const providerSaveFocusArgs: Parameters<typeof providerSaveFocus>[0] = { unlockSelected: selectedStage === AccessChainStage.Unlock, control: dashboardElement('devices-access-provider-label') };
    const focus = providerSaveFocus(
      providerSaveFocusArgs,
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

  function selectPerspective(perspective: IdentityBridgePerspective): void {
    selectedPerspective = perspective
    selectedStage =
      perspective === IdentityBridgePerspective.Identities
        ? AccessChainStage.Unlock
        : AccessChainStage.Vaults
  }

  function selectCurrentIdentity(): void {
    selectPerspective(IdentityBridgePerspective.Identities)
  }

  function selectVault(storeId: string): void {
    selectedVault = {
      kind: IdentityBridgeVaultSelectionKind.Selected,
      storeId,
    }
    selectedStage = AccessChainStage.Vaults
  }

  async function navigateDetailTabs(
    { event, currentStage }: { readonly event: KeyboardEvent; readonly currentStage: AccessChainStage },
  ): Promise<void> {
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

  function selectedVaultLabel(view: DashboardView): string {
    if (selectedVault.kind === IdentityBridgeVaultSelectionKind.Selected) {
      for (const entry of view.vaults) {
        if (entry.storeId === selectedVault.storeId) return entry.label
      }
    }
    return vault.t(I18N_KEYS.DevicesAccessBridgeVault)
  }

  function selectedVaultVerified(view: DashboardView): boolean {
    if (selectedVault.kind === IdentityBridgeVaultSelectionKind.Selected) {
      for (const entry of view.vaults) {
        if (entry.storeId === selectedVault.storeId) return entry.verified
      }
    }
    return false
  }

  $effect(() => {
    void vault.deviceProtectionStatus
    void vault.localVaults.length
    void loadDashboard()
  })
</script>

<section
  class="mx-auto w-full max-w-[90rem] space-y-8 pb-4"
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
    <div class="min-w-0">
      {#if view.protection === DeviceAccessProtectionKind.Missing}
        <AccessStrengthPreview {vault} vaults={view.vaults} />
        <div
          class="mt-8 border-t border-border/70 pt-6"
          data-testid="devices-access-prepare-browser"
        >
          <DeviceProtectionGate
            {vault}
            frame={DeviceProtectionGateFrame.HostSection}
            onProtectionReady={() => void focusAfterProtectionReady()}
          />
        </div>
      {:else}
        {@const verifiedVaultCount = view.vaults.filter(
          (entry) => entry.verified,
        ).length}
        {@const selectedVaultIsVerified = selectedVaultVerified(view)}
        {@const selectedVaultName = selectedVaultLabel(view)}
        {@const selectedVaultExists =
          selectedVault.kind === IdentityBridgeVaultSelectionKind.Selected}
        {@const deviceIdentifier =
          view.deviceId.kind === DashboardTextKind.Known
            ? view.deviceId.value
            : vault.t(I18N_KEYS.DevicesAccessUnknown)}
        {@const companionIdentity =
          view.protection === DeviceAccessProtectionKind.CompanionSession}
        {@const identityTitle = companionIdentity
          ? vault.t(I18N_KEYS.DevicesAccessBridgeCompanionIdentity)
          : vault.t(I18N_KEYS.DevicesAccessBridgeCurrentIdentity)}
        {@const identityDescription = companionIdentity
          ? vault.t(I18N_KEYS.DevicesAccessBridgeCompanionIdentityDesc)
          : vault.t(I18N_KEYS.DevicesAccessBridgeCurrentIdentityDesc)}
        {@const bridgeCopy = {
          protectionStage: vault.t(
            I18N_KEYS.DevicesAccessBridgeProtectionEvidence,
          ),
          deviceStage: vault.t(I18N_KEYS.DevicesAccessBridgeDeviceEvidence),
          identityStage: companionIdentity
            ? vault.t(I18N_KEYS.DevicesAccessBridgeCompanionIdentityContext)
            : vault.t(I18N_KEYS.DevicesAccessBridgeDistributedIdentity),
          vaultStage: vault.t(I18N_KEYS.DevicesAccessBridgeVaultGrants),
          selectedVaultStage: vault.t(
            I18N_KEYS.DevicesAccessBridgeSelectedVault,
          ),
          currentDevice:
            view.protection === DeviceAccessProtectionKind.PasskeyStandard
              ? vault.t(I18N_KEYS.DevicesAccessBridgeDetailDevice)
              : (() => { const deviceKeyTitleArgs: Parameters<typeof deviceKeyTitle>[0] = { vault, protection: view.protection }; return deviceKeyTitle(deviceKeyTitleArgs); })(),
          currentIdentity: identityTitle,
          selectedIdentity: companionIdentity
            ? vault.t(I18N_KEYS.DevicesAccessBridgeCompanionIdentityContext)
            : vault.t(I18N_KEYS.DevicesAccessBridgeSelectedIdentity),
          vaultGrant: vault.t(I18N_KEYS.DevicesAccessBridgeVaultGrant),
          deviceKey: vault.t(I18N_KEYS.DevicesAccessBridgeDetailDevice),
          oneDeviceKey: vault.t(I18N_KEYS.DevicesAccessBridgeOneDeviceKey),
          identityDescription: (() => { const protectionLabelArgs: Parameters<typeof protectionLabel>[0] = { vault, protection: view.protection }; return protectionLabel(protectionLabelArgs); })(),
          identityState: (() => { const identityStateLabelArgs: Parameters<typeof identityStateLabel>[0] = { vault, state: view.identityState }; return identityStateLabel(identityStateLabelArgs); })(),
          deviceMetricLabel: vault.t(
            I18N_KEYS.DevicesAccessBridgeDeviceEvidence,
          ),
          vaultMetricLabel: vault.t(I18N_KEYS.DevicesAccessVerifiedVaultsLabel),
          verifiedVaultCount: (() => { const tArgs: Parameters<typeof vault.t>[0] = { key: I18N_KEYS.DevicesAccessBridgeVerifiedVaultCount, replacements: { count: String(verifiedVaultCount) } }; return vault.t(
            tArgs,
          ); })(),
          statusMetricLabel: vault.t(I18N_KEYS.DevicesAccessStatusLabel),
          evidenceMetricLabel: vault.t(
            I18N_KEYS.DevicesAccessLastSuccessfulUse,
          ),
          verifiedStatus: vault.t(I18N_KEYS.DevicesAccessRouteVerified),
          unverifiedStatus: vault.t(I18N_KEYS.DevicesAccessRouteUnverified),
          noAuthorizedIdentity: vault.t(
            I18N_KEYS.DevicesAccessBridgeNoAuthorized,
          ),
          noAuthorizedIdentityDescription: vault.t(
            I18N_KEYS.DevicesAccessBridgeNoAuthorizedDesc,
          ),
          noVerifiedVaults: vault.t(
            I18N_KEYS.DevicesAccessBridgeNoVerifiedVaults,
          ),
          noVerifiedVaultsDescription: vault.t(
            I18N_KEYS.DevicesAccessBridgeNoVerifiedVaultsDesc,
          ),
          noSelectedVault: vault.t(
            I18N_KEYS.DevicesAccessBridgeNoSelectedVault,
          ),
          noSelectedVaultDescription: vault.t(
            I18N_KEYS.DevicesAccessBridgeNoSelectedVaultDesc,
          ),
          protectionDeviceRelation: vault.t(
            I18N_KEYS.DevicesAccessBridgeProtectionDeviceRelation,
          ),
          appKeyIdentityRelation: vault.t(
            I18N_KEYS.DevicesAccessBridgeAppKeyIdentityRelation,
          ),
          identityVaultRelation: (vaultLabel: string) =>
            (() => { const tArgs2: Parameters<typeof vault.t>[0] = { key: I18N_KEYS.DevicesAccessBridgeIdentityVaultRelation, replacements: {
              vault: vaultLabel,
            } }; return vault.t(tArgs2); })(),
          deviceVaultRelation: (vaultLabel: string) =>
            (() => { const tArgs3: Parameters<typeof vault.t>[0] = { key: I18N_KEYS.DevicesAccessBridgeDeviceVaultRelation, replacements: {
              vault: vaultLabel,
            } }; return vault.t(tArgs3); })(),
          vaultDeviceRelation: (vaultLabel: string) =>
            (() => { const tArgs4: Parameters<typeof vault.t>[0] = { key: I18N_KEYS.DevicesAccessBridgeVaultDeviceRelation, replacements: {
              vault: vaultLabel,
            } }; return vault.t(tArgs4); })(),
          formatEvidence: (value: string) => (() => { const formatAccessDateArgs: Parameters<typeof formatAccessDate>[0] = { vault, value }; return formatAccessDate(formatAccessDateArgs); })(),
          unknown: vault.t(I18N_KEYS.DevicesAccessUnknown),
        } satisfies IdentityBridgeCopy}
        <div
          class="grid min-w-0 gap-8 min-[80rem]:grid-cols-[16rem_minmax(0,1fr)] min-[80rem]:items-start"
        >
          <IdentityBridgeNavigation
            {vault}
            perspective={selectedPerspective}
            {selectedVault}
            {verifiedVaultCount}
            vaults={view.vaults}
            {identityTitle}
            {identityDescription}
            onPerspective={selectPerspective}
            onIdentity={selectCurrentIdentity}
            onVault={selectVault}
          />

          <div class="min-w-0">
            <div class="mb-6">
              <p class="access-micro-label text-primary">
                {selectedPerspective === IdentityBridgePerspective.Identities
                  ? vault.t(I18N_KEYS.DevicesAccessBridgeIdentityView)
                  : vault.t(I18N_KEYS.DevicesAccessBridgeVaultView)}
              </p>
              <h2
                class="mt-2 max-w-4xl text-3xl font-semibold tracking-[-0.025em] text-balance text-foreground sm:text-4xl"
              >
                {#if selectedPerspective === IdentityBridgePerspective.Identities}
                  {(() => { const tArgs5: Parameters<typeof vault.t>[0] = { key: I18N_KEYS.DevicesAccessBridgeIdentityHeadline, replacements: {
                    count: String(verifiedVaultCount),
                    vaults: vault.t(
                      verifiedVaultCount === 1
                        ? I18N_KEYS.DevicesAccessBridgeVaultSingular
                        : I18N_KEYS.DevicesAccessBridgeVaultPlural,
                    ),
                  } }; return vault.t(tArgs5); })()}
                {:else if selectedVaultExists}
                  {(() => { const tArgs6: Parameters<typeof vault.t>[0] = { key: I18N_KEYS.DevicesAccessBridgeVaultHeadline, replacements: {
                    count: selectedVaultIsVerified ? '1' : '0',
                    identities: vault.t(
                      selectedVaultIsVerified
                        ? I18N_KEYS.DevicesAccessBridgeIdentitySingular
                        : I18N_KEYS.DevicesAccessBridgeIdentityPlural,
                    ),
                    vault: selectedVaultName,
                  } }; return vault.t(tArgs6); })()}
                {:else}
                  {vault.t(I18N_KEYS.DevicesAccessBridgeNoSelectedVault)}
                {/if}
              </h2>
              <p
                class="mt-3 max-w-[72ch] text-sm leading-relaxed text-pretty text-muted-foreground"
              >
                {selectedPerspective === IdentityBridgePerspective.Identities
                  ? vault.t(I18N_KEYS.DevicesAccessBridgeIdentityLede)
                  : selectedVaultExists
                    ? vault.t(I18N_KEYS.DevicesAccessBridgeVaultLede)
                    : vault.t(
                        I18N_KEYS.DevicesAccessBridgeNoSelectedVaultDesc,
                      )}
              </p>
            </div>

            <IdentityBridgeGraph
              perspective={selectedPerspective}
              {selectedVault}
              {deviceIdentifier}
              identityStatus={view.identityState}
              protectionLabel={(() => { const protectionLabelArgs2: Parameters<typeof protectionLabel>[0] = { vault, protection: view.protection }; return protectionLabel(protectionLabelArgs2); })()}
              deviceIconKind={view.protection ===
              DeviceAccessProtectionKind.PasskeyStandard
                ? IdentityBridgeDeviceIconKind.RecoverableKey
                : view.protection ===
                    DeviceAccessProtectionKind.CompanionSession
                  ? IdentityBridgeDeviceIconKind.PairedDevice
                  : IdentityBridgeDeviceIconKind.Browser}
              vaults={view.vaults}
              copy={bridgeCopy}
              graphLabel={vault.t(I18N_KEYS.DevicesAccessBridgeGraphLabel)}
              controlsLabel={vault.t(
                I18N_KEYS.DevicesAccessBridgeGraphControls,
              )}
              ariaLabelConfig={{
                'node.a11yDescription.default': vault.t(
                  I18N_KEYS.DevicesAccessBridgeA11yNode,
                ),
                'node.a11yDescription.keyboardDisabled': vault.t(
                  I18N_KEYS.DevicesAccessBridgeA11yNode,
                ),
                'node.a11yDescription.ariaLiveMessage': ({
                  direction,
                  x,
                  y,
                }) =>
                  (() => { const tArgs7: Parameters<typeof vault.t>[0] = { key: I18N_KEYS.DevicesAccessBridgeA11yNodeMoved, replacements: {
                    direction,
                    x: String(x),
                    y: String(y),
                  } }; return vault.t(tArgs7); })(),
                'edge.a11yDescription.default': vault.t(
                  I18N_KEYS.DevicesAccessBridgeA11yEdge,
                ),
                'controls.ariaLabel': vault.t(
                  I18N_KEYS.DevicesAccessBridgeGraphControls,
                ),
                'controls.zoomIn.ariaLabel': vault.t(
                  I18N_KEYS.DevicesAccessBridgeA11yZoomIn,
                ),
                'controls.zoomOut.ariaLabel': vault.t(
                  I18N_KEYS.DevicesAccessBridgeA11yZoomOut,
                ),
                'controls.fitView.ariaLabel': vault.t(
                  I18N_KEYS.DevicesAccessBridgeA11yFitView,
                ),
                'controls.interactive.ariaLabel': vault.t(
                  I18N_KEYS.DevicesAccessBridgeA11yInteractivity,
                ),
                'minimap.ariaLabel': vault.t(
                  I18N_KEYS.DevicesAccessBridgeA11yMinimap,
                ),
                'handle.ariaLabel': vault.t(
                  I18N_KEYS.DevicesAccessBridgeA11yHandle,
                ),
              }}
            />
          </div>
        </div>

        <div
          id={PANEL_ID}
          class="mt-10 border-t border-border/70 pt-6"
          data-testid="devices-access-panel"
        >
          <div
            class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"
          >
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
                aria-controls={PANEL_CONTENT_ID}
                tabindex={selectedStage === AccessChainStage.Unlock ? 0 : -1}
                class:active={selectedStage === AccessChainStage.Unlock}
                class="detail-tab"
                data-testid="devices-access-node-unlock"
                onclick={() => (selectedStage = AccessChainStage.Unlock)}
                onkeydown={(event) =>
                  void (() => { const navigateDetailTabsArgs: Parameters<typeof navigateDetailTabs>[0] = { event, currentStage: AccessChainStage.Unlock }; return navigateDetailTabs(navigateDetailTabsArgs); })()}
                >{vault.t(
                  I18N_KEYS.DevicesAccessBridgeDetailProtection,
                )}</button
              >
              <button
                type="button"
                role="tab"
                id={accessChainTabId(AccessChainStage.DeviceKey)}
                aria-selected={selectedStage === AccessChainStage.DeviceKey}
                aria-controls={PANEL_CONTENT_ID}
                tabindex={selectedStage === AccessChainStage.DeviceKey ? 0 : -1}
                class:active={selectedStage === AccessChainStage.DeviceKey}
                class="detail-tab"
                data-testid="devices-access-node-device-key"
                onclick={() => (selectedStage = AccessChainStage.DeviceKey)}
                onkeydown={(event) =>
                  void (() => { const navigateDetailTabsArgs2: Parameters<typeof navigateDetailTabs>[0] = { event, currentStage: AccessChainStage.DeviceKey }; return navigateDetailTabs(navigateDetailTabsArgs2); })()}
                >{vault.t(I18N_KEYS.DevicesAccessBridgeDetailDevice)}</button
              >
              <button
                type="button"
                role="tab"
                id={accessChainTabId(AccessChainStage.Vaults)}
                aria-selected={selectedStage === AccessChainStage.Vaults}
                aria-controls={PANEL_CONTENT_ID}
                tabindex={selectedStage === AccessChainStage.Vaults ? 0 : -1}
                class:active={selectedStage === AccessChainStage.Vaults}
                class="detail-tab"
                data-testid="devices-access-node-vaults"
                onclick={() => (selectedStage = AccessChainStage.Vaults)}
                onkeydown={(event) =>
                  void (() => { const navigateDetailTabsArgs3: Parameters<typeof navigateDetailTabs>[0] = { event, currentStage: AccessChainStage.Vaults }; return navigateDetailTabs(navigateDetailTabsArgs3); })()}
                >{vault.t(I18N_KEYS.DevicesAccessBridgeDetailVaults)}</button
              >
            </div>
          </div>
          <div
            id={PANEL_CONTENT_ID}
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
  {/if}
</section>

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
