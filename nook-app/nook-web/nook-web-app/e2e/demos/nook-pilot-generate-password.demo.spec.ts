import { expect, test } from '../fixtures'
import {
  demoBeat,
  injectPilotAutofill,
  loadPilotMessages,
} from './pilot-demo-helpers'
import { installDemoChromeStub } from './static-chrome-stub'

test('generate a signup password through Nook Pilot', async ({ page }) => {
  const messages = await loadPilotMessages()
  const stubArgs = {
    localizedMessages: messages,
    generatePilotFlow: true,
  }

  await page.addInitScript(installDemoChromeStub, stubArgs)

  await page.goto('/')
  await page.setContent(`<!doctype html>
    <html>
      <head>
        <title>Example account signup</title>
        <style>
          :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
          * { box-sizing: border-box; }
          body {
            min-height: 100vh;
            margin: 0;
            display: grid;
            place-items: center;
            background:
              radial-gradient(circle at 20% 10%, rgb(48 57 79 / 55%), transparent 36%),
              linear-gradient(145deg, #11131a, #090a0f 70%);
            color: #f7f7f8;
          }
          main {
            width: min(440px, calc(100vw - 48px));
            padding: 42px;
            border: 1px solid rgb(255 255 255 / 10%);
            border-radius: 22px;
            background: rgb(24 26 35 / 92%);
            box-shadow: 0 28px 90px rgb(0 0 0 / 45%);
          }
          .eyebrow { margin: 0 0 10px; color: #9ca5b9; font-size: 12px; letter-spacing: .14em; text-transform: uppercase; }
          h1 { margin: 0 0 10px; font-size: 32px; }
          .intro { margin: 0 0 28px; color: #aeb4c1; line-height: 1.5; }
          form { display: grid; gap: 18px; }
          label { display: grid; gap: 8px; color: #d8dbe3; font-size: 13px; font-weight: 650; }
          input {
            width: 100%;
            min-height: 48px;
            padding: 12px 14px;
            border: 1px solid rgb(255 255 255 / 12%);
            border-radius: 10px;
            background: #11131a;
            color: #f7f7f8;
            font: inherit;
          }
          form > button {
            min-height: 48px;
            border: 0;
            border-radius: 10px;
            background: #eef0f4;
            color: #171921;
            font: 750 14px/1 Inter, ui-sans-serif, system-ui, sans-serif;
          }
        </style>
      </head>
      <body>
        <main>
          <p class="eyebrow">Example account</p>
          <h1>Create account</h1>
          <p class="intro">Nook can generate a strong password for this signup.</p>
          <form id="signup-form">
            <label>Email<input autocomplete="username" name="email" type="email"></label>
            <label>Password<input autocomplete="new-password" name="password" type="password"></label>
            <label>Confirm<input autocomplete="new-password" name="password-confirm" type="password"></label>
            <button type="submit">Create account</button>
          </form>
        </main>
      </body>
    </html>`)
  await page.evaluate(() => {
    document
      .querySelector('#signup-form')
      ?.addEventListener('submit', (event) => {
        event.preventDefault()
      })
  })
  await page.evaluate(installDemoChromeStub, stubArgs)
  await injectPilotAutofill(page)

  const widget = page.locator('#nook-auth-widget')
  await expect(widget.getByText('Signup detected')).toBeVisible()
  await demoBeat(page)

  await widget.getByRole('button', { name: 'Generate password' }).click()
  await expect(
    widget.getByText(/new password is filled|пароль заполнен/i),
  ).toBeVisible()
  await expect(page.locator('input[name="password"]')).not.toHaveValue('')
  await expect(page.locator('input[name="password-confirm"]')).toHaveValue(
    await page.locator('input[name="password"]').inputValue(),
  )
  await demoBeat(page)
})
