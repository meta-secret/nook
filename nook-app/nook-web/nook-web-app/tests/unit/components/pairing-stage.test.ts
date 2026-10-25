import { describe, expect, test } from 'vitest'
import {
  PairingProgress,
  PairingStage,
} from '$lib/components/add-device/pairing-stage'

describe('adding a device', () => {
  test('starts at the cloud copy, then the invite', () => {
    const noCloud = new PairingProgress({
      member: true,
      cloudReady: false,
      inviteReady: false,
    })
    expect(noCloud.stage).toBe(PairingStage.Cloud)
    expect(noCloud.step).toBe(0)
    const noInvite = new PairingProgress({
      member: true,
      cloudReady: true,
      inviteReady: false,
    })
    expect(noInvite.stage).toBe(PairingStage.Invite)
    expect(noInvite.step).toBe(1)
  })

  test('an issued invite completes every step without waiting for the device', () => {
    const issued = new PairingProgress({
      member: true,
      cloudReady: true,
      inviteReady: true,
    })
    expect(issued.stage).toBe(PairingStage.Issued)
    expect(issued.step).toBe(2)
  })

  test('a lost cloud copy goes back to the cloud step even with an invite', () => {
    const lost = new PairingProgress({
      member: true,
      cloudReady: false,
      inviteReady: true,
    })
    expect(lost.stage).toBe(PairingStage.Cloud)
  })

  test('a key that has not joined the identity stops at the invite step', () => {
    const notMember = new PairingProgress({
      member: false,
      cloudReady: true,
      inviteReady: false,
    })
    expect(notMember.stage).toBe(PairingStage.NotMember)
    expect(notMember.step).toBe(1)
  })

  test('without a cloud copy the cloud step comes first, member or not', () => {
    const notMember = new PairingProgress({
      member: false,
      cloudReady: false,
      inviteReady: false,
    })
    expect(notMember.stage).toBe(PairingStage.Cloud)
  })
})
