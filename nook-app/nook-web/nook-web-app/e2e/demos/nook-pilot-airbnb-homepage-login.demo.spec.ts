import { expect, test } from '../fixtures'
import {
  demoBeat,
  injectPilotAutofill,
  loadPilotMessages,
} from './pilot-demo-helpers'
import { demoDomainEnumArgs, installDemoChromeStub } from './static-chrome-stub'

test('detect and fill the Airbnb homepage login modal', async ({ page }) => {
  const messages = await loadPilotMessages()
  const stubArgs = {
    localizedMessages: messages,
    ...demoDomainEnumArgs,
    loginPilotFlow: true,
  }
  await page.addInitScript(installDemoChromeStub, stubArgs)
  await page.route('https://www.airbnb.com/**', async (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<!doctype html>
        <html><head><title>Airbnb login modal</title></head>
        <body><main>
          <form action="/homes" aria-label="Search">
            <input type="search" aria-label="Where">
          </form>
          <div role="dialog" aria-label="Log in or sign up">
            <button type="button" aria-label="Close"></button>
            <h1>Log in or sign up</h1>
            <form action="/" data-testid="airbnb-auth-form">
              <label for="phone-or-email">Phone number or email</label>
              <input id="phone-or-email" type="text" inputmode="email" autocomplete="tel-national">
              <button type="submit">Continue</button>
            </form>
            <button type="button" aria-label="Continue with Google"></button>
            <button type="button" aria-label="Continue with Apple"></button>
          </div>
          <p id="site-status" role="status"></p>
          <script>
            const form = document.querySelector('[data-testid="airbnb-auth-form"]')
            const identity = form.querySelector('#phone-or-email')
            const status = document.querySelector('#site-status')
            let primaryActivations = 0
            let alternativeActivations = 0
            document.querySelectorAll('[aria-label^="Continue with"]').forEach((control) => {
              control.addEventListener('click', () => {
                alternativeActivations += 1
              })
            })
            form.addEventListener('submit', (event) => {
              event.preventDefault()
              primaryActivations += 1
              if (identity.value === 'pilot@example.test' && primaryActivations === 1 && alternativeActivations === 0) {
                status.textContent = 'Airbnb authentication complete'
              }
            })
          </script>
        </main></body></html>`,
    }),
  )
  await page.goto('https://www.airbnb.com/')
  await injectPilotAutofill(page)

  const form = page.getByTestId('airbnb-auth-form')
  const identity = form.getByLabel('Phone number or email')
  const widget = page.locator('#nook-auth-widget')
  await expect(page).toHaveURL('https://www.airbnb.com/')
  await expect(page.locator('form')).toHaveCount(2)
  await expect(page.locator('[role="dialog"]')).toBeVisible()
  await expect(widget.getByText('Ready to sign in')).toBeVisible()

  await widget.getByRole('button', { name: 'Continue with Nook' }).click()

  await expect(identity).toHaveValue('pilot@example.test')
  await expect(page.getByRole('status')).toHaveText(
    'Airbnb authentication complete',
  )
  await expect(page.locator('[aria-label="Continue with Google"]')).toHaveCount(1)
  await expect(page.locator('[aria-label="Continue with Apple"]')).toHaveCount(1)
  await demoBeat(page)
})
