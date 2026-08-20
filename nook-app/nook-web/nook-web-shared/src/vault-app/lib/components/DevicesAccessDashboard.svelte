<!--
THESIS: Identity selection and key ownership must be clear before relationship details.
OWN-WORLD: Nook's restrained security surfaces, semantic tokens, evidence-aware language, and real local state remain intact.
STORY: Choose an identity from a persistent rail, scan its protector and app keys, then inspect its vault relationships and technical evidence below.
FIRST VIEWPORT: The complete local identity directory and selected-identity key inventory appear before the relationship map.
FORM: A quiet master-detail layout makes identity ownership primary while the existing graph and evidence panels remain available as progressive disclosure.
-->
<script lang="ts">
  import { I18N_KEYS } from '../../../generated/i18n-keys'
  import { tick, untrack } from 'svelte'
  import { ArrowLeft, Fingerprint, RefreshCw } from '@lucide/svelte'
  import {
    DeviceAccessProtectionKind,
    NookIdentityLocalAccessKind,
    NookDeviceAccessTextKind,
    NookDeviceVaultAccessState,
    NookPasskeyTimestampEvidenceKind,
    set_device_access_passkey_provider_label,
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
    type DashboardView,
    providerSaveFocus,
    ProviderSaveFocusKind,
    ProviderSaveKind,
  } from './devices-access-dashboard-state'
  import AccessStrengthPreview from './devices-access/AccessStrengthPreview.svelte'
  import DevicesAccessDetailPanel from './devices-access/DevicesAccessDetailPanel.svelte'
  import IdentityDirectoryRail from './devices-access/IdentityDirectoryRail.svelte'
  import IdentityKeyInventory from './devices-access/IdentityKeyInventory.svelte'
  import {
    AccessChainStage,
    accessChainTab,
    AccessChainTabKind,
    deviceKeyTitle,
    formatAccessDate,
    identityStateLabel,
    protectionLabel,
    textValue,
    type VaultAccessView,
  } from './devices-access/access-chain'
  import IdentityBridgeGraph from './devices-access/IdentityBridgeGraph.svelte'
  import IdentityBridgeNavigation from './devices-access/IdentityBridgeNavigation.svelte'
  import {
    IdentityDirectoryLoadKind,
    type IdentityDirectoryLoadState,
    IdentityDirectorySelectionKind,
    loadIdentityDirectoryView,
    selectedIdentity,
  } from './devices-access/identity-directory-view'
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

  let loadState = $state<DashboardLoadState<DashboardView>>({
    kind: DashboardLoadKind.Loading,
  })
  let directoryLoadState = $state<IdentityDirectoryLoadState>({
    kind: IdentityDirectoryLoadKind.Loading,
  })
  let selectedStage = $state(AccessChainStage.Unlock)
  let selectedPerspective = $state(IdentityBridgePerspective.Identities)
  let selectedVault = $state<IdentityBridgeVaultSelection>({
    kind: IdentityBridgeVaultSelectionKind.Empty,
  })
  let providerDraft = $state('')
  let providerSaveState = $state<ProviderSaveKind>(ProviderSaveKind.Idle)
  let pendingFocusTarget = $state<DashboardFocusTargetKind>(
    DashboardFocusTargetKind.None,
  )
  let loadGeneration = 0
  let directoryLoadGeneration = 0
  let snapshotLoadGeneration = 0
  let snapshotsRefreshing = $state(false)

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
          loadState.kind === DashboardLoadKind.Failed ||
            directoryLoadState.kind === IdentityDirectoryLoadKind.Failed
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
    await reloadSnapshots()
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
        .device_access_snapshot_request()
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
          keeper: snapshot.keeper,
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
        resetSelectedVaultForIdentity()
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

  async function loadDirectory(): Promise<IdentityDirectoryLoadKind> {
    const generation = ++directoryLoadGeneration
    if (
      untrack(() => directoryLoadState.kind) !==
      IdentityDirectoryLoadKind.Ready
    ) {
      directoryLoadState = { kind: IdentityDirectoryLoadKind.Loading }
    }
    try {
      const view = await loadIdentityDirectoryView(vault.requireManager())
      if (generation !== directoryLoadGeneration) {
        return IdentityDirectoryLoadKind.Loading
      }
      const browsedIdentityId = untrack(() =>
        directoryLoadState.kind === IdentityDirectoryLoadKind.Ready &&
        directoryLoadState.view.selection.kind ===
          IdentityDirectorySelectionKind.Selected
          ? directoryLoadState.view.selection.identityId
          : '',
      )
      const preservedView =
        browsedIdentityId.length > 0 &&
        view.identities.some(
          (identity) => identity.identityId === browsedIdentityId,
        )
          ? {
              ...view,
              selection: {
                kind: IdentityDirectorySelectionKind.Selected,
                identityId: browsedIdentityId,
              } as const,
            }
          : view
      directoryLoadState = {
        kind: IdentityDirectoryLoadKind.Ready,
        view: preservedView,
      }
      resetSelectedVaultForIdentity()
      return IdentityDirectoryLoadKind.Ready
    } catch {
      if (generation === directoryLoadGeneration) {
        directoryLoadState = { kind: IdentityDirectoryLoadKind.Failed }
        return IdentityDirectoryLoadKind.Failed
      }
      return IdentityDirectoryLoadKind.Loading
    }
  }

  async function retryDashboard(): Promise<void> {
    pendingFocusTarget = DashboardFocusTargetKind.RetryResult
    await reloadSnapshots()
  }

  function chooseIdentity(identityId: string): void {
    if (directoryLoadState.kind !== IdentityDirectoryLoadKind.Ready) return
    directoryLoadState = {
      kind: IdentityDirectoryLoadKind.Ready,
      view: {
        ...directoryLoadState.view,
        selection: {
          kind: IdentityDirectorySelectionKind.Selected,
          identityId,
        },
      },
    }
    selectedStage = AccessChainStage.Unlock
    selectedPerspective = IdentityBridgePerspective.Identities
    selectedVault = { kind: IdentityBridgeVaultSelectionKind.Empty }
    resetSelectedVaultForIdentity()
  }

  function resetSelectedVaultForIdentity(): void {
    if (
      loadState.kind !== DashboardLoadKind.Ready ||
      directoryLoadState.kind !== IdentityDirectoryLoadKind.Ready
    ) {
      return
    }
    const identitySelection = selectedIdentity(directoryLoadState.view)
    if (identitySelection.kind === IdentityDirectorySelectionKind.Empty) {
      selectedVault = { kind: IdentityBridgeVaultSelectionKind.Empty }
      return
    }
    if (identitySelection.identity.vaults.length === 0) {
      selectedVault = { kind: IdentityBridgeVaultSelectionKind.Empty }
      return
    }
    if (
      selectedVault.kind === IdentityBridgeVaultSelectionKind.Selected &&
      identitySelection.identity.vaults.some(
        (entry) => entry.storeId === selectedVault.storeId,
      )
    ) {
      return
    }
    selectedVault = {
      kind: IdentityBridgeVaultSelectionKind.Selected,
      storeId: identitySelection.identity.vaults[0].storeId,
    }
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
      await set_device_access_passkey_provider_label(
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

  function selectVault(storeId: string): void {
    selectedVault = {
      kind: IdentityBridgeVaultSelectionKind.Selected,
      storeId,
    }
    selectedStage = AccessChainStage.Vaults
  }

  function selectedVaultLabel(vaults: readonly VaultAccessView[]): string {
    if (selectedVault.kind === IdentityBridgeVaultSelectionKind.Selected) {
      for (const entry of vaults) {
        if (entry.storeId === selectedVault.storeId) return entry.label
      }
    }
    return vault.t(I18N_KEYS.DevicesAccessBridgeVault)
  }

  function selectedVaultVerified(vaults: readonly VaultAccessView[]): boolean {
    if (selectedVault.kind === IdentityBridgeVaultSelectionKind.Selected) {
      for (const entry of vaults) {
        if (entry.storeId === selectedVault.storeId) return entry.verified
      }
    }
    return false
  }

  async function reloadSnapshots(): Promise<void> {
    const generation = ++snapshotLoadGeneration
    snapshotsRefreshing = true
    await Promise.all([loadDashboard(), loadDirectory()])
    if (generation !== snapshotLoadGeneration) return
    snapshotsRefreshing = false
    await tick()
    focusPendingDashboardTarget()
  }

  $effect(() => {
    void vault.deviceProtectionStatus
    void vault.localVaults.length
    void reloadSnapshots()
  })
</script>

<section
  class="w-full space-y-8 pb-4"
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

  {#if snapshotsRefreshing || loadState.kind === DashboardLoadKind.Loading}
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
  {:else if directoryLoadState.kind === IdentityDirectoryLoadKind.Loading}
    <div
      class="flex min-h-56 items-center justify-center gap-2 text-sm text-muted-foreground"
      role="status"
    >
      <RefreshCw class="size-4 animate-spin" />
      {vault.t(I18N_KEYS.DevicesAccessIdentityDirectoryLoading)}
    </div>
  {:else if directoryLoadState.kind === IdentityDirectoryLoadKind.Failed}
    <div
      class="rounded-xl border border-destructive/30 bg-destructive/5 p-5"
      role="alert"
    >
      <p class="font-medium text-foreground">
        {vault.t(I18N_KEYS.DevicesAccessIdentityDirectoryFailed)}
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
    {@const accessView = loadState.view}
    {@const directory = directoryLoadState.view}
    {@const identitySelection = selectedIdentity(directory)}
    {@const selectedIdentityId =
      directory.selection.kind === IdentityDirectorySelectionKind.Selected
        ? directory.selection.identityId
        : ''}
    <div
      class="grid min-w-0 gap-8 md:grid-cols-[18rem_minmax(0,1fr)] md:gap-0"
    >
      <IdentityDirectoryRail
        {vault}
        view={accessView}
        identities={directory.identities}
        {selectedIdentityId}
        onSelectIdentity={chooseIdentity}
      />

      <div
        class="min-w-0 border-t border-border pt-8 md:border-t-0 md:pt-0 md:pl-8"
      >
        {#if accessView.protection === DeviceAccessProtectionKind.Missing &&
        !(identitySelection.kind === IdentityDirectorySelectionKind.Selected &&
          identitySelection.identity.localAccess ===
            NookIdentityLocalAccessKind.OtherInstallation)}
          <AccessStrengthPreview {vault} vaults={accessView.vaults} />
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
        {:else if identitySelection.kind === IdentityDirectorySelectionKind.Empty && directory.identities.length === 0}
          <div
            class="flex min-h-64 flex-col items-center justify-center rounded-lg border border-dashed border-border px-6 text-center"
            data-testid="devices-access-no-identities"
          >
            <Fingerprint class="size-8 text-muted-foreground" />
            <h2 class="mt-4 text-lg font-semibold text-foreground">
              {vault.t(I18N_KEYS.DevicesAccessNoIdentities)}
            </h2>
            <p
              class="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground"
            >
              {vault.t(I18N_KEYS.DevicesAccessNoIdentitiesDescription)}
            </p>
          </div>
        {:else if identitySelection.kind === IdentityDirectorySelectionKind.Empty}
          <div
            class="flex min-h-64 flex-col items-center justify-center rounded-lg border border-dashed border-border px-6 text-center"
            data-testid="devices-access-no-session-identity"
          >
            <Fingerprint class="size-8 text-muted-foreground" />
            <h2 class="mt-4 text-lg font-semibold text-foreground">
              {vault.t(I18N_KEYS.DevicesAccessNoSessionIdentity)}
            </h2>
            <p
              class="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground"
            >
              {vault.t(I18N_KEYS.DevicesAccessNoSessionIdentityDescription)}
            </p>
          </div>
        {:else}
        {@const identity = identitySelection.identity}
        {@const view = { ...accessView, vaults: [...identity.vaults] }}
        <IdentityKeyInventory
          {vault}
          {identity}
          {view}
          {selectedStage}
          onSelectStage={(stage) => (selectedStage = stage)}
        />
        {#if identity.localAccess ===
        NookIdentityLocalAccessKind.OtherInstallation}
          <div
            class="mt-8 rounded-lg border border-border bg-muted/30 p-5"
            data-testid="devices-access-other-identity-notice"
          >
            <p class="text-sm font-medium text-foreground">
              {vault.t(I18N_KEYS.DevicesAccessOtherIdentityEvidenceTitle)}
            </p>
            <p class="mt-2 max-w-[64ch] text-sm leading-relaxed text-muted-foreground">
              {vault.t(
                I18N_KEYS.DevicesAccessOtherIdentityEvidenceUnavailable,
              )}
            </p>
          </div>
        {:else}
        {@const verifiedVaultCount = view.vaults.filter(
          (entry) => entry.verified,
        ).length}
        {@const selectedVaultIsVerified = selectedVaultVerified(identity.vaults)}
        {@const selectedVaultName = selectedVaultLabel(identity.vaults)}
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
          class="mt-10 border-t border-border pt-8"
          data-testid="devices-access-relationship-details"
        >
        <div class="flex min-w-0 flex-col gap-6">
          <IdentityBridgeNavigation
            {vault}
            perspective={selectedPerspective}
            {selectedVault}
            vaults={view.vaults}
            onPerspective={selectPerspective}
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

        <DevicesAccessDetailPanel
          {vault}
          {view}
          bind:selectedStage
          bind:providerDraft
          {providerSaveState}
          onSaveProviderLabel={() => void saveProviderLabel()}
          onProviderDraftInput={clearProviderSaveFailure}
          {onManageVaultDevices}
          {onManageVaultPasswords}
        />
          </div>
        {/if}
        {/if}
      </div>
    </div>
  {/if}
</section>
