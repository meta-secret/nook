import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { Schema } from 'effect'
import { extensionChannelIdentity } from '../scripts/channel-identity'
import {
  launchPairedPinExtension,
  lockExtensionSession,
} from './helpers/paired-pin-extension'
import {
  extensionDir,
  getServiceWorker,
  launchExtensionContext,
} from './helpers/extension-smoke-runtime'

type RecoveryInstructionPayloadObservation = {
  readonly texts?: string[]
  readonly visibleInstructionCopies?: string[]
}
type BackupExtractionOperationObservation = {
  readonly type?: string
  readonly payload?: RecoveryInstructionPayloadObservation
}

/** Retains the live shell's structural evidence without OAuth session values. */
class MicrosoftIdentifierShellFixture {
  readonly machineIdentity =
    'fui-Button r1alrhcs ___ksj0r70 ffp7eso f1p3nwhy f11589ue f1q5o8ev f1pdflbu f1phragk f15wkkf3 f1s2uweq fr80ssc f1ukrpxl fecsdlb f1rq72xc fnp9lpt f1h0usnq fs4ktlq f16h9ulv fx2bmrt f1d6v5y2 f1nz3ub2 fag2qd2 fmvhcg7 f1o3dhpw f14bpyus fqc85l4 f1h3a8gf fkiggi6 f8gmj8i f1ap8nzx f1igan7k fjag8bx f1v3eptx fpelvsg f1r9enuy fdvt4n0 f1l34yyb f1grx941 fqfbdvs f14es27b f5b47ha fhx4nu fjodcmx f1kwiid1 f4db1ww ft85np5 fkhj508 fl43uef f1i3iumi f17t0x8g f194v5ow f1qgg65p fk7jm04 fhgccpy f32wu9k fu5nqqq f13prjl2 f1czftr5 f1nl83rv fixhny3 feygou5 f1b6alqh fk6fouc f22iagw f4d9j23 f6dzj5z fjksvth'

  readonly contentSecurityPolicy =
    "object-src 'none'; base-uri 'self'; script-src 'self' 'nonce-fixture' https://js.monitor.azure.com https://logincdn.msauth.net https://logincdn.msftauth.net https://lgincdnvzeuno.azureedge.net https://lgincdnmsftuswe2.azureedge.net https://*.live.com https://*.microsoft.com https://*.office.net https://*.bing.com https://*.sharepointonline.com 'report-sample'"

  destination(): string {
    const destination = new URL('https://login.live.com/oauth20_authorize.srf')
    destination.search = new URLSearchParams({
      client_id: '00000000-0000-0000-0000-000000000000',
      scope: 'openid profile offline_access',
      redirect_uri: 'https://www.microsoft.com/auth/callback',
      response_type: 'code',
      response_mode: 'form_post',
      nonce: 'n'.repeat(115),
      code_challenge: 'c'.repeat(43),
      code_challenge_method: 'S256',
      'x-client-SKU': 'fixture',
      'x-client-Ver': 'fixture',
      uaid: 'a'.repeat(32),
      msproxy: '1',
      issuer: 'msa',
      tenant: 'consumers',
      ui_locales: 'en-US',
      client_info: '1',
      epctrc: 'r'.repeat(99),
      epct: 'e'.repeat(832),
      jshs: '1',
      claims: '{}',
      state: '',
    }).toString()
    destination.searchParams.set(
      'state',
      's'.repeat(2141 - destination.href.length),
    )
    return destination.href
  }

  html(authentication: boolean): string {
    const field = authentication
      ? '<input id="usernameEntry" type="email" autocomplete="username webauthn">'
      : '<input id="newsletter-email" type="email" name="newsletter-email">'
    return `<!doctype html><html><body><main>
      <h1>${authentication ? 'Sign in' : 'Newsletter preferences'}</h1>
      <form class="___cqaz2i0 fly5x3f" method="post">
        ${field}
        <button type="button">Forgot your username?</button>
        <button type="submit" class="${this.machineIdentity}">${authentication ? 'Next' : 'Subscribe'}</button>
      </form>
      <form method="post" action=""></form>
      <section><h2 id="setup-copy">Continue with email</h2><canvas width="120" height="120"></canvas></section>
      <script nonce="fixture">
        let mutationFrame = 0;
        function changeVisibleMetadata() {
          const instruction = document.getElementById('setup-copy');
          instruction.textContent = mutationFrame % 2 === 0 ? 'Continue with email' : 'Use your Microsoft account';
          mutationFrame += 1;
          if (mutationFrame < 48) requestAnimationFrame(changeVisibleMetadata);
          else document.documentElement.dataset.setupMetadataSettled = 'true';
        }
        requestAnimationFrame(changeVisibleMetadata);
      </script>
    </main></body></html>`
  }
}

