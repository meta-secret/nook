import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  ActiveExtensionSessionLease,
  ExtensionSessionGeneration,
  ExtensionSessionLeaseFailure,
} from '../../../../nook-web-extension/src/offscreen/session-lease'

class SessionLeaseFixture {
  readonly onExpire = vi.fn()
  readonly generation = ExtensionSessionGeneration.initial()
  readonly lease = new ActiveExtensionSessionLease({
    generation: this.generation,
    durationMs: 1000,
    onExpire: this.onExpire,
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('active extension session lease', () => {
  test('expires exactly once', () => {
    const fixture = new SessionLeaseFixture()
    vi.advanceTimersByTime(1000)
    expect(fixture.onExpire).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(5000)
    expect(fixture.onExpire).toHaveBeenCalledTimes(1)
  })
  test('renewal extends the deadline', () => {
    const fixture = new SessionLeaseFixture()
    vi.advanceTimersByTime(600)
    expect(fixture.lease.renew(fixture.generation).isOk()).toBe(true)
    vi.advanceTimersByTime(400)
    expect(fixture.onExpire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(600)
    expect(fixture.onExpire).toHaveBeenCalledTimes(1)
  })
  test('stale generations reject without extending the deadline', () => {
    const fixture = new SessionLeaseFixture()
    vi.advanceTimersByTime(600)
    const renewal = fixture.lease.renew(fixture.generation.next())
    expect(renewal.isErr()).toBe(true)
    if (renewal.isErr())
      expect(renewal.error).toBe(ExtensionSessionLeaseFailure.Locked)
    vi.advanceTimersByTime(400)
    expect(fixture.onExpire).toHaveBeenCalledTimes(1)
  })
  test('elapsed leases reject before a delayed timer callback executes', () => {
    const fixture = new SessionLeaseFixture()
    vi.setSystemTime(1000)
    const renewal = fixture.lease.renew(fixture.generation)
    expect(renewal.isErr()).toBe(true)
    if (renewal.isErr())
      expect(renewal.error).toBe(ExtensionSessionLeaseFailure.Locked)
    expect(fixture.onExpire).not.toHaveBeenCalled()
    vi.runOnlyPendingTimers()
    expect(fixture.onExpire).toHaveBeenCalledTimes(1)
  })
  test('stop cancels expiration and rejects further renewal', () => {
    const fixture = new SessionLeaseFixture()
    fixture.lease.stop()
    const renewal = fixture.lease.renew(fixture.generation)
    expect(renewal.isErr()).toBe(true)
    if (renewal.isErr())
      expect(renewal.error).toBe(ExtensionSessionLeaseFailure.Locked)
    vi.advanceTimersByTime(5000)
    expect(fixture.onExpire).not.toHaveBeenCalled()
  })
})
