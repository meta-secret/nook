import { expect, type BrowserContext, type Page } from '@playwright/test'
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

async function waitForOwnedCompanionPopup(
  request: OwnedCompanionPopupOpen,
): Promise<CompanionPopupHandle> {
  const existingPopup = findOwnedCompanionPopup(request)
  if (existingPopup.kind === CompanionPopupLookupKind.Found) {
    return {
      page: existingPopup.page,
      closeAfterUse: true,
      diagnostics: captureCompanionPopupDiagnostics(
        existingPopup.page,
        request.extensionId,
      ),
    }
  }

  const popupPage = await request.context.waitForEvent('page', {
    timeout: EXTENSION_UNLOCK_TIMEOUT_MS,
    predicate: (page) =>
      !request.ignoredPages.includes(page) &&
      isOwnedCompanionPopup(page, request.extensionId),
  })
  return {
    page: popupPage,
    closeAfterUse: true,
    diagnostics: captureCompanionPopupDiagnostics(
      popupPage,
      request.extensionId,
    ),
  }
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
  await page.getByTestId('device-protection-unlock-btn').click()
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

export async function unlockPairedVaultThroughCompanion(
  request: PairedVaultCompanionUnlock,
): Promise<void> {
  const { context, vaultPage, companionUnlock, extensionId } = request
  const authenticatedShell = vaultPage.getByTestId('authenticated-shell')
  const unlockButton = vaultPage.getByTestId('unlock-vault-btn')

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
    await unlockButton.click()
    await expect(vaultPage.getByTestId('passkey-auth-overlay')).toHaveCount(0)

    if (companionUnlock === PairedVaultCompanionUnlockKind.Optional) {
      try {
        await expect(authenticatedShell).toBeVisible({
          timeout: EXTENSION_UNLOCK_TIMEOUT_MS,
        })
      } catch {
        const companionPopup = await waitForOwnedCompanionPopup({
          context,
          extensionId,
          ignoredPages: existingCompanionPages,
        })
        try {
          await completeCompanionPopupUnlock(companionPopup)
        } finally {
          if (companionPopup.closeAfterUse && !companionPopup.page.isClosed()) {
            await companionPopup.page.close()
          }
        }
      }
    } else {
      const companionPopup = await waitForOwnedCompanionPopup({
        context,
        extensionId,
        ignoredPages: existingCompanionPages,
      })
      try {
        await completeCompanionPopupUnlock(companionPopup)
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
