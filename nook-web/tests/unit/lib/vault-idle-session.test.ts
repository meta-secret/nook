import { describe, expect, test } from 'vitest'
import {
  createVaultIdleSessionTracker,
  resolveVaultIdleTimeoutMs,
  resolveVaultIdleWarningMs,
} from '$lib/vault-idle-session'

describe('resolveVaultIdleTimeoutMs', () => {
  test('production build uses five minute default', () => {
    expect(resolveVaultIdleTimeoutMs({})).toBe(5 * 60_000)
    expect(
      resolveVaultIdleTimeoutMs({
        VITE_VAULT_IDLE_TIMEOUT_MS: '1000',
      }),
    ).toBe(5 * 60_000)
  })

  test('e2e build honors VITE_VAULT_IDLE_TIMEOUT_MS', () => {
    expect(
      resolveVaultIdleTimeoutMs({
        VITE_E2E_EXPOSE_VAULT: 'true',
        VITE_VAULT_IDLE_TIMEOUT_MS: '2500',
      }),
    ).toBe(2500)
  })

  test('rejects values below minimum in dev/e2e', () => {
    expect(
      resolveVaultIdleTimeoutMs({
        DEV: true,
        VITE_VAULT_IDLE_TIMEOUT_MS: '100',
      }),
    ).toBe(5 * 60_000)
  })
})

describe('resolveVaultIdleWarningMs', () => {
  test('production build uses thirty second warning', () => {
    expect(resolveVaultIdleWarningMs({})).toBe(30_000)
  })

  test('e2e can disable warning', () => {
    expect(
      resolveVaultIdleWarningMs({
        VITE_E2E_EXPOSE_VAULT: 'true',
        VITE_VAULT_IDLE_WARNING_MS: '0',
      }),
    ).toBe(0)
  })
})

describe('createVaultIdleSessionTracker', () => {
  test('fires expire callback after timeout with no activity', async () => {
    let expired = false
    const tracker = createVaultIdleSessionTracker({
      timeoutMs: 50,
      warningMs: 0,
      onExpire: () => {
        expired = true
      },
    })

    tracker.start()
    await new Promise((resolve) => setTimeout(resolve, 120))
    tracker.stop()
    expect(expired).toBe(true)
  })

  test('activity resets the idle timer', async () => {
    let expired = false
    const tracker = createVaultIdleSessionTracker({
      timeoutMs: 80,
      warningMs: 0,
      onExpire: () => {
        expired = true
      },
    })

    tracker.start()
    await new Promise((resolve) => setTimeout(resolve, 40))
    tracker.recordActivity()
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(expired).toBe(false)
    tracker.stop()
  })
})
