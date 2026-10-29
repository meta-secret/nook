import { expect, type BrowserContext, type Page } from '@playwright/test'
import { EXTENSION_UNLOCK_TIMEOUT_MS } from './extension-smoke-runtime'

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
