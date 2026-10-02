export type AuthSidePanelContext = Pick<
  chrome.runtime.ExtensionContext,
  'contextType' | 'documentId' | 'documentUrl' | 'windowId'
>

const sidePanelContextType = 'SIDE_PANEL' as const

export enum AuthSidePanelWindowLookupKind {
  Found = 'found',
  NotFound = 'not-found',
}

export enum AuthSidePanelDismissalFailureReason {
  NotSidePanelDocument = 'not-side-panel-document',
  SidePanelCloseFailed = 'side-panel-close-failed',
}

export type AuthSidePanelDismissalRuntime = {
  readonly extensionUrl: (path: string) => string
  readonly getContexts: (
    filter: chrome.runtime.ContextFilter,
  ) => Promise<chrome.runtime.ExtensionContext[]>
  readonly close: (
    options: Parameters<typeof chrome.sidePanel.close>[0],
  ) => Promise<void>
}

export type AuthSidePanelWindowIdLookup = {
  readonly contexts: readonly AuthSidePanelContext[]
  readonly documentId: string
  readonly documentUrl: string
}

export type AuthSidePanelWindowLookupResult =
  | {
      readonly kind: AuthSidePanelWindowLookupKind.Found
      readonly windowId: number
    }
  | { readonly kind: AuthSidePanelWindowLookupKind.NotFound }

export type AuthSidePanelDismissalRequest = {
  readonly sender: Pick<chrome.runtime.MessageSender, 'documentId'>
  readonly runtime?: AuthSidePanelDismissalRuntime
}

export type AuthSidePanelDismissalResponse =
  | { readonly ok: true }
  | {
      readonly ok: false
      readonly reason: AuthSidePanelDismissalFailureReason
    }

export function authSidePanelWindowIdForDocument(
  request: AuthSidePanelWindowIdLookup,
): AuthSidePanelWindowLookupResult {
  const { contexts, documentId, documentUrl } = request
  const context = contexts.find(
    (candidate) =>
      candidate.contextType === sidePanelContextType &&
      candidate.documentId === documentId &&
      candidate.documentUrl === documentUrl &&
      candidate.windowId >= 0,
  )
  return context
    ? { kind: AuthSidePanelWindowLookupKind.Found, windowId: context.windowId }
    : { kind: AuthSidePanelWindowLookupKind.NotFound }
}

export async function dismissAuthSidePanelFromSender(
  request: AuthSidePanelDismissalRequest,
): Promise<AuthSidePanelDismissalResponse> {
  const runtime: AuthSidePanelDismissalRuntime =
    'runtime' in request
      ? request.runtime
      : {
          extensionUrl: chrome.runtime.getURL,
          getContexts: (filter) => chrome.runtime.getContexts(filter),
          close: (options) => chrome.sidePanel.close(options),
        }
  const sender = request.sender
  const { documentId } = sender
  if (!documentId) {
    return {
      ok: false,
      reason: AuthSidePanelDismissalFailureReason.NotSidePanelDocument,
    }
  }
  const documentUrl = runtime.extensionUrl(
    'popup/index.html?surface=side-panel',
  )
  const contextFilter: chrome.runtime.ContextFilter = {
    contextTypes: [sidePanelContextType],
    documentIds: [documentId],
  }
  const contexts = await runtime.getContexts(contextFilter)
  const windowLookup: AuthSidePanelWindowIdLookup = {
    contexts,
    documentId,
    documentUrl,
  }
  const windowLookupResult = authSidePanelWindowIdForDocument(windowLookup)
  if (windowLookupResult.kind === AuthSidePanelWindowLookupKind.NotFound) {
    return {
      ok: false,
      reason: AuthSidePanelDismissalFailureReason.NotSidePanelDocument,
    }
  }
  try {
    const closeRequest: Parameters<typeof chrome.sidePanel.close>[0] = {
      windowId: windowLookupResult.windowId,
    }
    await runtime.close(closeRequest)
    return { ok: true }
  } catch {
    return {
      ok: false,
      reason: AuthSidePanelDismissalFailureReason.SidePanelCloseFailed,
    }
  }
}
