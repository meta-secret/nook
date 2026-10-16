import { describe, expect, test } from 'vitest'
import {
  PairingProgress,
  PairingStage,
} from '$lib/components/add-device/pairing-stage'

describe('adding a device', () => {
  test('starts at the cloud copy, then the invite', () => {
    const noCloud = new PairingProgress({
      cloudReady: false,
      inviteReady: false,
    })
    expect(noCloud.stage).toBe(PairingStage.Cloud)
    expect(noCloud.step).toBe(0)
    const noInvite = new PairingProgress({
      cloudReady: true,
      inviteReady: false,
    })
    expect(noInvite.stage).toBe(PairingStage.Invite)
    expect(noInvite.step).toBe(1)
  })

  test('an issued invite completes every step without waiting for the device', () => {
    const issued = new PairingProgress({ cloudReady: true, inviteReady: true })
    expect(issued.stage).toBe(PairingStage.Issued)
    expect(issued.step).toBe(2)
  })

  test('a lost cloud copy goes back to the cloud step even with an invite', () => {
    const lost = new PairingProgress({ cloudReady: false, inviteReady: true })
    expect(lost.stage).toBe(PairingStage.Cloud)
  })
})
