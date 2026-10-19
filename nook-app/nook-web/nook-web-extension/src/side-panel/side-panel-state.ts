import {
  I18N_KEYS,
  type I18nKey,
} from '../../../nook-web-shared/src/generated/i18n-keys'
import {
  DeviceProtectionStatus,
  ExtensionSessionDeviceStateKind,
  type ExtensionSessionDeviceState,
  type NookIdentityConnectionStart,
} from '../lib/nook-wasm'
import {
  PairedVaultsLoadKind,
  pairedVaultGroups,
  type PairedVaultGroup,
  type PairedVaultSummary,
  type PairedVaultsLoad,
} from '../lib/paired-vaults'
import {
  IdentitySyncKind,
  PopupInitializationPhase,
  type IdentitySync,
} from '../popup/popup-app-state'
import {
  ExtensionConnectStartKind,
  type ExtensionConnectStart,
} from '../../../nook-web-shared/src/extension/extension-connect-start'

/**
 * What the side panel shows. The panel stays open while the person works
 * in tabs, so each view follows the extension's state as it changes here,
 * in the Nook tab or in Pilot.
 */
export enum SidePanelViewKind {
  /** No key yet: the shared ceremony sets it up in place. */
  Setup = 'setup',
  PinLocked = 'pin-locked',
  PasskeyLocked = 'passkey-locked',
  Unlocked = 'unlocked',
  /** Reading the extension's state failed: nothing else is offered. */
  Failure = 'failure',
}

/** Why the panel is locked, when that is worth saying. */
export enum SidePanelLockReasonKind {
  None = 'none',
  /** A Fill found the extension locked. */
  FillLocked = 'fill-locked',
}

export enum SidePanelVaultsKind {
  Loading = 'loading',
  Paired = 'paired',
  /** The list loaded and no identity is connected yet. */
  NoVault = 'no-vault',
  /** The list could not be read; this is not "no identity". */
  Failed = 'failed',
}

export type SidePanelVaults =
  | { readonly kind: SidePanelVaultsKind.Loading }
  | {
      readonly kind: SidePanelVaultsKind.Paired
      readonly groups: readonly PairedVaultGroup[]
    }
  | { readonly kind: SidePanelVaultsKind.NoVault }
  | { readonly kind: SidePanelVaultsKind.Failed }

/** Why the panel shows setup. */
export enum SidePanelSetupOrigin {
  /** The extension has no key yet. */
  Status = 'status',
  /** Passkeys cannot work here, so the ceremony moved to a PIN: a status
   * read that still says passkey keeps that step, as the Nook tab does. */
  PinFallback = 'pin-fallback',
}

/** Whether a fresh status read keeps the view the panel shows. */
export enum SidePanelContinuity {
  Same = 'same',
  Changed = 'changed',
}

export type SidePanelView =
  | {
      readonly kind: SidePanelViewKind.Setup
      /** Missing, plaintext or PIN setup; the ceremony moves between them. */
      readonly status: DeviceProtectionStatus
      readonly origin: SidePanelSetupOrigin
    }
  | {
      readonly kind: SidePanelViewKind.PinLocked
      readonly reason: SidePanelLockReasonKind
    }
  | {
      readonly kind: SidePanelViewKind.PasskeyLocked
      readonly reason: SidePanelLockReasonKind
    }
  | {
      readonly kind: SidePanelViewKind.Unlocked
      readonly device: ExtensionSessionDeviceState
      readonly vaults: SidePanelVaults
      readonly identitySync: IdentitySync
    }
  | {
      readonly kind: SidePanelViewKind.Failure
      readonly phase: PopupInitializationPhase
    }

/** The header's state tag: its `data-state` and its text. */
export enum SidePanelChipState {
  Unlocked = 'unlocked',
  Locked = 'locked',
  Setup = 'setup',
}

export enum SidePanelChipKind {
  Shown = 'shown',
  /** The failure view names no state it could not read. */
  Hidden = 'hidden',
}

export type SidePanelChip =
  | {
      readonly kind: SidePanelChipKind.Shown
      readonly state: SidePanelChipState
      readonly label: I18nKey
    }
  | { readonly kind: SidePanelChipKind.Hidden }

