import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  extensionDir,
  getServiceWorker,
  launchExtensionContext,
} from './helpers/extension-smoke-runtime'

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
    </main></body></html>`
  }
}

for (const authentication of [true, false]) {
  test(`production extension ${authentication ? 'admits Microsoft identifier' : 'rejects unrelated email'} with live structural bounds and CSP`, async ({
    baseURL: _baseURL,
  }, testInfo) => {
    const fixture = new MicrosoftIdentifierShellFixture()
    const manifest = await readFile(
      path.join(extensionDir, 'manifest.json'),
      'utf8',
    )
    expect(manifest).toMatch(/"version_name"\s*:\s*"[^"]*\(production,/u)
    await testInfo.attach('production-extension-manifest', {
      body: manifest,
      contentType: 'application/json',
    })
    expect(new TextEncoder().encode(fixture.machineIdentity)).toHaveLength(581)
    expect(new TextEncoder().encode(fixture.destination())).toHaveLength(2141)
    const context = await launchExtensionContext(testInfo.outputPath('profile'))
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
      await expect(page.getByTestId('nook-auth-gate')).toBeVisible()
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
      await page.screenshot({ path: testInfo.outputPath('shell.png') })
    } finally {
      await context.tracing.stop({
        path: testInfo.outputPath('production-trace.zip'),
      })
      await context.close()
    }
  })
}
