import { expect, test, type Page } from '@playwright/test'
import { MOCK_AUTH_DEFAULT_PIN } from '../e2e/mock-auth/accounts'
import { approveExtensionConnect } from '../e2e/helpers/extension-approval'
import { ensurePinProtectedPopup } from '../e2e/helpers/pin-device'
import {
  readExtensionStorage,
  reuseNookTabForConnect,
} from '../e2e/helpers/extension-smoke-runtime'
import { startFirstRun } from '../../nook-web-app/e2e/helpers'
import {
  firstPage,
  launchDevBrowser,
  reportLogs,
  type DevBrowser,
} from './dev-browser'

const PAIRING_GRANT_PREFIX = 'nook:extension-pairing-grant:'

/** One scenario's steps, run in its own Brave window. */
type ScenarioSteps = (browser: DevBrowser) => Promise<void>

/** Run a scenario's steps in a new Brave window. A failure writes the
 * console and app logs before it stops the scenario; the window always
 * closes, so the task can reopen its profile for a person. */
export async function runScenario(steps: ScenarioSteps): Promise<void> {
  const testInfo = test.info()
  const browser = await launchDevBrowser()
  try {
    await steps(browser)
  } catch (failure) {
    await reportLogs(browser, (name) => testInfo.outputPath(name))
    throw failure
  } finally {
    await browser.context.close()
  }
}

/** The extension's own key: a PIN, as without passkeys. */
export async function protectExtensionWithPin(
  browser: DevBrowser,
): Promise<void> {
  const setup = await browser.context.newPage()
  await setup.goto(browser.popupUrl)
  await ensurePinProtectedPopup(setup, MOCK_AUTH_DEFAULT_PIN)
  await setup.close()
}

/** Open the web vault in the first tab and start first run with a PIN key,
 * up to its sync provider step. */
export async function startVaultWithPin(browser: DevBrowser): Promise<Page> {
  const vault = await firstPage(browser)
  await vault.goto('/app/')
  await startFirstRun(vault)
  await expect(vault.getByTestId('first-run-protect-step')).toBeVisible()
  const createChoice = vault.getByTestId('device-protection-create-new-choice')
  if (await createChoice.isVisible()) await createChoice.click()
  await vault.getByTestId('device-protection-setup-btn').click()
  await vault
    .getByTestId('device-protection-pin-input')
    .fill(MOCK_AUTH_DEFAULT_PIN)
  await vault
    .getByTestId('device-protection-pin-confirm')
    .fill(MOCK_AUTH_DEFAULT_PIN)
  await vault.getByTestId('device-protection-pin-setup-btn').click()
  await expect(vault.getByTestId('first-run-sync-step')).toBeVisible()
  return vault
}

/** Save one login in the open vault, for the extension to offer. */
export async function saveLogin(page: Page): Promise<void> {
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

/** Pair the extension: the popup's connect request opens in the vault tab,
 * whose keyring approves the extension, which then holds its grant. */
export async function pairExtension(
  browser: DevBrowser,
  vault: Page,
): Promise<void> {
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
}
