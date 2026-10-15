import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import {
  CompanionWasmSessionMessageType,
  type CompanionWasmRuntimeMessage,
} from '../../nook-web-shared/src/extension/companion-wasm-runtime-messages'

type RuntimeResponse = {
  readonly ok: true
  readonly result: {
    readonly fields: readonly []
    readonly strongestAuthenticationUsernameEvidence: 'absent'
    readonly labels: readonly []
  }
}

class GoogleContentWasmDecouplingHarness {
  readonly fetchCalls: string[] = []
  private readonly originalFetch = globalThis.fetch
  // The test preload installs a browser host; later files rely on it.
  private readonly chromeDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'chrome',
  )
  private readonly locationDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'location',
  )
  private readonly simpleVaultUrlDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    '__NOOK_SIMPLE_VAULT_URL__',
  )

  install(): void {
    const response: RuntimeResponse = {
      ok: true,
      result: {
        fields: [],
        strongestAuthenticationUsernameEvidence: 'absent',
        labels: [],
      },
    }
    const runtime = {
      sendMessage: (
        message: CompanionWasmRuntimeMessage,
        callback: (response: RuntimeResponse) => void,
      ): void => {
        expect(message.type).toBe(
          CompanionWasmSessionMessageType.ClassifyPageInputs,
        )
        callback(response)
      },
    }
    Object.assign(globalThis, {
      chrome: { runtime },
      location: { origin: 'https://accounts.google.com' },
      __NOOK_SIMPLE_VAULT_URL__: 'https://simple.example.test/',
      fetch: async (input: RequestInfo | URL): Promise<Response> => {
        this.fetchCalls.push(String(input))
        throw new Error('content companion WASM readiness rejected')
      },
    })
  }

  uninstall(): void {
    if (this.chromeDescriptor)
      Object.defineProperty(globalThis, 'chrome', this.chromeDescriptor)
    else Reflect.deleteProperty(globalThis, 'chrome')
    if (this.locationDescriptor)
      Object.defineProperty(globalThis, 'location', this.locationDescriptor)
    else Reflect.deleteProperty(globalThis, 'location')
    if (this.simpleVaultUrlDescriptor)
      Object.defineProperty(
        globalThis,
        '__NOOK_SIMPLE_VAULT_URL__',
        this.simpleVaultUrlDescriptor,
      )
    else Reflect.deleteProperty(globalThis, '__NOOK_SIMPLE_VAULT_URL__')
    globalThis.fetch = this.originalFetch
  }
}

describe('Google content companion WASM decoupling', () => {
  const harness = new GoogleContentWasmDecouplingHarness()

  afterEach(() => {
    harness.uninstall()
  })

  test('delivers ClassifyPageInputs without starting content WASM', async () => {
    harness.install()
    const adapterSource = readFileSync(
      new URL(
        '../src/content/autofill/runtime-message-adapter.ts',
        import.meta.url,
      ),
      'utf8',
    )
    expect(adapterSource).not.toContain('companion-ready')
    const backupCodeSource = readFileSync(
      new URL('../src/lib/backup-code-candidates.ts', import.meta.url),
      'utf8',
    )
    const simpleVaultSource = readFileSync(
      new URL('../src/lib/simple-vault-runtime.ts', import.meta.url),
      'utf8',
    )
    expect(backupCodeSource).not.toContain('companion-ready')
    expect(simpleVaultSource).not.toContain('companion-ready')
    const { simpleVaultRuntime } =
      await import('../src/lib/simple-vault-runtime')
    expect(
      await simpleVaultRuntime.isRuntimeNookVaultAppUrl(
        'https://accounts.google.com/ServiceLogin',
      ),
    ).toBe(false)
    const imported =
      await import('../src/content/autofill/runtime-message-adapter')
    const message: CompanionWasmRuntimeMessage = {
      type: CompanionWasmSessionMessageType.ClassifyPageInputs,
      origin: 'https://accounts.google.com',
      payload: { fields: [], labels: [] },
    }

    const delivery =
      await imported.authenticationRuntimeTransport.sendCompanionWasmRuntimeMessage(
        message,
      )

    expect(delivery.kind).toBe(imported.RuntimeMessageDeliveryKind.Delivered)
    expect(harness.fetchCalls).toEqual([])
  })
})
