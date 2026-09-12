import { afterEach, expect, test } from 'bun:test'
import { simpleVaultRuntime } from '../src/lib/simple-vault-runtime'

afterEach(() => {
  Reflect.deleteProperty(globalThis, '__NOOK_SIMPLE_VAULT_URL__')
})

test('imports the runtime without reading the build constant', () => {
  expect(typeof simpleVaultRuntime.runtimeSimpleVaultUrl).toBe('function')
})

test('fails closed when an operation has no Simple Vault build constant', async () => {
  let failure: Error | false = false
  try {
    await simpleVaultRuntime.runtimeSimpleVaultUrl()
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error
    }
    failure = error
  }

  expect(failure).toBeInstanceOf(ReferenceError)
})

test('uses the configured build constant for the canonical Simple Vault URL', async () => {
  Object.assign(globalThis, {
    __NOOK_SIMPLE_VAULT_URL__: 'https://simple.example.test/',
  })

  const url = await simpleVaultRuntime.runtimeSimpleVaultUrl()
  expect(url).toBe('https://simple.example.test/')
})
