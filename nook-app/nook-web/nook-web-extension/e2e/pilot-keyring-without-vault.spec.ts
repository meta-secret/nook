import { expect, test } from '@playwright/test'
import {
  getServiceWorker,
  installMockPasskeyRuntime,
  launchExtensionContext,
  setupPasskeyExtensionPopup,
  simpleVaultBaseUrl,
  startLoginServer,
  waitForNewPage,
  writeExtensionStorage,
} from './helpers/extension-smoke-runtime'
import { belongs_to_simple_vault } from '../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import type { StoredExtensionKeyring } from '../src/background/pairing-grants'

/** The keyring the web app added this extension to before it had a vault. */
const joinedKeyring: StoredExtensionKeyring = {
  identityId: 'identity-e2e',
  identityLabel: 'Personal',
  deviceId: 'device-e2e',
  devicePublicKey: 'age1e2e',
  deviceSigningPublicKey: 'signing-e2e',
  deviceLabel: 'Nook Extension - Chromium test profile',
  approvedAt: 1_753_401_600_000,
  scopes: ['vault-access', 'password-filling'],
}

test('a connected keyring with no vault yet asks for a vault, never for a connection', async ({
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')

  const loginServer = await startLoginServer()
  const context = await launchExtensionContext(
    testInfo.outputPath('chromium-profile-keyring-without-vault'),
  )
  await context.addInitScript(installMockPasskeyRuntime)
  // The vault tab the widget opens needs no running vault app here.
  await context.route('**/*', (route) => {
    const request = route.request()
    if (
      request.resourceType() === 'document' &&
      belongs_to_simple_vault(simpleVaultBaseUrl, request.url())
    ) {
      return route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><body><h1>Simple Vault</h1></body></html>',
      })
    }
    return route.continue()
  })

  try {
    const popupPage = await setupPasskeyExtensionPopup(context)
    const worker = await getServiceWorker(context)
    const extensionId = new URL(worker.url()).host
    await writeExtensionStorage(popupPage, {
      [`nook:extension-keyring:${joinedKeyring.identityId}`]: joinedKeyring,
    })
    await popupPage.close()

    const loginPage = await context.newPage()
    await loginPage.goto(`${loginServer.origin}/login`)
    const widget = loginPage.locator('#nook-auth-widget')
    await expect(widget).toBeVisible()

    // The keyring is connected: the widget asks for a vault in it.
    await expect(
      widget.getByText('Create a vault to use Nook here'),
    ).toBeVisible()
    await expect(
      widget.getByText(
        'Your keyring is connected, but it has no vault yet. Create one in Nook to fill and save logins.',
      ),
    ).toBeVisible()
    const vaultStatus = widget.getByTestId('nook-auth-gate-vault-status')
    await expect(vaultStatus).toHaveText('No vault yet')
    await expect(vaultStatus).toHaveAttribute('data-state', 'no-vault')
    await expect(vaultStatus).toHaveAttribute('data-connected', 'true')

    // It never claims the connection is missing, and offers no sign-in.
    await expect(widget.getByText('Connect Nook to your vault')).toHaveCount(0)
    await expect(widget.getByText('Vault not connected')).toHaveCount(0)
    await expect(
      widget.getByRole('button', { name: 'Connect vault' }),
    ).toHaveCount(0)
    await expect(widget.getByRole('button', { name: 'Sign in' })).toHaveCount(0)
    await expect(widget.getByRole('button', { name: 'Not now' })).toBeVisible()

    // The one action opens the vault app, where the vault is created.
    const openVault = widget.getByRole('button', { name: 'Open vault' })
    await expect(openVault).toBeVisible()
    const [vaultPage] = await Promise.all([
      waitForNewPage(context, 'vault page opened from the widget'),
      openVault.click(),
    ])
    await expect(vaultPage).toHaveURL((url) =>
      belongs_to_simple_vault(simpleVaultBaseUrl, url.toString()),
    )
    await expect(
      widget.getByText(
        'Create a vault in the Nook tab, then come back to this page.',
      ),
    ).toBeVisible()
    // Opening the vault never starts a connect in the extension's own tab.
    expect(
      context
        .pages()
        .filter((page) =>
          page.url().startsWith(`chrome-extension://${extensionId}/`),
        ),
    ).toHaveLength(0)
  } finally {
    await context.close()
    await loginServer.close()
  }
})
