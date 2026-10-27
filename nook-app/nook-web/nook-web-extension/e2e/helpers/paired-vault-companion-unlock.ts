import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { pressIfReady } from '../../../nook-web-app/e2e/helpers/workspace-navigation'
import { VaultPanelUnlockProgress } from '../../../nook-web-app/e2e/helpers/settings-auth'
import { EXTENSION_UNLOCK_TIMEOUT_MS } from './extension-smoke-runtime'

export enum PairedVaultCompanionUnlockKind {
  Optional = 'optional',
  Required = 'required',
}

export type PairedVaultCompanionUnlock = {
  readonly context: BrowserContext
  readonly vaultPage: Page
  readonly companionUnlock: PairedVaultCompanionUnlockKind
  readonly extensionId: string
}

type CompanionPopupUnlock = {
  readonly page: Page
  readonly diagnostics: CompanionPopupDiagnostics
}

type CompanionAdoptionVisibilityOptions = {
  readonly timeout: number
}

type CompanionPopupHandle = {
  readonly page: Page
  readonly closeAfterUse: boolean
  readonly diagnostics: CompanionPopupDiagnostics
}

type CompanionPopupDiagnostics = {
  readonly failures: string[]
}

enum CompanionPopupLookupKind {
  Found = 'found',
  Missing = 'missing',
}

type CompanionPopupLookup =
  | {
      readonly kind: CompanionPopupLookupKind.Found
      readonly page: Page
    }
  | { readonly kind: CompanionPopupLookupKind.Missing }

type OwnedCompanionPopupOpen = {
  readonly context: BrowserContext
  readonly extensionId: string
  readonly ignoredPages: readonly Page[]
}

function companionPopupUrl(extensionId: string): string {
  return `chrome-extension://${extensionId}/popup/index.html`
}

function isOwnedCompanionPopup(page: Page, extensionId: string): boolean {
  return (
    !page.isClosed() && page.url().startsWith(companionPopupUrl(extensionId))
  )
}

function captureCompanionPopupDiagnostics(
  page: Page,
  extensionId: string,
): CompanionPopupDiagnostics {
  const diagnostics: CompanionPopupDiagnostics = { failures: [] }
  const extensionOrigin = `chrome-extension://${extensionId}/`
  page.on('console', (message) => {
    if (message.type() === 'error') {
      diagnostics.failures.push(`console: ${message.text()}`)
    }
  })
  page.on('pageerror', (error) => {
    diagnostics.failures.push(`page error: ${error.message}`)
  })
  page.on('requestfailed', (request) => {
    if (request.url().startsWith(extensionOrigin)) {
      const failure = request.failure()
      diagnostics.failures.push(
        `request failed: ${request.url()} ` +
          `(${failure ? failure.errorText : 'unknown'})`,
      )
    }
  })
  page.on('response', (response) => {
    if (
      response.status() >= 400 &&
      response.url().startsWith(extensionOrigin)
    ) {
      diagnostics.failures.push(`HTTP ${response.status()}: ${response.url()}`)
    }
  })
  return diagnostics
}

async function describeCompanionPopup(page: Page): Promise<string> {
  const state = await page.evaluate(() => {
    const target = document.getElementById('app')
    const testIds = Array.from(document.querySelectorAll('[data-testid]'))
      .map((element) => element.getAttribute('data-testid') || '')
      .filter(Boolean)
      .slice(0, 20)
    return {
      url: `${window.location.pathname}${window.location.search}`,
      readyState: document.readyState,
      title: document.title,
      testIds,
      appMounted: target ? target.childElementCount > 0 : false,
    }
  })
  return JSON.stringify(state)
}

