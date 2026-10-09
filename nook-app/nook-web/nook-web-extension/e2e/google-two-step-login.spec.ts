import {
  expect,
  test,
  type Page,
  type Route,
  type TestInfo,
  type BrowserName,
} from '@playwright/test'
import {
  launchPairedPinExtension,
  saveVaultLogin,
} from './helpers/paired-pin-extension'

enum GoogleNextMode {
  Automatic = 'automatic',
  Manual = 'manual',
}
type GoogleRouteFulfillment = Parameters<Route['fulfill']>[0]
interface GoogleBrowserScenario {
  readonly mode: GoogleNextMode
  readonly page: Page
}
interface GoogleBrowserRun {
  readonly mode: GoogleNextMode
  readonly browserName: BrowserName
  readonly testInfo: TestInfo
}

/** Replays the live form-less Google controls through the existing paired browser harness. */
class GoogleTwoStepBrowserScenarios {
  html(mode: GoogleNextMode): string {
    return `<!doctype html><html><body><main>
      <h1>Sign in</h1><p>Use your Google Account</p>
      <input id="identifierId" name="identifier" type="text" autocomplete="username webauthn" aria-label="Email or phone">
      <input name="hiddenPassword" type="password" aria-hidden="true" style="display:none">
      <div id="identifierNext"><div><button type="button">Next</button></div></div>
      <button id="change-account" type="button">Use another account</button>
      <script>
        let nextCount = 0;
        document.querySelector('#identifierNext button').addEventListener('click', () => {
          nextCount += 1;
          let nextDecision = 'advance';
          switch ('${mode}') {
            case 'manual':
              switch (nextCount) { case 1: nextDecision = 'wait-for-manual-next'; break; default: break; }
              break;
            case 'automatic': break;
          }
          switch (nextDecision) { case 'wait-for-manual-next': return; case 'advance': break; }
          history.pushState('', '', '/v3/signin/challenge/pwd');
          document.querySelector('main').innerHTML = '<h1>Welcome</h1><input name="Passwd" type="password" autocomplete="current-password" aria-label="Enter your password"><div id="passwordNext"><button type="button">Next</button></div>';
          document.documentElement.dataset.passwordFillCount = '0';
          document.querySelector('[name=Passwd]').addEventListener('input', () => {
            document.documentElement.dataset.passwordFillCount = String(Number(document.documentElement.dataset.passwordFillCount) + 1);
          });
          document.querySelector('#passwordNext button').addEventListener('click', () => {
            document.documentElement.dataset.passwordSubmitted = 'true';
          });
        });
      </script></main></body></html>`
  }
  private async assertPassword(request: GoogleBrowserScenario): Promise<void> {
    switch (request.mode) {
      case GoogleNextMode.Automatic:
        break
      case GoogleNextMode.Manual:
        await expect(request.page.locator('#identifierId')).toHaveValue(
          'selected@nook.test',
        )
        await request.page.locator('#identifierNext button').click()
        break
    }
    await expect(request.page.locator('[name="Passwd"]')).toHaveValue(
      'selected-password',
    )
    await expect(request.page.locator('html')).toHaveAttribute(
      'data-password-fill-count',
      '1',
    )
    await expect(request.page.locator('html')).not.toHaveAttribute(
      'data-password-submitted',
      'true',
    )
    await request.page.locator('#passwordNext button').click()
    await expect(request.page.locator('html')).toHaveAttribute(
      'data-password-submitted',
      'true',
    )
  }
  private async run(request: GoogleBrowserRun): Promise<void> {
    test.skip(
      request.browserName !== 'chromium',
      'Chrome extensions require Chromium',
    )
    const paired = await launchPairedPinExtension(request.testInfo)
    try {
      await saveVaultLogin(
        paired.vaultPage,
        'https://accounts.google.com',
        'selected@nook.test',
        'selected-password',
      )
      const page = await paired.context.newPage()
      await page.route('https://accounts.google.com/**', async (route) => {
        const fulfillment: GoogleRouteFulfillment = {
          contentType: 'text/html',
          body: this.html(request.mode),
        }
        await route.fulfill(fulfillment)
      })
      await page.goto(
        'https://accounts.google.com/v3/signin/identifier?flowName=GlifWebSignIn',
      )
      const widget = page.locator('#nook-auth-widget')
      await expect(widget.getByText('Ready to sign in')).toBeVisible()
      await widget.getByRole('button', { name: 'Continue with Nook' }).click()
      const scenario: GoogleBrowserScenario = { mode: request.mode, page }
      await this.assertPassword(scenario)
      const screenshot: Parameters<Page['screenshot']>[0] = {
        path: request.testInfo.outputPath(`google-${request.mode}.png`),
      }
      await page.screenshot(screenshot)
    } finally {
      await paired.context.close()
    }
  }
  register(): void {
    for (const mode of [GoogleNextMode.Automatic, GoogleNextMode.Manual]) {
      test(`Google ${mode} Next fills the same selected password once without submitting`, async ({
        browserName,
      }, testInfo) => {
        const request: GoogleBrowserRun = { mode, browserName, testInfo }
        await this.run(request)
      })
    }
  }
}
new GoogleTwoStepBrowserScenarios().register()
