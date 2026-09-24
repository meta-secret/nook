import { describe, expect, spyOn, test } from 'bun:test'
import { err, ok } from 'neverthrow'
import {
  ActiveExtensionSessionLease,
  ExtensionSessionGeneration,
  ExtensionSessionLeaseFailure,
  ExtensionSessionLeaseRenewal,
} from '../src/offscreen/session-lease'

describe('extension session lease generation', () => {
  test('returns the semantic renewal outcome for the active generation', () => {
    const expirations: string[] = []
    const current = ExtensionSessionGeneration.initial().next()
    const lease = new ActiveExtensionSessionLease({
      generation: current,
      durationMs: 1_000,
      onExpire: () => {
        expirations.push('expired')
      },
    })

    expect(lease.renew(current)).toEqual(
      ok(ExtensionSessionLeaseRenewal.Renewed),
    )
    lease.stop()
    expect(expirations).toEqual([])
  })

  test('rejects a stale typed generation', () => {
    const expirations: string[] = []
    const current = ExtensionSessionGeneration.initial().next()
    const lease = new ActiveExtensionSessionLease({
      generation: current,
      durationMs: 1_000,
      onExpire: () => {
        expirations.push('expired')
      },
    })

    expect(lease.renew(current.next())).toEqual(
      err(ExtensionSessionLeaseFailure.Locked),
    )
    lease.stop()
    expect(expirations).toEqual([])
  })

  test('gates renewal after the lease deadline has elapsed', () => {
    const current = ExtensionSessionGeneration.initial().next()
    const durationMs = 15 * 60 * 1_000
    const expirations: string[] = []
    let currentTime = 1_000
    const clock = spyOn(Date, 'now').mockImplementation(() => currentTime)
    const lease = new ActiveExtensionSessionLease({
      generation: current,
      durationMs,
      onExpire: () => {
        expirations.push('expired')
      },
    })

    try {
      currentTime = 1_000 + durationMs
      expect(lease.renew(current)).toEqual(
        err(ExtensionSessionLeaseFailure.Locked),
      )
      expect(expirations).toEqual([])
    } finally {
      lease.stop()
      clock.mockRestore()
    }
  })
})
