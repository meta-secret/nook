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
  import { LoaderCircle, Settings2 } from '@lucide/svelte'
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
  import type { ExtensionConnectStart } from '../../../nook-web-shared/src/extension/extension-connect-start'
  import { retryClosedExtensionSessionOnce } from '../lib/extension-runtime-retry'
  import { pairedVaultsClient } from '../lib/paired-vaults'
  import ConnectChain from '../popup/ConnectChain.svelte'
  import ExtensionDeviceProtection from '../popup/ExtensionDeviceProtection.svelte'
  import {
    DeviceProtectionPurposeKind,
    IdentityKeyCancelOutcome,
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
  import SidePanelConnectCard from './SidePanelConnectCard.svelte'
  import SidePanelConnections from './SidePanelConnections.svelte'
  import SidePanelIdentitySync from './SidePanelIdentitySync.svelte'
  import ThisSite from './ThisSite.svelte'
  import {
    SidePanelAlertKind,
    SidePanelCeremonyKind,
    SidePanelConnectCardPlacement,
    SidePanelConnectKind,
    SidePanelConnectStep,
    SidePanelConnects,
    SidePanelContinuity,
    SidePanelGateIcon,
    SidePanelHandOffKind,
    SidePanelHeaderActionKind,
    SidePanelLockReasonKind,
    SidePanelReadFreshness,
    SidePanelReadSequence,
    SidePanelSessionControls,
    SidePanelVaultsKind,
    SidePanelViewKind,
    SidePanelViews,
    type SidePanelAlert,
    type SidePanelConnect,
    type SidePanelView,
  } from './side-panel-state'
  import {
    SidePanelChangeKind,
    SidePanelRuntime,
    SidePanelWindowKind,
    type SidePanelPairing,
    type SidePanelWindow,
  } from './side-panel-runtime'

  /** A status read, and why the panel may now be locked. */
  type SidePanelArrival = {
    readonly status: DeviceProtectionStatus
    readonly reason: SidePanelLockReasonKind
  }

  /** The key that connects the next identity, and the choice the connect
   * page continues. */
  type SidePanelPairingStart = {
    readonly device: ExtensionSessionDeviceWire
    readonly start: ExtensionConnectStart
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
  let handOff = $state<SidePanelHandOffKind>(SidePanelHandOffKind.Idle)
  let connect = $state<SidePanelConnect>({ kind: SidePanelConnectKind.Idle })
  let panelWindow = $state<SidePanelWindow>({
    kind: SidePanelWindowKind.Resolving,
  })
  /** A new entry into the ceremony views starts the ceremony afresh. */
  let ceremonyEntry = $state(0)

  const chip = $derived(SidePanelViews.chip(view.kind))
  const lockControl = $derived(SidePanelViews.sessionControls(view.kind))
  const footer = $derived(SidePanelViews.footer(view))
  const ceremony = $derived(SidePanelViews.ceremony(view))
  /** The connect card opened under This site, or leading the panel. */
  const choosing = $derived.by(() => {
    switch (view.kind) {
      case SidePanelViewKind.Unlocked: {
        const request: Parameters<typeof SidePanelConnects.choiceShown>[0] = {
          vaults: view.vaults.kind,
          connect,
        }
        return SidePanelConnects.choiceShown(request)
      }
      case SidePanelViewKind.Setup:
      case SidePanelViewKind.PinLocked:
      case SidePanelViewKind.PasskeyLocked:
      case SidePanelViewKind.Failure:
        return false
    }
  })
  /** A new identity's key: set up in place, or dropped by its Cancel. */
  const identityKey: DeviceProtectionPurpose = {
    kind: DeviceProtectionPurposeKind.IdentityKey,
    cancel: cancelIdentityKey,
  }

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
    handOff = SidePanelHandOffKind.Idle
  }

  /** Re-read the extension's state: it may have changed in the Nook tab,
   * in Pilot, or by the session lease ending. */
  async function refresh(): Promise<void> {
    switch (SidePanelConnects.holdsPanel(connect)) {
      case true:
        return
      case false:
        break
    }
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
    const request: Parameters<typeof SidePanelViews.continuity>[0] = {
      view,
      status: arrival.status,
    }
    switch (SidePanelViews.continuity(request)) {
      case SidePanelContinuity.Same:
        stay()
        return
      case SidePanelContinuity.Changed:
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
    connect = { kind: SidePanelConnectKind.Idle }
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

  /** The ceremony moved to PIN setup because passkeys cannot work here;
   * that is the only status it asks for. */
  function ceremonyStatus(): void {
    view = SidePanelViews.pinFallback()
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

  /** All connections: the Nook tab's companion home, where Use this
   * identity and Make default live. */
  async function openConnections(): Promise<void> {
    switch (handOff) {
      case SidePanelHandOffKind.Opening:
        return
      case SidePanelHandOffKind.Idle:
        break
    }
    handOff = SidePanelHandOffKind.Opening
    alert = { kind: SidePanelAlertKind.None }
    const opened = await Effect.runPromise(
      Effect.result(runtime.openConnections()),
    )
    handOff = SidePanelHandOffKind.Idle
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

  function connectLabel(): string {
    return translatePlain(I18N_KEYS.ExtensionSetupProfileTitle)
  }

  /** Connect another identity opens the card; a busy connect keeps it. */
  function openChoice(): void {
    switch (connect.kind) {
      case SidePanelConnectKind.Starting:
      case SidePanelConnectKind.IdentityKey:
        return
      case SidePanelConnectKind.Idle:
      case SidePanelConnectKind.Choosing:
      case SidePanelConnectKind.Continued:
      case SidePanelConnectKind.Failed:
        connect = { kind: SidePanelConnectKind.Choosing }
    }
  }

  function closeChoice(): void {
    switch (connect.kind) {
      case SidePanelConnectKind.Starting:
      case SidePanelConnectKind.IdentityKey:
        return
      case SidePanelConnectKind.Idle:
      case SidePanelConnectKind.Choosing:
      case SidePanelConnectKind.Continued:
      case SidePanelConnectKind.Failed:
        connect = { kind: SidePanelConnectKind.Idle }
    }
  }

  function createIdentity(typedName: string): void {
    const request: Parameters<typeof SidePanelConnects.create>[0] = {
      typed: typedName,
      suggested: translatePlain(I18N_KEYS.FirstRunNamePlaceholder),
    }
    void connectIdentity(SidePanelConnects.create(request))
  }

  function joinIdentity(): void {
    void connectIdentity(SidePanelConnects.join())
  }

  /** Rust decides whether the unlocked key connects the next identity or
   * a new key is set up for it first, as each identity has its own. */
  async function connectIdentity(start: ExtensionConnectStart): Promise<void> {
    switch (connect.kind) {
      case SidePanelConnectKind.Starting:
      case SidePanelConnectKind.IdentityKey:
        return
      case SidePanelConnectKind.Idle:
      case SidePanelConnectKind.Choosing:
      case SidePanelConnectKind.Continued:
      case SidePanelConnectKind.Failed:
        break
    }
    switch (view.kind) {
      case SidePanelViewKind.Unlocked:
        break
      case SidePanelViewKind.Setup:
      case SidePanelViewKind.PinLocked:
      case SidePanelViewKind.PasskeyLocked:
      case SidePanelViewKind.Failure:
        return
    }
    switch (view.device.kind) {
      case ExtensionSessionDeviceStateKind.Locked:
        connect = { kind: SidePanelConnectKind.Failed }
        return
      case ExtensionSessionDeviceStateKind.Active:
        break
    }
    const device = view.device.device
    connect = { kind: SidePanelConnectKind.Starting }
    const begun = await Effect.runPromise(
      Effect.result(
        Effect.tryPromise(() =>
          extensionWasmRuntime.beginIdentityConnection(connectLabel()),
        ),
      ),
    )
    switch (begun._tag) {
      case 'Failure':
        connect = { kind: SidePanelConnectKind.Failed }
        return
      case 'Success':
        break
    }
    switch (SidePanelConnects.step(begun.success)) {
      case SidePanelConnectStep.Pair: {
        const pairing: SidePanelPairingStart = { device, start }
        await pair(pairing)
        return
      }
      case SidePanelConnectStep.SetUpKey:
        connect = SidePanelConnects.identityKey(start)
        ceremonyEntry += 1
    }
  }

  /** Open Nook's connect page on the chosen step; the panel stays. */
  async function pair(request: SidePanelPairingStart): Promise<void> {
    connect = { kind: SidePanelConnectKind.Starting }
    const pairing: SidePanelPairing = {
      device: request.device,
      deviceLabel: connectLabel(),
      start: request.start,
    }
    const opened = await Effect.runPromise(
      Effect.result(runtime.beginPairing(pairing)),
    )
    switch (opened._tag) {
      case 'Success':
        connect = { kind: SidePanelConnectKind.Continued }
        return
      case 'Failure':
        connect = { kind: SidePanelConnectKind.Failed }
    }
  }

  /** The new identity's ceremony moved to PIN setup. */
  function identityKeyStatus(next: DeviceProtectionStatus): void {
    switch (connect.kind) {
      case SidePanelConnectKind.IdentityKey:
        connect = { ...connect, status: next }
        return
      case SidePanelConnectKind.Idle:
      case SidePanelConnectKind.Choosing:
      case SidePanelConnectKind.Starting:
      case SidePanelConnectKind.Continued:
      case SidePanelConnectKind.Failed:
        return
    }
  }

  /** The person did not set up the new identity's key: drop it and go
   * back to the choice. */
  async function cancelIdentityKey(): Promise<IdentityKeyCancelOutcome> {
    const cancelled = await Effect.runPromise(
      Effect.result(
        Effect.tryPromise(() =>
          extensionWasmRuntime.cancelIdentityConnection(),
        ),
      ),
    )
    switch (cancelled._tag) {
      case 'Failure':
        return IdentityKeyCancelOutcome.Failed
      case 'Success':
        connect = { kind: SidePanelConnectKind.Choosing }
        return IdentityKeyCancelOutcome.Cancelled
    }
  }

  /** The new identity's key exists and is the unlocked one: open the
   * connect page for it. */
  function identityKeyUnlocked(unlock: DeviceProtectionUnlock): void {
    switch (connect.kind) {
      case SidePanelConnectKind.IdentityKey:
        break
      case SidePanelConnectKind.Idle:
      case SidePanelConnectKind.Choosing:
      case SidePanelConnectKind.Starting:
      case SidePanelConnectKind.Continued:
      case SidePanelConnectKind.Failed:
        return
    }
    const pairing: SidePanelPairingStart = {
      device: unlock.device,
      start: connect.start,
    }
    statusReads.invalidate()
    clearMessages()
    const device: ExtensionSessionDeviceState = {
      kind: ExtensionSessionDeviceStateKind.Active,
      device: unlock.device,
    }
    showUnlocked(device)
    void pair(pairing)
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
        // A hidden panel keeps no typed PIN: the ceremony starts afresh.
        ceremonyEntry += 1
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
      {@const gateStatus = ceremony.status}
      {#key ceremonyEntry}
        <SidePanelGate icon={ceremony.icon}>
          {#snippet lead()}
            <ConnectChain {i18n} status={gateStatus} />
          {/snippet}
          <div class="side-panel-ceremony" data-testid="side-panel-ceremony">
            <ExtensionDeviceProtection
              {i18n}
              status={ceremony.status}
              purpose={extensionKey}
              onstatus={ceremonyStatus}
              onunlocked={unlocked}
            />
          </div>
          {#if ceremony.reason === SidePanelLockReasonKind.FillLocked}
            <p
              class="side-panel-status-line"
              role="status"
              data-testid="side-panel-lock-reason"
            >
              {translatePlain(I18N_KEYS.ExtensionActionFillLocked)}
            </p>
          {/if}
        </SidePanelGate>
      {/key}
    {:else if view.kind === SidePanelViewKind.Unlocked && connect.kind === SidePanelConnectKind.IdentityKey}
      {@const identityKeyStatusNow = connect.status}
      {#key ceremonyEntry}
        <SidePanelGate icon={SidePanelGateIcon.Setup}>
          {#snippet lead()}
            <ConnectChain {i18n} status={identityKeyStatusNow} />
          {/snippet}
          <div
            class="side-panel-ceremony"
            data-testid="side-panel-identity-key"
          >
            <ExtensionDeviceProtection
              {i18n}
              status={identityKeyStatusNow}
              purpose={identityKey}
              onstatus={identityKeyStatus}
              onunlocked={identityKeyUnlocked}
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
          groups={view.vaults.groups}
          device={view.device}
          onlocked={onSiteLocked}
          onunpaired={() => void loadVaults()}
        />
        <SidePanelConnections
          {i18n}
          identitySync={view.identitySync}
          {connect}
          {choosing}
          onopen={openChoice}
          oncreate={createIdentity}
          onjoin={joinIdentity}
          onclose={closeChoice}
        />
      {:else if view.vaults.kind === SidePanelVaultsKind.NoVault}
        <div class="side-panel-gate" data-gate={SidePanelGateIcon.NoVault}>
          <SidePanelConnectCard
            {i18n}
            placement={SidePanelConnectCardPlacement.First}
            {connect}
            identitySync={view.identitySync}
            oncreate={createIdentity}
            onjoin={joinIdentity}
            onclose={closeChoice}
          />
        </div>
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
            <SidePanelIdentitySync {i18n} identitySync={view.identitySync} />
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
        class="side-panel-text-button side-panel-footer-action"
        aria-busy={handOff === SidePanelHandOffKind.Opening}
        aria-disabled={handOff === SidePanelHandOffKind.Opening}
        data-testid="side-panel-manage"
        onclick={() => void openConnections()}
      >
        <Settings2 size={14} aria-hidden="true" />
        {translatePlain(I18N_KEYS.ExtensionActionManage)}
      </button>
    </footer>
  {/if}
</div>
