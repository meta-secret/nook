import { expect, test } from './fixtures'
import {
  clearBrowserVault,
  connectLocalVault,
  disableVaultIdleLock,
  e2eAccount,
  e2eDriveFolderId,
  expectSealedCredential,
  flushNookLogPersistQueue,
  fetchAppLogs,
  AuthProviderBrowserFixture,
  RawCredentialKind,
  rawDriveAccessToken,
  rawGithubToken,
  readRawAuthProvidersFromIdb,
  saveAuthProvidersInBrowser,
  SeededProviderKind,
  storePlaintextGithubToken,
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
            kind: SeededProviderKind.Github,
            id: 'gh-e2e-save',
            label: 'GitHub',
            repository: 'nook',
            token: pat,
            scope: unselectedAuthProviderSeedScope(),
          },
        ],
      },
      unselectedAuthProviderSeedScope(),
    )

    const raw = await readRawAuthProvidersFromIdb(page)
    expectSealedCredential(rawGithubToken(raw, 'gh-e2e-save'), pat)

    const decrypted = await new AuthProviderBrowserFixture(page).load()
    expect(decrypted.isOk()).toBe(true)
    if (decrypted.isOk())
      expect(decrypted.value.providers.map((row) => row.provider)).toEqual([
        {
          type: 'github',
          repository: { state: 'repository', value: 'nook' },
          token: pat,
        },
      ])
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
            kind: SeededProviderKind.Github,
            id: 'gh-e2e-plain',
            label: 'GitHub',
            repository: 'nook',
            token: 'github_pat_sealed_first',
            scope: unselectedAuthProviderSeedScope(),
          },
        ],
      },
      unselectedAuthProviderSeedScope(),
    )
    await storePlaintextGithubToken(page, 'gh-e2e-plain', pat)

    const admission = await new AuthProviderBrowserFixture(page).load()
    expect(admission.isErr()).toBe(true)
    if (admission.isErr())
      expect(admission.error).toBe(AUTH_PROVIDER_HOOK_READ_FAILED)

    const raw = await readRawAuthProvidersFromIdb(page)
    expect(rawGithubToken(raw, 'gh-e2e-plain')).toEqual({
      kind: RawCredentialKind.Text,
      text: pat,
    })
  })

  test('OAuth access token is sealed at rest', async ({ page }) => {
    // Credentials are sealed with this browser's key, made in first run.
    await createFirstRunKey(page)
    const access = 'ya29.e2e-oauth-access-token'
    await saveAuthProvidersInBrowser(
      page,
      {
        providers: [
          {
            kind: SeededProviderKind.GoogleDrive,
            id: 'gd-e2e-oauth',
            label: 'Google Drive',
            accessToken: access,
            fileName: 'nook-events',
            account: e2eAccount('me@example.com'),
            scope: unselectedAuthProviderSeedScope(),
          },
        ],
      },
      unselectedAuthProviderSeedScope(),
    )

    const raw = await readRawAuthProvidersFromIdb(page)
    expectSealedCredential(rawDriveAccessToken(raw, 'gd-e2e-oauth'), access)

    const decrypted = await new AuthProviderBrowserFixture(page).load()
    expect(decrypted.isOk()).toBe(true)
    if (decrypted.isOk())
      expect(decrypted.value.providers.map((row) => row.provider)).toEqual([
        {
          type: 'oauth-file',
          preset: 'google-drive',
          authorization: {
            accessToken: access,
            expiresAt: expect.any(String),
          },
          account: { state: 'email', email: 'me@example.com' },
          folderId: e2eDriveFolderId('nook-events'),
        },
      ])
  })
})