/** Whether the header offers Lock, or the page shows its footer. */
export enum SidePanelSessionControls {
  Shown = 'shown',
  Hidden = 'hidden',
}

export enum SidePanelCeremonyKind {
  Shown = 'shown',
  None = 'none',
}

/** The shared device-protection ceremony, when a view runs it. */
export type SidePanelCeremony =
  | {
      readonly kind: SidePanelCeremonyKind.Shown
      readonly icon: SidePanelGateIcon
      /** The status the ceremony sets up or unlocks. */
      readonly status: DeviceProtectionStatus
      readonly reason: SidePanelLockReasonKind
    }
  | { readonly kind: SidePanelCeremonyKind.None }

/** Whether an identity group, or a This site section's vault, belongs to
 * the identity unlocked now. */
export enum SidePanelIdentityRelation {
  Current = 'current',
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Other = 'other',
}

type SidePanelIdentityRelationRequest = {
  readonly group: PairedVaultGroup
  readonly device: ExtensionSessionDeviceState
}

type SidePanelSectionRelationRequest = {
  /** The vault a This site section lists. */
  readonly vaultStoreId: PairedVaultSummary['vaultStoreId']
  /** The paired vaults the panel loaded, under their identities. */
  readonly groups: readonly PairedVaultGroup[]
  readonly device: ExtensionSessionDeviceState
}

type SidePanelUnlockedRequest = {
  readonly device: ExtensionSessionDeviceState
}

type SidePanelContinuityRequest = {
  readonly view: SidePanelView
  readonly status: DeviceProtectionStatus
}

type SidePanelLockedRequest = {
  readonly status: DeviceProtectionStatus
  readonly reason: SidePanelLockReasonKind
}

type SidePanelSetupContinuityRequest = {
  readonly origin: SidePanelSetupOrigin
  readonly next: SidePanelViewKind
}

type SidePanelKindPair = {
  readonly shown: SidePanelViewKind
  readonly next: SidePanelViewKind
}

/** Maps the extension's protection status to the panel's views. */
export class SidePanelViews {
  private constructor() {}

  /** The view a status asks for. A status the panel cannot act on is a
   * failure, never "Set up Nook": that would invite a second setup. */
  static kind(status: DeviceProtectionStatus): SidePanelViewKind {
    switch (status) {
      case DeviceProtectionStatus.Missing:
      case DeviceProtectionStatus.Plaintext:
      case DeviceProtectionStatus.PinSetup:
        return SidePanelViewKind.Setup
      case DeviceProtectionStatus.Pin:
        return SidePanelViewKind.PinLocked
      case DeviceProtectionStatus.Passkey:
        return SidePanelViewKind.PasskeyLocked
      case DeviceProtectionStatus.Unlocked:
        return SidePanelViewKind.Unlocked
      case DeviceProtectionStatus.Loading:
      case DeviceProtectionStatus.Error:
      case DeviceProtectionStatus.Unknown:
        return SidePanelViewKind.Failure
    }
  }

  /** The view after a lock, a status read elsewhere, or a Fill that found
   * the extension locked. */
  static locked(request: SidePanelLockedRequest): SidePanelView {
    const { status, reason } = request
    switch (SidePanelViews.kind(status)) {
      case SidePanelViewKind.Setup:
        return {
          kind: SidePanelViewKind.Setup,
          status,
          origin: SidePanelSetupOrigin.Status,
        }
      case SidePanelViewKind.PinLocked:
        return { kind: SidePanelViewKind.PinLocked, reason }
      case SidePanelViewKind.PasskeyLocked:
        return { kind: SidePanelViewKind.PasskeyLocked, reason }
      case SidePanelViewKind.Unlocked:
      case SidePanelViewKind.Failure:
        return {
          kind: SidePanelViewKind.Failure,
          phase: PopupInitializationPhase.DeviceProtectionStatus,
        }
    }
  }

  /** The ceremony moved to PIN setup because passkeys cannot work here. */
  static pinFallback(): SidePanelView {
    return {
      kind: SidePanelViewKind.Setup,
      status: DeviceProtectionStatus.PinSetup,
      origin: SidePanelSetupOrigin.PinFallback,
    }
  }

