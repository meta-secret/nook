import { describe, expect, mock, test } from 'bun:test'
import { err, ok, type Result } from 'neverthrow'
import {
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
    if (completion.kind !== BrowserEffectPhase.Pending) return err(completion.kind)
    this.completion = { kind: BrowserEffectPhase.Complete }
    completion.resolve(value)
    return ok(undefined)
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
  readonly createDocument = mock(() => this.creation.operation)
  readonly closeDocument = mock(() => this.closure.operation)
  private reply: BrowserReply = { kind: BrowserReplyPhase.Unrequested }

  constructor() {
    globalThis.chrome = {
      offscreen: {
        createDocument: this.createDocument,
        closeDocument: this.closeDocument,
      },
      runtime: {
        sendMessage: (_message: unknown, respond: (value: unknown) => void) => {
          this.reply = { kind: BrowserReplyPhase.Pending, respond }
        },
      },
    } as typeof chrome
  }

  respond(value: unknown): Result<void, BrowserReplyPhase> {
    const reply = this.reply
    if (reply.kind !== BrowserReplyPhase.Pending) return err(reply.kind)
    this.reply = { kind: BrowserReplyPhase.Unrequested }
    reply.respond(value)
    return ok(undefined)
  }
}

describe('extension session document ownership', () => {
  test('coalesces opens until creation completes', async () => {
    const fixture = new SessionDocumentFixture()
    const first = fixture.owner.open()
    const second = fixture.owner.open()
    expect(fixture.createDocument).toHaveBeenCalledTimes(1)
    expect(fixture.creation.complete()).toEqual(ok(undefined))
    const opened = await first
    const shared = await second
    if (opened.isErr() || shared.isErr())
      return expect.fail('document creation must succeed')
    expect(opened.value).toBe(shared.value)
    const closing = fixture.owner.close()
    expect(fixture.closure.complete()).toEqual(ok(undefined))
    expect(await closing).toEqual(ok(undefined))
  })

  test('closing while creation is pending denies the late sending capability', async () => {
    const fixture = new SessionDocumentFixture()
    const opening = fixture.owner.open()
    const closing = fixture.owner.close()
    expect(fixture.creation.complete()).toEqual(ok(undefined))
    expect(await opening).toEqual(
      err(
        new ExtensionSessionTransportFailure(
          ExtensionSessionTransportFailureKind.Closed,
        ),
      ),
    )
    expect(fixture.closeDocument).toHaveBeenCalledTimes(1)
    expect(fixture.closure.complete()).toEqual(ok(undefined))
    expect(await closing).toEqual(ok(undefined))
  })

  test('revokes aliases and pending replies before awaiting browser closure', async () => {
    const fixture = new SessionDocumentFixture()
    const opening = fixture.owner.open()
    expect(fixture.creation.complete()).toEqual(ok(undefined))
    const opened = await opening
    if (opened.isErr()) return expect.fail('document creation must succeed')
    const delivery = opened.value.sendMessage({ type: 'fixture-request' })
    const closing = fixture.owner.close()
    expect(await opened.value.sendMessage({ type: 'fixture-after-close' })).toEqual(
      err(
        new ExtensionSessionTransportFailure(
          ExtensionSessionTransportFailureKind.Closed,
        ),
      ),
    )
    expect(fixture.respond({ ok: true })).toEqual(ok(undefined))
    expect(await delivery).toEqual(
      err(
        new ExtensionSessionTransportFailure(
          ExtensionSessionTransportFailureKind.Closed,
        ),
      ),
    )
    expect(fixture.closure.complete()).toEqual(ok(undefined))
    expect(await closing).toEqual(ok(undefined))
  })

  test('retains denied ownership after closure fails until a caller explicitly closes again', async () => {
    const fixture = new SessionDocumentFixture()
    const opening = fixture.owner.open()
    expect(fixture.creation.complete()).toEqual(ok(undefined))
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
    expect(fixture.closure.complete()).toEqual(ok(undefined))
    expect(await closing).toEqual(ok(undefined))
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
    expect(await fixture.owner.close()).toEqual(ok(undefined))
    expect(fixture.closeDocument).not.toHaveBeenCalled()
  })
})
