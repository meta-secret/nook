<!--
The Nook side panel. The toolbar button opens it beside the page, and it
stays open while the person works: setup and unlock run here through the
same ceremony as the Nook tab, and the panel re-reads the extension's state
when its window's tabs change or it is shown again. Opening a page never
closes it.
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import { Effect } from 'effect'
  import { LoaderCircle, Plus, Settings2 } from '@lucide/svelte'
  import {
    I18N_KEYS,
    type I18nKey,
  } from '../../../nook-web-shared/src/generated/i18n-keys'
  import { type ExtensionI18n, extensionLocaleCatalog } from '../lib/i18n'
  import {
    DeviceProtectionStatus,
    ExtensionSessionDeviceStateKind,
    type ExtensionSessionDeviceState,
    type ExtensionSessionDeviceWire,
    extensionWasmRuntime,
  } from '../lib/nook-wasm'
  import { retryClosedExtensionSessionOnce } from '../lib/extension-runtime-retry'
  import { pairedVaultsClient } from '../lib/paired-vaults'
  import ExtensionDeviceProtection from '../popup/ExtensionDeviceProtection.svelte'
  import {
    DeviceProtectionPurposeKind,
    type DeviceProtectionPurpose,
    type DeviceProtectionUnlock,
  } from '../popup/device-protection-ceremony'
  import {
    DeviceActionFollowUp,
    IdentitySyncKind,
    PopupInitializationPhase,
    popupInitializationFailureKey,
    type IdentitySync,
  } from '../popup/popup-app-state'
  import SidePanelGate from './SidePanelGate.svelte'
  import SidePanelHeader from './SidePanelHeader.svelte'
  import SidePanelIdentities from './SidePanelIdentities.svelte'
  import ThisSite from './ThisSite.svelte'
  import {
    SidePanelAlertKind,
    SidePanelCeremonyKind,
    SidePanelHandOffs,
    SidePanelGateIcon,
    SidePanelHandOffKind,
    SidePanelHandOffTrigger,
    SidePanelHeaderActionKind,
    SidePanelLockReasonKind,
    SidePanelReadFreshness,
    SidePanelReadSequence,
    SidePanelSessionControls,
    SidePanelVaultsKind,
    SidePanelViewKind,
    SidePanelViews,
    type SidePanelAlert,
    type SidePanelHandOff,
    type SidePanelView,
  } from './side-panel-state'
  import {
    SidePanelChangeKind,
    SidePanelRuntime,
    SidePanelWindowKind,
    type SidePanelWindow,
  } from './side-panel-runtime'

  /** A status read, and why the panel may now be locked. */
  type SidePanelArrival = {
    readonly status: DeviceProtectionStatus
    readonly reason: SidePanelLockReasonKind
  }

  type SidePanelProps = {
    readonly i18n: ExtensionI18n
    /** What startup read; the panel mounts only after that read. */
    readonly initialView: SidePanelView
  }

  let { i18n, initialView }: SidePanelProps = $props()

  function startingView(): SidePanelView {
    return initialView
  }

  const runtime = new SidePanelRuntime()
  const statusReads = new SidePanelReadSequence()
  const vaultReads = new SidePanelReadSequence()
  const extensionKey: DeviceProtectionPurpose = {
    kind: DeviceProtectionPurposeKind.ExtensionKey,
  }

  let view = $state<SidePanelView>(startingView())
  let headerAction = $state<SidePanelHeaderActionKind>(
    SidePanelHeaderActionKind.Idle,
  )
  let alert = $state<SidePanelAlert>({ kind: SidePanelAlertKind.None })
  let handOff = $state<SidePanelHandOff>({ kind: SidePanelHandOffKind.Idle })
  let panelWindow = $state<SidePanelWindow>({
    kind: SidePanelWindowKind.Resolving,
  })
  /** A new entry into the ceremony views starts the ceremony afresh. */
  let ceremonyEntry = $state(0)

  const chip = $derived(SidePanelViews.chip(view.kind))
  const lockControl = $derived(SidePanelViews.sessionControls(view.kind))
  const footer = $derived(SidePanelViews.footer(view))
  const ceremony = $derived(SidePanelViews.ceremony(view))

  function translatePlain(key: I18nKey): string {
    return i18n.t(extensionLocaleCatalog.plainExtensionTranslation(key))
  }

  function readStatus() {
    return Effect.runPromise(
      Effect.result(
        Effect.tryPromise(() =>
          retryClosedExtensionSessionOnce(() =>
            extensionWasmRuntime.extensionDeviceProtectionStatus(),
          ),
        ),
      ),
    )
  }

  function failed(phase: PopupInitializationPhase): void {
    view = { kind: SidePanelViewKind.Failure, phase }
  }

  function clearMessages(): void {
    alert = { kind: SidePanelAlertKind.None }
    handOff = { kind: SidePanelHandOffKind.Idle }
  }

  /** Re-read the extension's state: it may have changed in the Nook tab,
   * in Pilot, or by the session lease ending. */
  async function refresh(): Promise<void> {
    switch (view.kind) {
      case SidePanelViewKind.Failure:
        // Reopening the panel runs startup again; nothing retries here.
        return
      case SidePanelViewKind.Setup:
      case SidePanelViewKind.PinLocked:
      case SidePanelViewKind.PasskeyLocked:
      case SidePanelViewKind.Unlocked:
        break
    }
    const read = statusReads.begin()
    const status = await readStatus()
    switch (read.freshness()) {
      case SidePanelReadFreshness.Stale:
        return
      case SidePanelReadFreshness.Current:
        break
    }
    switch (status._tag) {
      case 'Failure':
        failed(PopupInitializationPhase.DeviceProtectionStatus)
        return
      case 'Success': {
        const arrival: SidePanelArrival = {
          status: status.success,
          reason: SidePanelLockReasonKind.None,
        }
        await arrive(arrival)
      }
    }
  }

  function onSiteLocked(reason: SidePanelLockReasonKind): void {
    void siteLocked(reason)
  }

  /** This site found the extension locked: re-read which lock it is. */
  async function siteLocked(reason: SidePanelLockReasonKind): Promise<void> {
    const read = statusReads.begin()
    const status = await readStatus()
    switch (read.freshness()) {
      case SidePanelReadFreshness.Stale:
        return
      case SidePanelReadFreshness.Current:
        break
    }
    switch (status._tag) {
      case 'Failure':
        failed(PopupInitializationPhase.DeviceProtectionStatus)
        return
      case 'Success': {
        const arrival: SidePanelArrival = { status: status.success, reason }
        await arrive(arrival)
      }
    }
  }

  async function arrive(arrival: SidePanelArrival): Promise<void> {
    switch (SidePanelViews.kind(arrival.status) === view.kind) {
      case true:
        stay()
        return
      case false:
        await enter(arrival)
    }
  }

  /** The same view: an unlocked panel re-reads its vault list. */
  function stay(): void {
    switch (view.kind) {
      case SidePanelViewKind.Unlocked:
        void loadVaults()
        return
      case SidePanelViewKind.Setup:
      case SidePanelViewKind.PinLocked:
      case SidePanelViewKind.PasskeyLocked:
      case SidePanelViewKind.Failure:
        return
    }
  }

  async function enter(arrival: SidePanelArrival): Promise<void> {
    const { status, reason } = arrival
    clearMessages()
    switch (SidePanelViews.kind(status)) {
      case SidePanelViewKind.Unlocked:
        await enterUnlocked()
        return
      case SidePanelViewKind.Setup:
      case SidePanelViewKind.PinLocked:
      case SidePanelViewKind.PasskeyLocked:
      case SidePanelViewKind.Failure:
        break
    }
    const request: Parameters<typeof SidePanelViews.locked>[0] = {
      status,
      reason,
    }
    view = SidePanelViews.locked(request)
    ceremonyEntry += 1
  }

  async function enterUnlocked(): Promise<void> {
    const read = statusReads.begin()
    const device = await Effect.runPromise(
      Effect.result(
        Effect.tryPromise(() => extensionWasmRuntime.extensionSessionDevice()),
      ),
    )
    switch (read.freshness()) {
      case SidePanelReadFreshness.Stale:
        return
      case SidePanelReadFreshness.Current:
        break
    }
    switch (device._tag) {
      case 'Failure':
        failed(PopupInitializationPhase.ActiveSessionDevice)
        return
      case 'Success':
        showUnlocked(device.success)
    }
  }

  function showUnlocked(device: ExtensionSessionDeviceState): void {
    const request: Parameters<typeof SidePanelViews.unlocked>[0] = { device }
    view = SidePanelViews.unlocked(request)
    void loadVaults()
  }

  async function loadVaults(): Promise<void> {
    const read = vaultReads.begin()
    const load = await pairedVaultsClient.list()
    switch (read.freshness()) {
      case SidePanelReadFreshness.Stale:
        return
      case SidePanelReadFreshness.Current:
        break
    }
    switch (view.kind) {
      case SidePanelViewKind.Unlocked:
        view = { ...view, vaults: SidePanelViews.vaults(load) }
        return
      case SidePanelViewKind.Setup:
      case SidePanelViewKind.PinLocked:
      case SidePanelViewKind.PasskeyLocked:
      case SidePanelViewKind.Failure:
        return
    }
  }

  function showIdentitySync(identitySync: IdentitySync): void {
    switch (view.kind) {
      case SidePanelViewKind.Unlocked:
        view = { ...view, identitySync }
        return
      case SidePanelViewKind.Setup:
      case SidePanelViewKind.PinLocked:
      case SidePanelViewKind.PasskeyLocked:
      case SidePanelViewKind.Failure:
        return
    }
  }

  /** The extension just unlocked: pair the vaults its identity gained. */
  async function refreshIdentity(
    device: ExtensionSessionDeviceWire,
  ): Promise<void> {
    const checking: IdentitySync = { kind: IdentitySyncKind.Checking }
    showIdentitySync(checking)
    const refreshed = await pairedVaultsClient.refreshIdentity(device.deviceId)
    switch (refreshed.ok) {
      case false: {
        const failedSync: IdentitySync = { kind: IdentitySyncKind.Failed }
        showIdentitySync(failedSync)
        return
      }
      case true:
        break
    }
    const checked: IdentitySync = {
      kind: IdentitySyncKind.Checked,
      awaitingGrant: refreshed.awaitingGrant,
    }
    showIdentitySync(checked)
    switch (refreshed.paired) {
      case 0:
        return
      default:
        await loadVaults()
    }
  }

  /** The ceremony moved to PIN setup because passkeys cannot work here. */
  function ceremonyStatus(status: DeviceProtectionStatus): void {
    const request: Parameters<typeof SidePanelViews.locked>[0] = {
      status,
      reason: SidePanelLockReasonKind.None,
    }
    view = SidePanelViews.locked(request)
  }

  function unlocked(unlock: DeviceProtectionUnlock): void {
    statusReads.invalidate()
    clearMessages()
    const device: ExtensionSessionDeviceState = {
      kind: ExtensionSessionDeviceStateKind.Active,
      device: unlock.device,
    }
    showUnlocked(device)
    switch (unlock.followUp) {
      case DeviceActionFollowUp.RefreshIdentity:
        void refreshIdentity(unlock.device)
        return
      case DeviceActionFollowUp.Menu:
        return
    }
  }

  async function openVault(): Promise<void> {
    switch (headerAction) {
      case SidePanelHeaderActionKind.OpeningVault:
      case SidePanelHeaderActionKind.Locking:
        return
      case SidePanelHeaderActionKind.Idle:
        break
    }
    headerAction = SidePanelHeaderActionKind.OpeningVault
    alert = { kind: SidePanelAlertKind.None }
    const opened = await Effect.runPromise(Effect.result(runtime.openVault()))
    headerAction = SidePanelHeaderActionKind.Idle
    switch (opened._tag) {
      case 'Success':
        return
      case 'Failure':
        alert = {
          kind: SidePanelAlertKind.Shown,
          key: I18N_KEYS.ExtensionActionOpenFailed,
        }
    }
  }

  async function lock(): Promise<void> {
    switch (headerAction) {
      case SidePanelHeaderActionKind.OpeningVault:
      case SidePanelHeaderActionKind.Locking:
        return
      case SidePanelHeaderActionKind.Idle:
        break
    }
    headerAction = SidePanelHeaderActionKind.Locking
    clearMessages()
    const locked = await Effect.runPromise(Effect.result(runtime.lock()))
    switch (locked._tag) {
      case 'Failure':
        headerAction = SidePanelHeaderActionKind.Idle
        alert = {
          kind: SidePanelAlertKind.Shown,
          key: I18N_KEYS.ExtensionActionLockFailed,
        }
        return
      case 'Success':
        break
    }
    const read = statusReads.begin()
    const status = await readStatus()
    headerAction = SidePanelHeaderActionKind.Idle
    switch (read.freshness()) {
      case SidePanelReadFreshness.Stale:
        return
      case SidePanelReadFreshness.Current:
        break
    }
    switch (status._tag) {
      case 'Failure':
        failed(PopupInitializationPhase.DeviceProtectionStatus)
        return
      case 'Success': {
        const arrival: SidePanelArrival = {
          status: status.success,
          reason: SidePanelLockReasonKind.None,
        }
        await enter(arrival)
      }
    }
  }

  /** Connecting an identity and all connections continue in the Nook tab. */
  async function openNookTab(trigger: SidePanelHandOffTrigger): Promise<void> {
    switch (handOff.kind) {
      case SidePanelHandOffKind.Opening:
        return
      case SidePanelHandOffKind.Idle:
      case SidePanelHandOffKind.Continued:
      case SidePanelHandOffKind.Failed:
        break
    }
    handOff = { kind: SidePanelHandOffKind.Opening, trigger }
    alert = { kind: SidePanelAlertKind.None }
    const opened = await Effect.runPromise(
      Effect.result(runtime.openNookTab(SidePanelHandOffs.intent(trigger))),
    )
    switch (opened._tag) {
      case 'Success':
        handOff = SidePanelHandOffs.opened(trigger)
        return
      case 'Failure':
        handOff = { kind: SidePanelHandOffKind.Failed, trigger }
        alert = SidePanelHandOffs.openFailedAlert(trigger)
    }
  }

  function changed(change: SidePanelChangeKind): void {
    switch (change) {
      case SidePanelChangeKind.TabActivated:
      case SidePanelChangeKind.TabNavigated:
      case SidePanelChangeKind.PanelShown:
      case SidePanelChangeKind.PanelFocused:
        void refresh()
        return
      case SidePanelChangeKind.PanelHidden:
        return
    }
  }

  async function resolveWindow(): Promise<void> {
    panelWindow = await Effect.runPromise(runtime.currentWindow())
  }

  onMount(() => {
    void resolveWindow()
    switch (view.kind) {
      case SidePanelViewKind.Unlocked:
        void loadVaults()
        return
      case SidePanelViewKind.Setup:
      case SidePanelViewKind.PinLocked:
      case SidePanelViewKind.PasskeyLocked:
      case SidePanelViewKind.Failure:
        return
    }
  })

  $effect(() => {
    const followRequest: Parameters<typeof runtime.follow>[0] = {
      window: panelWindow,
      onchange: changed,
    }
    const release = runtime.follow(followRequest)
    return release
  })
