import { afterEach, describe, expect, test, vi } from 'vitest'
import { ActiveVaultSyncSchedule } from '$lib/vault/sync-schedule'

afterEach(() => {
  vi.useRealTimers()
})

describe('active vault sync schedule', () => {
  test('invokes its callback on every scheduled tick', async () => {
    vi.useFakeTimers()
    const callback = vi.fn()
    const schedule = new ActiveVaultSyncSchedule({
      callback,
      intervalMs: 1_000,
    })

    await vi.advanceTimersByTimeAsync(3_000)

    expect(callback).toHaveBeenCalledTimes(3)
    schedule.stop()
  })

  test('stopping the prior schedule prevents its later ticks', async () => {
    vi.useFakeTimers()
    const priorCallback = vi.fn()
    const nextCallback = vi.fn()
    const prior = new ActiveVaultSyncSchedule({
      callback: priorCallback,
      intervalMs: 1_000,
    })

    prior.stop()
    const next = new ActiveVaultSyncSchedule({
      callback: nextCallback,
      intervalMs: 1_000,
    })
    await vi.advanceTimersByTimeAsync(2_000)

    expect(priorCallback).not.toHaveBeenCalled()
    expect(nextCallback).toHaveBeenCalledTimes(2)
    next.stop()
  })

  test('stop prevents subsequent callbacks', async () => {
    vi.useFakeTimers()
    const callback = vi.fn()
    const schedule = new ActiveVaultSyncSchedule({
      callback,
      intervalMs: 1_000,
    })

    await vi.advanceTimersByTimeAsync(1_000)
    schedule.stop()
    await vi.advanceTimersByTimeAsync(5_000)

    expect(callback).toHaveBeenCalledOnce()
  })
})
