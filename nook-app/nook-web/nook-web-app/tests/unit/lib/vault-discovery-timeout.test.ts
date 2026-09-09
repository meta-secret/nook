import { afterEach, describe, expect, it, vi } from 'vitest'
import { err, ok, type Result } from 'neverthrow'
import { VaultDiscoveryTimeout } from '$lib/vault/vault-discovery-timeout'
import {
  VaultStorageFailure,
  VaultStorageFailureKind,
} from '$lib/runtime/storage-failure'

afterEach(() => vi.useRealTimers())

describe('discovery deadline ownership', () => {
  it('returns a native outcome and cancels its deadline', async () => {
    vi.useFakeTimers()
    const dispose = vi.fn()
    const owner = new VaultDiscoveryTimeout({ timeoutMs: 10 })
    const outcome = await owner.waitFor({
      operation: Promise.resolve(ok('ready')),
      releaseLateValue: dispose,
    })
    expect(outcome.isOk()).toBe(true)
    if (outcome.isOk()) expect(outcome.value).toBe('ready')
    expect(vi.getTimerCount()).toBe(0)
    expect(dispose).not.toHaveBeenCalled()
  })

  it('releases a handle produced after timeout instead of publishing it', async () => {
    vi.useFakeTimers()
    const handle = { free: vi.fn() }
    const operation =
      Promise.withResolvers<Result<typeof handle, VaultStorageFailure>>()
    const owner = new VaultDiscoveryTimeout({ timeoutMs: 10 })
    const waiting = owner.waitFor({
      operation: operation.promise,
      releaseLateValue: (value) => value.free(),
    })
    await vi.advanceTimersByTimeAsync(10)
    const outcome = await waiting
    expect(outcome.isErr()).toBe(true)
    if (outcome.isErr())
      expect(outcome.error.kind).toBe(VaultStorageFailureKind.TimedOut)
    operation.resolve(ok(handle))
    await Promise.resolve()
    expect(handle.free).toHaveBeenCalledOnce()
  })

  it('retains an operation failure without waiting for or leaking the timer', async () => {
    vi.useFakeTimers()
    const failure = new VaultStorageFailure(
      VaultStorageFailureKind.GenerationChanged,
    )
    const owner = new VaultDiscoveryTimeout({ timeoutMs: 10 })
    const outcome = await owner.waitFor({
      operation: Promise.resolve(err(failure)),
      releaseLateValue: vi.fn(),
    })
    expect(outcome.isErr()).toBe(true)
    if (outcome.isErr()) expect(outcome.error).toBe(failure)
    expect(vi.getTimerCount()).toBe(0)
  })
})
