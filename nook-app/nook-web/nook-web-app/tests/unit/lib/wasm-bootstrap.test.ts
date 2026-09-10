import { afterEach, describe, expect, test, vi } from 'vitest'
import { VaultApplication } from '$app-wasm'

const wasm = vi.hoisted(() => ({
  initialize: vi.fn(() => Promise.resolve()),
  configure: vi.fn(),
  manager: vi.fn(),
}))
vi.mock('$app-wasm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$app-wasm')>()),
  default: wasm.initialize,
  configure_vault_application: wasm.configure,
  NookVaultManager: wasm.manager,
}))

class EngineInitialization {
  readonly completion: Promise<void>
  finish: () => void = () => {}
  constructor() {
    this.completion = new Promise((resolve) => {
      this.finish = resolve
    })
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.resetModules()
  vi.clearAllMocks()
})

describe('vault engine startup results', () => {
  test('initialization rejection returns a concrete failure without creating a manager', async () => {
    wasm.initialize.mockRejectedValueOnce('host initialization unavailable')
    const { VaultManagerStartup, VaultEngineFailure } =
      await import('$lib/runtime/wasm-bootstrap')
    const result = await new VaultManagerStartup(VaultApplication.Simple).open()
    expect(result.isErr()).toBe(true)
    if (result.isErr())
      expect(result.error).toBe(VaultEngineFailure.Initialization)
    expect(wasm.manager).not.toHaveBeenCalled()
  })

  test('timed-out initialization cannot create a late manager', async () => {
    vi.useFakeTimers()
    const initialization = new EngineInitialization()
    wasm.initialize.mockReturnValueOnce(initialization.completion)
    const { VaultManagerStartup, VaultEngineFailure } =
      await import('$lib/runtime/wasm-bootstrap')
    const opening = new VaultManagerStartup(VaultApplication.Simple).open()
    await vi.advanceTimersByTimeAsync(15000)
    const result = await opening
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error).toBe(VaultEngineFailure.Timeout)
    initialization.finish()
    await Promise.resolve()
    await Promise.resolve()
    expect(wasm.manager).not.toHaveBeenCalled()
  })
})
