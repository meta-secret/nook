import { describe, expect, mock, test } from 'bun:test'
import { err, ok, type Result } from 'neverthrow'
import {
  extensionSessionDocument,
  ExtensionSessionDocumentOwner,
  ExtensionSessionTransportFailure,
  ExtensionSessionTransportFailureKind,
} from '../src/background/service-worker/session-document'

enum BrowserEffectPhase {
  Initializing = 'initializing',
  Pending = 'pending',
  Complete = 'complete',
}
type BrowserEffectCompletion<T> =
  | { readonly kind: BrowserEffectPhase.Initializing }
  | {
      readonly kind: BrowserEffectPhase.Pending
      readonly resolve: (value: T) => void
    }
  | { readonly kind: BrowserEffectPhase.Complete }

class DeferredBrowserEffect<T> {
  private completion: BrowserEffectCompletion<T> = {
    kind: BrowserEffectPhase.Initializing,
  }
  readonly operation = new Promise<T>((resolve) => {
    this.completion = { kind: BrowserEffectPhase.Pending, resolve }
  })
  complete(value: T): Result<void, BrowserEffectPhase> {
    const completion = this.completion
    if (completion.kind !== BrowserEffectPhase.Pending)
      return err(completion.kind)
    this.completion = { kind: BrowserEffectPhase.Complete }
    completion.resolve(value)
    return ok()
  }
}

enum BrowserReplyPhase {
  Unrequested = 'unrequested',
  Pending = 'pending',
}
type BrowserReply =
  | { readonly kind: BrowserReplyPhase.Unrequested }
  | {
      readonly kind: BrowserReplyPhase.Pending
      readonly respond: (value: unknown) => void
    }

class SessionDocumentFixture {
  readonly owner = new ExtensionSessionDocumentOwner()
  readonly creation = new DeferredBrowserEffect<void>()
  readonly closure = new DeferredBrowserEffect<void>()
  readonly closureRequested = new DeferredBrowserEffect<void>()
  readonly createDocument = mock(() => this.creation.operation)
  readonly closeDocument = mock(() => {
    this.closureRequested.complete()
    return this.closure.operation
  })
  readonly getContexts = mock(
    async (): Promise<chrome.runtime.ExtensionContext[]> => [],
  )
  private reply: BrowserReply = { kind: BrowserReplyPhase.Unrequested }

  constructor() {
    globalThis.chrome = {
      offscreen: {
        Reason: { WORKERS: 'WORKERS' },
        createDocument: this.createDocument,
        closeDocument: this.closeDocument,
      },
      runtime: {
        ContextType: { OFFSCREEN_DOCUMENT: 'OFFSCREEN_DOCUMENT' },
        getURL: (path: string) => `chrome-extension://fixture/${path}`,
        getContexts: this.getContexts,
        sendMessage: (_message: unknown, respond: (value: unknown) => void) => {
          this.reply = { kind: BrowserReplyPhase.Pending, respond }
        },
      },
    } as typeof chrome
  }

  inheritDocument(): void {
    this.getContexts.mockResolvedValue([
      {
        contextType: chrome.runtime.ContextType.OFFSCREEN_DOCUMENT,
        contextId: 'inherited-session',
        documentUrl: chrome.runtime.getURL(extensionSessionDocument),
        documentOrigin: 'chrome-extension://fixture',
        documentId: 'inherited-document',
        frameId: 0,
        tabId: -1,
        windowId: -1,
        incognito: false,
      },
    ])
  }

  respond(value: unknown): Result<void, BrowserReplyPhase> {
    const reply = this.reply
    if (reply.kind !== BrowserReplyPhase.Pending) return err(reply.kind)
    this.reply = { kind: BrowserReplyPhase.Unrequested }
    reply.respond(value)
    return ok()
  }
}

