import { beforeAll, describe, expect, test } from 'vitest'
import initNookWasm, { provider_draft_kind, s3_provider_draft } from '$app-wasm'
import { recoveryProviderSource } from '$lib/vault/access-check'
import { S3ConnectionFixture } from '../s3-connection-fixture'
import { VaultStateTestFixture } from '../vault-state-test-fixture'

beforeAll(async () => {
  await initNookWasm()
})

describe('the provider a keyring recovery reads', () => {
  test('names the S3 location it lists, so a join asked after a new key still goes there', () => {
    const vault = VaultStateTestFixture.create()
    const draft = s3_provider_draft(S3ConnectionFixture.configuration())
    vault.stageProviderDraft(draft)
    vault.activateLoginSetup(provider_draft_kind(draft))

    const source = recoveryProviderSource(vault)

    expect(source.kind).toBe('remote')
    if (source.kind !== 'remote') return
    expect(source.source.kind).toBe('s3')
  })

  test('with nothing staged, reads the provider in use', () => {
    const vault = VaultStateTestFixture.create()

    expect(recoveryProviderSource(vault)).toEqual({ kind: 'currentProvider' })
  })
})
