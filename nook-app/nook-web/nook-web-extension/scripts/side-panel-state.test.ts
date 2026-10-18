import { describe, expect, test } from 'bun:test'
import { I18N_KEYS } from '../../nook-web-shared/src/generated/i18n-keys'
import {
  DeviceProtectionStatus,
  ExtensionSessionDeviceStateKind,
  type ExtensionSessionDeviceState,
} from '../src/lib/nook-wasm'
import {
  PairedVaultsLoadKind,
  type PairedVaultGroup,
  type PairedVaultSummary,
  type PairedVaultsLoad,
} from '../src/lib/paired-vaults'
import {
  IdentitySyncKind,
  PopupInitializationPhase,
} from '../src/popup/popup-app-state'
import { SidePanelNookTabIntent } from '../src/side-panel/side-panel-runtime'
import {
  SidePanelAlertKind,
  SidePanelCeremonyKind,
  SidePanelChipKind,
  SidePanelChipState,
  SidePanelContinuity,
  SidePanelGateIcon,
  SidePanelHandOffKind,
  SidePanelHandOffTrigger,
  SidePanelHandOffs,
  SidePanelIdentityRelation,
  SidePanelLockReasonKind,
  SidePanelReadFreshness,
  SidePanelReadSequence,
  SidePanelSessionControls,
  SidePanelSetupOrigin,
  SidePanelVaultsKind,
  SidePanelViewKind,
  SidePanelViews,
  type SidePanelView,
} from '../src/side-panel/side-panel-state'

const activeDevice: ExtensionSessionDeviceState = {
  kind: ExtensionSessionDeviceStateKind.Active,
  device: {
    deviceId: 'device-personal',
    devicePublicKey: 'public',
    deviceSigningPublicKey: 'signing',
  },
}

const personalVault: PairedVaultSummary = {
  vaultStoreId: 'store-personal',
  vaultName: 'Personal',
  identityLabel: 'Me',
  deviceId: 'device-personal',
  isDefault: true,
  fillsPasswords: true,
  managesPasskeys: false,
}

const workVault: PairedVaultSummary = {
  ...personalVault,
  vaultStoreId: 'store-work',
  vaultName: 'Work',
  identityLabel: 'Acme',
  deviceId: 'device-work',
  isDefault: false,
}

function unlockedView(): SidePanelView {
  const request: Parameters<typeof SidePanelViews.unlocked>[0] = {
    device: activeDevice,
  }
  return SidePanelViews.unlocked(request)
}

