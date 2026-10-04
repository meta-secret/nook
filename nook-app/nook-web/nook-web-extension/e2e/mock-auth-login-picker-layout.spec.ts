import { expect, test } from '@playwright/test'
import {
  launchPairedPinExtension,
  saveVaultLogin,
  unlockExtensionPopupPin,
} from './helpers/paired-pin-extension'
import { startMockAuthServer } from './mock-auth'
import { getServiceWorker } from './helpers/extension-smoke-runtime'

test.describe('PIN Pilot mock-auth coverage', () => {
  test.describe.configure({ timeout: 180_000 })
  test('shows extension-owned login picker usernames and completes plain success', async ({
    browserName,
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')
    const mockAuth = await startMockAuthServer()
    const paired = await launchPairedPinExtension(testInfo, {
      vaultName: 'Mock auth chooser vault with a long account collection label',
    })
    try {
      await saveVaultLogin(
        paired.vaultPage,
        mockAuth.origin,
        'alice@nook.test',
        'extension-fill-password',
      )
      await saveVaultLogin(
        paired.vaultPage,
        mockAuth.origin,
        'bob@nook.test',
        'second-extension-password',
      )
      const loginPage = await paired.context.newPage()
      await loginPage.goto(`${mockAuth.origin}/plain/login`)
      const widget = loginPage.locator('#nook-auth-widget')
      await expect(widget.getByText('Ready to sign in')).toBeVisible()
      await expect(
        widget.getByTestId('nook-auth-gate-vault-status'),
      ).toHaveText('Matching saved logins: 2')
      await expect(
        widget.getByText(
          'Multiple saved logins match this site. Continue shows the choices here. Nook fills and submits only after you choose one.',
        ),
      ).toBeVisible()
      await expect(widget.getByText('Mock auth chooser vault')).toHaveCount(0)
      await expect(loginPage.locator('input[name="username"]')).toHaveValue('')
      await expect(loginPage.locator('input[name="password"]')).toHaveValue('')
      await unlockExtensionPopupPin(paired.context, paired.extensionId)
      const pageCount = paired.context.pages().length
      const worker = await getServiceWorker(paired.context)
      await worker.evaluate(() => {
        chrome.windows.create = () => {
          throw new Error('Login selection must stay in the inline panel')
        }
      })
      await widget.getByRole('button', { name: 'Continue with Nook' }).click()
      await expect(widget.getByText('alice@nook.test')).toHaveCount(0)
      await expect(widget.getByText('bob@nook.test')).toHaveCount(0)
      const iframe = widget.getByTestId('nook-inline-login-picker')
      await expect(iframe).toBeVisible()
      await expect(iframe).toHaveAttribute(
        'src',
        `chrome-extension://${paired.extensionId}/login-picker/index.html`,
      )
      const loginPicker = iframe.contentFrame()
      const firstRow = loginPicker.getByRole('button').first()
      await expect(loginPicker.getByText('alice@nook.test')).toBeVisible({
        timeout: 20_000,
      })
      await expect(loginPicker.getByText('bob@nook.test')).toBeVisible()
      await expect(loginPicker.getByTestId('login-search')).toBeFocused()
      const layouts = [
        { width: 1280, height: 720, colorScheme: 'light' as const },
        { width: 1280, height: 720, colorScheme: 'dark' as const },
        { width: 360, height: 740, colorScheme: 'light' as const },
        { width: 360, height: 740, colorScheme: 'dark' as const },
      ]
      for (const layout of layouts) {
        await loginPage.setViewportSize({
          width: layout.width,
          height: layout.height,
        })
        await loginPage.emulateMedia({ colorScheme: layout.colorScheme })
        const bounds = await widget.evaluate((element) => {
          const rect = element.getBoundingClientRect()
          return { left: rect.left, right: rect.right, bottom: rect.bottom }
        })
        expect(bounds.left).toBeGreaterThanOrEqual(0)
        expect(bounds.right).toBeLessThanOrEqual(layout.width)
        expect(bounds.bottom).toBeLessThanOrEqual(layout.height)
        const panel = widget.locator('.panel')
        await panel.evaluate((element) => {
          element.scrollTop = element.scrollHeight
        })
        const cancelVisibility: { ratio: number } = { ratio: 1 }
        await expect(
          widget.locator('.inline-login-picker-cancel'),
        ).toBeInViewport(cancelVisibility)
        await panel.evaluate((element) => {
          element.scrollTop = 0
        })
        const surface = loginPicker.getByTestId('login-picker')
        await surface.evaluate(() => window.scrollTo(0, 0))
        expect(
          await surface.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(await surface.evaluate(() => window.innerWidth))
        expect(
          await surface.evaluate(
            () => getComputedStyle(document.documentElement).colorScheme,
          ),
        ).toBe('dark')
        await testInfo.attach(
          `inline-login-${layout.width}-${layout.colorScheme}`,
          {
            body: await loginPage.screenshot({
              caret: 'initial',
              path: testInfo.outputPath(
                `inline-login-${layout.width}-${layout.colorScheme}.png`,
              ),
            }),
            contentType: 'image/png',
          },
        )
        await expect(firstRow).toBeInViewport({ ratio: 1 })
        await loginPicker.getByTestId('login-search').focus()
        await loginPicker.getByTestId('login-search').press('Tab')
        await expect(firstRow).toBeFocused()
        await loginPicker.getByTestId('login-results').hover()
        await loginPage.mouse.wheel(0, 120)
        await expect(iframe).toBeVisible()
        await expect(loginPicker.getByTestId('login-search')).toBeInViewport({
          ratio: 1,
        })
      }
      expect(paired.context.pages()).toHaveLength(pageCount)
      expect(
        await loginPage.evaluate(() => {
          const host = document.getElementById('nook-auth-widget')
          const frame = host?.shadowRoot?.querySelector('iframe')
          return (
            frame instanceof HTMLIFrameElement &&
            !(frame.contentDocument instanceof Document)
          )
        }),
      ).toBe(true)
      await loginPicker.getByTestId('login-search').fill('bob')
      await expect(loginPicker.getByText('alice@nook.test')).toHaveCount(0)
      await expect(loginPicker.getByText('bob@nook.test')).toBeVisible()
      await loginPicker.getByTestId('login-search').fill('')
      await expect(loginPicker.getByText('alice@nook.test')).toBeVisible()
      await loginPicker
        .getByRole('button', { name: /alice@nook\.test/ })
        .click()
      await expect(loginPage.getByTestId('mock-auth-success')).toHaveText(
        'Authentication complete',
        { timeout: 20_000 },
      )
      await expect(iframe).toHaveCount(0)
    } finally {
      await paired.context.close()
      await mockAuth.close()
    }
  })
})
