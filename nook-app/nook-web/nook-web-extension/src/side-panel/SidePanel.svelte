<!--
The Nook side panel. The toolbar button opens it beside the page, and it
stays open while the person works: setup and unlock run here through the
same ceremony as the Nook tab, and the panel re-reads the extension's state
when its window's tabs change or it is shown again. Opening a page never
closes it.
-->
<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
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
  import SidePanelAllConnections from './SidePanelAllConnections.svelte'
  import SidePanelConnectCard from './SidePanelConnectCard.svelte'
  import SidePanelConnections from './SidePanelConnections.svelte'
  import SidePanelIdentitySync from './SidePanelIdentitySync.svelte'
  import ThisSite from './ThisSite.svelte'
  import {
    SidePanelAlertKind,
    SidePanelCeremonyKind,
    SidePanelContinuity,
    SidePanelGateIcon,
    SidePanelManageKind,
    SidePanelPageKind,
    SidePanelHeaderActionKind,
    SidePanelLockReasonKind,
    SidePanelReadFreshness,
    SidePanelReadSequence,
    SidePanelSessionControls,
    SidePanelVaultsKind,
    SidePanelViewKind,
    SidePanelViews,
    type SidePanelAlert,
    type SidePanelManage,
    type SidePanelView,
  } from './side-panel-state'
  import {
    SidePanelConnectActivity,
    SidePanelConnectCardPlacement,
    SidePanelConnectFailure,
    SidePanelConnectFollowUp,
    SidePanelConnectKind,
    SidePanelConnectStep,
    SidePanelConnects,
    type SidePanelConnect,
  } from './side-panel-connect-state'
  import {
    SidePanelConnectSessions,
    type SidePanelConnectEvent,
  } from './side-panel-connect-port'
  import { ExternalSenderTrustPolicy } from '../background/service-worker/routing-trust'
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
  /** The connect page's port, admitted by the Simple Vault origin rule. */
  const connectSessions = new SidePanelConnectSessions(
    ExternalSenderTrustPolicy,
  )
  const extensionKey: DeviceProtectionPurpose = {
    kind: DeviceProtectionPurposeKind.ExtensionKey,
  }

  let view = $state<SidePanelView>(startingView())
  let headerAction = $state<SidePanelHeaderActionKind>(
    SidePanelHeaderActionKind.Idle,
  )
  let alert = $state<SidePanelAlert>({ kind: SidePanelAlertKind.None })
  /** This site, or All connections; a new view starts on This site. */
  let page = $state<SidePanelPageKind>(SidePanelPageKind.Site)
  let manage = $state<SidePanelManage>({ kind: SidePanelManageKind.Idle })
  let connect = $state<SidePanelConnect>({ kind: SidePanelConnectKind.Idle })
  let panelWindow = $state<SidePanelWindow>({
    kind: SidePanelWindowKind.Resolving,
  })
  /** A new entry into the ceremony views starts the ceremony afresh. */
  let ceremonyEntry = $state(0)

  const chip = $derived(SidePanelViews.chip(view.kind))
  const lockControl = $derived(SidePanelViews.sessionControls(view.kind))
  const pageRequest = $derived<Parameters<typeof SidePanelViews.page>[0]>({
    view,
    page,
  })
  const footer = $derived(SidePanelViews.footer(pageRequest))
  const shownPage = $derived(SidePanelViews.page(pageRequest))
  const ceremony = $derived(SidePanelViews.ceremony(view))
  /** The connect card opened under This site, or leading the panel. */
  const cardShown = $derived.by(() => {
    switch (view.kind) {
      case SidePanelViewKind.Unlocked: {
        const request: Parameters<typeof SidePanelConnects.cardShown>[0] = {
          vaults: view.vaults.kind,
          connect,
        }
        return SidePanelConnects.cardShown(request)
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
    manage = { kind: SidePanelManageKind.Idle }
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
    stopConnect()
    page = SidePanelPageKind.Site
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
      case SidePanelViewKind.Unlocked: {
        view = { ...view, vaults: SidePanelViews.vaults(load) }
        return
      }
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

  /** All connections opens in the panel; Back returns to This site. */
  function openConnections(): void {
    manage = { kind: SidePanelManageKind.Idle }
    page = SidePanelPageKind.Connections
  }

  function closeConnections(): void {
    manage = { kind: SidePanelManageKind.Idle }
    page = SidePanelPageKind.Site
  }

  function chooseDefault(vaultStoreId: string): void {
    void makeDefault(vaultStoreId)
  }

  function chooseIdentity(deviceId: string): void {
    void useIdentity(deviceId)
  }

  /** New logins are saved to the default vault. */
  async function makeDefault(vaultStoreId: string): Promise<void> {
    switch (manage.kind) {
      case SidePanelManageKind.Busy:
        return
      case SidePanelManageKind.Idle:
      case SidePanelManageKind.Failed:
        break
    }
    manage = { kind: SidePanelManageKind.Busy }
    const changed = await pairedVaultsClient.makeDefault(vaultStoreId)
    switch (changed) {
      case false:
        manage = {
          kind: SidePanelManageKind.Failed,
          key: I18N_KEYS.ExtensionCompanionMakeDefaultFailed,
        }
        return
      case true:
        manage = { kind: SidePanelManageKind.Idle }
        await loadVaults()
    }
  }

  /** Switch to another identity of this extension: this one locks and the
   * panel shows that identity's own unlock. */
  async function useIdentity(deviceId: string): Promise<void> {
    switch (manage.kind) {
      case SidePanelManageKind.Busy:
        return
      case SidePanelManageKind.Idle:
      case SidePanelManageKind.Failed:
        break
    }
    manage = { kind: SidePanelManageKind.Busy }
    const activated = await Effect.runPromise(
      Effect.result(
        Effect.tryPromise(() =>
          extensionWasmRuntime.activateIdentity(deviceId),
        ),
      ),
    )
    switch (activated._tag) {
      case 'Failure':
        manage = {
          kind: SidePanelManageKind.Failed,
          key: I18N_KEYS.ExtensionCompanionUseIdentityFailed,
        }
        return
      case 'Success':
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
        await enter(arrival)
      }
    }
  }

  function connectLabel(): string {
    return translatePlain(I18N_KEYS.ExtensionSetupProfileTitle)
  }

  function connectKind(): SidePanelConnectKind {
    return connect.kind
  }

  /** Drop a running connect: the card returns. */
  function stopConnect(): void {
    connectSessions.end()
    connect = { kind: SidePanelConnectKind.Idle }
  }

  /** The card's close button: a starting connect keeps it. */
  function closeConnect(): void {
    switch (connect.kind) {
      case SidePanelConnectKind.Starting:
      case SidePanelConnectKind.IdentityKey:
        return
      case SidePanelConnectKind.Idle:
      case SidePanelConnectKind.InTab:
      case SidePanelConnectKind.Failed:
        stopConnect()
    }
  }

  /** Rust decides whether the unlocked key connects the next identity or
   * a new key is set up for it first, as each identity has its own. */
  async function connectIdentity(): Promise<void> {
    switch (SidePanelConnects.activity(connect)) {
      case SidePanelConnectActivity.Busy:
        return
      case SidePanelConnectActivity.Ready:
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
        connectFailed()
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
        connectFailed()
        return
      case 'Success':
        break
    }
    switch (SidePanelConnects.step(begun.success)) {
      case SidePanelConnectStep.Pair:
        await pair(device)
        return
      case SidePanelConnectStep.SetUpKey:
        connect = SidePanelConnects.identityKey()
        ceremonyEntry += 1
    }
  }

  function connectFailed(): void {
    connectSessions.end()
    connect = {
      kind: SidePanelConnectKind.Failed,
      failure: SidePanelConnectFailure.Start,
    }
  }

  /** Open or reuse the one Nook tab of this window on the connect route,
   * then follow the steps its page reports; the panel stays. */
  async function pair(device: ExtensionSessionDeviceWire): Promise<void> {
    connect = { kind: SidePanelConnectKind.Starting }
    switch (panelWindow.kind) {
      case SidePanelWindowKind.Known:
        break
      case SidePanelWindowKind.Resolving:
      case SidePanelWindowKind.Unknown:
        connectFailed()
        return
    }
    const windowId = panelWindow.id
    const listening: Parameters<typeof connectSessions.open>[0] = {
      windowId,
      onevent: followTab,
    }
    connectSessions.open(listening)
    const pairing: SidePanelPairing = {
      device,
      deviceLabel: connectLabel(),
      windowId,
    }
    const opened = await Effect.runPromise(
      Effect.result(runtime.beginPairing(pairing)),
    )
    // Page events may have moved the connect while the reply was awaited.
    switch (connectKind()) {
      case SidePanelConnectKind.Starting:
        break
      // The tab closed or the page failed before its id arrived.
      case SidePanelConnectKind.Idle:
      case SidePanelConnectKind.IdentityKey:
      case SidePanelConnectKind.InTab:
      case SidePanelConnectKind.Failed:
        return
    }
    switch (opened._tag) {
      case 'Success':
        connect = SidePanelConnects.inTab(opened.success)
        connectSessions.tabOpened(opened.success)
        return
      case 'Failure':
        connectFailed()
    }
  }

  /** A step, a closed tab or a protocol failure from the Nook tab. */
  function followTab(event: SidePanelConnectEvent): void {
    const request: Parameters<typeof SidePanelConnects.advance>[0] = {
      connect,
      event,
    }
    const advance = SidePanelConnects.advance(request)
    connect = advance.connect
    switch (advance.followUp) {
      case SidePanelConnectFollowUp.None:
        return
      case SidePanelConnectFollowUp.ReadVaults:
        // Approved: the new identity shows at once.
        connectSessions.end()
        void loadVaults()
    }
  }

  async function focusTab(): Promise<void> {
    switch (connect.kind) {
      case SidePanelConnectKind.InTab:
        break
      case SidePanelConnectKind.Idle:
      case SidePanelConnectKind.Starting:
      case SidePanelConnectKind.IdentityKey:
      case SidePanelConnectKind.Failed:
        return
    }
    alert = { kind: SidePanelAlertKind.None }
    const focused = await Effect.runPromise(
      Effect.result(runtime.focusTab(connect.tabId)),
    )
    switch (focused._tag) {
      case 'Success':
        return
      case 'Failure':
        alert = {
          kind: SidePanelAlertKind.Shown,
          key: I18N_KEYS.ExtensionActionOpenFailed,
        }
    }
  }

  /** The new identity's ceremony moved to PIN setup. */
  function identityKeyStatus(next: DeviceProtectionStatus): void {
    switch (connect.kind) {
      case SidePanelConnectKind.IdentityKey:
        connect = { ...connect, status: next }
        return
      case SidePanelConnectKind.Idle:
      case SidePanelConnectKind.Starting:
      case SidePanelConnectKind.InTab:
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
        connect = { kind: SidePanelConnectKind.Idle }
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
      case SidePanelConnectKind.Starting:
      case SidePanelConnectKind.InTab:
      case SidePanelConnectKind.Failed:
        return
    }
    statusReads.invalidate()
    clearMessages()
    const device: ExtensionSessionDeviceState = {
      kind: ExtensionSessionDeviceStateKind.Active,
      device: unlock.device,
    }
    showUnlocked(device)
    void pair(unlock.device)
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

  // Closing the panel stops following the Nook tab.
  onDestroy(() => connectSessions.end())

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
      {:else if view.vaults.kind === SidePanelVaultsKind.Paired && shownPage === SidePanelPageKind.Connections}
        <SidePanelAllConnections
          {i18n}
          groups={view.vaults.groups}
          device={view.device}
          {manage}
          onmakedefault={chooseDefault}
          onuseidentity={chooseIdentity}
          onback={closeConnections}
        />
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
          {cardShown}
          onconnect={() => void connectIdentity()}
          onfocustab={() => void focusTab()}
          onclose={closeConnect}
        />
      {:else if view.vaults.kind === SidePanelVaultsKind.NoVault}
        <div class="side-panel-gate" data-gate={SidePanelGateIcon.NoVault}>
          <SidePanelConnectCard
            {i18n}
            placement={SidePanelConnectCardPlacement.First}
            {connect}
            identitySync={view.identitySync}
            onconnect={() => void connectIdentity()}
            onfocustab={() => void focusTab()}
            onclose={closeConnect}
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
        data-testid="side-panel-manage"
        onclick={openConnections}
      >
        <Settings2 size={14} aria-hidden="true" />
        {translatePlain(I18N_KEYS.ExtensionActionManage)}
      </button>
    </footer>
  {/if}
</div>
