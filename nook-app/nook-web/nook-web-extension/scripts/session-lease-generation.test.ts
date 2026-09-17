import { describe, expect, test } from 'bun:test'
import { err } from 'neverthrow'
import {
  ActiveExtensionSessionLease,
  ExtensionSessionGeneration,
  ExtensionSessionLeaseFailure,
} from '../src/offscreen/session-lease'

describe('extension session lease generation', () => {
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
})
