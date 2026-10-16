import { chromium, expect, test } from '@playwright/test'
import {
  EXTENSION_UNLOCK_TIMEOUT_MS,
  extensionDir,
  getServiceWorker,
  installMockPasskeyRuntime,
  isHostedSmoke,
  readExtensionStorage,
  setupPasskeyExtensionPopup,
  simpleVaultBaseUrl,
  waitForNewPage,
} from './helpers/extension-smoke-runtime'
import { belongs_to_simple_vault } from '../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  authorizeDeviceProtection,
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
// nowhere for it: its identity join cannot reach the provider, and that
// failure must reach the person instead of passing for a connection.
test('an identity join that cannot reach the provider is reported, and the approved vault stays paired', async ({
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')
  test.skip(isHostedSmoke, 'Hosted smoke has no GitHub stub')
  testInfo.setTimeout(240_000)

  const context = await chromium.launchPersistentContext(
    testInfo.outputPath('chromium-profile-identity-membership'),
    {
      headless: false,
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

    // An identity replicated through a GitHub repo, so the extension is
    // invited into it.
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
    await expect(
      connectPage.locator('[data-extension-pairing-rejection-reason]'),
    ).toHaveAttribute(
      'data-extension-pairing-rejection-reason',
      'identity-join-failed',
      { timeout: 90_000 },
    )

    // The vault the person approved from was paired before the join.
    await expect
      .poll(
        async () =>
          Object.keys(await readExtensionStorage(context))
            .filter((key) => key.startsWith(PAIRING_GRANT_PREFIX))
            .map((key) => key.slice(PAIRING_GRANT_PREFIX.length)),
        { timeout: EXTENSION_UNLOCK_TIMEOUT_MS },
      )
      .toEqual([storeId])
  } finally {
    await context.close()
  }
})
