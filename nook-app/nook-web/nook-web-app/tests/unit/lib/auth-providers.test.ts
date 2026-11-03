import { describe, expect, test } from 'vitest'
import {
  localizedProviderStorageDetail,
  type StorageProvider,
} from '$lib/auth/providers'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import {
  ProviderFixtureCredentials,
  ProviderRowFixture,
} from '../provider-fixtures'

/** The detail line Rust writes for a row, with the keys as the words. */
function detail(provider: StorageProvider): string {
  return localizedProviderStorageDetail({ provider, t: (key) => key })
}

describe('localizedProviderStorageDetail', () => {
  test('names the repository and never the full GitHub token', () => {
    const github = ProviderRowFixture.github(ProviderRowFixture.unscoped('gh'))
    const line = detail(github)
    expect(line).toContain('nook')
    expect(line).not.toContain(ProviderFixtureCredentials.GITHUB_TOKEN)
  })

  test('describes local browser storage with the host words', () => {
    const local = ProviderRowFixture.local(ProviderRowFixture.unscoped('l'))
    expect(detail(local)).toBe(I18N_KEYS.ProviderPickerThisDeviceDesc)
  })

  test('names the Google account a Drive provider syncs with', () => {
    const drive = ProviderRowFixture.googleDrive(
      ProviderRowFixture.unscoped('gd'),
    )
    expect(detail(drive)).toBe(ProviderFixtureCredentials.ACCOUNT)
  })
})