async function describeCompanionRuntime(page: Page): Promise<string> {
  const state = await page.evaluate(async () => {
    const offscreenContextCount: number | string = await (async () => {
      try {
        const contexts = await chrome.runtime.getContexts({
          contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
        })
        return contexts.length
      } catch {
        return 'observation-failed'
      }
    })()

    const ensureRuntime = await new Promise<unknown>((resolve) => {
      chrome.runtime.sendMessage(
        { type: 'nook:ensure-extension-session-runtime' },
        (response: unknown) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, reason: 'runtime-message-failed' })
            return
          }
          resolve(response)
        },
      )
    })
    const reason =
      ensureRuntime &&
      typeof ensureRuntime === 'object' &&
      'ok' in ensureRuntime &&
      ensureRuntime.ok === true
        ? 'ok'
        : ensureRuntime &&
            typeof ensureRuntime === 'object' &&
            'reason' in ensureRuntime &&
            typeof ensureRuntime.reason === 'string' &&
            /^[a-z0-9-]{1,80}$/.test(ensureRuntime.reason)
          ? ensureRuntime.reason
          : 'unavailable'
    return { offscreenContextCount, ensureRuntimeReason: reason }
  })
  return JSON.stringify(state)
}

function findOwnedCompanionPopup(
  request: OwnedCompanionPopupOpen,
): CompanionPopupLookup {
  const page = request.context
    .pages()
    .find(
      (page) =>
        !request.ignoredPages.includes(page) &&
        isOwnedCompanionPopup(page, request.extensionId),
    )
  return page
    ? { kind: CompanionPopupLookupKind.Found, page }
    : { kind: CompanionPopupLookupKind.Missing }
}

async function openOwnedCompanionPopup(
  request: OwnedCompanionPopupOpen,
): Promise<CompanionPopupHandle> {
  const existingPopup = findOwnedCompanionPopup(request)
  if (existingPopup.kind === CompanionPopupLookupKind.Found) {
    return {
      page: existingPopup.page,
      closeAfterUse: false,
      diagnostics: captureCompanionPopupDiagnostics(
        existingPopup.page,
        request.extensionId,
      ),
    }
  }

  const popupPage = await request.context.newPage()
  const diagnostics = captureCompanionPopupDiagnostics(
    popupPage,
    request.extensionId,
  )
  await popupPage.goto(companionPopupUrl(request.extensionId))
  return { page: popupPage, closeAfterUse: true, diagnostics }
}

async function completeCompanionPopupUnlock(
  request: CompanionPopupUnlock,
): Promise<void> {
  const { page, diagnostics } = request
  const deviceSetup = page.getByTestId('extension-device-setup')
  const companionHome = page.getByTestId('extension-toolbar-menu')
  try {
    await expect(deviceSetup.or(companionHome)).toBeVisible({
      timeout: EXTENSION_UNLOCK_TIMEOUT_MS,
    })
  } catch (error) {
    const popupState = await describeCompanionPopup(page)
    const failures = diagnostics.failures.slice(-10)
    throw new Error(
      [
        `Companion popup did not mount its setup or toolbar view: ${popupState}`,
        ...(failures.length > 0
          ? [`Companion popup browser failures: ${failures.join(' | ')}`]
          : ['Companion popup reported no page-scoped browser failures.']),
        error instanceof Error ? error.message : 'Popup readiness timed out.',
      ].join('\n'),
      { cause: error },
    )
  }
  if (!(await deviceSetup.isVisible())) {
    return
  }
  const unlockButton = page.getByTestId('device-protection-unlock-btn')
  const runtimeError = page.getByTestId('extension-runtime-error')
  await expect(unlockButton.or(runtimeError)).toBeVisible({
    timeout: EXTENSION_UNLOCK_TIMEOUT_MS,
  })
  if (await runtimeError.isVisible()) {
    const errorText = await runtimeError.innerText()
    const runtimeState = await describeCompanionRuntime(page)
    const failures = diagnostics.failures.slice(-10)
    throw new Error(
      [
        `Companion popup runtime error: ${errorText}`,
        `Runtime diagnostics: ${runtimeState}`,
        ...(failures.length > 0
          ? [`Companion popup browser failures: ${failures.join(' | ')}`]
          : []),
      ].join('\n'),
    )
  }
  await unlockButton.click()
  await expect(companionHome).toBeVisible({
    timeout: EXTENSION_UNLOCK_TIMEOUT_MS,
  })
}

