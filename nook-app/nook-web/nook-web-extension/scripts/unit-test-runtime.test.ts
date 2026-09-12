import { expect, test } from 'bun:test'
import { SIMPLE_VAULT_BASE_URL } from '../src/lib/simple-vault-runtime'

test('installs the Simple Vault build constant before static imports', () => {
  expect(SIMPLE_VAULT_BASE_URL).toBe('https://simple.example.test/')
})
