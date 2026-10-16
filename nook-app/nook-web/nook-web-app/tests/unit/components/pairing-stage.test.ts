import { describe, expect, test } from 'vitest'
import {
  PairingProgress,
  PairingStage,
} from '$lib/components/add-device/pairing-stage'

type Facts = ConstructorParameters<typeof PairingProgress>[0]

const READY: Facts = {
  cloudReady: true,
  inviteReady: true,
  membersAtInvite: ['app-laptop'],
  members: ['app-laptop'],
}

describe('adding a device', () => {
  test('starts at the cloud copy, then the invite', () => {
    const noCloud = new PairingProgress({
      ...READY,
      cloudReady: false,
      inviteReady: false,
      membersAtInvite: false,
    })
    expect(noCloud.stage).toBe(PairingStage.Cloud)
    expect(noCloud.step).toBe(0)
    const noInvite = new PairingProgress({
      ...READY,
      inviteReady: false,
      membersAtInvite: false,
    })
    expect(noInvite.stage).toBe(PairingStage.Invite)
    expect(noInvite.step).toBe(1)
  })

  test('waits while the invite is out and nobody new has joined', () => {
    const waiting = new PairingProgress(READY)
    expect(waiting.stage).toBe(PairingStage.Waiting)
    expect(waiting.step).toBe(2)
  })

  test('a member that was not one when the invite went out completes it', () => {
    const joined = new PairingProgress({
      ...READY,
      members: ['app-laptop', 'app-phone'],
    })
    expect(joined.stage).toBe(PairingStage.Joined)
    expect(joined.step).toBe(3)
  })

  test('a removed member does not count as a join', () => {
    const removed = new PairingProgress({
      ...READY,
      membersAtInvite: ['app-laptop', 'app-old'],
      members: ['app-laptop'],
    })
    expect(removed.stage).toBe(PairingStage.Waiting)
  })

  test('without a recorded invite roster nothing has joined yet', () => {
    const unrecorded = new PairingProgress({
      ...READY,
      membersAtInvite: false,
      members: ['app-laptop', 'app-phone'],
    })
    expect(unrecorded.stage).toBe(PairingStage.Waiting)
  })
})
