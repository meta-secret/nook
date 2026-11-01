import { describe, expect, test } from 'vitest'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import { configuredS3, S3_PROVIDER_TYPE } from '$lib/auth/providers'
import {
  InviteS3Connection,
  type InviteS3Provider,
} from '$lib/vault/invite-s3-connection'
import { LoginSetupKind, S3DraftKind } from '$lib/vault/state/provider.svelte'
import { S3ConnectionFixture } from '../s3-connection-fixture'
import { VaultStateTestFixture } from '../vault-state-test-fixture'

/** An invite provider whose S3 block Rust refused to project. */
class RejectedInviteProvider implements InviteS3Provider {
  get s3Configuration(): InviteS3Provider['s3Configuration'] {
    throw new Error(I18N_KEYS.ErrorsValidationS3EndpointInsecure)
  }
}

describe('joining through an invite that carries an S3 connection', () => {
  test('stages the inviter’s connection and connects through it', () => {
    const vault = VaultStateTestFixture.create()
    const provider: InviteS3Provider = {
      s3Configuration: configuredS3(S3ConnectionFixture.configuration()),
    }

    const staged = new InviteS3Connection(vault).stage(provider)

    expect(staged.isOk()).toBe(true)
    if (staged.isErr()) return
    expect(staged.value).toEqual({
      mode: 's3',
      connection: S3ConnectionFixture.configuration(),
    })
    // The save after the join keeps this S3 setup.
    expect(vault.storageMode).toBe(S3_PROVIDER_TYPE)
    expect(vault.loginSetup).toEqual({
      kind: LoginSetupKind.Active,
      providerType: S3_PROVIDER_TYPE,
    })
    expect(vault.s3Draft).toEqual({
      kind: S3DraftKind.Configured,
      config: S3ConnectionFixture.configuration(),
    })
  })

  test('a connection Rust rejects joins nothing and stages nothing', () => {
    const vault = VaultStateTestFixture.create()

    const staged = new InviteS3Connection(vault).stage(
      new RejectedInviteProvider(),
    )

    expect(staged.isErr()).toBe(true)
    expect(vault.loginSetup.kind).toBe(LoginSetupKind.Inactive)
    expect(vault.s3Draft.kind).toBe(S3DraftKind.NotConfigured)
  })
})
