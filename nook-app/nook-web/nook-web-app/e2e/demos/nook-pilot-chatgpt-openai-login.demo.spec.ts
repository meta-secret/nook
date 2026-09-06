import { expect, test } from '../fixtures'
import {
  demoBeat,
  injectPilotAutofill,
  loadPilotMessages,
} from './pilot-demo-helpers'
import { demoDomainEnumArgs, installDemoChromeStub } from './static-chrome-stub'

test('continue from ChatGPT GET to OpenAI POST authentication', async ({
  page,
}) => {
  const messages = await loadPilotMessages()
  const stubArgs = {
    localizedMessages: messages,
    ...demoDomainEnumArgs,
    loginPilotFlow: true,
  }
  await page.addInitScript(installDemoChromeStub, stubArgs)
  await page.goto('/auth/login')
  await page.setContent(`<!doctype html>
    <html><head><title>ChatGPT and OpenAI sign in</title><style>:root { color-scheme: dark; font-family: Inter, system-ui, sans-serif; } * { box-sizing: border-box; } body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0d0d0d; color: #f4f4f4; } main { width: min(440px, calc(100vw - 48px)); padding: 40px; border: 1px solid #343434; border-radius: 20px; background: #171717; box-shadow: 0 28px 90px #0009; } h1 { text-align: center; } form { display: grid; gap: 12px; } input, button { min-height: 48px; padding: 11px 14px; border: 1px solid #4a4a4a; border-radius: 10px; background: #242424; color: inherit; font: inherit; } [type='submit'] { background: #f4f4f4; color: #171717; font-weight: 750; } #site-status { min-height: 24px; color: #8fddb0; }</style></head>
      <body><main id="auth-surface"><h1>Log in or sign up</h1><p data-testid="auth-step">ChatGPT · GET</p><form method="get" action="/auth/login"><button type="button">Continue with Google</button><button type="button">Continue with Apple</button><button type="button">Continue with phone</button><input id="email" name="email" type="email" autocomplete="email" aria-label="Email address" placeholder="Email address"><button name="intent" type="submit" value="chatgpt-continue">Continue</button></form></main>
        <script>const surface = document.querySelector('#auth-surface'); surface.addEventListener('submit', (event) => { event.preventDefault(); const form = event.target; if (!(form instanceof HTMLFormElement) || form.method.endsWith('get') && (event.submitter?.value !== 'chatgpt-continue' || form.elements.email.value !== 'pilot@example.test')) return; if (form.method.endsWith('get')) { history.pushState({}, '', '/log-in-or-create-account'); surface.innerHTML = '<h1>Log in or sign up</h1><p data-testid="auth-step">OpenAI · POST</p><form id="openai-social-form" method="post" hidden></form><form id="openai-identifier-form" method="post" action="/log-in-or-create-account"><button name="intent" type="submit" value="google" form="openai-social-form">Continue with Google</button><button name="intent" type="submit" value="apple" form="openai-social-form">Continue with Apple</button><button name="intent" type="submit" value="microsoft" form="openai-social-form">Continue with Microsoft</button><button type="button">Continue with phone</button><input id="email" name="email" type="email" autocomplete="email" aria-label="Email address" placeholder="Email address"><button name="intent" type="submit" value="openai-continue">Continue</button></form><p id="site-status" role="status"></p>'; return; } if (event.submitter?.value === 'openai-continue' && form.elements.email.value === 'pilot@example.test') document.querySelector('#site-status').textContent = 'OpenAI authentication complete'; });</script>
      </body></html>`)
  await page.evaluate(installDemoChromeStub, stubArgs)
  await injectPilotAutofill(page)

  const widget = page.locator('#nook-auth-widget')
  await expect(page.getByTestId('auth-step')).toHaveText('ChatGPT · GET')
  await expect(widget.getByText('Ready to sign in')).toBeVisible()
  await widget.getByRole('button', { name: 'Continue with Nook' }).click()
  await widget.getByRole('button', { name: 'Continue with Nook' }).click()

  await expect(page.getByTestId('auth-step')).toHaveText('OpenAI · POST')
  await expect(page.locator('input[type="password"]')).toHaveCount(0)
  await expect(widget.getByText('Ready to sign in')).toBeVisible()
  await widget.getByRole('button', { name: 'Continue with Nook' }).click()
  await expect(page.getByRole('status')).toHaveText(
    'OpenAI authentication complete',
  )
  await demoBeat(page)
})
