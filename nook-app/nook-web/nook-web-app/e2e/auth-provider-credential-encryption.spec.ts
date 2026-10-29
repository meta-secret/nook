import { expect, test } from './fixtures'
import {
  clearBrowserVault,
  connectLocalVault,
  disableVaultIdleLock,
  e2eDriveFolderId,
  expectSealedCredential,
  flushNookLogPersistQueue,
  fetchAppLogs,
  AuthProviderBrowserFixture,
  readRawAuthProvidersFromIdb,
  saveAuthProvidersInBrowser,
  storePlaintextGithubPat,
  unselectedAuthProviderSeedScope,
  waitForAuthProvidersE2eHook,
  waitForStorageChainIdle,
  waitForVaultSyncIdle,
  expectLoginGateAfterLoad,
  createFirstRunKey,
} from './helpers'
import { AUTH_PROVIDER_HOOK_READ_FAILED } from './helpers/auth-providers'

test.describe('sync provider credential encryption', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/app/')
    await clearBrowserVault(page)
    await page.reload()
    await expectLoginGateAfterLoad(page)
  })

  test('saveAuthProviders seals credentials in IndexedDB and load decrypts them', async ({
    page,
  }) => {
    // Credentials are sealed with this browser's key, made in first run.
    await createFirstRunKey(page)
    const pat = 'github_pat_11E2EsaveSEALtoken'
    await saveAuthProvidersInBrowser(
      page,
      {
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
      },
      unselectedAuthProviderSeedScope(),
    )

    const raw = await readRawAuthProvidersFromIdb(page)
    expectSealedCredential(raw.providers[0]?.githubPat, pat, 'token')

    const decrypted = await new AuthProviderBrowserFixture(page).load()
    expect(decrypted.isOk()).toBe(true)
    if (decrypted.isOk())
      expect(decrypted.value.providers[0]?.githubPat).toEqual({
        state: 'token',
        value: pat,
      })
  })

  test('replacement conflict refresh avoids recursive wasm closure use', async ({
    page,
  }) => {
    await connectLocalVault(page)
    await disableVaultIdleLock(page)
    await page.evaluate(async () => {
      const vault = window.__nookVault
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

  test('load rejects a plaintext credential at rest', async ({ page }) => {
    // Credentials are sealed with this browser's key, made in first run.
    await createFirstRunKey(page)
    const pat = 'github_pat_22E2EplainTEXT'
    await waitForAuthProvidersE2eHook(page)
    await saveAuthProvidersInBrowser(
      page,
      {
        providers: [
          {
            id: 'gh-e2e-plain',
            type: 'github',
            label: 'GitHub',
            githubPat: 'github_pat_sealed_first',
            githubRepo: 'nook',
            createdAt: new Date().toISOString(),
          },
        ],
      },
      unselectedAuthProviderSeedScope(),
    )
    await storePlaintextGithubPat(page, 'gh-e2e-plain', pat)

    const admission = await new AuthProviderBrowserFixture(page).load()
    expect(admission.isErr()).toBe(true)
    if (admission.isErr())
      expect(admission.error).toBe(AUTH_PROVIDER_HOOK_READ_FAILED)

    const raw = await readRawAuthProvidersFromIdb(page)
    expect(
      raw.providers.find((p) => p.id === 'gh-e2e-plain')?.githubPat,
    ).toEqual({ state: 'token', value: pat })
  })

  test('OAuth access and refresh tokens are sealed at rest', async ({
    page,
  }) => {
    // Credentials are sealed with this browser's key, made in first run.
    await createFirstRunKey(page)
    const access = 'ya29.e2e-oauth-access-token'
    const refresh = '1//e2e-refresh-token-secret'
    await saveAuthProvidersInBrowser(
      page,
      {
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
              folderId: e2eDriveFolderId('nook-events'),
              accountEmail: 'me@example.com',
            },
            createdAt: new Date().toISOString(),
          },
        ],
      },
      unselectedAuthProviderSeedScope(),
    )

    const raw = await readRawAuthProvidersFromIdb(page)
    const oauth = raw.providers[0]?.oauthFile
    expectSealedCredential(oauth?.accessToken, access, 'accessToken')
    expectSealedCredential(oauth?.refreshToken, refresh, 'token')

    const decrypted = await new AuthProviderBrowserFixture(page).load()
    expect(decrypted.isOk()).toBe(true)
    if (decrypted.isOk())
      expect(decrypted.value.providers[0]?.oauthFile).toEqual(
        expect.objectContaining({
          state: 'configured',
          config: expect.objectContaining({
            accessToken: { state: 'accessToken', value: access },
            refreshToken: { state: 'token', value: refresh },
          }),
        }),
      )
  })
})