</script>

<div class="side-panel" data-testid="side-panel" data-view={view.kind}>
  <SidePanelHeader
    {i18n}
    {chip}
    controls={lockControl}
    action={headerAction}
    onopenvault={() => void openVault()}
    onlock={() => void lock()}
  />
  <main class="side-panel-page">
    {#if alert.kind === SidePanelAlertKind.Shown}
      <p
        class="error-message side-panel-alert"
        role="alert"
        data-testid="side-panel-alert"
      >
        {translatePlain(alert.key)}
      </p>
    {/if}

    {#if ceremony.kind === SidePanelCeremonyKind.Shown}
      {#key ceremonyEntry}
        <SidePanelGate icon={ceremony.icon}>
          {#if ceremony.reason === SidePanelLockReasonKind.FillLocked}
            <p
              class="side-panel-status-line"
              role="status"
              data-testid="side-panel-lock-reason"
            >
              {translatePlain(I18N_KEYS.ExtensionActionFillLocked)}
            </p>
          {/if}
          <div class="side-panel-ceremony" data-testid="side-panel-ceremony">
            <ExtensionDeviceProtection
              {i18n}
              status={ceremony.status}
              purpose={extensionKey}
              onstatus={ceremonyStatus}
              onunlocked={unlocked}
            />
          </div>
        </SidePanelGate>
      {/key}
    {:else if view.kind === SidePanelViewKind.Unlocked}
      {#if view.vaults.kind === SidePanelVaultsKind.Loading}
        <div class="side-panel-gate">
          <p class="side-panel-status-line" role="status">
            <LoaderCircle
              size={14}
              class="side-panel-spin"
              aria-hidden="true"
            />
            {translatePlain(I18N_KEYS.CommonLoading)}
          </p>
        </div>
      {:else if view.vaults.kind === SidePanelVaultsKind.Paired}
        <ThisSite
          {i18n}
          {panelWindow}
          onlocked={onSiteLocked}
          onunpaired={() => void loadVaults()}
        />
        <SidePanelIdentities
          {i18n}
          groups={view.vaults.groups}
          device={view.device}
          identitySync={view.identitySync}
          {handOff}
          onconnect={() =>
            void openNookTab(SidePanelHandOffTrigger.ConnectIdentity)}
        />
      {:else if view.vaults.kind === SidePanelVaultsKind.NoVault}
        <SidePanelGate icon={SidePanelGateIcon.NoVault}>
          <h1 class="side-panel-gate-title">
            {translatePlain(I18N_KEYS.ExtensionCompanionNoVaultsTitle)}
          </h1>
          <p class="side-panel-gate-line">
            {translatePlain(I18N_KEYS.ExtensionActionNoIdentityLine)}
          </p>
          <div class="side-panel-gate-actions">
            <button
              type="button"
              aria-busy={handOff.kind === SidePanelHandOffKind.Opening}
              aria-disabled={handOff.kind === SidePanelHandOffKind.Opening}
              data-testid="side-panel-connect"
              onclick={() =>
                void openNookTab(SidePanelHandOffTrigger.ConnectIdentity)}
            >
              <Plus size={16} aria-hidden="true" />
              {translatePlain(I18N_KEYS.ExtensionActionConnectIdentity)}
            </button>
            {#if handOff.kind === SidePanelHandOffKind.Continued && handOff.trigger === SidePanelHandOffTrigger.ConnectIdentity}
              <p
                class="side-panel-status-line"
                role="status"
                data-testid="side-panel-handoff"
              >
                {translatePlain(I18N_KEYS.ExtensionActionContinueInTab)}
              </p>
            {:else if handOff.kind === SidePanelHandOffKind.Failed && handOff.trigger === SidePanelHandOffTrigger.ConnectIdentity}
              <p
                class="error-message"
                role="alert"
                data-testid="side-panel-error"
              >
                {translatePlain(I18N_KEYS.ExtensionActionOpenFailed)}
              </p>
            {/if}
          </div>
        </SidePanelGate>
      {:else}
        <SidePanelGate icon={SidePanelGateIcon.Failure}>
          <h1 class="side-panel-gate-title">
            {translatePlain(I18N_KEYS.ExtensionActionIdentitiesFailed)}
          </h1>
          <div class="side-panel-gate-actions">
            <button
              type="button"
              data-testid="side-panel-retry-identities"
              onclick={() => void loadVaults()}
            >
              {translatePlain(I18N_KEYS.ExtensionActionTryAgain)}
            </button>
          </div>
        </SidePanelGate>
      {/if}
    {:else if view.kind === SidePanelViewKind.Failure}
      <SidePanelGate icon={SidePanelGateIcon.Failure}>
        <h1 class="side-panel-gate-title">
          {translatePlain(I18N_KEYS.ExtensionActionStartFailed)}
        </h1>
        <div class="side-panel-gate-actions">
          <p
            class="error-message"
            role="alert"
            data-testid="extension-runtime-error"
          >
            {translatePlain(popupInitializationFailureKey(view.phase))}
          </p>
          <p class="side-panel-status-line">
            {translatePlain(I18N_KEYS.ExtensionActionReopenHint)}
          </p>
        </div>
      </SidePanelGate>
    {/if}
  </main>
  {#if footer === SidePanelSessionControls.Shown}
    <footer class="side-panel-footer">
      <button
        type="button"
        class="side-panel-text-button"
        aria-busy={handOff.kind === SidePanelHandOffKind.Opening &&
          handOff.trigger === SidePanelHandOffTrigger.Manage}
        aria-disabled={handOff.kind === SidePanelHandOffKind.Opening}
        data-testid="side-panel-manage"
        onclick={() => void openNookTab(SidePanelHandOffTrigger.Manage)}
      >
        <Settings2 size={14} aria-hidden="true" />
        {translatePlain(I18N_KEYS.ExtensionActionManage)}
      </button>
    </footer>
  {/if}
</div>