for (const locked of [false, true]) {
  test(`production Continue preserves empty provider fields when ${locked ? 'locked' : 'unconnected'}`, async ({
    baseURL,
  }, testInfo) => {
    void baseURL
    test.setTimeout(180_000)
    const context = locked
      ? (await launchPairedPinExtension(testInfo)).context
      : await launchExtensionContext(testInfo.outputPath('profile'))
    await context.tracing.start({ screenshots: true, snapshots: true })
    try {
      if (locked) await lockExtensionSession(context)
      const fixture = new MicrosoftIdentifierShellFixture()
      let submitted = false
      await context.route('https://login.live.com/**', async (route) => {
        if (route.request().method() === 'POST') submitted = true
        await route.fulfill({
          contentType: 'text/html',
          headers: { 'Content-Security-Policy': fixture.contentSecurityPolicy },
          body: fixture.html(true),
        })
      })
      const worker = await getServiceWorker(context)
      await worker.evaluate(() => {
        Reflect.set(globalThis, 'nookTestLoginLookupCount', 0)
        chrome.runtime.onMessage.addListener(
          (message: BackupExtractionOperationObservation) => {
            if (message.type !== 'nook:website-login-options') return
            const count: unknown = Reflect.get(
              globalThis,
              'nookTestLoginLookupCount',
            )
            if (typeof count === 'number')
              Reflect.set(globalThis, 'nookTestLoginLookupCount', count + 1)
          },
        )
      })
      const page = await context.newPage()
      await page.goto(fixture.destination())
      const widget = page.locator('#nook-auth-widget')
      await expect(widget.getByText('Ready to sign in')).toBeVisible()
      if (locked)
        await expect(
          widget.getByTestId('nook-auth-gate-vault-status'),
        ).toHaveAttribute('data-state', 'vault-locked')
      const popupPromise = context.waitForEvent('page')
      await widget.getByRole('button', { name: 'Continue with Nook' }).click()
      const popup = await popupPromise
      expect(
        await worker.evaluate(() => {
          const count: unknown = Reflect.get(
            globalThis,
            'nookTestLoginLookupCount',
          )
          return count
        }),
      ).toBe(1)
      await expect(popup).toHaveURL(
        /chrome-extension:\/\/[^/]+\/popup\/index.html/u,
      )
      await expect(page.locator('#usernameEntry')).toHaveValue('')
      expect(submitted).toBe(false)
      if (locked)
        await expect(
          popup.getByTestId('device-protection-pin-unlock-btn'),
        ).toBeVisible()
      await page.screenshot({
        path: testInfo.outputPath('continue-site.png'),
        caret: 'initial',
      })
      await popup.screenshot({
        path: testInfo.outputPath('continue-nook.png'),
        caret: 'initial',
      })
    } finally {
      await context.tracing.stop({ path: testInfo.outputPath('trace.zip') })
      await context.close()
    }
  })
}

