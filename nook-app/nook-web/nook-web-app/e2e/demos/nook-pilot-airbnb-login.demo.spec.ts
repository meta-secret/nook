import { expect, test } from '../fixtures'
import {
  demoBeat,
  injectPilotAutofill,
  loadPilotMessages,
} from './pilot-demo-helpers'
import { demoDomainEnumArgs, installDemoChromeStub } from './static-chrome-stub'

test('fill and continue through the Airbnb mixed identity surface', async ({
  page,
}) => {
  const messages = await loadPilotMessages()
  const stubArgs = {
    localizedMessages: messages,
    ...demoDomainEnumArgs,
    loginPilotFlow: true,
  }
  await page.addInitScript(installDemoChromeStub, stubArgs)
  await page.goto('/login')
  const localOrigin = new URL(page.url()).origin
  const externalRequests: string[] = []
  page.on('request', (request) => {
    const target = new URL(request.url())
    if (
      (target.protocol === 'http:' || target.protocol === 'https:') &&
      target.origin !== localOrigin
    ) {
      externalRequests.push(request.url())
    }
  })
  await page.setContent(`<!doctype html>
    <html><head><style>:root { color-scheme: light; font-family: Inter, system-ui, sans-serif; } * { box-sizing: border-box; } body { margin: 0; min-height: 100vh; color: #222; background: #fff; } main { width: min(460px, calc(100vw - 48px)); margin: 80px auto; padding: 32px; border: 1px solid #ddd; border-radius: 14px; } form, label { display: grid; gap: 10px; } button, input { min-height: 48px; width: 100%; margin: 7px 0; padding: 11px 13px; border: 1px solid #777; border-radius: 8px; background: #fff; color: inherit; font: inherit; } form button { background: #e51d55; border-color: #e51d55; color: #fff; font-weight: 700; } [aria-label^="Continue with"] { font-weight: 650; } #site-status { min-height: 24px; color: #167342; }</style></head>
      <body><main>
        <form><label>Phone number or email<input type="text" inputmode="email" autocomplete="tel-national"></label><button type="submit">Continue</button></form>
        <button type="button" aria-label="Continue with Google"></button><button type="button" aria-label="Continue with Apple"></button>
        <p id="site-status" role="status" data-primary-activations="0" data-alternative-activations="0"></p>
      </main><script>const form = document.querySelector('form'); const identity = form.querySelector('input'); const status = document.querySelector('#site-status'); let primaryActivations = 0; let alternativeActivations = 0; document.querySelectorAll('[aria-label^="Continue with"]').forEach((control) => { control.addEventListener('click', () => { alternativeActivations += 1; status.dataset.alternativeActivations = String(alternativeActivations); }); }); form.addEventListener('submit', (event) => { event.preventDefault(); primaryActivations += 1; status.dataset.primaryActivations = String(primaryActivations); if (identity.value === 'pilot@example.test' && primaryActivations === 1 && alternativeActivations === 0) status.textContent = 'Airbnb authentication complete'; });</script>
      </body></html>`)
  await page.evaluate(installDemoChromeStub, stubArgs)
  await injectPilotAutofill(page)

  const form = page.locator('form')
  const identity = form.getByLabel('Phone number or email')
  const primary = form.getByRole('button', { name: 'Continue' })
  const widget = page.locator('#nook-auth-widget')
  await expect(page).toHaveURL(/\/login$/u)
  await expect(page.locator('form')).toHaveCount(1)
  await expect(form).not.toHaveAttribute('method')
  await expect(form).not.toHaveAttribute('action')
  await expect(form).toHaveJSProperty('method', 'get')
  await expect(identity).toHaveAttribute('type', 'text')
  await expect(identity).not.toHaveAttribute('name')
  await expect(identity).not.toHaveAttribute('aria-label')
  await expect(identity).toHaveAttribute('inputmode', 'email')
  await expect(identity).toHaveAttribute('autocomplete', 'tel-national')
  await expect(primary).toHaveAttribute('type', 'submit')
  for (const attribute of ['id', 'name', 'value', 'class', 'data-testid']) {
    await expect(primary).not.toHaveAttribute(attribute)
  }
  for (const name of ['Continue with Google', 'Continue with Apple']) {
    const alternative = page.getByRole('button', { name })
    await expect(alternative).toHaveAttribute('type', 'button')
    expect(
      await alternative.evaluate((button) => {
        if (!(button instanceof HTMLButtonElement)) {
          throw new Error('Expected an alternative login button.')
        }
        return !button.form
      }),
    ).toBe(true)
  }
  await expect(page.locator('[role="dialog"]')).toHaveCount(0)
  await expect(widget.getByText('Ready to sign in')).toBeVisible()

  await widget.getByRole('button', { name: 'Continue with Nook' }).click()
  await widget.getByRole('button', { name: 'Continue with Nook' }).click()

  const status = page.getByRole('status')
  await expect(identity).toHaveValue('pilot@example.test')
  await expect(status).toHaveText('Airbnb authentication complete')
  await expect(status).toHaveAttribute('data-primary-activations', '1')
  await expect(status).toHaveAttribute('data-alternative-activations', '0')
  expect(externalRequests).toEqual([])
  await demoBeat(page)
})
