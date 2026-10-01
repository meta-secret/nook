export type AuthSidePanelContext = Pick<
  chrome.runtime.ExtensionContext,
  'contextType' | 'documentId' | 'documentUrl' | 'windowId'
>

const sidePanelContextType = 'SIDE_PANEL' as const

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
  readonly documentId: string | undefined
  readonly documentUrl: string
}

export type AuthSidePanelDismissalRequest = {
  readonly sender: Pick<chrome.runtime.MessageSender, 'documentId'>
  readonly runtime?: AuthSidePanelDismissalRuntime
}

export type AuthSidePanelDismissalResponse =
  | { readonly ok: true }
  | {
      readonly ok: false
      readonly reason: 'not-side-panel-document' | 'side-panel-close-failed'
    }

export function authSidePanelWindowIdForDocument(
  request: AuthSidePanelWindowIdLookup,
): number | undefined {
  const { contexts, documentId, documentUrl } = request
  if (documentId === undefined) return undefined
  const context = contexts.find(
    (candidate) =>
      candidate.contextType === sidePanelContextType &&
      candidate.documentId === documentId &&
      candidate.documentUrl === documentUrl &&
      candidate.windowId >= 0,
  )
  return context?.windowId
}

export async function dismissAuthSidePanelFromSender(
  request: AuthSidePanelDismissalRequest,
): Promise<AuthSidePanelDismissalResponse> {
  const runtime: AuthSidePanelDismissalRuntime = request.runtime ?? {
    extensionUrl: chrome.runtime.getURL,
    getContexts: (filter) => chrome.runtime.getContexts(filter),
    close: (options) => chrome.sidePanel.close(options),
  }
  const sender = request.sender
  const { documentId } = sender
  if (documentId === undefined) {
    return { ok: false, reason: 'not-side-panel-document' }
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
  const windowId = authSidePanelWindowIdForDocument(windowLookup)
  if (windowId === undefined) {
    return { ok: false, reason: 'not-side-panel-document' }
  }
  try {
    const closeRequest: Parameters<typeof chrome.sidePanel.close>[0] = {
      windowId,
    }
    await runtime.close(closeRequest)
    return { ok: true }
  } catch {
    return { ok: false, reason: 'side-panel-close-failed' }
  }
}
