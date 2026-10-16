import { expect, test } from '@playwright/test'
import {
  EXTENSION_UNLOCK_TIMEOUT_MS,
  getServiceWorker,
  installMockPasskeyRuntime,
  isHostedSmoke,
  launchExtensionContext,
  readExtensionStorage,
  setupPasskeyExtensionPopup,
  setupStorageKey,
  simpleVaultBaseUrl,
  waitForExtensionPairingReady,
  waitForNewPage,
} from './helpers/extension-smoke-runtime'
import { belongs_to_simple_vault } from '../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  authorizeDeviceProtection,
  connectGithubSyncProviderFromSettings,
  createLocalE2eGithubVaultStub,
  createLocalVaultOnLogin,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  openIdentitiesPage,
  readLocalVaultYamlFromIdb,
  waitForLoadedSyncProviders,
} from '../../nook-web-app/e2e/helpers'

const GITHUB_REPO = 'nook-extension-identity'
const GITHUB_PAT = 'ghp_test_token'
const PAIRING_GRANT_PREFIX = 'nook:extension-pairing-grant:'

function storeIdOf(yaml: string): string {
  const storeId = yaml.match(/^store_id:\s*(\S+)/mu)?.[1]
  if (!storeId) {
    throw new Error('store_id missing from vault yaml')
  }
  return storeId
}

test('connecting the extension to an identity pairs every vault in it', async ({
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')
  test.skip(isHostedSmoke, 'Hosted smoke has no GitHub stub')
  testInfo.setTimeout(240_000)

  const context = await launchExtensionContext(
    testInfo.outputPath('chromium-profile-identity-membership'),
  )
  await context.addInitScript(installMockPasskeyRuntime)
  const github = createLocalE2eGithubVaultStub()

  try {
    const popupPage = await setupPasskeyExtensionPopup(context)

    // An identity with two vaults, both replicated through one GitHub repo.
    const vaultPage = await context.newPage()
    // The stub routes the whole context, so the extension's offscreen
    // session reaches the same repo.
    await github.install(vaultPage, { repoName: GITHUB_REPO })
    await vaultPage.goto(simpleVaultBaseUrl)
    await createLocalVaultOnLogin(
      vaultPage,
      'Personal vault',
      'authenticated-shell',
    )
    const personalStoreId = storeIdOf(
      await readLocalVaultYamlFromIdb(vaultPage),
    )
    await connectGithubSyncProviderFromSettings(
      vaultPage,
      GITHUB_REPO,
      GITHUB_PAT,
    )
    await openIdentitiesPage(vaultPage)
    await vaultPage.getByTestId('identity-new-vault').click()
    await vaultPage.getByTestId('login-vault-name-input').fill('Work vault')
    await vaultPage.getByTestId('login-create-additional-vault-btn').click()
    await expect
      .poll(async () => storeIdOf(await readLocalVaultYamlFromIdb(vaultPage)), {
        timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
      })
      .not.toBe(personalStoreId)
    const workStoreId = storeIdOf(await readLocalVaultYamlFromIdb(vaultPage))
    // The provider mounts the identity: a sync gives the new vault its own
    // folder in the repo.
    await waitForLoadedSyncProviders(vaultPage)
    await vaultPage.evaluate(async () => {
      await window.__nookVault?.runFanOutSyncAfterLocalSave?.()
    })
    await expect
      .poll(
        () =>
          github
            .getEventFilePaths()
            .some((path) => path.includes(`/vaults/${workStoreId}/`)),
        { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
      )
      .toBe(true)

    // Connect the extension once, from the open vault.
    const worker = await getServiceWorker(context)
    const extensionId = new URL(worker.url()).host
    await popupPage.close()
    const pairPopup = await context.newPage()
    await pairPopup.goto(
      `chrome-extension://${extensionId}/popup/index.html?intent=pair`,
    )
    await expect(pairPopup.getByTestId('connect-simple-vault-btn')).toBeVisible(
      { timeout: EXTENSION_UNLOCK_TIMEOUT_MS },
    )
    const [connectPage] = await Promise.all([
      waitForNewPage(context, 'identity connection page'),
      pairPopup.getByTestId('connect-simple-vault-btn').click(),
    ])
    await expect(connectPage).toHaveURL((url) =>
      belongs_to_simple_vault(simpleVaultBaseUrl, url.toString()),
    )
    const consent = connectPage.getByTestId('extension-connect-consent')
    const unlockStep = connectPage.getByTestId('identity-vault-row').first()
    await expect(consent.or(unlockStep)).toBeVisible({
      timeout: EXTENSION_UNLOCK_TIMEOUT_MS,
    })
    if (await unlockStep.isVisible()) {
      await authorizeDeviceProtection(connectPage)
    }
    await expect(consent).toBeVisible({ timeout: EXTENSION_UNLOCK_TIMEOUT_MS })
    // The identity has a cloud provider, so the consent covers all of it.
    await expect(consent).toContainText('every vault in')

    await connectPage.getByTestId('approve-extension-device-btn').click()
    // Joining the identity and opening its other vault take longer than a
    // single-vault approval; wait for the outcome before reading it.
    await expect(
      connectPage
        .getByTestId('extension-connect-approved')
        .or(connectPage.locator('[data-extension-pairing-rejection-reason]')),
    ).toBeVisible({ timeout: 90_000 })
    await waitForExtensionPairingReady(
      connectPage,
      async () => {
        const storage = await readExtensionStorage(context)
        return storage[setupStorageKey]
      },
      'Work vault',
    )
    await expect(
      connectPage.getByTestId('extension-connect-approved'),
    ).toBeVisible({ timeout: EXTENSION_UNLOCK_TIMEOUT_MS })
    await expect(
      connectPage.locator('[data-extension-pairing-rejection-reason]'),
    ).toHaveCount(0)

    // The extension joined the identity: both vaults are paired, not only
    // the one the consent was shown from.
    await expect
      .poll(
        async () =>
          Object.keys(await readExtensionStorage(context))
            .filter((key) => key.startsWith(PAIRING_GRANT_PREFIX))
            .map((key) => key.slice(PAIRING_GRANT_PREFIX.length))
            .sort(),
        { timeout: EXTENSION_UNLOCK_TIMEOUT_MS },
      )
      .toEqual([personalStoreId, workStoreId].sort())
  } finally {
    await context.close()
  }
})
