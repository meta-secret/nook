import { expect, test, type Page } from '@playwright/test'
import { LocalS3Identity } from '../scripts/local-s3'
import { MOCK_AUTH_DEFAULT_PIN } from '../e2e/mock-auth/accounts'
import { approveExtensionConnect } from '../e2e/helpers/extension-approval'
import { ensurePinProtectedPopup } from '../e2e/helpers/pin-device'
import {
  readExtensionStorage,
  reuseNookTabForConnect,
} from '../e2e/helpers/extension-smoke-runtime'
import {
  connectS3InFirstRun,
  createKeyringOnS3,
  openVaultPage,
  startFirstRun,
  uniqueS3KeyPrefix,
} from '../../nook-web-app/e2e/helpers'
import { firstPage, launchDevBrowser, reportLogs } from './dev-browser'

const KEYRING_NAME = 'S3 keyring'
const PAIRING_GRANT_PREFIX = 'nook:extension-pairing-grant:'

/** First run's key step without passkeys: the vault asks for a PIN. */
async function protectVaultWithPin(page: Page): Promise<void> {
  await expect(page.getByTestId('first-run-protect-step')).toBeVisible()
  const createChoice = page.getByTestId('device-protection-create-new-choice')
  if (await createChoice.isVisible()) await createChoice.click()
  await page.getByTestId('device-protection-setup-btn').click()
  await page
    .getByTestId('device-protection-pin-input')
    .fill(MOCK_AUTH_DEFAULT_PIN)
  await page
    .getByTestId('device-protection-pin-confirm')
    .fill(MOCK_AUTH_DEFAULT_PIN)
  await page.getByTestId('device-protection-pin-setup-btn').click()
  await expect(page.getByTestId('first-run-sync-step')).toBeVisible()
}

/** The connect route asks to unlock the keyring before its consent; a
 * PIN-protected keyring takes its PIN in the card's PIN field. */
async function showConsentWithPin(page: Page): Promise<void> {
  const consent = page.getByTestId('extension-connect-consent')
  const unlock = page.getByTestId('extension-request-unlock')
  const pinInput = page.getByTestId('card-pin-input')
  await expect(consent.or(unlock).or(pinInput).first()).toBeVisible()
  if (await unlock.isVisible()) await unlock.click()
  if (!(await consent.isVisible())) {
    await expect(consent.or(pinInput).first()).toBeVisible()
  }
  if (await pinInput.isVisible()) {
    await pinInput.fill(MOCK_AUTH_DEFAULT_PIN)
    await page.getByTestId('card-pin-submit').click()
  }
  await expect(consent).toBeVisible()
}

/** Save one login in the open vault, for the extension to offer. */
async function saveLogin(page: Page): Promise<void> {
  await page.getByTestId('add-secret-btn').click()
  await page.getByTestId('item-type-login').click()
  await page.getByTestId('secret-label').fill('https://example.com')
  await page.getByTestId('login-username').fill('scenario-user')
  await page.getByTestId('secret-value').fill('scenario-password-not-real')
  await page.getByTestId('save-secret-btn').click()
  await expect(
    page.getByTestId('vault-group-login').getByTestId('secret-row').last(),
  ).toBeVisible()
}

// A web vault keyring on the local S3 server, protected by a PIN, with one
// vault and a login, and the extension (also PIN-protected) paired with it.
test('S3 keyring with a PIN, a login, and the extension paired', async () => {
  const testInfo = test.info()
  const browser = await launchDevBrowser()
  try {
    // The extension's own key first: a PIN, as without passkeys.
    const setup = await browser.context.newPage()
    await setup.goto(browser.popupUrl)
    await ensurePinProtectedPopup(setup, MOCK_AUTH_DEFAULT_PIN)
    await setup.close()

    // The web vault: a PIN key, S3 as its sync provider, a keyring there
    // with its first vault, and a login in that vault.
    const vault = await firstPage(browser)
    await vault.goto('/app/')
    await startFirstRun(vault)
    await protectVaultWithPin(vault)
    await connectS3InFirstRun(vault, {
      keyPrefix: uniqueS3KeyPrefix('scenario'),
      identity: LocalS3Identity.DeviceA,
    })
    await createKeyringOnS3(vault, KEYRING_NAME)
    await openVaultPage(vault)
    await saveLogin(vault)

    // Pair: the popup's connect request opens in the vault tab, whose
    // keyring approves the extension.
    const pair = await browser.context.newPage()
    await pair.goto(`${browser.popupUrl}?intent=pair`)
    const connectButton = pair.getByTestId('connect-simple-vault-btn')
    await expect(connectButton).toBeVisible()
    const connectPage = await reuseNookTabForConnect({
      context: browser.context,
      nookPage: vault,
      connect: () => connectButton.click(),
    })
    await showConsentWithPin(connectPage)
    await approveExtensionConnect(connectPage)
    await expect
      .poll(async () =>
        Object.keys(await readExtensionStorage(browser.context)).some((key) =>
          key.startsWith(PAIRING_GRANT_PREFIX),
        ),
      )
      .toBe(true)
    await pair.close()
  } catch (failure) {
    await reportLogs(browser, (name) => testInfo.outputPath(name))
    throw failure
  } finally {
    await browser.context.close()
  }
})
