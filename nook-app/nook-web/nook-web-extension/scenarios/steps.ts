import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'
import { MOCK_AUTH_DEFAULT_PIN } from '../e2e/mock-auth/accounts'
import { approveExtensionConnect } from '../e2e/helpers/extension-approval'
import { ensurePinProtectedPopup } from '../e2e/helpers/pin-device'
import {
  readExtensionStorage,
  reuseNookTabForConnect,
} from '../e2e/helpers/extension-smoke-runtime'
import {
  openOnboardDevicePanel,
  openVaultAfterIdentityJoin,
  startFirstRun,
  submitOnboardEnrollmentCode,
} from '../../nook-web-app/e2e/helpers'
import {
  firstPage,
  launchDevBrowser,
  reportLogs,
  type DevBrowser,
} from './dev-browser'

const PAIRING_GRANT_PREFIX = 'nook:extension-pairing-grant:'

/**
 * The devices of one scenario: each is a Brave window on its own profile,
 * a folder named after the device under the task's scenario folder, so the
 * task reopens every device a scenario opened.
 */
export class ScenarioDevices {
  private readonly opened: DevBrowser[] = []

  constructor(private readonly root: string) {}

  /** Open the named device's Brave window. */
  async open(name: string): Promise<DevBrowser> {
    const browser = await launchDevBrowser(path.join(this.root, name))
    this.opened.push(browser)
    return browser
  }

  get browsers(): readonly DevBrowser[] {
    return this.opened
  }
}

/** One scenario's steps, run on the devices it opens. */
type ScenarioSteps = (devices: ScenarioDevices) => Promise<void>

/** Run a scenario's steps. A failure writes each device's console and app
 * logs before it stops the scenario; every window closes, so the task can
 * reopen their profiles for a person. */
export async function runScenario(steps: ScenarioSteps): Promise<void> {
  const testInfo = test.info()
  const root = process.env.NOOK_SCENARIO_ROOT
  if (!root) {
    throw new Error(
      'NOOK_SCENARIO_ROOT names the folder of the scenario profiles.',
    )
  }
  const devices = new ScenarioDevices(root)
  try {
    await steps(devices)
  } catch (failure) {
    for (const [index, browser] of devices.browsers.entries()) {
      await reportLogs(browser, (name) =>
        testInfo.outputPath(`device-${index + 1}-${name}`),
      )
    }
    throw failure
  } finally {
    for (const browser of devices.browsers) await browser.context.close()
  }
}

/** Protect this browser's key with the scenario PIN, at a device
 * protection prompt that is already showing. With passkeys unavailable the
 * prompt reaches its PIN form through its own steps: the existing-passkey
 * attempt finds none, the new-key choice, then setup. */
async function protectWithPin(page: Page): Promise<void> {
  const pinInput = page.getByTestId('device-protection-pin-input')
  const createChoice = page.getByTestId('device-protection-create-new-choice')
  const setup = page.getByTestId('device-protection-setup-btn')
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await expect(pinInput.or(createChoice).or(setup).first()).toBeVisible()
    if (await pinInput.isVisible()) break
    // Each step replaces its control; wait for that before the next one.
    const step = (await createChoice.isVisible()) ? createChoice : setup
    await step.click()
    await expect
      .poll(
        async () => (await pinInput.isVisible()) || !(await step.isVisible()),
      )
      .toBe(true)
  }
  await pinInput.fill(MOCK_AUTH_DEFAULT_PIN)
  await page
    .getByTestId('device-protection-pin-confirm')
    .fill(MOCK_AUTH_DEFAULT_PIN)
  await page.getByTestId('device-protection-pin-setup-btn').click()
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
  await protectWithPin(vault)
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

/** The one-time passphrase scenario invites carry; the joining device types
 * it, as a person would read it off the inviting screen. */
const SCENARIO_INVITE_PASSPHRASE = 'scenario invite passphrase'

/** Issue a one-time invite from the keyring open in `page`, with this
 * device's key for each provider, and return its link. */
export async function issueInvite(page: Page): Promise<string> {
  await openOnboardDevicePanel(page)
  await submitOnboardEnrollmentCode(page, SCENARIO_INVITE_PASSPHRASE)
  const link = await page.getByTestId('onboard-link').textContent()
  if (typeof link !== 'string' || !link.includes('#enroll=')) {
    throw new Error('The invite page showed no invite link.')
  }
  return link.trim()
}

/** Join the keyring from its invite on a browser that has no key yet: the
 * passphrase, then a PIN for this browser's own key, then the invited
 * vault opened with the login it holds. */
export async function joinWithInvite(page: Page, link: string): Promise<void> {
  await page.goto(link)
  await expect(page.getByTestId('join-this-device')).toBeVisible()
  await page
    .getByTestId('enrollment-password-input')
    .fill(SCENARIO_INVITE_PASSPHRASE)
  await page.getByTestId('submit-enrollment-code-btn').click()
  const joined = page
    .locator('[data-testid="identity-vault-row"][data-state="unavailable"]')
    .first()
  const prompt = page.getByTestId('device-protection-gate')
  await expect(joined.or(prompt).first()).toBeVisible()
  if (await prompt.isVisible()) await protectWithPin(page)
  await openVaultAfterIdentityJoin(page)
  await expect(
    page.getByTestId('vault-group-login').getByTestId('secret-row').first(),
  ).toBeVisible()
}
