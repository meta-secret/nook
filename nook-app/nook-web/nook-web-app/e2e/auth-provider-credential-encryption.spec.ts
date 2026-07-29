import { expect, test } from './fixtures'
import {
  appendAuthProviders,
  clearBrowserVault,
  connectLocalVault,
  disableVaultIdleLock,
  expectSealedCredential,
  flushNookLogPersistQueue,
  fetchAppLogs,
  loadDecryptedAuthProvidersInBrowser,
  readRawAuthProvidersFromIdb,
  saveAuthProvidersInBrowser,
  UI_TIMEOUT_MS,
  waitForAuthProvidersE2eHook,
  waitForStorageChainIdle,
  waitForVaultSyncIdle,
} from './helpers'

test.describe('sync provider credential encryption', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/app/')
    await clearBrowserVault(page)
    await page.reload()
    await expect(page.getByTestId('login-gate')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
  })

  test('saveAuthProviders seals credentials in IndexedDB and load decrypts them', async ({
    page,
  }) => {
    const pat = 'github_pat_11E2EsaveSEALtoken'
    await saveAuthProvidersInBrowser(page, {
      providers: [
        {
          id: 'gh-e2e-save',
          type: 'github',
          label: 'GitHub',
          githubPat: pat,
          githubRepo: 'nook',
          createdAt: new Date().toISOString(),
        },
      ],
    })

    const raw = await readRawAuthProvidersFromIdb(page)
    expectSealedCredential(raw.providers[0]?.githubPat, pat)

    const decrypted = await loadDecryptedAuthProvidersInBrowser(page)
    expect(decrypted.providers[0]?.githubPat).toBe(pat)
  })

  test('replacement conflict refresh avoids recursive wasm closure use', async ({
    page,
  }) => {
    await connectLocalVault(page)
    await disableVaultIdleLock(page)
    await page.evaluate(async () => {
      const vault = (
        window as Window & {
          __nookVault?: { refreshReplacementConflicts?: () => Promise<void> }
        }
      ).__nookVault
      if (!vault?.refreshReplacementConflicts) {
        throw new Error('E2E vault conflict-refresh hook is unavailable')
      }
      await vault.refreshReplacementConflicts()
    })
    await waitForStorageChainIdle(page)
    await waitForVaultSyncIdle(page)
    await flushNookLogPersistQueue(page)
    const logs = await fetchAppLogs(page, { minLevel: 'warn', limit: 500 })
    expect(
      logs.entries.some(
        (entry) =>
          entry.message.includes(
            'closure invoked recursively or after being dropped',
          ) ||
          entry.data?.includes(
            'closure invoked recursively or after being dropped',
          ),
      ),
    ).toBe(false)
  })

  test('load rejects legacy plaintext IndexedDB rows', async ({ page }) => {
    const pat = 'github_pat_22E2ElegacyUPGRADE'
    await waitForAuthProvidersE2eHook(page)
    await appendAuthProviders(page, [
      {
        id: 'gh-e2e-legacy',
        type: 'github',
        label: 'GitHub · legacy',
        githubRepo: 'nook-legacy',
        githubPat: pat,
      },
    ])

    await expect(loadDecryptedAuthProvidersInBrowser(page)).rejects.toThrow(
      'Provider credential is not age-encrypted.',
    )

    const raw = await readRawAuthProvidersFromIdb(page)
    expect(raw.providers.find((p) => p.id === 'gh-e2e-legacy')?.githubPat).toBe(
      pat,
    )
  })

  test('OAuth access and refresh tokens are sealed at rest', async ({
    page,
  }) => {
    const access = 'ya29.e2e-oauth-access-token'
    const refresh = '1//e2e-refresh-token-secret'
    await saveAuthProvidersInBrowser(page, {
      providers: [
        {
          id: 'gd-e2e-oauth',
          type: 'oauth-file',
          label: 'Google Drive',
          oauthFile: {
            accessToken: access,
            refreshToken: refresh,
            preset: 'google-drive',
            fileName: 'nook-events',
            driveMode: 'private',
            iCloudMode: 'private',
            accountEmail: 'me@example.com',
          },
          createdAt: new Date().toISOString(),
        },
      ],
    })

    const raw = await readRawAuthProvidersFromIdb(page)
    const oauth = raw.providers[0]?.oauthFile
    expectSealedCredential(oauth?.accessToken, access)
    expectSealedCredential(oauth?.refreshToken, refresh)

    const decrypted = await loadDecryptedAuthProvidersInBrowser(page)
    const decryptedOauth = decrypted.providers[0]?.oauthFile
    expect(decryptedOauth?.accessToken).toBe(access)
    expect(decryptedOauth?.refreshToken).toBe(refresh)
  })
})
