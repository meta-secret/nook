import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import { UI_TIMEOUT_MS } from '../helpers'

enum WasmReleaseSignalKind {
  Blocked = 'blocked',
  Releasable = 'releasable',
}

type WasmReleaseSignal =
  | { kind: WasmReleaseSignalKind.Blocked }
  | { kind: WasmReleaseSignalKind.Releasable; release(): void }

async function openDuringBlockedWasm(page: Page): Promise<WasmReleaseSignal> {
  let signal: WasmReleaseSignal = { kind: WasmReleaseSignalKind.Blocked }
  const releasePromise = new Promise<void>((resolve) => {
    signal = { kind: WasmReleaseSignalKind.Releasable, release: resolve }
  })
  let markStarted = () => {}
  const started = new Promise<void>((resolve) => {
    markStarted = resolve
  })
  await page.route(/nook_wasm_bg.*\.wasm$/, async (route) => {
    markStarted()
    await releasePromise
    await route.continue()
  })
  const gotoOptions: Parameters<typeof page.goto>[1] = { waitUntil: 'commit' }
  await page.goto('/app/', gotoOptions)
  await started
  return signal
}

test('shows an honest vault shell while the engine loads', async ({ page }) => {
  const releaseSignal = await openDuringBlockedWasm(page)
  const startupShell = page.getByTestId('vault-startup-shell')
  await expect(startupShell).toBeVisible()
  await expect(startupShell).toHaveAttribute('aria-busy', 'true')
  await expect(startupShell).toContainText('Loading engine…')

  if (releaseSignal.kind === WasmReleaseSignalKind.Releasable) {
    releaseSignal.release()
  }
  const readyOptions = { timeout: UI_TIMEOUT_MS }
  await expect(page.getByTestId('login-create-vault-chooser')).toBeVisible(
    readyOptions,
  )
  await expect(startupShell).toHaveCount(0)
})

test('shows a localized error when the vault engine cannot initialize', async ({
  page,
}) => {
  const startupError = page.waitForEvent('pageerror')
  await page.addInitScript(() => {
    localStorage.setItem('nook_locale', 'ru')
  })
  await page.route(/nook_wasm_bg.*\.wasm$/, async (route) => {
    const response: Parameters<typeof route.fulfill>[0] = {
      status: 200,
      contentType: 'application/wasm',
      body: 'not-webassembly',
    }
    await route.fulfill(response)
  })
  const gotoOptions: Parameters<typeof page.goto>[1] = { waitUntil: 'commit' }
  await page.goto('/app/', gotoOptions)

  const startupShell = page.getByTestId('vault-startup-shell')
  await expect(startupShell).toBeVisible()
  await expect(startupShell).toHaveAttribute('aria-busy', 'false')
  await expect(startupShell).toHaveAttribute('data-state', 'unavailable')
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru')
  await expect(startupShell).toContainText(
    'Движок сейфа недоступен. Обновите страницу и повторите попытку.',
  )
  expect((await startupError).message.length).toBeGreaterThan(0)
})

test('ignores inherited locale catalog property names', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('nook_locale', 'constructor')
  })
  const releaseSignal = await openDuringBlockedWasm(page)
  const startupShell = page.getByTestId('vault-startup-shell')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(startupShell).toContainText('Loading engine…')

  if (releaseSignal.kind === WasmReleaseSignalKind.Releasable) {
    releaseSignal.release()
  }
})
