import { expect, test, type Locator } from '../fixtures'
import {
  demoBeat,
  injectPilotAutofill,
  loadPilotMessages,
} from './pilot-demo-helpers'
import { demoDomainEnumArgs, installDemoChromeStub } from './static-chrome-stub'
import { WebsiteFocusedLoginRevealMessageType } from '../../../nook-web-extension/src/lib/focused-login-fill-messages'
import type { WebsiteFocusedLoginFillResponse } from '../../../nook-web-extension/src/lib/focused-login-fill-messages'
import { AuthenticationWorkflowSnapshotMessageType } from '../../../nook-web-extension/src/lib/auth-workflow-messages'
import { WebsiteLoginPickerOpenMessageType } from '../../../nook-web-extension/src/lib/login-picker-messages'

const interactions = ['mouse', 'keyboard'] as const
for (const interaction of interactions) {
  test(`choose a saved username for an isolated credential through ${interaction} focus`, async ({
    page,
  }) => {
    const messages = await loadPilotMessages()
    const selectedCredential: WebsiteFocusedLoginFillResponse = {
      ok: true,
      value: 'pilot@example.test',
    }
    const stubArgs: Parameters<typeof installDemoChromeStub>[0] = {
      localizedMessages: messages,
      ...demoDomainEnumArgs,
      loginPilotFlow: true,
      recordRuntimeMessageTypes: true,
      responsesByType: {
        [WebsiteFocusedLoginRevealMessageType.Reveal]: selectedCredential,
      },
    }
    const requestMethods: string[] = []
    page.on('request', (request) => requestMethods.push(request.method()))
    await page.goto('/')
    await page.setContent(`<!doctype html>
      <html><head><title>Profile details</title><style>
        :root { color-scheme: dark; font-family: Inter, system-ui, sans-serif; }
        * { box-sizing: border-box; }
        body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #10131b; color: #f2f4f8; }
        main { width: min(440px, calc(100vw - 48px)); padding: 36px; border: 1px solid #45506a; border-radius: 18px; background: #181d29; }
        h1 { margin: 0 0 24px; }
        label { display: grid; gap: 8px; margin: 18px 0; }
        input { min-height: 48px; padding: 12px; border: 1px solid #45506a; border-radius: 9px; background: #10131b; color: inherit; font: inherit; }
      </style></head><body><main>
        <h1>Profile details</h1>
        <p>Choose which saved email to use for this field.</p>
        <label>Email<input id="profile-email" type="email" autocomplete="username"></label>
        <label>Display name<input id="display-name" autocomplete="nickname" value="Demo profile"></label>
      </main></body></html>`)
    await page.evaluate(installDemoChromeStub, stubArgs)
    await injectPilotAutofill(page)
    await demoBeat(page)

    const email = page.locator('#profile-email')
    const displayName = page.locator('#display-name')
    const widget = page.locator('#nook-auth-widget')
    await displayName.click()
    await demoBeat(page)
    await expect(widget).toHaveCount(0)
    expect(
      await page.evaluate(() => window.__nookDemoRuntimeMessageTypes),
    ).not.toContain(
      AuthenticationWorkflowSnapshotMessageType.NookAuthenticationWorkflowSnapshot,
    )
    switch (interaction) {
      case 'mouse':
        await email.click()
        break
      case 'keyboard':
        await page.keyboard.press('Shift+Tab')
        break
    }
    await expect(email).toBeFocused()
    await expect(widget).toHaveAttribute('data-nook-credential-mode', 'focused')
    await expect(widget.getByText('Ready to sign in')).toBeVisible()
    await expect(email).toHaveValue('')
    await expect(displayName).toHaveValue('Demo profile')
    expect(
      await page.evaluate(() => window.__nookDemoRuntimeMessageTypes),
    ).not.toContain(WebsiteFocusedLoginRevealMessageType.Reveal)
    await demoBeat(page)

    const continueOptions: Parameters<Locator['getByRole']>[1] = {
      name: 'Continue with Nook',
    }
    await widget.getByRole('button', continueOptions).click()
    // The shared demo runtime models the origin-matched chooser's selected account.
    await expect(email).toHaveValue('pilot@example.test')
    await expect(displayName).toHaveValue('Demo profile')
    const runtimeMessages = await page.evaluate(
      () => window.__nookDemoRuntimeMessageTypes,
    )
    expect(runtimeMessages).toContain(
      WebsiteLoginPickerOpenMessageType.NookWebsiteLoginPickerOpen,
    )
    expect(runtimeMessages).toContain(
      WebsiteFocusedLoginRevealMessageType.Reveal,
    )
    expect(runtimeMessages).not.toContain('nook:website-login-fill')
    expect(requestMethods).not.toContain('POST')
    await demoBeat(page)
  })
}
