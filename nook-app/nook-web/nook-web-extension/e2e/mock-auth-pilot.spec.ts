import {
  expect,
  test,
  type TestInfo,
  type Page,
  type Locator,
  type Worker,
  type Route,
  type PlaywrightWorkerOptions,
} from '@playwright/test'
import {
  launchPairedPinExtension,
  saveVaultAuthenticator,
  saveVaultLogin,
} from './helpers/paired-pin-extension'
import { startMockAuthServer } from './mock-auth'
import {
  holdPilotFilledProjection,
  pilotProjectionDeliveryState,
  releasePilotProjection,
} from './helpers/pilot-checklist-delivery'

type PilotPanelEvidenceRequest = {
  page: Page
  widget: Locator
  testInfo: TestInfo
}
type PilotPanelScreenshotOptions = NonNullable<
  Parameters<Page['screenshot']>[0]
>
type PilotPanelScrollDimensions = {
  scrollWidth: number
  clientWidth: number
  scrollHeight: number
  clientHeight: number
}
class PilotPanelEvidence {
  constructor(private readonly request: PilotPanelEvidenceRequest) {}
  checklist(): Locator {
    const options: Parameters<Locator['getByRole']>[1] = {
      name: 'Sign-in steps',
    }
    return this.request.widget.getByRole('list', options)
  }
  button(name: string): Locator {
    const options: Parameters<Locator['getByRole']>[1] = { name }
    return this.request.widget.getByRole('button', options)
  }
  async screenshot(name: string): Promise<void> {
    await this.request.page.bringToFront()
    await expect(this.request.widget).toBeVisible()
    const options: PilotPanelScreenshotOptions = {
      path: this.request.testInfo.outputPath(name),
      caret: 'initial',
    }
    await this.request.page.screenshot(options)
    await expect(this.request.widget).toBeVisible()
  }
  private async assertReady(): Promise<void> {
    const checklist = this.checklist()
    await expect(checklist.getByRole('listitem')).toHaveCount(3)
    await expect(checklist.locator('[aria-current]')).toHaveCount(0)
  }
  private async assertCollapsedLayout(): Promise<void> {
    const panel = this.request.widget.locator('.panel.is-collapsed')
    const dimensions = await panel.evaluate(
      (element): PilotPanelScrollDimensions => ({
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
      }),
    )
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
    expect(dimensions.scrollHeight).toBeLessThanOrEqual(dimensions.clientHeight)
  }
  async ready(): Promise<void> {
    await this.request.page.bringToFront()
    const checklist = this.checklist()
    await this.assertReady()
    await this.screenshot('pilot-checklist-ready.png')
    await this.assertReady()
    await this.button('Collapse Nook').click()
    await expect(checklist).toBeHidden()
    const launcher = this.request.widget.getByTestId('nook-auth-gate-expand')
    await expect(launcher).toHaveCount(1)
    await expect(launcher).toBeVisible()
    await expect(launcher).toHaveAccessibleName('Expand Nook: Nook Pilot · 1/3')
    await expect(launcher).toContainText('1/3')
    await this.assertCollapsedLayout()
    await this.screenshot('pilot-checklist-collapsed.png')
    await expect(launcher).toBeVisible()
    await expect(checklist).toBeHidden()
    await this.assertCollapsedLayout()
    await this.button('Expand Nook').click()
    await expect(checklist).toBeVisible()
    const viewport: Parameters<Page['setViewportSize']>[0] = {
      width: 375,
      height: 812,
    }
    await this.request.page.setViewportSize(viewport)
    await expect(this.button('Continue with Nook')).toBeVisible()
    await this.screenshot('pilot-checklist-responsive.png')
    await this.assertReady()
    await expect(this.button('Continue with Nook')).toBeVisible()
  }
}
enum PilotScenario {
  Waiting = 'waiting',
  Manual = 'manual',
  Attention = 'attention',
  Confirmed = 'confirmed',
}
type PilotScenarioRun = {
  browserName: PlaywrightWorkerOptions['browserName']
  testInfo: TestInfo
}
type PilotScenarioPageRequest = {
  scenario: PilotScenario
  page: Page
  worker: Worker
  origin: string
  testInfo: TestInfo
}
enum PilotScenarioAdvanceControlKind {
  Absent = 'absent',
  Submit = 'submit',
}
type ScenarioMarkup = {
  advanceControl: PilotScenarioAdvanceControlKind
  alertMarkup: string
  successScript: string
}
class PilotScenarioPage {
  private readonly evidence: PilotPanelEvidence
  constructor(private readonly request: PilotScenarioPageRequest) {
    const evidenceRequest: PilotPanelEvidenceRequest = {
      page: request.page,
      widget: request.page.locator('#nook-auth-widget'),
      testInfo: request.testInfo,
    }
    this.evidence = new PilotPanelEvidence(evidenceRequest)
  }
  private markup(): ScenarioMarkup {
    switch (this.request.scenario) {
      case PilotScenario.Manual:
        return {
          advanceControl: PilotScenarioAdvanceControlKind.Absent,
          alertMarkup: '',
          successScript: '',
        }
      case PilotScenario.Attention:
        return {
          advanceControl: PilotScenarioAdvanceControlKind.Submit,
          alertMarkup: '<p role="alert">Unable to sign in.</p>',
          successScript: '',
        }
      case PilotScenario.Waiting:
        return {
          advanceControl: PilotScenarioAdvanceControlKind.Submit,
          alertMarkup: '',
          successScript: '',
        }
      case PilotScenario.Confirmed:
        return {
          advanceControl: PilotScenarioAdvanceControlKind.Submit,
          alertMarkup: '',
          successScript:
            "const marker = document.createElement('p'); marker.dataset.nookAuthOutcome = 'success'; marker.textContent = 'Authentication complete'; document.body.append(marker);",
        }
    }
  }
  private advanceControlMarkup(
    control: PilotScenarioAdvanceControlKind,
  ): string {
    switch (control) {
      case PilotScenarioAdvanceControlKind.Absent:
        return ''
      case PilotScenarioAdvanceControlKind.Submit:
        return '<button type="submit">Sign in</button>'
    }
  }
  private pageMarkup(markup: ScenarioMarkup): string {
    switch (markup.advanceControl) {
      case PilotScenarioAdvanceControlKind.Absent:
        return '<!doctype html><html><body><h1>Sign in</h1><section id="login-form" role="form"><label>Email<input autocomplete="username" name="username" type="email"></label><label>Password<input autocomplete="current-password" name="password" type="password"></label></section></body></html>'
      case PilotScenarioAdvanceControlKind.Submit:
        return `<!doctype html><html><body><h1>Sign in</h1><form id="login-form" action="/auth/login" method="post"><label>Email<input autocomplete="username" name="username" type="email"></label><label>Password<input autocomplete="current-password" name="password" type="password"></label>${markup.alertMarkup}${this.advanceControlMarkup(markup.advanceControl)}</form><script>document.getElementById('login-form').addEventListener('submit', event => { event.preventDefault(); ${markup.successScript} });</script></body></html>`
    }
  }
  private async fulfill(route: Route): Promise<void> {
    const markup: ScenarioMarkup = this.markup()
    const response: Parameters<Route['fulfill']>[0] = {
      contentType: 'text/html',
      body: this.pageMarkup(markup),
    }
    await route.fulfill(response)
  }
  private pendingReply() {
    return pilotProjectionDeliveryState(this.request.worker)
  }
  async run(): Promise<void> {
    await this.request.page.route(
      `${this.request.origin}/plain/login`,
      this.fulfill.bind(this),
    )
    await this.request.page.goto(`${this.request.origin}/plain/login`)
    await this.request.page.bringToFront()
    const widget = this.request.page.locator('#nook-auth-widget')
    const checklist = this.evidence.checklist()
    await expect(widget.getByText('Ready to sign in')).toBeVisible()
    await expect(checklist.getByRole('listitem')).toHaveCount(3)
    switch (this.request.scenario) {
      case PilotScenario.Waiting:
        await holdPilotFilledProjection(this.request.worker)
        break
      case PilotScenario.Manual:
      case PilotScenario.Attention:
      case PilotScenario.Confirmed:
        break
    }
    await this.evidence.button('Continue with Nook').click()
    switch (this.request.scenario) {
      case PilotScenario.Waiting:
        await expect.poll(this.pendingReply.bind(this)).toBe('Held')
        await expect(checklist).toHaveAttribute('data-status', 'Working')
        await expect(
          checklist.locator('[aria-current="step"]'),
        ).toHaveAttribute('data-step', 'FillLogin')
        await expect(widget.getByText('Ready to sign in')).toHaveCount(0)
        await this.evidence.screenshot('pilot-checklist-working.png')
        await expect(checklist).toHaveAttribute('data-status', 'Working')
        await expect(
          checklist.locator('[aria-current="step"]'),
        ).toHaveAttribute('data-step', 'FillLogin')
        await releasePilotProjection(this.request.worker)
        break
      case PilotScenario.Manual:
      case PilotScenario.Attention:
      case PilotScenario.Confirmed:
        break
    }
    await this.assertOutcome(checklist)
    await expect(widget.getByText('Ready to sign in')).toHaveCount(0)
    await expect(this.evidence.button('Take over')).toBeVisible()
    await expect(widget).not.toContainText('alice@nook.test')
    await expect(widget).not.toContainText('extension-fill-password')
    await this.evidence.screenshot(
      `pilot-checklist-${this.request.scenario}.png`,
    )
    await this.assertOutcome(checklist)
    await expect(this.evidence.button('Take over')).toBeVisible()
    await this.evidence.button('Take over').click()
    await expect(widget).toHaveCount(0)
  }
  private async assertOutcome(checklist: Locator): Promise<void> {
    switch (this.request.scenario) {
      case PilotScenario.Manual:
        await expect(checklist).toHaveAttribute('data-status', 'Waiting')
        await expect(
          checklist.locator('[aria-current="step"]'),
        ).toHaveAttribute('data-step', 'SubmitForm')
        await expect(
          checklist.locator('[data-step="CheckResult"]'),
        ).toHaveAttribute('data-state', 'Pending')
        await expect(
          checklist.locator('[data-step="SubmitForm"]'),
        ).toContainText('Review and submit the form yourself')
        return
      case PilotScenario.Waiting:
        await expect(checklist).toHaveAttribute('data-status', 'Waiting')
        await expect(
          checklist.locator('[aria-current="step"]'),
        ).toHaveAttribute('data-step', 'CheckResult')
        return
      case PilotScenario.Attention:
        await expect(checklist).toHaveAttribute('data-status', 'Attention')
        await expect(checklist.locator('[aria-current]')).toHaveCount(0)
        await expect(
          checklist.locator('[data-step="CheckResult"]'),
        ).toHaveAttribute('data-state', 'Attention')
        return
      case PilotScenario.Confirmed:
        await expect(checklist).toHaveAttribute('data-status', 'Complete')
        await expect(checklist.locator('[aria-current]')).toHaveCount(0)
        await expect(checklist.locator('[data-state="Done"]')).toHaveCount(3)
    }
  }
}
class PilotChecklistScenarios {
  constructor(private readonly request: PilotScenarioRun) {}
  private async worker(
    context: Awaited<ReturnType<typeof launchPairedPinExtension>>['context'],
  ): Promise<Worker> {
    const existing = context.serviceWorkers()[0]
    switch (typeof existing) {
      case 'object':
        return existing
      case 'string':
      case 'number':
      case 'bigint':
      case 'boolean':
      case 'symbol':
      case 'undefined':
      case 'function':
        return context.waitForEvent('serviceworker')
    }
  }
  async run(): Promise<void> {
    test.skip(
      this.request.browserName !== 'chromium',
      'Chrome extensions require Chromium',
    )
    const mockAuth = await startMockAuthServer()
    const paired = await launchPairedPinExtension(this.request.testInfo)
    try {
      await saveVaultLogin(
        paired.vaultPage,
        mockAuth.origin,
        'alice@nook.test',
        'extension-fill-password',
      )
      const worker = await this.worker(paired.context)
      for (const scenario of Object.values(PilotScenario)) {
        const page = await paired.context.newPage()
        const request: PilotScenarioPageRequest = {
          scenario,
          page,
          worker,
          origin: mockAuth.origin,
          testInfo: this.request.testInfo,
        }
        await new PilotScenarioPage(request).run()
        await page.close()
      }
    } finally {
      await paired.context.close()
      await mockAuth.close()
    }
  }
}

