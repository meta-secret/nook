<!--
THESIS: Identity selection and key ownership must be clear before relationship details.
OWN-WORLD: Nook's restrained security surfaces, semantic tokens, evidence-aware language, and real local state remain intact.
STORY: Choose an identity from a persistent rail, scan its protection method and apps, then inspect its vault relationships below.
FIRST VIEWPORT: The complete local identity directory and one selected-identity representation appear together.
FORM: A quiet master-detail layout makes identity ownership primary while a compact switch chooses either the key inventory or relationship graph.
-->
<script lang="ts">
  import { I18N_KEYS } from '../../../generated/i18n-keys'
  import { onDestroy, untrack } from 'svelte'
  import { ArrowLeft, Fingerprint, RefreshCw } from '@lucide/svelte'
  import {
    DeviceAccessProtectionKind,
    DeviceProtectionStatus,
    NookIdentityLocalAccessKind,
    set_vault_session_locked,
  } from '$app-wasm'
  import { Button } from '$lib/components/ui/button'
  import DeviceProtectionGate from '$lib/components/DeviceProtectionGate.svelte'
  import { DeviceProtectionGateFrame } from '$lib/components/device-protection-gate-state'
  import type { VaultState } from '$lib/vault.svelte'
  import {
    DashboardLoadKind,
    type DashboardLoadState,
    DashboardTextKind,
    type DashboardView,
    DevicesAccessRepresentationKind,
  } from './devices-access-dashboard-state'
  import IdentityDirectoryRail from './devices-access/IdentityDirectoryRail.svelte'
  import IdentityKeyInventory from './devices-access/IdentityKeyInventory.svelte'
  import IdentityRepresentationSwitch from './devices-access/IdentityRepresentationSwitch.svelte'
  import {
    deviceKeyTitle,
    formatAccessDate,
    identityStateLabel,
    protectionLabel,
    type VaultAccessView,
  } from './devices-access/access-chain'
  import IdentityBridgeGraph from './devices-access/IdentityBridgeGraph.svelte'
  import IdentityBridgeNavigation from './devices-access/IdentityBridgeNavigation.svelte'
  import {
    IdentityDirectoryLoadKind,
    type IdentityDirectoryLoadState,
    IdentityDirectorySelectionKind,
    type IdentityDirectoryView,
    loadIdentityDirectoryAccessView,
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
  }: {
    vault: VaultState
    onBack: () => void
  } = $props()

  let loadState = $state<DashboardLoadState<DashboardView>>({
    kind: DashboardLoadKind.Loading,
  })
  let directoryLoadState = $state<IdentityDirectoryLoadState>({
    kind: IdentityDirectoryLoadKind.Loading,
  })
  let selectedRepresentation = $state(DevicesAccessRepresentationKind.List)
  let selectedPerspective = $state(IdentityBridgePerspective.Identities)
  let selectedVault = $state<IdentityBridgeVaultSelection>({
    kind: IdentityBridgeVaultSelectionKind.Empty,
  })
  let identityCreationOpen = $state(false)
  let identityCreationPending = false
  let identityCreationActionInFlight = false
  let identityCreationCleanupRequested = false
  let dashboardMounted = true
  let snapshotLoadGeneration = 0

  function clearPriorIdentitySession(): void {
    set_vault_session_locked(true)
    vault.clearUnlockedSession(false)
    vault.clearIdentityProviderSession()
    // The selected identity owns a separate active-vault and provider session.
    // The local vault catalog is installation-wide and remains discoverable,
    // but no catalog entry is active for the new identity until it authenticates
    // and explicitly opens one.
    vault.localVaultPresent = false
    vault.providersLoaded = false
  }

  async function focusAfterProtectionReady(
    committedIdentityCreation: boolean,
  ): Promise<void> {
    if (committedIdentityCreation) {
      identityCreationPending = false
      // Rust has committed and adopted the new app key. Only now discard the
      // prior vault UI session. The immutable action intent matters here:
      // navigation may close the panel while the browser ceremony is running.
      clearPriorIdentitySession()
    }
    identityCreationOpen = false
    vault.devicesAccessIdentityProtectionOpen = false
    if (!dashboardMounted) return
    const providerLoadOptions: Parameters<typeof vault.loadProviders>[0] = {
      ensureLocalRow: true,
    }
    try {
      await vault.loadProviders(providerLoadOptions)
      vault.applyActiveProviderCredentials()
    } catch (error) {
      vault.errorMsg =
        error instanceof Error
          ? error.message
          : vault.t(I18N_KEYS.ErrorsDeviceProtectionAuthorizationRequired)
    }
    directoryLoadState = { kind: IdentityDirectoryLoadKind.Loading }
    await reloadSnapshots()
  }

  function beginIdentityCreationProtectionAction(): void {
    identityCreationActionInFlight = true
  }

  function finishIdentityCreationProtectionAction(): void {
    identityCreationActionInFlight = false
    if (identityCreationCleanupRequested) {
      void finishPendingIdentityCreationCancellation()
    }
  }

  function keepCurrentIdentitySession(): void {}

  async function retryDashboard(): Promise<void> {
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
    selectedPerspective = IdentityBridgePerspective.Identities
    selectedVault = { kind: IdentityBridgeVaultSelectionKind.Empty }
    const nextIdentity = directoryLoadState.view.identities.find(
      (entry) => entry.identityId === identityId,
    )
    if (
      nextIdentity?.localAccess !== NookIdentityLocalAccessKind.CurrentBrowser
    ) {
      selectedRepresentation = DevicesAccessRepresentationKind.List
    }
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
    if (selectedVault.kind === IdentityBridgeVaultSelectionKind.Selected) {
      const selectedVaultId = selectedVault.storeId
      if (
        identitySelection.identity.vaults.some(
          (entry) => entry.storeId === selectedVaultId,
        )
      ) {
        return
      }
    }
    selectedVault = {
      kind: IdentityBridgeVaultSelectionKind.Selected,
      storeId: identitySelection.identity.vaults[0].storeId,
    }
  }

  async function renamePasskey(name: string): Promise<boolean> {
    if (
      loadState.kind !== DashboardLoadKind.Ready ||
      loadState.view.credentialId.kind !== DashboardTextKind.Known ||
      loadState.view.deviceId.kind !== DashboardTextKind.Known
    ) {
      return false
    }
    const credentialFingerprint = loadState.view.credentialId.value
    const appId = loadState.view.deviceId.value
    try {
      await vault
        .requireManager()
        .set_device_access_passkey_name(appId, credentialFingerprint, name)
      return (await reloadSnapshots()) === DashboardLoadKind.Ready
    } catch {
      vault.errorMsg = vault.t(I18N_KEYS.DevicesAccessProviderSaveFailed)
      return false
    }
  }

  async function beginAddIdentity(): Promise<void> {
    const labelArgs: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.DevicesAccessIdentityDefaultLabel,
      replacements: {
        count:
          directoryLoadState.kind === IdentityDirectoryLoadKind.Ready
            ? String(directoryLoadState.view.identities.length + 1)
            : '1',
      },
    }
    try {
      await vault.enqueueStorage(() =>
        vault
          .requireManager()
          .begin_local_identity_creation(vault.t(labelArgs)),
      )
    } catch {
      vault.errorMsg = vault.t(
        I18N_KEYS.ErrorsDeviceProtectionAuthorizationRequired,
      )
      return
    }
    vault.dismissError()
    identityCreationOpen = true
    identityCreationPending = true
    identityCreationCleanupRequested = false
    vault.devicesAccessIdentityProtectionOpen = false
  }

  async function finishPendingIdentityCreationCancellation(): Promise<void> {
    if (!identityCreationPending || identityCreationActionInFlight) return
    vault.requireManager().cancel_local_identity_creation()
    identityCreationPending = false
    identityCreationCleanupRequested = false
    identityCreationOpen = false
    vault.deviceProtectionStatus = await vault
      .requireManager()
      .device_protection_status()
    vault.dismissError()
  }

  async function abandonPendingIdentityCreation(): Promise<void> {
    if (!identityCreationPending) return
    identityCreationCleanupRequested = true
    identityCreationOpen = false
    if (!identityCreationActionInFlight) {
      await finishPendingIdentityCreationCancellation()
    }
  }

  async function cancelAddIdentity(): Promise<void> {
    await abandonPendingIdentityCreation()
  }

  async function leaveDashboard(): Promise<void> {
    dashboardMounted = false
    await abandonPendingIdentityCreation()
    vault.devicesAccessIdentityProtectionOpen = false
    onBack()
  }

  onDestroy(() => {
    dashboardMounted = false
    void abandonPendingIdentityCreation()
  })

  async function useIdentity(identityId: string): Promise<void> {
    try {
      await vault.enqueueStorage(() =>
        vault.requireManager().activate_local_identity(identityId),
      )
    } catch {
      vault.errorMsg = vault.t(
        I18N_KEYS.ErrorsDeviceProtectionAuthorizationRequired,
      )
      return
    }
    // Establish the cross-shell transition before clearing authentication.
    // The authenticated dashboard is unmounted as soon as the vault session
    // closes, while the login-shell dashboard reuses this shared vault state.
    vault.devicesAccessIdentityProtectionOpen = true
    vault.deviceProtectionStatus = DeviceProtectionStatus.Loading
    clearPriorIdentitySession()
    vault.deviceProtectionStatus = await vault
      .requireManager()
      .device_protection_status()
    vault.deviceId = ''
    vault.devicePublicKey = ''
    await reloadSnapshots()
  }

  function selectPerspective(perspective: IdentityBridgePerspective): void {
    selectedPerspective = perspective
  }

  function selectVault(storeId: string): void {
    selectedVault = {
      kind: IdentityBridgeVaultSelectionKind.Selected,
      storeId,
    }
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

  async function reloadSnapshots(): Promise<DashboardLoadKind> {
    const generation = ++snapshotLoadGeneration
    // A re-read keeps the current readout on screen. Blanking it would move
    // focus and hide the link the person is reading mid-save.
    if (untrack(() => loadState.kind) !== DashboardLoadKind.Ready) {
      loadState = { kind: DashboardLoadKind.Loading }
    }
    if (
      untrack(() => directoryLoadState.kind) !== IdentityDirectoryLoadKind.Ready
    ) {
      directoryLoadState = { kind: IdentityDirectoryLoadKind.Loading }
    }
    try {
      const snapshot = await loadIdentityDirectoryAccessView(
        vault.requireManager(),
      )
      if (generation !== snapshotLoadGeneration) {
        return DashboardLoadKind.Loading
      }
      const browsedIdentityId = untrack(() =>
        directoryLoadState.kind === IdentityDirectoryLoadKind.Ready &&
        directoryLoadState.view.selection.kind ===
          IdentityDirectorySelectionKind.Selected
          ? directoryLoadState.view.selection.identityId
          : '',
      )
      const preservedDirectory: IdentityDirectoryView =
        browsedIdentityId.length > 0 &&
        snapshot.directory.identities.some(
          (identity) => identity.identityId === browsedIdentityId,
        )
          ? {
              ...snapshot.directory,
              selection: {
                kind: IdentityDirectorySelectionKind.Selected,
                identityId: browsedIdentityId,
              } as const,
            }
          : snapshot.directory
      loadState = { kind: DashboardLoadKind.Ready, view: snapshot.access }
      directoryLoadState = {
        kind: IdentityDirectoryLoadKind.Ready,
        view: preservedDirectory,
      }
      const identitySelection = selectedIdentity(preservedDirectory)
      if (
        identitySelection.kind === IdentityDirectorySelectionKind.Selected &&
        identitySelection.identity.localAccess ===
          NookIdentityLocalAccessKind.OtherInstallation
      ) {
        selectedRepresentation = DevicesAccessRepresentationKind.List
      }
      resetSelectedVaultForIdentity()
      return DashboardLoadKind.Ready
    } catch {
      if (generation === snapshotLoadGeneration) {
        loadState = { kind: DashboardLoadKind.Failed }
        directoryLoadState = { kind: IdentityDirectoryLoadKind.Failed }
      }
      return generation === snapshotLoadGeneration
        ? DashboardLoadKind.Failed
        : DashboardLoadKind.Loading
    }
  }

  $effect(() => {
    void vault.deviceProtectionStatus
    void vault.localVaults.length
    void reloadSnapshots()
  })
</script>

<section class="w-full space-y-8 pb-4" data-testid="devices-access-dashboard">
  <header class="flex items-start gap-3 border-b border-border/60 pb-5">
    <Button
      type="button"
      variant="ghost"
      size="icon"
      class="mt-0.5 shrink-0"
      aria-label={vault.t(I18N_KEYS.CommonBack)}
      data-testid="devices-access-back"
      onclick={() => void leaveDashboard()}
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
    <div class="grid min-w-0 gap-8 md:grid-cols-[18rem_minmax(0,1fr)] md:gap-0">
      <IdentityDirectoryRail
        {vault}
        identities={directory.identities}
        {selectedIdentityId}
        onSelectIdentity={chooseIdentity}
        onAddIdentity={() => void beginAddIdentity()}
      />

      <div
        class="min-w-0 border-t border-border pt-8 md:border-t-0 md:pt-0 md:pl-8"
      >
        {#if identityCreationOpen}
          <div data-testid="devices-access-add-identity-flow">
            <div class="flex justify-end">
              <Button
                type="button"
                variant="ghost"
                disabled={vault.isVerifying}
                onclick={() => void cancelAddIdentity()}
                data-testid="devices-access-cancel-add-identity"
              >
                {vault.t(I18N_KEYS.CommonCancel)}
              </Button>
            </div>
            <DeviceProtectionGate
              {vault}
              frame={DeviceProtectionGateFrame.HostSection}
              creationOnly={true}
              initializeSession={false}
              recoveryAppId=""
              onBeforeProtectionAction={beginIdentityCreationProtectionAction}
              onProtectionActionSettled={finishIdentityCreationProtectionAction}
              onProtectionReady={() => void focusAfterProtectionReady(true)}
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
          {#if vault.devicesAccessIdentityProtectionOpen}
            <div data-testid="devices-access-identity-protection-flow">
              <div class="flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  onclick={() =>
                    (vault.devicesAccessIdentityProtectionOpen = false)}
                >
                  {vault.t(I18N_KEYS.CommonCancel)}
                </Button>
              </div>
              <DeviceProtectionGate
                {vault}
                frame={DeviceProtectionGateFrame.HostSection}
                creationOnly={false}
                initializeSession={false}
                recoveryAppId={view.deviceId.kind === DashboardTextKind.Known
                  ? view.deviceId.value
                  : ''}
                onBeforeProtectionAction={keepCurrentIdentitySession}
                onProtectionReady={() => void focusAfterProtectionReady(false)}
              />
            </div>
          {:else}
            {#if identity.localAccess === NookIdentityLocalAccessKind.ThisBrowser}
              <div class="mb-6 rounded-lg border border-border bg-muted/30 p-5">
                <p class="text-sm font-medium text-foreground">
                  {vault.t(I18N_KEYS.DevicesAccessIdentityOnThisBrowser)}
                </p>
                <Button
                  type="button"
                  class="mt-3"
                  onclick={() => void useIdentity(identity.identityId)}
                  data-testid="devices-access-use-identity"
                >
                  {vault.t(I18N_KEYS.DevicesAccessUseIdentity)}
                </Button>
              </div>
            {:else if identity.localAccess === NookIdentityLocalAccessKind.CurrentBrowser && vault.deviceProtectionStatus !== DeviceProtectionStatus.Unlocked && accessView.protection !== DeviceAccessProtectionKind.Missing}
              <div class="mb-6 rounded-lg border border-border bg-muted/30 p-5">
                <p class="text-sm font-medium text-foreground">
                  {vault.t(I18N_KEYS.DevicesAccessIdentityLocked)}
                </p>
                <Button
                  type="button"
                  class="mt-3"
                  onclick={() =>
                    (vault.devicesAccessIdentityProtectionOpen = true)}
                  data-testid="devices-access-unlock-identity"
                >
                  {vault.t(I18N_KEYS.DevicesAccessUnlockIdentity)}
                </Button>
              </div>
            {/if}
            <IdentityRepresentationSwitch
              {vault}
              identityLabel={identity.label}
              {selectedRepresentation}
              graphDisabled={identity.localAccess !==
                NookIdentityLocalAccessKind.CurrentBrowser}
              onSelectRepresentation={(representation) =>
                (selectedRepresentation = representation)}
            />

            {#if selectedRepresentation === DevicesAccessRepresentationKind.List}
              <div class="mt-6">
                <IdentityKeyInventory
                  {vault}
                  {identity}
                  {view}
                  onRenamePasskey={renamePasskey}
                />
              </div>
            {/if}

            {#if identity.localAccess === NookIdentityLocalAccessKind.OtherInstallation}
              <div
                class="mt-8 rounded-lg border border-border bg-muted/30 p-5"
                data-testid="devices-access-other-identity-notice"
              >
                <p class="text-sm font-medium text-foreground">
                  {vault.t(I18N_KEYS.DevicesAccessOtherIdentityEvidenceTitle)}
                </p>
                <p
                  class="mt-2 max-w-[64ch] text-sm leading-relaxed text-muted-foreground"
                >
                  {vault.t(
                    I18N_KEYS.DevicesAccessOtherIdentityEvidenceUnavailable,
                  )}
                </p>
              </div>
            {:else if selectedRepresentation === DevicesAccessRepresentationKind.Graph}
              {@const verifiedVaultCount = view.vaults.filter(
                (entry) => entry.verified,
              ).length}
              {@const selectedVaultIsVerified = selectedVaultVerified(
                identity.vaults,
              )}
              {@const selectedVaultName = selectedVaultLabel(identity.vaults)}
              {@const selectedVaultExists =
                selectedVault.kind ===
                IdentityBridgeVaultSelectionKind.Selected}
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
                deviceStage: vault.t(
                  I18N_KEYS.DevicesAccessBridgeDeviceEvidence,
                ),
                identityStage: companionIdentity
                  ? vault.t(
                      I18N_KEYS.DevicesAccessBridgeCompanionIdentityContext,
                    )
                  : vault.t(I18N_KEYS.DevicesAccessBridgeDistributedIdentity),
                vaultStage: vault.t(I18N_KEYS.DevicesAccessBridgeVaultGrants),
                selectedVaultStage: vault.t(
                  I18N_KEYS.DevicesAccessBridgeSelectedVault,
                ),
                currentDevice:
                  view.protection === DeviceAccessProtectionKind.PasskeyStandard
                    ? vault.t(I18N_KEYS.DevicesAccessBridgeDetailDevice)
                    : (() => {
                        const deviceKeyTitleArgs: Parameters<
                          typeof deviceKeyTitle
                        >[0] = { vault, protection: view.protection }
                        return deviceKeyTitle(deviceKeyTitleArgs)
                      })(),
                currentIdentity: identityTitle,
                selectedIdentity: companionIdentity
                  ? vault.t(
                      I18N_KEYS.DevicesAccessBridgeCompanionIdentityContext,
                    )
                  : vault.t(I18N_KEYS.DevicesAccessBridgeSelectedIdentity),
                vaultGrant: vault.t(I18N_KEYS.DevicesAccessBridgeVaultGrant),
                deviceKey: vault.t(I18N_KEYS.DevicesAccessBridgeDetailDevice),
                oneDeviceKey: vault.t(
                  I18N_KEYS.DevicesAccessBridgeOneDeviceKey,
                ),
                identityDescription: (() => {
                  const protectionLabelArgs: Parameters<
                    typeof protectionLabel
                  >[0] = { vault, protection: view.protection }
                  return protectionLabel(protectionLabelArgs)
                })(),
                identityState: (() => {
                  const identityStateLabelArgs: Parameters<
                    typeof identityStateLabel
                  >[0] = { vault, state: view.identityState }
                  return identityStateLabel(identityStateLabelArgs)
                })(),
                deviceMetricLabel: vault.t(
                  I18N_KEYS.DevicesAccessBridgeDeviceEvidence,
                ),
                vaultMetricLabel: vault.t(
                  I18N_KEYS.DevicesAccessVerifiedVaultsLabel,
                ),
                verifiedVaultCount: (() => {
                  const tArgs: Parameters<typeof vault.t>[0] = {
                    key: I18N_KEYS.DevicesAccessBridgeVerifiedVaultCount,
                    replacements: { count: String(verifiedVaultCount) },
                  }
                  return vault.t(tArgs)
                })(),
                statusMetricLabel: vault.t(I18N_KEYS.DevicesAccessStatusLabel),
                evidenceMetricLabel: vault.t(
                  I18N_KEYS.DevicesAccessLastSuccessfulUse,
                ),
                verifiedStatus: vault.t(I18N_KEYS.DevicesAccessRouteVerified),
                unverifiedStatus: vault.t(
                  I18N_KEYS.DevicesAccessRouteUnverified,
                ),
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
                  (() => {
                    const tArgs2: Parameters<typeof vault.t>[0] = {
                      key: I18N_KEYS.DevicesAccessBridgeIdentityVaultRelation,
                      replacements: {
                        vault: vaultLabel,
                      },
                    }
                    return vault.t(tArgs2)
                  })(),
                deviceVaultRelation: (vaultLabel: string) =>
                  (() => {
                    const tArgs3: Parameters<typeof vault.t>[0] = {
                      key: I18N_KEYS.DevicesAccessBridgeDeviceVaultRelation,
                      replacements: {
                        vault: vaultLabel,
                      },
                    }
                    return vault.t(tArgs3)
                  })(),
                vaultDeviceRelation: (vaultLabel: string) =>
                  (() => {
                    const tArgs4: Parameters<typeof vault.t>[0] = {
                      key: I18N_KEYS.DevicesAccessBridgeVaultDeviceRelation,
                      replacements: {
                        vault: vaultLabel,
                      },
                    }
                    return vault.t(tArgs4)
                  })(),
                formatEvidence: (value: string) =>
                  (() => {
                    const formatAccessDateArgs: Parameters<
                      typeof formatAccessDate
                    >[0] = { vault, value }
                    return formatAccessDate(formatAccessDateArgs)
                  })(),
                unknown: vault.t(I18N_KEYS.DevicesAccessUnknown),
              } satisfies IdentityBridgeCopy}
              <div
                class="mt-8"
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
                        {selectedPerspective ===
                        IdentityBridgePerspective.Identities
                          ? vault.t(I18N_KEYS.DevicesAccessBridgeIdentityView)
                          : vault.t(I18N_KEYS.DevicesAccessBridgeVaultView)}
                      </p>
                      <h2
                        class="mt-2 max-w-4xl text-3xl font-semibold tracking-[-0.025em] text-balance text-foreground sm:text-4xl"
                      >
                        {#if selectedPerspective === IdentityBridgePerspective.Identities}
                          {(() => {
                            const tArgs5: Parameters<typeof vault.t>[0] = {
                              key: I18N_KEYS.DevicesAccessBridgeIdentityHeadline,
                              replacements: {
                                count: String(verifiedVaultCount),
                                vaults: vault.t(
                                  verifiedVaultCount === 1
                                    ? I18N_KEYS.DevicesAccessBridgeVaultSingular
                                    : I18N_KEYS.DevicesAccessBridgeVaultPlural,
                                ),
                              },
                            }
                            return vault.t(tArgs5)
                          })()}
                        {:else if selectedVaultExists}
                          {(() => {
                            const tArgs6: Parameters<typeof vault.t>[0] = {
                              key: I18N_KEYS.DevicesAccessBridgeVaultHeadline,
                              replacements: {
                                count: selectedVaultIsVerified ? '1' : '0',
                                identities: vault.t(
                                  selectedVaultIsVerified
                                    ? I18N_KEYS.DevicesAccessBridgeIdentitySingular
                                    : I18N_KEYS.DevicesAccessBridgeIdentityPlural,
                                ),
                                vault: selectedVaultName,
                              },
                            }
                            return vault.t(tArgs6)
                          })()}
                        {:else}
                          {vault.t(
                            I18N_KEYS.DevicesAccessBridgeNoSelectedVault,
                          )}
                        {/if}
                      </h2>
                      <p
                        class="mt-3 max-w-[72ch] text-sm leading-relaxed text-pretty text-muted-foreground"
                      >
                        {selectedPerspective ===
                        IdentityBridgePerspective.Identities
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
                      protectionLabel={(() => {
                        const protectionLabelArgs2: Parameters<
                          typeof protectionLabel
                        >[0] = { vault, protection: view.protection }
                        return protectionLabel(protectionLabelArgs2)
                      })()}
                      deviceIconKind={view.protection ===
                      DeviceAccessProtectionKind.PasskeyStandard
                        ? IdentityBridgeDeviceIconKind.RecoverableKey
                        : view.protection ===
                            DeviceAccessProtectionKind.CompanionSession
                          ? IdentityBridgeDeviceIconKind.PairedDevice
                          : IdentityBridgeDeviceIconKind.Browser}
                      vaults={view.vaults}
                      copy={bridgeCopy}
                      graphLabel={vault.t(
                        I18N_KEYS.DevicesAccessBridgeGraphLabel,
                      )}
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
                          (() => {
                            const tArgs7: Parameters<typeof vault.t>[0] = {
                              key: I18N_KEYS.DevicesAccessBridgeA11yNodeMoved,
                              replacements: {
                                direction,
                                x: String(x),
                                y: String(y),
                              },
                            }
                            return vault.t(tArgs7)
                          })(),
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
              </div>
            {/if}
          {/if}
        {/if}
      </div>
    </div>
  {/if}
</section>
