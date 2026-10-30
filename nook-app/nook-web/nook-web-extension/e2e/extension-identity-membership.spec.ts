import { chromium, expect, test } from '@playwright/test'
import { approveExtensionConnect } from './helpers/extension-approval'
import {
  EXTENSION_UNLOCK_TIMEOUT_MS,
  extensionDir,
  getServiceWorker,
  installMockPasskeyRuntime,
  isHostedSmoke,
  readExtensionStorage,
  setupPasskeyExtensionPopup,
  simpleVaultBaseUrl,
  reuseNookTabForConnect,
} from './helpers/extension-smoke-runtime'
import {
  connectGithubSyncProviderFromSettings,
  createLocalE2eGithubVaultStub,
  createLocalVaultOnLogin,
  readLocalVaultYamlFromIdb,
} from '../../nook-web-app/e2e/helpers'

const GITHUB_REPO = 'nook-extension-identity'
const GITHUB_PAT = 'ghp_test_token'
const PAIRING_GRANT_PREFIX = 'nook:extension-pairing-grant:'
const chromiumExecutablePath = ((v) => (v ? v : ''))(
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim(),
)

function storeIdOf(yaml: string): string {
  const storeId = yaml.match(/^store_id:\s*(\S+)/mu)?.[1]
  if (!storeId) {
    throw new Error('store_id missing from vault yaml')
  }
  return storeId
}

// The vault page reaches GitHub through Playwright's stub. The extension's
// offscreen session is outside Playwright's routing, so GitHub resolves
// nowhere for it. The extension still joins the keyring: the web app adds it
// by its own key and hands it the keyring's log, so no provider is needed.
test('the extension joins the keyring from the approval without reaching its provider', async ({
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')
  test.skip(isHostedSmoke, 'Hosted smoke has no GitHub stub')
  testInfo.setTimeout(240_000)

  const context = await chromium.launchPersistentContext(
    testInfo.outputPath('chromium-profile-identity-membership'),
    {
      channel: 'chromium',
      headless: true,
      ...(chromiumExecutablePath
        ? { executablePath: chromiumExecutablePath }
        : {}),
      args: [
        `--disable-extensions-except=${extensionDir}`,
        `--load-extension=${extensionDir}`,
        '--host-resolver-rules=MAP api.github.com ~NOTFOUND',
      ],
    },
  )
  await context.addInitScript(installMockPasskeyRuntime)
  const github = createLocalE2eGithubVaultStub()

  try {
    const popupPage = await setupPasskeyExtensionPopup(context)

    // A keyring replicated through a GitHub repo the extension cannot reach.
    const vaultPage = await context.newPage()
    await github.install(vaultPage, { repoName: GITHUB_REPO })
    await vaultPage.goto(simpleVaultBaseUrl)
    await createLocalVaultOnLogin(
      vaultPage,
      'Personal vault',
      'authenticated-shell',
    )
    const storeId = storeIdOf(await readLocalVaultYamlFromIdb(vaultPage))
    await connectGithubSyncProviderFromSettings(
      vaultPage,
      GITHUB_REPO,
      GITHUB_PAT,
    )

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
    // The auth tab shares the vault tab's window, so Connect reuses that
    // Nook tab on the connect route instead of opening another.
    const connectPage = await reuseNookTabForConnect({
      context,
      nookPage: vaultPage,
      connect: () => pairPopup.getByTestId('connect-simple-vault-btn').click(),
    })
    const consent = connectPage.getByTestId('extension-connect-consent')
    // The request unlocks the keyring, not a vault; the consent follows in
    // place with no vault opened.
    const unlockKeyring = connectPage.getByTestId('extension-request-unlock')
    await expect(consent.or(unlockKeyring)).toBeVisible({
      timeout: EXTENSION_UNLOCK_TIMEOUT_MS,
    })
    if (await unlockKeyring.isVisible()) await unlockKeyring.click()
    await expect(consent).toBeVisible({ timeout: EXTENSION_UNLOCK_TIMEOUT_MS })
    // The extension joins the keyring, never one vault alone.
    await expect(
      consent.getByTestId('extension-connect-diagram-keyring'),
    ).toBeVisible()

    await approveExtensionConnect(connectPage)

    // The approved vault is paired, and the keyring join did not fail.
    await expect
      .poll(
        async () =>
          Object.keys(await readExtensionStorage(context))
            .filter((key) => key.startsWith(PAIRING_GRANT_PREFIX))
            .map((key) => key.slice(PAIRING_GRANT_PREFIX.length)),
        { timeout: EXTENSION_UNLOCK_TIMEOUT_MS },
      )
      .toEqual([storeId])
    await expect(
      connectPage.locator('[data-extension-pairing-rejection-reason]'),
    ).toHaveCount(0)
  } finally {
    await context.close()
  }
})