test.describe('PIN Pilot against mock auth', () => {
  test.describe.configure({ timeout: 180_000 })

  test('completes plain login through Continue with Nook', async ({
    browserName,
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')

    const mockAuth = await startMockAuthServer()
    const paired = await launchPairedPinExtension(testInfo)
    try {
      await saveVaultLogin(
        paired.vaultPage,
        mockAuth.origin,
        'alice@nook.test',
        'extension-fill-password',
      )

      const loginPage = await paired.context.newPage()
      await loginPage.goto(`${mockAuth.origin}/plain/login`)
      const widget = loginPage.locator('#nook-auth-widget')
      await expect(widget.getByText('Ready to sign in')).toBeVisible()
      const evidenceRequest: PilotPanelEvidenceRequest = {
        page: loginPage,
        widget,
        testInfo,
      }
      await new PilotPanelEvidence(evidenceRequest).ready()
      await expect(
        widget.getByTestId('nook-auth-gate-vault-status'),
      ).toHaveText('Matching saved logins: 1')
      await expect(
        widget.getByTestId('nook-auth-gate-vault-status'),
      ).toHaveAttribute('data-state', 'credential-available')
      // Single matching login fills and submits without an account chooser.
      await widget.getByRole('button', { name: 'Continue with Nook' }).click()
      await expect(loginPage.getByTestId('mock-auth-success')).toHaveText(
        'Authentication complete',
        { timeout: 20_000 },
      )
      await expect(loginPage.getByTestId('mock-auth-flow')).toHaveText(
        'plain-login',
      )
    } finally {
      await paired.context.close()
      await mockAuth.close()
    }
  })

  test('renders real working, waiting, manual, attention and confirmed login checklist states', async ({
    browserName,
  }, testInfo) => {
    const request: PilotScenarioRun = { browserName, testInfo }
    await new PilotChecklistScenarios(request).run()
  })

  test('completes login then 2FA through Pilot', async ({
    browserName,
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')

    const mockAuth = await startMockAuthServer()
    const paired = await launchPairedPinExtension(testInfo, {
      vaultName: 'Mock auth 2FA vault',
    })
    try {
      await saveVaultLogin(
        paired.vaultPage,
        mockAuth.origin,
        'alice-2fa@nook.test',
        'extension-fill-password',
      )
      await saveVaultAuthenticator(
        paired.vaultPage,
        'Mock Auth',
        'alice-2fa@nook.test',
        'JBSWY3DPEHPK3PXP',
      )

      const loginPage = await paired.context.newPage()
      await loginPage.goto(`${mockAuth.origin}/totp/login`)
      const loginWidget = loginPage.locator('#nook-auth-widget')
      await expect(loginWidget.getByText('Ready to sign in')).toBeVisible({
        timeout: 20_000,
      })
      await loginWidget
        .getByRole('button', { name: 'Continue with Nook' })
        .click()

      await expect(loginPage).toHaveURL(/\/totp\/verify$/, { timeout: 20_000 })
      const otpWidget = loginPage.locator('#nook-auth-widget')
      await expect(otpWidget.getByText('Fill your 2FA code')).toBeVisible({
        timeout: 15_000,
      })
      const authenticatorPickerPromise = paired.context.waitForEvent('page')
      await otpWidget.getByRole('button', { name: 'Fill 2FA code' }).click()
      const authenticatorPicker = await authenticatorPickerPromise
      await authenticatorPicker.waitForURL(/intent=authenticator-picker/)
      await authenticatorPicker
        .getByRole('button', { name: /Mock Auth/ })
        .click()
      await expect(loginPage.getByTestId('mock-auth-otp-input')).toHaveValue(
        /^\d{6}$/,
      )
      await expect.poll(() => authenticatorPicker.isClosed()).toBe(true)

      await loginPage.getByRole('button', { name: 'Submit' }).click()
      await expect(loginPage.getByTestId('mock-auth-success')).toHaveText(
        'Authentication complete',
        { timeout: 20_000 },
      )
      await expect(loginPage.getByTestId('mock-auth-flow')).toHaveText(
        'login-then-totp',
      )
    } finally {
      await paired.context.close()
      await mockAuth.close()
    }
  })
})