export async function unlockExtensionThroughCompanion({
  context,
  extensionId,
}: {
  context: BrowserContext
  extensionId: string
}): Promise<void> {
  const companionPopup = await openOwnedCompanionPopup({
    context,
    extensionId,
    ignoredPages: context.pages(),
  })
  try {
    await completeCompanionPopupUnlock(companionPopup)
  } finally {
    if (companionPopup.closeAfterUse && !companionPopup.page.isClosed()) {
      await companionPopup.page.close()
    }
  }
}

/** A locked vault unlocks from its panel beside the identity card. */
export async function startVaultPanelUnlock(vaultPage: Page): Promise<void> {
  const row = vaultPage.getByTestId('identity-vault-row').first()
  const unlock = vaultPage.getByTestId('vault-panel-unlock')
  const continued = vaultPage
    .getByTestId('authenticated-shell')
    .or(vaultPage.getByTestId('vault-panel-open'))
    .or(vaultPage.getByTestId('passkey-auth-overlay'))
    .first()
  const closedRow = row.and(vaultPage.locator(':not([aria-expanded="true"])'))
  // On an unlocked identity the row opens its vault: the click is the request.
  const liveClosedRow = closedRow.and(
    vaultPage.locator(
      '[data-testid="identity-card"][data-status="unlocked"] [data-testid="identity-vault-row"]',
    ),
  )
  // An identity that the paired extension restores while its vault panel
  // is open loses the panel's Unlock, and its vault opens only as a panel
  // opens on the unlocked identity: close that panel to open it again.
  const liveOpenRow = row.and(
    vaultPage.locator(
      '[data-testid="identity-card"][data-status="unlocked"] [data-testid="identity-vault-row"][aria-expanded="true"]',
    ),
  )
  const gettingAccess = vaultPage.getByTestId('vault-panel-getting-access')
  // The restored identity may unlock itself while its old button disappears.
  await expect
    .poll(
      async () => {
        switch (await continued.isVisible()) {
          case true:
            return VaultPanelUnlockProgress.Continued
          case false:
            break
        }
        switch (await pressIfReady(unlock)) {
          case true:
            return VaultPanelUnlockProgress.Requested
          case false:
            break
        }
        switch (await pressIfReady(liveClosedRow)) {
          case true:
            return VaultPanelUnlockProgress.Requested
          case false:
            break
        }
        switch (await gettingAccess.isVisible()) {
          case true:
            return VaultPanelUnlockProgress.Waiting
          case false:
            break
        }
        switch (await pressIfReady(liveOpenRow)) {
          case true:
            return VaultPanelUnlockProgress.Waiting
          case false:
            break
        }
        await pressIfReady(closedRow)
        return VaultPanelUnlockProgress.Waiting
      },
      { timeout: EXTENSION_UNLOCK_TIMEOUT_MS },
    )
    .not.toBe(VaultPanelUnlockProgress.Waiting)
}

/** An unlocked vault waits on the identities page until Open vault. */
export async function expectVaultOpened(
  vaultPage: Page,
  timeout = EXTENSION_UNLOCK_TIMEOUT_MS,
): Promise<void> {
  const shell = vaultPage.getByTestId('authenticated-shell')
  const open = vaultPage.getByTestId('vault-panel-open')
  try {
    await expect
      .poll(
        async () => {
          if (await shell.isVisible()) return true
          await pressIfReady(open)
          return false
        },
        { timeout },
      )
      .toBe(true)
  } catch (error) {
    const state = await describeVaultPage(vaultPage)
    await test.info().attach('vault-page-at-open-timeout.png', {
      body: await vaultPage.screenshot({ fullPage: true }),
      contentType: 'image/png',
    })
    throw new Error(`Vault did not open: ${state}`, { cause: error })
  }
}