test('production backup review extracts only after consent and clears on cancel', async ({
  baseURL,
}, testInfo) => {
  void baseURL
  const context = await launchExtensionContext(testInfo.outputPath('profile'))
  await context.tracing.start({ screenshots: true, snapshots: true })
  try {
    const worker = await getServiceWorker(context)
    await worker.evaluate(() => {
      Reflect.set(globalThis, 'nookTestBackupExtractionCount', 0)
      Reflect.set(globalThis, 'nookTestRecoveryInstructionObserved', false)
      Reflect.set(
        globalThis,
        'nookTestInitialRecoveryContainsFixtureCode',
        false,
      )
      chrome.runtime.onMessage.addListener(
        (message: BackupExtractionOperationObservation) => {
          if (
            message.type ===
            'nook:extension-session-authentication-recovery-copy-evidence'
          ) {
            Reflect.set(globalThis, 'nookTestRecoveryInstructionObserved', true)
            if (
              message.payload?.texts?.some(
                (copy) =>
                  copy.includes('A1B2-C3D4-E5F6') ||
                  copy.includes('G7H8-I9J0-K1L2'),
              )
            )
              Reflect.set(
                globalThis,
                'nookTestInitialRecoveryContainsFixtureCode',
                true,
              )
          }
          if (
            message.type ===
              'nook:extension-session-authentication-authenticator-setup-observation' &&
            message.payload?.visibleInstructionCopies?.some(
              (copy) =>
                copy.includes('A1B2-C3D4-E5F6') ||
                copy.includes('G7H8-I9J0-K1L2'),
            )
          )
            Reflect.set(
              globalThis,
              'nookTestInitialRecoveryContainsFixtureCode',
              true,
            )
          if (
            message.type ===
            'nook:extension-session-extract-authentication-backup-code-candidates'
          ) {
            const count: unknown = Reflect.get(
              globalThis,
              'nookTestBackupExtractionCount',
            )
            if (typeof count !== 'number')
              throw new Error('Expected backup extraction counter')
            Reflect.set(globalThis, 'nookTestBackupExtractionCount', count + 1)
          }
          return false
        },
      )
    })
    await context.route('https://example.test/recovery', async (route) => {
      await route.fulfill({
        contentType: 'text/html',
        headers: {
          'Content-Security-Policy': new MicrosoftIdentifierShellFixture()
            .contentSecurityPolicy,
        },
        body: '<main><h1>Save your recovery codes</h1><p>Save these recovery codes somewhere secure.</p><p>Save your recovery codes: A1B2-C3D4-E5F6</p><ul><li>A1B2-C3D4-E5F6</li><li>G7H8-I9J0-K1L2</li></ul></main>',
      })
    })
    const page = await context.newPage()
    await page.goto('https://example.test/recovery')
    const widget = page.locator('#nook-auth-widget')
    const save = widget.getByRole('button', { name: 'Save backup codes' })
    await expect(save).toBeVisible()
    await expect(widget.getByText('A1B2-C3D4-E5F6')).toHaveCount(0)
    expect(
      await worker.evaluate(
        () =>
          Reflect.get(globalThis, 'nookTestRecoveryInstructionObserved') ===
          true,
      ),
    ).toBe(true)
    expect(
      await worker.evaluate(
        () =>
          Reflect.get(
            globalThis,
            'nookTestInitialRecoveryContainsFixtureCode',
          ) === true,
      ),
    ).toBe(false)
    expect(
      await worker.evaluate(() => {
        const count: unknown = Reflect.get(
          globalThis,
          'nookTestBackupExtractionCount',
        )
        if (typeof count !== 'number')
          throw new Error('Expected backup extraction counter')
        return count
      }),
    ).toBe(0)
    await save.click()
    await expect(widget.getByText('A1B2-C3D4-E5F6')).toBeVisible()
    await expect(widget.getByText('G7H8-I9J0-K1L2')).toBeVisible()
    expect(
      await worker.evaluate(() => {
        const count: unknown = Reflect.get(
          globalThis,
          'nookTestBackupExtractionCount',
        )
        if (typeof count !== 'number')
          throw new Error('Expected backup extraction counter')
        return count
      }),
    ).toBe(1)
    await page.screenshot({
      path: testInfo.outputPath('backup-approved.png'),
      caret: 'initial',
    })
    await widget.getByText('Cancel', { exact: true }).click()
    await expect(widget.getByText('A1B2-C3D4-E5F6')).toHaveCount(0)
    await expect(widget.getByText('G7H8-I9J0-K1L2')).toHaveCount(0)
    await page.screenshot({
      path: testInfo.outputPath('backup-cancelled.png'),
      caret: 'initial',
    })
  } finally {
    await context.tracing.stop({ path: testInfo.outputPath('trace.zip') })
    await context.close()
  }
})

