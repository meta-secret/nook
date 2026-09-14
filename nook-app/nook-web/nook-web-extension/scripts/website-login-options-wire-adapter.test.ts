import { describe, expect, test } from 'bun:test'
import { companionWasmReady } from '../../nook-web-shared/src/extension/companion-ready'
import { websiteLoginOptionsWireAdapter } from '../src/background/service-worker/website-login-options-wire-adapter'

await companionWasmReady

const readyOptions = {
  ok: true,
  status: 'ready',
  authorizationGeneration: 'epoch-1',
  accounts: [
    {
      vaultStoreId: 'vault-1',
      vaultName: 'Personal',
      secretId: 'secret-1',
      username: 'person@example.test',
      websiteUrl: 'https://example.test/login',
      websiteHost: 'example.test',
    },
  ],
}

describe('website login options wire admission', () => {
  test('rejects fields outside the Rust wire contract', () => {
    expect(
      websiteLoginOptionsWireAdapter.decode({
        ...readyOptions,
        browserOnlyGuess: true,
      }),
    ).toEqual({ kind: 'unavailable' })
  })

  test.each([
    { ...readyOptions, authorizationGeneration: ' ' },
    {
      ...readyOptions,
      accounts: [{ ...readyOptions.accounts[0], vaultStoreId: '' }],
    },
    {
      ...readyOptions,
      accounts: [{ ...readyOptions.accounts[0], secretId: ' ' }],
    },
  ])('rejects blank Rust-owned identifiers', (wire) => {
    expect(websiteLoginOptionsWireAdapter.decode(wire)).toEqual({
      kind: 'unavailable',
    })
  })
})