  /** Whether a status read elsewhere asks for another view. */
  static continuity(request: SidePanelContinuityRequest): SidePanelContinuity {
    const { view, status } = request
    const next = SidePanelViews.kind(status)
    switch (view.kind) {
      case SidePanelViewKind.Setup: {
        const setup: SidePanelSetupContinuityRequest = {
          origin: view.origin,
          next,
        }
        return SidePanelViews.setupContinuity(setup)
      }
      case SidePanelViewKind.PinLocked:
      case SidePanelViewKind.PasskeyLocked:
      case SidePanelViewKind.Unlocked:
      case SidePanelViewKind.Failure: {
        const pair: SidePanelKindPair = { shown: view.kind, next }
        return SidePanelViews.sameKind(pair)
      }
    }
  }

  private static setupContinuity(
    request: SidePanelSetupContinuityRequest,
  ): SidePanelContinuity {
    const { origin, next } = request
    switch (origin) {
      case SidePanelSetupOrigin.Status: {
        const pair: SidePanelKindPair = {
          shown: SidePanelViewKind.Setup,
          next,
        }
        return SidePanelViews.sameKind(pair)
      }
      case SidePanelSetupOrigin.PinFallback:
        break
    }
    switch (next) {
      case SidePanelViewKind.Setup:
      case SidePanelViewKind.PasskeyLocked:
        return SidePanelContinuity.Same
      case SidePanelViewKind.PinLocked:
      case SidePanelViewKind.Unlocked:
      case SidePanelViewKind.Failure:
        return SidePanelContinuity.Changed
    }
  }

  private static sameKind(request: SidePanelKindPair): SidePanelContinuity {
    switch (request.shown === request.next) {
      case true:
        return SidePanelContinuity.Same
      case false:
        return SidePanelContinuity.Changed
    }
  }

  /** Unlocked, with the vault list still loading. */
  static unlocked(request: SidePanelUnlockedRequest): SidePanelView {
    return {
      kind: SidePanelViewKind.Unlocked,
      device: request.device,
      vaults: { kind: SidePanelVaultsKind.Loading },
      identitySync: { kind: IdentitySyncKind.Idle },
    }
  }

  static chip(view: SidePanelViewKind): SidePanelChip {
    switch (view) {
      case SidePanelViewKind.Setup:
        return {
          kind: SidePanelChipKind.Shown,
          state: SidePanelChipState.Setup,
          label: I18N_KEYS.ExtensionActionStateSetup,
        }
      case SidePanelViewKind.PinLocked:
      case SidePanelViewKind.PasskeyLocked:
        return {
          kind: SidePanelChipKind.Shown,
          state: SidePanelChipState.Locked,
          label: I18N_KEYS.ExtensionActionStateLocked,
        }
      case SidePanelViewKind.Unlocked:
        return {
          kind: SidePanelChipKind.Shown,
          state: SidePanelChipState.Unlocked,
          label: I18N_KEYS.ExtensionActionStateUnlocked,
        }
      case SidePanelViewKind.Failure:
        return { kind: SidePanelChipKind.Hidden }
    }
  }

  /** Lock and the footer belong to the unlocked views only. */
  static sessionControls(view: SidePanelViewKind): SidePanelSessionControls {
    switch (view) {
      case SidePanelViewKind.Unlocked:
        return SidePanelSessionControls.Shown
      case SidePanelViewKind.Setup:
      case SidePanelViewKind.PinLocked:
      case SidePanelViewKind.PasskeyLocked:
      case SidePanelViewKind.Failure:
        return SidePanelSessionControls.Hidden
    }
  }

