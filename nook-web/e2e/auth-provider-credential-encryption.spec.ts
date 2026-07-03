import { expect, test } from './fixtures'
import {
  clearBrowserVault,
  connectLocalVault,
  disableVaultIdleLock,
  expectSealedCredential,
  loadDecryptedAuthProvidersInBrowser,
  readRawAuthProvidersFromIdb,
  saveAuthProvidersInBrowser,
  seedExtraGithubProviders,
  UI_TIMEOUT_MS,
  waitForAuthProvidersE2eHook,
} from './helpers'

test.describe('sync provider credential encryption', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
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

  test('load upgrades legacy plaintext IndexedDB rows to sealed storage', async ({
    page,
  }) => {
    await page.goto('/')
    await clearBrowserVault(page)
    await page.reload()
    await connectLocalVault(page)
    await disableVaultIdleLock(page)

    const pat = 'github_pat_22E2ElegacyUPGRADE'
    await seedExtraGithubProviders(page, [
      {
        id: 'gh-e2e-legacy',
        label: 'GitHub · legacy',
        githubRepo: 'nook-legacy',
        githubPat: pat,
      },
    ])

    await page.reload()
    await expect(page.getByTestId('login-local-vault-detected')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await page.getByTestId('unlock-vault-btn').click()
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await waitForAuthProvidersE2eHook(page)

    const raw = await readRawAuthProvidersFromIdb(page)
    expectSealedCredential(
      raw.providers.find((p) => p.id === 'gh-e2e-legacy')?.githubPat,
      pat,
    )

    const decrypted = await loadDecryptedAuthProvidersInBrowser(page)
    expect(
      decrypted.providers.find((p) => p.id === 'gh-e2e-legacy')?.githubPat,
    ).toBe(pat)
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
            fileName: 'nook-vault.yaml',
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
