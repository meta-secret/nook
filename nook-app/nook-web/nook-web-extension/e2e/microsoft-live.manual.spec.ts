import {
  expect,
  test,
  type BrowserContext,
  type ConsoleMessage,
} from '@playwright/test'
import { Effect } from 'effect'
import { launchExtensionContext } from './helpers/extension-smoke-runtime'

// Live providers are manual diagnostics, never part of the CI fixture gate.
test.skip(
  process.env.E2E_SPEC !== 'microsoft-live.manual.spec.ts',
  'Select this manual spec explicitly to contact Microsoft.',
)

class MicrosoftLiveIdentifierProof {
  constructor(private readonly context: BrowserContext) {}

  async verify(screenshotPath: string): Promise<void> {
    const page = await this.context.newPage()
    page.on('console', this.recordDetectorDiagnostic.bind(this))
    const destination = new URL('https://login.live.com/oauth20_authorize.srf')
    destination.search = new URLSearchParams({
      client_id: '10fa57ef-4895-4ab2-872c-8c3613d4f7fb',
      scope: 'openid profile offline_access',
      redirect_uri: 'https://www.microsoft.com/cascadeauth/account/signin-oidc',
      response_type: 'code',
      response_mode: 'form_post',
      state: 'nook-live-diagnostic',
      nonce: 'nook-live-diagnostic',
      code_challenge: 'c'.repeat(43),
      code_challenge_method: 'S256',
      msproxy: '1',
      issuer: 'mso',
      tenant: 'consumers',
      ui_locales: 'en-US',
    }).toString()
    // No route interception, page replacement, or provider credentials.
    await page.goto(destination.href)
    await page.screenshot({ path: screenshotPath, caret: 'initial' })
    await expect(page.locator('#usernameEntry')).toBeVisible({
      timeout: 30_000,
    })
    const widget = page.locator('#nook-auth-widget')
    await expect(
      widget.getByRole('button', { name: 'Continue with Nook' }),
    ).toBeVisible({ timeout: 30_000 })
    await expect(widget.getByTestId('nook-auth-gate')).toBeInViewport()
    await expect(widget.getByTestId('nook-auth-gate')).toHaveCSS('opacity', '1')
    await expect(page.locator('#usernameEntry')).toHaveValue('')
    await page.screenshot({ path: screenshotPath, caret: 'initial' })
    await page.locator('#usernameEntry').evaluate((field) => {
      field.setAttribute('style', 'padding-right: 35px !important;')
    })
    await expect(widget.getByTestId('nook-auth-gate')).toBeVisible()
    const retainedFrames = await page
      .locator('#usernameEntry')
      .evaluate(async (field) => {
        let retained = 0
        for (let frame = 0; frame < 60; frame += 1) {
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          )
          field.setAttribute('style', 'padding-right: 35px !important;')
          retained += Number(
            Boolean(document.getElementById('nook-auth-widget')),
          )
        }
        return retained
      })
    expect(retainedFrames).toBe(60)
    await page.screenshot({ path: screenshotPath, caret: 'initial' })
    const popupPromise = this.context.waitForEvent('page')
    await widget.getByRole('button', { name: 'Continue with Nook' }).click()
    const popup = await popupPromise
    await expect(popup).toHaveURL(
      /chrome-extension:\/\/[^/]+\/popup\/index.html/u,
    )
    await expect(page.locator('#usernameEntry')).toHaveValue('')
    await popup.screenshot({
      path: screenshotPath.replace('.png', '-popup.png'),
      caret: 'initial',
    })
  }

  private async recordDetectorDiagnostic(
    message: ConsoleMessage,
  ): Promise<void> {
    switch (message.location().url.split('/').slice(-1).join('/')) {
      case 'autofill.js':
        return this.printDetectorArguments(message)
      default:
        return
    }
  }

  private async printDetectorArguments(message: ConsoleMessage): Promise<void> {
    for (const argument of message.args()) {
      console.info(await argument.evaluate((value) => JSON.stringify(value)))
    }
  }
}

test('packaged extension detects the real Microsoft identifier page and opens Nook', async ({
  baseURL,
}, testInfo) => {
  void baseURL
  test.setTimeout(120_000)
  const proof = Effect.acquireUseRelease(
    Effect.tryPromise(() =>
      launchExtensionContext(testInfo.outputPath('profile')),
    ),
    (context) =>
      Effect.tryPromise(() =>
        new MicrosoftLiveIdentifierProof(context).verify(
          testInfo.outputPath('live-microsoft-nook.png'),
        ),
      ),
    (context) => Effect.promise(() => context.close()),
  )
  // Preserve Playwright's assertion diagnostic at its test-runner boundary.
  await Effect.runPromise(
    proof.pipe(
      Effect.catchTag('UnknownException', (failure) =>
        Effect.die(failure.error),
      ),
    ),
  )
})
