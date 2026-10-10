import { expect, test, type Page } from '../fixtures'
import {
  advanceCreateVaultWizardToFinalStep,
  extensionApprovalVaultName,
  installMockPasskeyRuntime,
  launchExtensionContext,
  openSimpleVaultConnection,
  readExtensionStorage,
  registerWebsitePasskeyThroughExtension,
  setupPasskeyExtensionPopup,
  setupStorageKey,
  startLoginServer,
  waitForExtensionPairingReady,
  waitForNewPage,
} from '../../../nook-web-extension/e2e/helpers/extension-smoke-runtime'
import {
  PasskeyVaultDiscovery,
  WebsitePasskeyStateKind,
  type WebsitePasskeyState,
} from '../../../nook-web-extension/e2e/helpers/passkey-vault-discovery'
import {
  demoBeat,
  injectPilotAutofill,
  loadPilotMessages,
} from './pilot-demo-helpers'
import { demoDomainEnumArgs, installDemoChromeStub } from './static-chrome-stub'

type PairedVaultReopenOperations = readonly [Promise<Page>, Promise<void>]
type PasskeyVaultDemoVisibilityWait = { readonly timeout: number }

test('propose Create passkey through Nook Pilot without silent ceremony', async ({
  page,
}) => {
  const messages = await loadPilotMessages()
  const stubArgs = {
    localizedMessages: messages,
    ...demoDomainEnumArgs,
    passkeyPilotFlow: true,
  }

  await page.addInitScript(installDemoChromeStub, stubArgs)

  await page.goto('/')
  await page.setContent(`<!doctype html>
    <html>
      <head>
        <title>Example passkey signup</title>
        <style>
          :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
          body {
            min-height: 100vh;
            margin: 0;
            display: grid;
            place-items: center;
            background: linear-gradient(145deg, #11131a, #090a0f 70%);
            color: #f7f7f8;
          }
          main {
            width: min(440px, calc(100vw - 48px));
            padding: 36px;
            border: 1px solid rgb(255 255 255 / 10%);
            border-radius: 22px;
            background: rgb(24 26 35 / 92%);
            text-align: center;
          }
          button {
            min-height: 48px;
            margin-top: 18px;
            padding: 0 18px;
            border: 0;
            border-radius: 10px;
            background: #eef0f4;
            color: #171921;
            font: 750 14px/1 Inter, ui-sans-serif, system-ui, sans-serif;
          }
          #started { display: none; margin-top: 16px; color: #94d4ae; font-weight: 650; }
          body.started #started { display: block; }
        </style>
      </head>
      <body>
        <main>
          <form id="passkey-signin" method="post">
            <h1>Sign in with a passkey</h1>
            <p id="passkey-copy">Nook can propose creating a passkey after you approve.</p>
            <p id="started" data-testid="demo-passkey-started">Site passkey ceremony started</p>
          </form>
        </main>
      </body>
    </html>`)
  await page.evaluate(installDemoChromeStub, stubArgs)
  await injectPilotAutofill(page)

  const widget = page.locator('#nook-auth-widget')
  await expect(widget).toHaveCount(0)
  await page.evaluate(() => {
    const copy = document.querySelector('#passkey-copy')
    if (!copy) throw new Error('expected passkey demo copy')
    const passkeyControl = document.createElement('button')
    passkeyControl.type = 'button'
    passkeyControl.dataset.nookPasskeyControl = ''
    passkeyControl.dataset.testid = 'demo-passkey-control'
    passkeyControl.textContent = 'Sign in with a passkey'
    passkeyControl.addEventListener('click', () => {
      document.body.classList.add('started')
    })
    copy.after(passkeyControl)
  })
  await expect(
    widget.getByRole('button', { name: 'Create passkey' }),
  ).toBeVisible()
  await expect(widget.getByTestId('nook-auth-gate-vault-status')).toHaveText(
    'Connected to Demo vault',
  )
  const ceremonyStarted = page.getByTestId('demo-passkey-started')
  await expect(ceremonyStarted).toBeHidden()
  await demoBeat(page)

  await widget.getByRole('button', { name: 'Create passkey' }).click()
  await expect(ceremonyStarted).toBeHidden()
  await expect(
    widget.getByRole('button', { name: 'Create passkey' }),
  ).toBeEnabled()
  await widget.getByRole('button', { name: 'Create passkey' }).click()
  await expect(ceremonyStarted).toBeVisible()
  await expect(
    widget.getByRole('button', { name: 'Create passkey' }),
  ).toBeVisible()
  await demoBeat(page)
})

test('discover a website passkey in the reopened local paired vault', async ({
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')
  testInfo.setTimeout(180_000)
  const context = await launchExtensionContext(
    testInfo.outputPath('local-passkey-demo-profile'),
  )
  const loginServer = await startLoginServer()
  try {
    // Load the real website before the device-protection mock is installed;
    // its credential ceremony must pass through the production extension.
    const website = await context.newPage()
    await website.goto(`${loginServer.origin}/login`)
    await context.addInitScript(installMockPasskeyRuntime)
    const popup = await setupPasskeyExtensionPopup(context)
    const popupUrl = popup.url()
    const vault = await openSimpleVaultConnection(context, popup)
    await advanceCreateVaultWizardToFinalStep(vault)
    await vault
      .getByTestId('login-vault-name-input')
      .fill(extensionApprovalVaultName)
    await vault.getByTestId('login-create-device-vault-btn').click()
    await expect(vault.getByTestId('extension-connect-consent')).toBeVisible()
    await vault.getByTestId('approve-extension-device-btn').click()
    const readSetupState = async () => {
      const storage = await readExtensionStorage(context)
      return storage[setupStorageKey]
    }
    await waitForExtensionPairingReady(
      vault,
      readSetupState,
      extensionApprovalVaultName,
    )
    await expect(vault.getByTestId('authenticated-shell')).toBeVisible()

    const credentialId = await registerWebsitePasskeyThroughExtension(website)
    expect(credentialId).not.toBe('')
    await website.close()
    await vault.close()
    await popup.close()

    const connectedPopup = await context.newPage()
    await connectedPopup.goto(popupUrl)
    await expect(
      connectedPopup.getByTestId('open-simple-vault-btn'),
    ).toBeVisible()
    const reopen: PairedVaultReopenOperations = [
      waitForNewPage(context, 'paired local vault after website registration'),
      connectedPopup.getByTestId('open-simple-vault-btn').click(),
    ]
    const [reopenedVault] = await Promise.all(reopen)
    const visibility: PasskeyVaultDemoVisibilityWait = { timeout: 15_000 }
    await expect(reopenedVault.getByTestId('authenticated-shell')).toBeVisible(
      visibility,
    )
    // Production Simple startup pulls the encrypted companion events and
    // imports them through Rust before these normal list assertions run.
    const state: WebsitePasskeyState = {
      kind: WebsitePasskeyStateKind.Created,
      credentialId,
    }
    await new PasskeyVaultDiscovery(reopenedVault).assert(state)
    await demoBeat(reopenedVault)
  } finally {
    await context.close()
    await loginServer.close()
  }
})