for (const authentication of [true, false]) {
  test(`production extension ${authentication ? 'admits Microsoft identifier' : 'rejects unrelated email'} with live structural bounds and CSP`, async ({
    baseURL,
  }, testInfo) => {
    // This isolated extension context navigates the provider URL directly.
    void baseURL
    const fixture = new MicrosoftIdentifierShellFixture()
    const manifest = await readFile(
      path.join(extensionDir, 'manifest.json'),
      'utf8',
    )
    const deployment = extensionChannelIdentity(
      process.env.NOOK_EXTENSION_CHANNEL?.trim() || 'production',
    )
    const commit = Schema.decodeUnknownSync(Schema.String)(
      process.env.NOOK_EXTENSION_COMMIT,
    ).trim()
    expect(commit).toMatch(/^[a-f0-9]{40}$/u)
    const manifestFields = { key: Schema.String, version_name: Schema.String }
    const parsedManifest = Schema.decodeUnknownSync(
      Schema.Struct(manifestFields),
    )(JSON.parse(manifest))
    expect(parsedManifest.key).toBe(deployment.manifestKey)
    expect(parsedManifest.version_name).toContain(
      `(${deployment.channel}, ${commit.slice(0, 12)})`,
    )
    await testInfo.attach('production-extension-manifest', {
      body: manifest,
      contentType: 'application/json',
    })
    expect(new TextEncoder().encode(fixture.machineIdentity)).toHaveLength(581)
    expect(new TextEncoder().encode(fixture.destination())).toHaveLength(2141)
    const context = await launchExtensionContext(testInfo.outputPath('profile'))
    const setupFailures: string[] = []
    context.on('weberror', (event) => {
      if (event.error().message.includes('Authenticator setup observation'))
        setupFailures.push(event.error().message)
    })
    await context.tracing.start({ screenshots: true, snapshots: true })
    try {
      await getServiceWorker(context)
      await context.route('https://login.live.com/**', async (route) => {
        if (route.request().resourceType() !== 'document')
          return route.continue()
        await route.fulfill({
          contentType: 'text/html',
          headers: { 'Content-Security-Policy': fixture.contentSecurityPolicy },
          body: fixture.html(true),
        })
      })
      const page = await context.newPage()
      await page.goto(fixture.destination())
      await expect(
        page.getByRole('button', { name: 'Next', exact: true }),
      ).toBeVisible()
      await expect(page.locator('html')).toHaveAttribute(
        'data-setup-metadata-settled',
        'true',
      )
      await expect(page.getByTestId('nook-auth-gate')).toBeVisible()
      await expect(page.getByTestId('nook-auth-gate')).toBeInViewport()
      await expect(page.getByTestId('nook-auth-gate')).toHaveCSS('opacity', '1')
      await page.getByTestId('nook-auth-gate').evaluate(async (panel) => {
        for (let frame = 0; frame < 4; frame++) {
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          )
          const rect = panel.getBoundingClientRect()
          if (
            !panel.isConnected ||
            rect.width === 0 ||
            rect.height === 0 ||
            rect.right <= 0 ||
            rect.bottom <= 0 ||
            rect.left >= innerWidth ||
            rect.top >= innerHeight
          )
            throw new Error('Pilot HUD did not remain painted in the viewport.')
        }
      })
      expect(setupFailures).toEqual([])
      if (!authentication) {
        // Replace only the form after real startup and classification succeeded.
        // Removing the separately mounted HUD then requires a new negative scan.
        await page
          .locator('form')
          .first()
          .evaluate((form, html) => {
            const template = document.createElement('template')
            template.innerHTML = html
            const replacement = template.content.querySelector('form')
            if (replacement) form.replaceWith(replacement)
          }, fixture.html(false))
        await expect(
          page.getByRole('button', { name: 'Subscribe', exact: true }),
        ).toBeVisible()
        await expect(page.getByTestId('nook-auth-gate')).toHaveCount(0)
      }
      await page.screenshot({
        path: testInfo.outputPath('shell.png'),
        caret: 'initial',
      })
      if (authentication) {
        await expect(page.getByTestId('nook-auth-gate')).toBeVisible()
        await expect(page.getByTestId('nook-auth-gate')).toBeInViewport()
      }
    } finally {
      await context.tracing.stop({
        path: testInfo.outputPath('production-trace.zip'),
      })
      await context.close()
    }
  })
}
