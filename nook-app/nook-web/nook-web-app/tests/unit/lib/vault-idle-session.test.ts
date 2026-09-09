import { beforeAll, describe, expect, test, vi } from 'vitest'
import initNookWasm, {
  NookClientRunModeUtil,
  NookRuntimeConfig,
} from '$app-wasm'
import {
  VaultIdleSessionTracker,
  VaultIdleSessionStartKind,
  VaultIdleWarningKind,
} from '$lib/vault/idle-session-tracker'

beforeAll(async () => {
  await initNookWasm()
})

describe('resolveVaultIdleTimeoutMs', () => {
  test('production build uses five minute default', () => {
    const config = new NookRuntimeConfig(
      NookClientRunModeUtil.parse('production'),
      false,
    )
    expect(config.resolve_default_vault_idle_timeout_ms()).toBe(5 * 60_000)
    expect(config.resolve_vault_idle_timeout_ms('1000')).toBe(5 * 60_000)
  })

  test('e2e build honors VITE_VAULT_IDLE_TIMEOUT_MS', () => {
    const config = new NookRuntimeConfig(
      NookClientRunModeUtil.parse('production'),
      true,
    )
    expect(config.resolve_vault_idle_timeout_ms('2500')).toBe(2500)
  })

  test('rejects values below minimum in dev/e2e', () => {
    const config = new NookRuntimeConfig(
      NookClientRunModeUtil.parse('development'),
      false,
    )
    expect(config.resolve_vault_idle_timeout_ms('100')).toBe(5 * 60_000)
  })
})

describe('resolveVaultIdleWarningMs', () => {
  test('production build uses thirty second warning', () => {
    const config = new NookRuntimeConfig(
      NookClientRunModeUtil.parse('prod'),
      false,
    )
    expect(config.resolve_default_vault_idle_warning_ms()).toBe(30_000)
  })

  test('e2e can disable warning', () => {
    const config = new NookRuntimeConfig(
      NookClientRunModeUtil.parse('prod'),
      true,
    )
    expect(config.resolve_vault_idle_warning_ms('0')).toBe(0)
  })
})

describe('createVaultIdleSessionTracker', () => {
  test('fires expire callback after timeout with no activity', async () => {
    let expired = false
    const tracker = new VaultIdleSessionTracker({
      timeoutMs: 50,
      warning: { kind: VaultIdleWarningKind.Disabled },
      onExpire: () => {
        expired = true
      },
    })

    const started = tracker.start()
    if (started.kind !== VaultIdleSessionStartKind.Tracking)
      throw new Error('DOM is required')
    const active = started.session
    await new Promise((resolve) => setTimeout(resolve, 120))
    active.stop()
    expect(expired).toBe(true)
  })

  test('activity resets the idle timer', async () => {
    let expired = false
    const tracker = new VaultIdleSessionTracker({
      timeoutMs: 80,
      warning: { kind: VaultIdleWarningKind.Disabled },
      onExpire: () => {
        expired = true
      },
    })

    const started = tracker.start()
    if (started.kind !== VaultIdleSessionStartKind.Tracking)
      throw new Error('DOM is required')
    const active = started.session
    await new Promise((resolve) => setTimeout(resolve, 40))
    active.recordActivity()
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(expired).toBe(false)
    active.stop()
  })

  test('expiration detaches every activity listener before locking', async () => {
    const removeListener = vi.spyOn(document, 'removeEventListener')
    const tracker = new VaultIdleSessionTracker({
      timeoutMs: 30,
      warning: { kind: VaultIdleWarningKind.Disabled },
      onExpire: () => {
        // Expiration already detached the active capability.
      },
    })

    const started = tracker.start()
    if (started.kind !== VaultIdleSessionStartKind.Tracking)
      throw new Error('DOM is required')
    const active = started.session
    try {
      await new Promise((resolve) => setTimeout(resolve, 80))
      for (const event of [
        'pointerdown',
        'keydown',
        'touchstart',
        'scroll',
        'click',
      ]) {
        expect(removeListener).toHaveBeenCalledWith(event, expect.any(Function))
      }
    } finally {
      active.stop()
      removeListener.mockRestore()
    }
  })
})