describe('extension session document ownership', () => {
  test('reuses the exact inherited session without creating another document', async () => {
    const fixture = new SessionDocumentFixture()
    fixture.inheritDocument()

    const opened = await fixture.owner.open()

    expect(opened.isOk()).toBe(true)
    expect(fixture.getContexts).toHaveBeenCalledWith({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
      documentUrls: [chrome.runtime.getURL(extensionSessionDocument)],
    })
    expect(fixture.createDocument).not.toHaveBeenCalled()
  })

  test('does not admit an unrelated offscreen context when creation fails', async () => {
    const fixture = new SessionDocumentFixture()
    fixture.getContexts.mockResolvedValueOnce([
      {
        contextType: chrome.runtime.ContextType.OFFSCREEN_DOCUMENT,
        contextId: 'unrelated-session',
        documentUrl: chrome.runtime.getURL('offscreen/unrelated.html'),
        documentOrigin: 'chrome-extension://fixture',
        documentId: 'unrelated-document',
        frameId: 0,
        tabId: -1,
        windowId: -1,
        incognito: false,
      },
    ])
    fixture.createDocument.mockRejectedValueOnce(
      new Error('native create failed'),
    )

    expect(await fixture.owner.open()).toEqual(
      err(
        new ExtensionSessionTransportFailure(
          ExtensionSessionTransportFailureKind.CreationFailed,
        ),
      ),
    )
    expect(fixture.createDocument).toHaveBeenCalledTimes(1)
  })

  test('reports direct inherited-session observation failure', async () => {
    const fixture = new SessionDocumentFixture()
    fixture.getContexts.mockRejectedValueOnce(
      new Error('native observation failed'),
    )
    const failure = err(
      new ExtensionSessionTransportFailure(
        ExtensionSessionTransportFailureKind.ObservationFailed,
      ),
    )

    expect(await fixture.owner.open()).toEqual(failure)
    expect(await fixture.owner.open()).toEqual(failure)
    expect(fixture.createDocument).not.toHaveBeenCalled()
  })

  test('closes an inherited session and waits for browser acknowledgement without creating one', async () => {
    const fixture = new SessionDocumentFixture()
    fixture.inheritDocument()
    const settled = mock(() => {})
    const closing = fixture.owner.close()
    void closing.then(settled)
    await fixture.closureRequested.operation
    expect(fixture.getContexts).toHaveBeenCalledWith({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
      documentUrls: [chrome.runtime.getURL(extensionSessionDocument)],
    })
    expect(fixture.createDocument).not.toHaveBeenCalled()
    expect(fixture.closeDocument).toHaveBeenCalledTimes(1)
    expect(settled).not.toHaveBeenCalled()
    expect(fixture.closure.complete()).toEqual(ok())
    expect(await closing).toEqual(ok())
  })

  test('coalesces inherited cleanup and prevents open from overtaking closure', async () => {
    const fixture = new SessionDocumentFixture()
    fixture.inheritDocument()
    const first = fixture.owner.close()
    const second = fixture.owner.close()
    expect(second).toBe(first)
    const opening = fixture.owner.open()
    await fixture.closureRequested.operation
    expect(fixture.getContexts).toHaveBeenCalledTimes(1)
    expect(fixture.createDocument).not.toHaveBeenCalled()
    expect(fixture.closeDocument).toHaveBeenCalledTimes(1)
    expect(fixture.closure.complete()).toEqual(ok())
    expect(await first).toEqual(ok())
    expect(await second).toEqual(ok())
    expect(fixture.creation.complete()).toEqual(ok())
    expect((await opening).isOk()).toBe(true)
    expect(fixture.createDocument).toHaveBeenCalledTimes(1)
  })

  test('admits browser-confirmed absence without creating or closing a document', async () => {
    const fixture = new SessionDocumentFixture()
    expect(await fixture.owner.close()).toEqual(ok())
    expect(await fixture.owner.close()).toEqual(ok())
    expect(fixture.getContexts).toHaveBeenCalledTimes(1)
    expect(fixture.createDocument).not.toHaveBeenCalled()
    expect(fixture.closeDocument).not.toHaveBeenCalled()
  })

  test('denies opening when inherited-document observation fails', async () => {
    const fixture = new SessionDocumentFixture()
    fixture.getContexts.mockRejectedValueOnce(
      new Error('native observation failed'),
    )
    const closing = fixture.owner.close()
    const opening = fixture.owner.open()
    const failure = err(
      new ExtensionSessionTransportFailure(
        ExtensionSessionTransportFailureKind.ObservationFailed,
      ),
    )
    expect(await closing).toEqual(failure)
    expect(await opening).toEqual(failure)
    expect(await fixture.owner.open()).toEqual(failure)
    expect(fixture.createDocument).not.toHaveBeenCalled()
    expect(fixture.closeDocument).not.toHaveBeenCalled()
  })

  test('denies opening when inherited-document closure fails', async () => {
    const fixture = new SessionDocumentFixture()
    fixture.inheritDocument()
    fixture.closeDocument.mockRejectedValueOnce(
      new Error('native close failed'),
    )
    const closing = fixture.owner.close()
    const opening = fixture.owner.open()
    const failure = err(
      new ExtensionSessionTransportFailure(
        ExtensionSessionTransportFailureKind.ClosureFailed,
      ),
    )
    expect(await closing).toEqual(failure)
    expect(await opening).toEqual(failure)
    expect(await fixture.owner.open()).toEqual(failure)
    expect(fixture.createDocument).not.toHaveBeenCalled()
    expect(fixture.closeDocument).toHaveBeenCalledTimes(1)
  })

  test('coalesces opens until creation completes', async () => {
    const fixture = new SessionDocumentFixture()
    const first = fixture.owner.open()
    const second = fixture.owner.open()
    await Promise.resolve()
    expect(fixture.createDocument).toHaveBeenCalledTimes(1)
    expect(fixture.creation.complete()).toEqual(ok())
    const opened = await first
    const shared = await second
    if (opened.isErr() || shared.isErr())
      return expect.fail('document creation must succeed')
    expect(opened.value).toBe(shared.value)
    const closing = fixture.owner.close()
    expect(fixture.closure.complete()).toEqual(ok())
    expect(await closing).toEqual(ok())
  })

  test('closing while creation is pending denies the late sending capability', async () => {
    const fixture = new SessionDocumentFixture()
    const opening = fixture.owner.open()
    const closing = fixture.owner.close()
    await Promise.resolve()
    expect(fixture.creation.complete()).toEqual(ok())
    expect(await opening).toEqual(
      err(
        new ExtensionSessionTransportFailure(
          ExtensionSessionTransportFailureKind.Closed,
        ),
      ),
    )
    expect(fixture.closeDocument).toHaveBeenCalledTimes(1)
    expect(fixture.closure.complete()).toEqual(ok())
    expect(await closing).toEqual(ok())
  })

  test('revokes aliases and pending replies before awaiting browser closure', async () => {
    const fixture = new SessionDocumentFixture()
    const opening = fixture.owner.open()
    await Promise.resolve()
    expect(fixture.creation.complete()).toEqual(ok())
    const opened = await opening
    if (opened.isErr()) return expect.fail('document creation must succeed')
    const delivery = opened.value.sendMessage({ type: 'fixture-request' })
    const closing = fixture.owner.close()
    expect(
      await opened.value.sendMessage({ type: 'fixture-after-close' }),
    ).toEqual(
      err(
        new ExtensionSessionTransportFailure(
          ExtensionSessionTransportFailureKind.Closed,
        ),
      ),
    )
    expect(fixture.respond({ ok: true })).toEqual(ok())
    expect(await delivery).toEqual(
      err(
        new ExtensionSessionTransportFailure(
          ExtensionSessionTransportFailureKind.Closed,
        ),
      ),
    )
    expect(fixture.closure.complete()).toEqual(ok())
    expect(await closing).toEqual(ok())
  })

  test('retains denied ownership after closure fails until a caller explicitly closes again', async () => {
    const fixture = new SessionDocumentFixture()
    const opening = fixture.owner.open()
    await Promise.resolve()
    expect(fixture.creation.complete()).toEqual(ok())
    const opened = await opening
    if (opened.isErr()) return expect.fail('document creation must succeed')
    fixture.closeDocument.mockImplementationOnce(() =>
      Promise.reject(new Error('native close failed')),
    )
    const failure = err(
      new ExtensionSessionTransportFailure(
        ExtensionSessionTransportFailureKind.ClosureFailed,
      ),
    )
    expect(await fixture.owner.close()).toEqual(failure)
    expect(await fixture.owner.open()).toEqual(failure)
    expect(
      await opened.value.sendMessage({ type: 'fixture-after-failure' }),
    ).toEqual(
      err(
        new ExtensionSessionTransportFailure(
          ExtensionSessionTransportFailureKind.Closed,
        ),
      ),
    )
    const closing = fixture.owner.close()
    expect(fixture.closure.complete()).toEqual(ok())
    expect(await closing).toEqual(ok())
    expect(fixture.closeDocument).toHaveBeenCalledTimes(2)
  })

  test('reports failed creation without publishing a document', async () => {
    const fixture = new SessionDocumentFixture()
    fixture.createDocument.mockImplementationOnce(() =>
      Promise.reject(new Error('native create failed')),
    )
    expect(await fixture.owner.open()).toEqual(
      err(
        new ExtensionSessionTransportFailure(
          ExtensionSessionTransportFailureKind.CreationFailed,
        ),
      ),
    )
    expect(await fixture.owner.close()).toEqual(ok())
    expect(fixture.closeDocument).not.toHaveBeenCalled()
  })

  test('does not admit a rejected single-offscreen creation', async () => {
    const fixture = new SessionDocumentFixture()
    fixture.createDocument.mockImplementationOnce(() =>
      Promise.reject(new Error('Only a single offscreen document is allowed')),
    )

    expect(await fixture.owner.open()).toEqual(
      err(
        new ExtensionSessionTransportFailure(
          ExtensionSessionTransportFailureKind.CreationFailed,
        ),
      ),
    )
    expect(fixture.closeDocument).not.toHaveBeenCalled()
  })
})