/** The identity cards, vault rows and panel the open-vault poll reads. */
async function describeVaultPage(page: Page): Promise<string> {
  const state = await page.evaluate(() => {
    const attributes = (element: Element, names: readonly string[]) =>
      Object.fromEntries(names.map((name) => [name, element.getAttribute(name)]))
    const byTestId = (testId: string) =>
      Array.from(document.querySelectorAll(`[data-testid="${testId}"]`))
    return {
      url: `${window.location.pathname}${window.location.search}`,
      cards: byTestId('identity-card').map((card) =>
        attributes(card, ['data-status']),
      ),
      rows: byTestId('identity-vault-row').map((row) => ({
        ...attributes(row, ['data-state', 'aria-expanded']),
        disabled: (row as HTMLButtonElement).disabled,
      })),
      panel: byTestId('identity-card-vault').length > 0,
      open: byTestId('vault-panel-open').map((button) => ({
        disabled: (button as HTMLButtonElement).disabled,
      })),
      alerts: Array.from(document.querySelectorAll('[role="alert"]')).map(
        (alert) => alert.textContent?.trim().slice(0, 200) ?? '',
      ),
      testIds: Array.from(document.querySelectorAll('[data-testid]'))
        .map((element) => element.getAttribute('data-testid') ?? '')
        .filter(Boolean)
        .slice(0, 60),
    }
  })
  return JSON.stringify(state)
}

export async function unlockPairedVaultThroughCompanion(
  request: PairedVaultCompanionUnlock,
): Promise<void> {
  const { context, vaultPage, companionUnlock, extensionId } = request
  const authenticatedShell = vaultPage.getByTestId('authenticated-shell')
  const unlockButton = vaultPage.getByTestId('identity-vault-row').first()
  const adoptionVisibilityOptions: CompanionAdoptionVisibilityOptions = {
    timeout: EXTENSION_UNLOCK_TIMEOUT_MS,
  }

  await expect(authenticatedShell.or(unlockButton)).toBeVisible({
    timeout: EXTENSION_UNLOCK_TIMEOUT_MS,
  })
  const authenticated = await authenticatedShell.isVisible()
  if (
    companionUnlock === PairedVaultCompanionUnlockKind.Required &&
    authenticated
  ) {
    await unlockExtensionThroughCompanion({ context, extensionId })
  } else if (!authenticated) {
    const existingCompanionPages = context
      .pages()
      .filter((page) => isOwnedCompanionPopup(page, extensionId))
    await startVaultPanelUnlock(vaultPage)
    await expect(vaultPage.getByTestId('passkey-auth-overlay')).toHaveCount(0)

    if (companionUnlock === PairedVaultCompanionUnlockKind.Optional) {
      try {
        await expectVaultOpened(vaultPage)
      } catch {
        const companionPopup = await openOwnedCompanionPopup({
          context,
          extensionId,
          ignoredPages: existingCompanionPages,
        })
        try {
          await completeCompanionPopupUnlock(companionPopup)
          await expectVaultOpened(vaultPage, adoptionVisibilityOptions.timeout)
        } finally {
          if (companionPopup.closeAfterUse && !companionPopup.page.isClosed()) {
            await companionPopup.page.close()
          }
        }
      }
    } else {
      // The vault opens the browser-owned side panel, which Playwright does not
      // expose as a Page; the same packaged auth UI unlocks from a tab.
      const companionPopup = await openOwnedCompanionPopup({
        context,
        extensionId,
        ignoredPages: existingCompanionPages,
      })
      try {
        await completeCompanionPopupUnlock(companionPopup)
        await expectVaultOpened(vaultPage, adoptionVisibilityOptions.timeout)
      } finally {
        if (companionPopup.closeAfterUse && !companionPopup.page.isClosed()) {
          await companionPopup.page.close()
        }
      }
    }
  }

  await expect(authenticatedShell).toBeVisible({
    timeout: EXTENSION_UNLOCK_TIMEOUT_MS,
  })
}
