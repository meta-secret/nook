import { describe, expect, mock, test } from 'bun:test'
import {
  dismissAuthSidePanelFromSender,
  type AuthSidePanelDismissalRuntime,
} from '../src/background/service-worker/auth-side-panel-dismissal'

const sidePanelDocumentUrl =
  'chrome-extension://nook/popup/index.html?surface=side-panel'

function sidePanelContext(
  overrides: Partial<chrome.runtime.ExtensionContext> = {},
): chrome.runtime.ExtensionContext {
  return {
    contextId: 'side-panel-context',
    contextType: 'SIDE_PANEL',
    documentId: 'side-panel-document',
    documentOrigin: 'chrome-extension://nook',
    documentUrl: sidePanelDocumentUrl,
    frameId: 0,
    incognito: false,
    tabId: 27,
    windowId: 8,
    ...overrides,
  }
}

function dismissalRuntime(
  contexts: chrome.runtime.ExtensionContext[],
  close = mock(async () => {}),
): AuthSidePanelDismissalRuntime {
  return {
    extensionUrl: (path) => `chrome-extension://nook/${path}`,
    getContexts: mock(async () => contexts),
    close,
  }
}

describe('auth side panel dismissal', () => {
  test('closes only the side panel whose document sent the success message', async () => {
    const close = mock(async () => {})
    const runtime = dismissalRuntime(
      [
        sidePanelContext(),
        sidePanelContext({
          contextId: 'other-side-panel-context',
          documentId: 'other-side-panel-document',
          windowId: 12,
        }),
      ],
      close,
    )

    const request = {
      sender: { documentId: 'side-panel-document' },
      runtime,
    }
    const response = await dismissAuthSidePanelFromSender(request)

    expect(response).toEqual({ ok: true })
    expect(runtime.getContexts).toHaveBeenCalledWith({
      contextTypes: ['SIDE_PANEL'],
      documentIds: ['side-panel-document'],
    })
    expect(close).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledWith({ windowId: 8 })
  })

  test('does not close a panel for a popup or another extension document', async () => {
    const close = mock(async () => {})
    const runtime = dismissalRuntime(
      [
        sidePanelContext({
          contextType: 'POPUP',
          documentId: 'popup-document',
        }),
        sidePanelContext({
          documentId: 'other-document',
          documentUrl: 'chrome-extension://nook/popup/index.html',
        }),
      ],
      close,
    )

    const request = { sender: { documentId: 'popup-document' }, runtime }
    const response = await dismissAuthSidePanelFromSender(request)

    expect(response).toEqual({ ok: false, reason: 'not-side-panel-document' })
    expect(close).not.toHaveBeenCalled()
  })

  test('does not close any panel when the sender has no document identity', async () => {
    const close = mock(async () => {})
    const runtime = dismissalRuntime([sidePanelContext()], close)

    const request = { sender: {}, runtime }
    const response = await dismissAuthSidePanelFromSender(request)

    expect(response).toEqual({ ok: false, reason: 'not-side-panel-document' })
    expect(runtime.getContexts).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
  })
})
