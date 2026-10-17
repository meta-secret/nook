import { describe, expect, test } from 'bun:test'
import { DeviceProtectionStatus } from '../src/lib/nook-wasm'
import {
  ActionPanelState,
  actionPanelState,
} from '../src/popup/action-panel-state'

describe('the toolbar panel', () => {
  test('unlocks a PIN inside the panel and a passkey in the Nook tab', () => {
    expect(actionPanelState(DeviceProtectionStatus.Pin)).toBe(
      ActionPanelState.PinLocked,
    )
    // A passkey prompt would close the panel, so the tab owns it.
    expect(actionPanelState(DeviceProtectionStatus.Passkey)).toBe(
      ActionPanelState.PasskeyLocked,
    )
  })

  test('shows the vault actions once unlocked and setup without a key', () => {
    expect(actionPanelState(DeviceProtectionStatus.Unlocked)).toBe(
      ActionPanelState.Unlocked,
    )
    expect(actionPanelState(DeviceProtectionStatus.Missing)).toBe(
      ActionPanelState.Setup,
    )
    expect(actionPanelState(DeviceProtectionStatus.Plaintext)).toBe(
      ActionPanelState.Setup,
    )
  })
})