  /** Setup and both locked views run the shared ceremony in one gate,
   * so a step it takes itself (PIN instead of passkey) keeps its message. */
  static ceremony(view: SidePanelView): SidePanelCeremony {
    switch (view.kind) {
      case SidePanelViewKind.Setup:
        return {
          kind: SidePanelCeremonyKind.Shown,
          icon: SidePanelGateIcon.Setup,
          status: view.status,
          reason: SidePanelLockReasonKind.None,
        }
      case SidePanelViewKind.PinLocked:
        return {
          kind: SidePanelCeremonyKind.Shown,
          icon: SidePanelGateIcon.PinLocked,
          status: DeviceProtectionStatus.Pin,
          reason: view.reason,
        }
      case SidePanelViewKind.PasskeyLocked:
        return {
          kind: SidePanelCeremonyKind.Shown,
          icon: SidePanelGateIcon.PasskeyLocked,
          status: DeviceProtectionStatus.Passkey,
          reason: view.reason,
        }
      case SidePanelViewKind.Unlocked:
      case SidePanelViewKind.Failure:
        return { kind: SidePanelCeremonyKind.None }
    }
  }

  /** All connections sits in the footer of the unlocked views once their
   * vault list has answered. */
  static footer(view: SidePanelView): SidePanelSessionControls {
    switch (view.kind) {
      case SidePanelViewKind.Unlocked:
        break
      case SidePanelViewKind.Setup:
      case SidePanelViewKind.PinLocked:
      case SidePanelViewKind.PasskeyLocked:
      case SidePanelViewKind.Failure:
        return SidePanelSessionControls.Hidden
    }
    switch (view.vaults.kind) {
      case SidePanelVaultsKind.Loading:
        return SidePanelSessionControls.Hidden
      case SidePanelVaultsKind.Paired:
      case SidePanelVaultsKind.NoVault:
      case SidePanelVaultsKind.Failed:
        return SidePanelSessionControls.Shown
    }
  }

  /** The vault list an unlocked view shows; other views hold none yet. */
  static unlockedVaults(view: SidePanelView): SidePanelVaults {
    switch (view.kind) {
      case SidePanelViewKind.Unlocked:
        return view.vaults
      case SidePanelViewKind.Setup:
      case SidePanelViewKind.PinLocked:
      case SidePanelViewKind.PasskeyLocked:
      case SidePanelViewKind.Failure:
        return { kind: SidePanelVaultsKind.Loading }
    }
  }

  /** The paired-vault list, as the unlocked views read it. */
  static vaults(load: PairedVaultsLoad): SidePanelVaults {
    switch (load.kind) {
      case PairedVaultsLoadKind.Unavailable:
        return { kind: SidePanelVaultsKind.Failed }
      case PairedVaultsLoadKind.Ready:
        break
    }
    switch (load.vaults.length) {
      case 0:
        return { kind: SidePanelVaultsKind.NoVault }
      default:
        return {
          kind: SidePanelVaultsKind.Paired,
          groups: pairedVaultGroups(load.vaults),
        }
    }
  }

  /** A group is current when its app key is the unlocked one. */
  static identityRelation(
    request: SidePanelIdentityRelationRequest,
  ): SidePanelIdentityRelation {
    const { group, device } = request
    switch (device.kind) {
      case ExtensionSessionDeviceStateKind.Locked:
        return SidePanelIdentityRelation.Other
      case ExtensionSessionDeviceStateKind.Active:
        break
    }
    switch (group.deviceId === device.device.deviceId) {
      case true:
        return SidePanelIdentityRelation.Current
      case false:
        return SidePanelIdentityRelation.Other
    }
  }

  /** A This site section is current only when the loaded group holding its
   * vault is the unlocked identity; a vault no loaded group holds counts as
   * another identity's. */
  static sectionRelation(
    request: SidePanelSectionRelationRequest,
  ): SidePanelIdentityRelation {
    const { vaultStoreId, groups, device } = request
    const holding = groups.filter((group) =>
      group.vaults.some((vault) => vault.vaultStoreId === vaultStoreId),
    )
    const relations = holding.map((group) => {
      const relation: SidePanelIdentityRelationRequest = { group, device }
      return SidePanelViews.identityRelation(relation)
    })
    switch (relations.includes(SidePanelIdentityRelation.Current)) {
      case true:
        return SidePanelIdentityRelation.Current
      case false:
        return SidePanelIdentityRelation.Other
    }
  }
}

/** The header action in progress; it stays focused while it runs. */
export enum SidePanelHeaderActionKind {
  Idle = 'idle',
  OpeningVault = 'opening-vault',
  Locking = 'locking',
}

export enum SidePanelAlertKind {
  None = 'none',
  Shown = 'shown',
}

