import { render } from '@testing-library/svelte'
import type { ComponentProps } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import type { StorageProvider } from '$lib/auth/providers'
import { VaultStateTestFixture } from '../vault-state-test-fixture'
import { ProviderRowFixture } from '../provider-fixtures'
import LoginProviderManagement from '../../../../nook-web-shared/src/vault-app/lib/components/login/LoginProviderManagement.svelte'

/** The icon class each saved row draws, in row order. */
function rowIcons(providers: StorageProvider[]): string[] {
  const props = {
    vault: VaultStateTestFixture.create(),
    providers,
    isVerifying: false,
    isInitializing: false,
    open: true,
    onBeginSetup: vi.fn(),
  } satisfies ComponentProps<typeof LoginProviderManagement>
  const view = render(LoginProviderManagement, props)
  const list = view.getByTestId('login-manage-providers-list')
  return [...list.querySelectorAll('li > svg')].map((icon) =>
    ['lucide-cloud', 'lucide-archive', 'lucide-hard-drive']
      .filter((name) => icon.classList.contains(name))
      .join(''),
  )
}

describe('login provider rows', () => {
  test('cloud providers draw a cloud, S3 an archive, a local folder a drive', () => {
    expect(
      rowIcons([
        ProviderRowFixture.github(ProviderRowFixture.unscoped('github')),
        ProviderRowFixture.googleDrive(ProviderRowFixture.unscoped('drive')),
        ProviderRowFixture.icloud(ProviderRowFixture.unscoped('icloud')),
        ProviderRowFixture.s3(ProviderRowFixture.unscoped('s3')),
        ProviderRowFixture.localFolder(ProviderRowFixture.unscoped('folder')),
      ]),
    ).toEqual([
      'lucide-cloud',
      'lucide-cloud',
      'lucide-cloud',
      'lucide-archive',
      'lucide-hard-drive',
    ])
  })
})