describe('side panel views', () => {
  test('setup, PIN and passkey statuses each get their own view', () => {
    expect(SidePanelViews.kind(DeviceProtectionStatus.Missing)).toBe(
      SidePanelViewKind.Setup,
    )
    expect(SidePanelViews.kind(DeviceProtectionStatus.Plaintext)).toBe(
      SidePanelViewKind.Setup,
    )
    expect(SidePanelViews.kind(DeviceProtectionStatus.PinSetup)).toBe(
      SidePanelViewKind.Setup,
    )
    expect(SidePanelViews.kind(DeviceProtectionStatus.Pin)).toBe(
      SidePanelViewKind.PinLocked,
    )
    expect(SidePanelViews.kind(DeviceProtectionStatus.Passkey)).toBe(
      SidePanelViewKind.PasskeyLocked,
    )
    expect(SidePanelViews.kind(DeviceProtectionStatus.Unlocked)).toBe(
      SidePanelViewKind.Unlocked,
    )
  })

  test('a status read error is a failure, never an invitation to set up again', () => {
    for (const status of [
      DeviceProtectionStatus.Error,
      DeviceProtectionStatus.Unknown,
      DeviceProtectionStatus.Loading,
    ]) {
      expect(SidePanelViews.kind(status)).toBe(SidePanelViewKind.Failure)
      const request: Parameters<typeof SidePanelViews.locked>[0] = {
        status,
        reason: SidePanelLockReasonKind.None,
      }
      expect(SidePanelViews.locked(request)).toEqual({
        kind: SidePanelViewKind.Failure,
        phase: PopupInitializationPhase.DeviceProtectionStatus,
      })
    }
  })

  test('a Fill that found the extension locked says so on the locked view', () => {
    const request: Parameters<typeof SidePanelViews.locked>[0] = {
      status: DeviceProtectionStatus.Pin,
      reason: SidePanelLockReasonKind.FillLocked,
    }
    const view = SidePanelViews.locked(request)
    expect(view).toEqual({
      kind: SidePanelViewKind.PinLocked,
      reason: SidePanelLockReasonKind.FillLocked,
    })
    expect(SidePanelViews.ceremony(view)).toEqual({
      kind: SidePanelCeremonyKind.Shown,
      icon: SidePanelGateIcon.PinLocked,
      status: DeviceProtectionStatus.Pin,
      reason: SidePanelLockReasonKind.FillLocked,
    })
  })

  test('setup and both locked views run the shared ceremony in place', () => {
    const setup = SidePanelViews.pinFallback()
    expect(SidePanelViews.ceremony(setup)).toEqual({
      kind: SidePanelCeremonyKind.Shown,
      icon: SidePanelGateIcon.Setup,
      status: DeviceProtectionStatus.PinSetup,
      reason: SidePanelLockReasonKind.None,
    })
    const passkey: SidePanelView = {
      kind: SidePanelViewKind.PasskeyLocked,
      reason: SidePanelLockReasonKind.None,
    }
    expect(SidePanelViews.ceremony(passkey)).toEqual({
      kind: SidePanelCeremonyKind.Shown,
      icon: SidePanelGateIcon.PasskeyLocked,
      status: DeviceProtectionStatus.Passkey,
      reason: SidePanelLockReasonKind.None,
    })
    expect(SidePanelViews.ceremony(unlockedView()).kind).toBe(
      SidePanelCeremonyKind.None,
    )
  })

  test('the header tags the state in text, and the failure view tags none', () => {
    expect(SidePanelViews.chip(SidePanelViewKind.Setup)).toEqual({
      kind: SidePanelChipKind.Shown,
      state: SidePanelChipState.Setup,
      label: I18N_KEYS.ExtensionActionStateSetup,
    })
    expect(SidePanelViews.chip(SidePanelViewKind.PasskeyLocked)).toEqual({
      kind: SidePanelChipKind.Shown,
      state: SidePanelChipState.Locked,
      label: I18N_KEYS.ExtensionActionStateLocked,
    })
    expect(SidePanelViews.chip(SidePanelViewKind.Unlocked)).toEqual({
      kind: SidePanelChipKind.Shown,
      state: SidePanelChipState.Unlocked,
      label: I18N_KEYS.ExtensionActionStateUnlocked,
    })
    expect(SidePanelViews.chip(SidePanelViewKind.Failure).kind).toBe(
      SidePanelChipKind.Hidden,
    )
  })

  test('Lock and All connections appear only once unlocked', () => {
    expect(SidePanelViews.sessionControls(SidePanelViewKind.Unlocked)).toBe(
      SidePanelSessionControls.Shown,
    )
    for (const kind of [
      SidePanelViewKind.Setup,
      SidePanelViewKind.PinLocked,
      SidePanelViewKind.PasskeyLocked,
      SidePanelViewKind.Failure,
    ]) {
      expect(SidePanelViews.sessionControls(kind)).toBe(
        SidePanelSessionControls.Hidden,
      )
    }
    // The footer waits for the vault list to answer.
    expect(SidePanelViews.footer(unlockedView())).toBe(
      SidePanelSessionControls.Hidden,
    )
    const paired: SidePanelView = {
      kind: SidePanelViewKind.Unlocked,
      device: activeDevice,
      vaults: { kind: SidePanelVaultsKind.NoVault },
      identitySync: { kind: IdentitySyncKind.Idle },
    }
    expect(SidePanelViews.footer(paired)).toBe(SidePanelSessionControls.Shown)
  })
})

describe('side panel continuity', () => {
  test('a status read elsewhere replaces the view only when its kind changes', () => {
    const passkey: SidePanelView = {
      kind: SidePanelViewKind.PasskeyLocked,
      reason: SidePanelLockReasonKind.None,
    }
    const same: Parameters<typeof SidePanelViews.continuity>[0] = {
      view: passkey,
      status: DeviceProtectionStatus.Passkey,
    }
    expect(SidePanelViews.continuity(same)).toBe(SidePanelContinuity.Same)
    const unlockedElsewhere: Parameters<typeof SidePanelViews.continuity>[0] = {
      view: passkey,
      status: DeviceProtectionStatus.Unlocked,
    }
    expect(SidePanelViews.continuity(unlockedElsewhere)).toBe(
      SidePanelContinuity.Changed,
    )
  })

  test('a PIN fallback from the passkey view survives a passkey status read', () => {
    const fallback = SidePanelViews.pinFallback()
    expect(fallback).toEqual({
      kind: SidePanelViewKind.Setup,
      status: DeviceProtectionStatus.PinSetup,
      origin: SidePanelSetupOrigin.PinFallback,
    })
    for (const status of [
      DeviceProtectionStatus.Passkey,
      DeviceProtectionStatus.Missing,
    ]) {
      const request: Parameters<typeof SidePanelViews.continuity>[0] = {
        view: fallback,
        status,
      }
      expect(SidePanelViews.continuity(request)).toBe(SidePanelContinuity.Same)
    }
    for (const status of [
      DeviceProtectionStatus.Pin,
      DeviceProtectionStatus.Unlocked,
      DeviceProtectionStatus.Error,
    ]) {
      const request: Parameters<typeof SidePanelViews.continuity>[0] = {
        view: fallback,
        status,
      }
      expect(SidePanelViews.continuity(request)).toBe(
        SidePanelContinuity.Changed,
      )
    }
    // Setup the extension needs because it has no key follows its status.
    const lockedRequest: Parameters<typeof SidePanelViews.locked>[0] = {
      status: DeviceProtectionStatus.Missing,
      reason: SidePanelLockReasonKind.None,
    }
    const setup = SidePanelViews.locked(lockedRequest)
    const passkeyRead: Parameters<typeof SidePanelViews.continuity>[0] = {
      view: setup,
      status: DeviceProtectionStatus.Passkey,
    }
    expect(SidePanelViews.continuity(passkeyRead)).toBe(
      SidePanelContinuity.Changed,
    )
  })
})