/** The page-level message under the header, cleared by the next action. */
export type SidePanelAlert =
  | { readonly kind: SidePanelAlertKind.None }
  | { readonly kind: SidePanelAlertKind.Shown; readonly key: I18nKey }

/** All connections: the Nook tab's companion home, where Use this identity
 * and Make default live. A failure is said at the top of the page. */
export enum SidePanelHandOffKind {
  Idle = 'idle',
  Opening = 'opening',
}

/** Connecting an identity runs in the panel itself: the person first says
 * whether they start a new identity (naming its first vault) or join one
 * they already use, and Nook's connect page continues that choice. */
export enum SidePanelConnectKind {
  Idle = 'idle',
  /** The choice is open under This site (Connect another identity). */
  Choosing = 'choosing',
  /** Rust is choosing the key that connects the next identity. */
  Starting = 'starting',
  /** The next identity waits for its own passkey or PIN, set up in place. */
  IdentityKey = 'identity-key',
  /** Nook's connect page opened; the person continues there. */
  Continued = 'continued',
  Failed = 'failed',
}

export type SidePanelConnect =
  | {
      readonly kind:
        | SidePanelConnectKind.Idle
        | SidePanelConnectKind.Choosing
        | SidePanelConnectKind.Starting
        | SidePanelConnectKind.Failed
    }
  | {
      readonly kind: SidePanelConnectKind.Continued
      /** The key the connect page pairs vaults to. */
      readonly deviceId: string
      /** That key's paired vaults when the page opened. */
      readonly held: number
    }
  | {
      readonly kind: SidePanelConnectKind.IdentityKey
      /** Passkey setup, or PIN setup when passkeys cannot work here. */
      readonly status: DeviceProtectionStatus
      /** The choice the connect page continues once the key exists. */
      readonly start: ExtensionConnectStart
    }

type SidePanelCreateStartRequest = {
  /** What the person typed as the first vault's name. */
  readonly typed: string
  /** The connect page's suggested name, used for an empty field. */
  readonly suggested: string
}

type SidePanelContinuedRequest = {
  readonly vaults: SidePanelVaults
  readonly deviceId: string
}

type SidePanelVaultsArrivedRequest = {
  readonly connect: SidePanelConnect
  readonly vaults: SidePanelVaults
}

type SidePanelChoiceRequest = {
  readonly vaults: SidePanelVaultsKind
  readonly connect: SidePanelConnect
}

/** Whether the connect card leads the panel or opened under This site. */
export enum SidePanelConnectCardPlacement {
  /** No identity is connected: the card cannot be closed.
   * @public Used from Svelte templates; Knip cannot trace enum members there. */
  First = 'first',
  /** Connect another identity opened it; its close button closes it.
   * @public Used from Svelte templates; Knip cannot trace enum members there. */
  Another = 'another',
}

/** What the panel does once Rust chose the connecting key. */
export enum SidePanelConnectStep {
  /** The unlocked key joins the identity: open Nook's connect page now. */
  Pair = 'pair',
  /** A new identity was staged: its key is set up first. */
  SetUpKey = 'set-up-key',
}

export class SidePanelConnects {
  private constructor() {}

  static step(start: NookIdentityConnectionStart): SidePanelConnectStep {
    switch (start) {
      case 'current-key':
        return SidePanelConnectStep.Pair
      case 'new-key-staged':
        return SidePanelConnectStep.SetUpKey
    }
  }

  /** The new identity's key starts as a passkey, as the Nook tab's does. */
  static identityKey(start: ExtensionConnectStart): SidePanelConnect {
    return {
      kind: SidePanelConnectKind.IdentityKey,
      status: DeviceProtectionStatus.Missing,
      start,
    }
  }

  /** Starting a new identity with an empty name takes the suggested one,
   * as the connect page's own field does. */
  static create(request: SidePanelCreateStartRequest): ExtensionConnectStart {
    return {
      kind: ExtensionConnectStartKind.Create,
      vaultName: request.typed.trim() || request.suggested,
    }
  }

  static join(): ExtensionConnectStart {
    return { kind: ExtensionConnectStartKind.Join }
  }

