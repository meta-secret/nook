import { describe, expect, test } from 'vitest'
import {
  begin_provider_draft,
  type EnrollmentCredentialChoice,
  type S3Connection,
} from '$app-wasm'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import {
  InviteChoiceShapeKind,
  InviteProviderChoices,
} from '../../../../nook-web-shared/src/vault-app/lib/vault/invite-provider-choice'
import {
  InviteKeyKind,
  InviteKeyNeed,
  InviteKeyRequestKind,
  InviteKeyRequests,
  type InviteKeyAsk,
  type InviteKeyRequest,
} from '../../../../nook-web-shared/src/vault-app/lib/vault/invite-join-keys'
import { ProviderSetupKinds } from '../../../../nook-web-shared/src/vault-app/lib/vault/provider-setup-kinds'
import { ProviderRowFixture } from '../provider-fixtures'
import { S3ConnectionFixture } from '../s3-connection-fixture'

describe('invite key choices', () => {
  test('an S3 row offers this device key first, then each spare, then none', () => {
    const connection: S3Connection = {
      ...S3ConnectionFixture.configuration(),
      spareKeys: [
        { accessKeyId: 'device-b', secretAccessKey: 'TEST-ONLY-device-b' },
      ],
    }
    const options = InviteProviderChoices.s3Options(connection)
    expect(options.map((option) => option.labelKey)).toEqual([
      I18N_KEYS.OnboardDeviceInviteKeyMine,
      I18N_KEYS.OnboardDeviceInviteKeySpare,
      I18N_KEYS.OnboardDeviceInviteKeyJoiner,
    ])
    const spare: EnrollmentCredentialChoice = {
      kind: 'savedKey',
      accessKeyId: 'device-b',
    }
    expect(options.map((option) => option.choice)).toEqual([
      InviteProviderChoices.INVITER,
      spare,
      { kind: 'joinerProvides' },
    ])
    // Each choice selects the option it came from.
    for (const option of options)
      expect(InviteProviderChoices.valueOf(option.choice)).toBe(option.value)
    // No option carries a secret.
    expect(JSON.stringify(options)).not.toContain('TEST-ONLY')
  })

  test('GitHub offers its token or none; shared providers name an account', () => {
    expect(
      InviteProviderChoices.githubOptions().map((option) => option.labelKey),
    ).toEqual([
      I18N_KEYS.OnboardDeviceInviteTokenMine,
      I18N_KEYS.OnboardDeviceInviteTokenJoiner,
    ])
    const row = ProviderRowFixture.unscoped('row')
    expect(
      InviteProviderChoices.shapeOf(ProviderRowFixture.github(row)).kind,
    ).toBe(InviteChoiceShapeKind.GithubToken)
    expect(
      InviteProviderChoices.shapeOf(ProviderRowFixture.googleDrive(row)).kind,
    ).toBe(InviteChoiceShapeKind.SharedAccount)
    expect(InviteProviderChoices.shapeOf(ProviderRowFixture.s3(row)).kind).toBe(
      InviteChoiceShapeKind.S3Key,
    )
  })
})

describe('join key requests', () => {
  test('the join screen asks once per code, with one blank entry per provider', () => {
    const asked: InviteKeyRequest = {
      kind: InviteKeyRequestKind.Asked,
      code: 'code-1',
      need: InviteKeyNeed.AtLeastOne,
      providers: [
        {
          index: 0,
          kind: InviteKeyKind.S3,
          label: 'S3 · nook-dev',
          draft: begin_provider_draft(ProviderSetupKinds.S3),
        },
        {
          index: 2,
          kind: InviteKeyKind.Github,
          label: 'GitHub · team-vault',
          draft: begin_provider_draft(ProviderSetupKinds.GITHUB),
        },
      ],
    }
    const sameCode: InviteKeyAsk = { request: asked, code: 'code-1' }
    const otherCode: InviteKeyAsk = { request: asked, code: 'code-2' }
    const never: InviteKeyAsk = {
      request: InviteKeyRequests.NONE,
      code: 'code-1',
    }
    expect(InviteKeyRequests.asked(sameCode)).toBe(true)
    expect(InviteKeyRequests.asked(otherCode)).toBe(false)
    expect(InviteKeyRequests.asked(never)).toBe(false)
    const entries = InviteKeyRequests.blankEntries(asked)
    expect(entries.map((entry) => [entry.kind, entry.index])).toEqual([
      [InviteKeyKind.S3, 0],
      [InviteKeyKind.Github, 2],
    ])
    expect(entries.some((entry) => InviteKeyRequests.typed(entry))).toBe(false)
    const [s3] = entries
    if (!s3) throw new Error('an S3 entry')
    switch (s3.kind) {
      case InviteKeyKind.S3:
        s3.accessKeyId = 'device-b'
        break
      case InviteKeyKind.Github:
        throw new Error('the first entry is S3')
    }
    expect(InviteKeyRequests.typed(s3)).toBe(true)
  })
})