describe('side panel vaults', () => {
  test('an unreadable vault list is a failure, not "no identity connected"', () => {
    const unavailable: PairedVaultsLoad = {
      kind: PairedVaultsLoadKind.Unavailable,
    }
    expect(SidePanelViews.vaults(unavailable)).toEqual({
      kind: SidePanelVaultsKind.Failed,
    })
    const empty: PairedVaultsLoad = {
      kind: PairedVaultsLoadKind.Ready,
      vaults: [],
    }
    expect(SidePanelViews.vaults(empty)).toEqual({
      kind: SidePanelVaultsKind.NoVault,
    })
  })

  test('paired vaults are grouped by identity in the order they arrive', () => {
    const ready: PairedVaultsLoad = {
      kind: PairedVaultsLoadKind.Ready,
      vaults: [personalVault, workVault],
    }
    const personal: PairedVaultGroup = {
      identityLabel: 'Me',
      deviceId: 'device-personal',
      vaults: [personalVault],
    }
    const work: PairedVaultGroup = {
      identityLabel: 'Acme',
      deviceId: 'device-work',
      vaults: [workVault],
    }
    expect(SidePanelViews.vaults(ready)).toEqual({
      kind: SidePanelVaultsKind.Paired,
      groups: [personal, work],
    })
    const current: Parameters<typeof SidePanelViews.identityRelation>[0] = {
      group: personal,
      device: activeDevice,
    }
    const other: Parameters<typeof SidePanelViews.identityRelation>[0] = {
      group: work,
      device: activeDevice,
    }
    expect(SidePanelViews.identityRelation(current)).toBe(
      SidePanelIdentityRelation.Current,
    )
    expect(SidePanelViews.identityRelation(other)).toBe(
      SidePanelIdentityRelation.Other,
    )
    const locked: Parameters<typeof SidePanelViews.identityRelation>[0] = {
      group: personal,
      device: { kind: ExtensionSessionDeviceStateKind.Locked },
    }
    expect(SidePanelViews.identityRelation(locked)).toBe(
      SidePanelIdentityRelation.Other,
    )
  })
})

describe('side panel hand-offs to the Nook tab', () => {
  test('connecting pairs in the Nook tab and says to continue there', () => {
    const trigger = SidePanelHandOffTrigger.ConnectIdentity
    expect(SidePanelHandOffs.intent(trigger)).toBe(SidePanelNookTabIntent.Pair)
    expect(SidePanelHandOffs.opened(trigger)).toEqual({
      kind: SidePanelHandOffKind.Continued,
      trigger,
    })
    expect(SidePanelHandOffs.openFailedAlert(trigger)).toEqual({
      kind: SidePanelAlertKind.None,
    })
  })

  test('all connections opens the Nook tab and reports a failure on the page', () => {
    const trigger = SidePanelHandOffTrigger.Manage
    expect(SidePanelHandOffs.intent(trigger)).toBe(
      SidePanelNookTabIntent.Manage,
    )
    expect(SidePanelHandOffs.opened(trigger)).toEqual({
      kind: SidePanelHandOffKind.Idle,
    })
    expect(SidePanelHandOffs.openFailedAlert(trigger)).toEqual({
      kind: SidePanelAlertKind.Shown,
      key: I18N_KEYS.ExtensionActionOpenFailed,
    })
  })
})

describe('side panel read ordering', () => {
  test('a late answer for an earlier read never paints over a newer one', () => {
    const reads = new SidePanelReadSequence()
    const first = reads.begin()
    const second = reads.begin()
    expect(first.freshness()).toBe(SidePanelReadFreshness.Stale)
    expect(second.freshness()).toBe(SidePanelReadFreshness.Current)
  })

  test('a change made in the panel outdates reads already in flight', () => {
    const reads = new SidePanelReadSequence()
    const inFlight = reads.begin()
    reads.invalidate()
    expect(inFlight.freshness()).toBe(SidePanelReadFreshness.Stale)
  })
})