  /** Nook's connect page opened for this key. */
  static continued(request: SidePanelContinuedRequest): SidePanelConnect {
    return {
      kind: SidePanelConnectKind.Continued,
      deviceId: request.deviceId,
      held: SidePanelConnects.heldBy(request),
    }
  }

  /** Once the key holds more vaults than when the page opened, the
   * identity connected: the hand-off line gives way to it. */
  static vaultsArrived(
    request: SidePanelVaultsArrivedRequest,
  ): SidePanelConnect {
    const { connect, vaults } = request
    switch (connect.kind) {
      case SidePanelConnectKind.Continued:
        break
      case SidePanelConnectKind.Idle:
      case SidePanelConnectKind.Choosing:
      case SidePanelConnectKind.Starting:
      case SidePanelConnectKind.IdentityKey:
      case SidePanelConnectKind.Failed:
        return connect
    }
    const held: SidePanelContinuedRequest = {
      vaults,
      deviceId: connect.deviceId,
    }
    switch (SidePanelConnects.heldBy(held) > connect.held) {
      case true:
        return { kind: SidePanelConnectKind.Idle }
      case false:
        return connect
    }
  }

  private static heldBy(request: SidePanelContinuedRequest): number {
    const { vaults, deviceId } = request
    switch (vaults.kind) {
      case SidePanelVaultsKind.Paired:
        return vaults.groups
          .filter((group) => group.deviceId === deviceId)
          .flatMap((group) => group.vaults).length
      case SidePanelVaultsKind.Loading:
      case SidePanelVaultsKind.NoVault:
      case SidePanelVaultsKind.Failed:
        return 0
    }
  }

  /** Whether the choice shows: always while no identity is connected,
   * otherwise once Connect another identity opened it. */
  static choiceShown(request: SidePanelChoiceRequest): boolean {
    switch (request.vaults) {
      case SidePanelVaultsKind.NoVault:
        return true
      case SidePanelVaultsKind.Loading:
      case SidePanelVaultsKind.Paired:
      case SidePanelVaultsKind.Failed:
        break
    }
    switch (request.connect.kind) {
      case SidePanelConnectKind.Idle:
        return false
      case SidePanelConnectKind.Choosing:
      case SidePanelConnectKind.Starting:
      case SidePanelConnectKind.IdentityKey:
      case SidePanelConnectKind.Continued:
      case SidePanelConnectKind.Failed:
        return true
    }
  }

  /** The key ceremony owns the panel until it finishes or is cancelled:
   * a status read meanwhile must not replace it. */
  static holdsPanel(connect: SidePanelConnect): boolean {
    return connect.kind === SidePanelConnectKind.IdentityKey
  }
}

export enum SidePanelReadFreshness {
  Current = 'current',
  /** A later read or a change made here superseded it. */
  Stale = 'stale',
}

type SidePanelReadRequest = {
  readonly sequence: SidePanelReadSequence
  readonly generation: number
}

/** One read in flight; its answer applies only while it is the latest. */
export class SidePanelRead {
  constructor(private readonly request: SidePanelReadRequest) {}

  freshness(): SidePanelReadFreshness {
    return this.request.sequence.freshnessOf(this.request.generation)
  }
}

/** Orders the panel's reads of one kind, so a late answer for an earlier
 * read never paints over a newer state. */
export class SidePanelReadSequence {
  private generation = 0

  begin(): SidePanelRead {
    this.generation += 1
    const request: SidePanelReadRequest = {
      sequence: this,
      generation: this.generation,
    }
    return new SidePanelRead(request)
  }

  /** A change made in the panel itself outdates every read in flight. */
  invalidate(): void {
    this.generation += 1
  }

  freshnessOf(generation: number): SidePanelReadFreshness {
    switch (generation === this.generation) {
      case true:
        return SidePanelReadFreshness.Current
      case false:
        return SidePanelReadFreshness.Stale
    }
  }
}

/** The icon tile that leads a gate view. */
export enum SidePanelGateIcon {
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Setup = 'setup',
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  PinLocked = 'pin-locked',
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  PasskeyLocked = 'passkey-locked',
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  NoVault = 'no-vault',
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Failure = 'failure',
}
