import { err, ok, type Result } from 'neverthrow'

export const extensionSessionDocument = 'offscreen/session.html'

export enum ExtensionSessionTransportFailureKind {
  ObservationFailed = 'extension-session-document-observation-failed',
  CreationFailed = 'extension-session-document-creation-failed',
  Closed = 'extension-session-document-closed',
  DeliveryFailed = 'extension-session-delivery-failed',
  ClosureFailed = 'extension-session-document-closure-failed',
}

export class ExtensionSessionTransportFailure {
  constructor(readonly kind: ExtensionSessionTransportFailureKind) {}
  get response() {
    return { ok: false as const, reason: this.kind }
  }
}

export type ExtensionSessionTransportResult<T> = Result<
  T,
  ExtensionSessionTransportFailure
>

/** Host wire values are admitted by the concrete Rust response decoder at the caller. */
export interface ExtensionSessionTransport {
  sendMessage(
    // eslint-disable-next-line @typescript-eslint/no-restricted-types -- Foreign browser data is narrowed at this adapter boundary.
    message: unknown,
    // eslint-disable-next-line @typescript-eslint/no-restricted-types -- Foreign browser data is narrowed at this adapter boundary.
  ): Promise<ExtensionSessionTransportResult<unknown>>
}

enum SessionDocumentAccess {
  Sending = 'sending',
  Revoked = 'revoked',
}

/** Created only after the browser confirms the document exists. */
class OpenExtensionSessionDocument implements ExtensionSessionTransport {
  private access = SessionDocumentAccess.Sending

  sendMessage(
    // eslint-disable-next-line @typescript-eslint/no-restricted-types -- Foreign browser data is narrowed at this adapter boundary.
    message: unknown,
    // eslint-disable-next-line @typescript-eslint/no-restricted-types -- Foreign browser data is narrowed at this adapter boundary.
  ): Promise<ExtensionSessionTransportResult<unknown>> {
    if (this.access === SessionDocumentAccess.Revoked)
      return Promise.resolve(
        err(
          new ExtensionSessionTransportFailure(
            ExtensionSessionTransportFailureKind.Closed,
          ),
        ),
      )
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          const nativeFailure = chrome.runtime.lastError
          if (this.access === SessionDocumentAccess.Revoked) {
            resolve(
              err(
                new ExtensionSessionTransportFailure(
                  ExtensionSessionTransportFailureKind.Closed,
                ),
              ),
            )
          } else if (nativeFailure) {
            resolve(
              err(
                new ExtensionSessionTransportFailure(
                  ExtensionSessionTransportFailureKind.DeliveryFailed,
                ),
              ),
            )
          } else {
            resolve(ok(response))
          }
        })
      } catch {
        resolve(
          err(
            new ExtensionSessionTransportFailure(
              ExtensionSessionTransportFailureKind.DeliveryFailed,
            ),
          ),
        )
      }
    })
  }

  async close(): Promise<ExtensionSessionTransportResult<void>> {
    this.access = SessionDocumentAccess.Revoked
    try {
      await chrome.offscreen.closeDocument()
      return ok()
    } catch {
      return err(
        new ExtensionSessionTransportFailure(
          ExtensionSessionTransportFailureKind.ClosureFailed,
        ),
      )
    }
  }
}

enum ExtensionSessionDocumentStateKind {
  Unobserved = 'unobserved',
  ObservationFailed = 'observation-failed',
  Closed = 'closed',
  Creating = 'creating',
  Open = 'open',
  Closing = 'closing',
  ClosureFailed = 'closure-failed',
}

type ExtensionSessionDocumentState =
  | { readonly kind: ExtensionSessionDocumentStateKind.Unobserved }
  | {
      readonly kind: ExtensionSessionDocumentStateKind.ObservationFailed
      readonly failure: ExtensionSessionTransportFailure
    }
  | { readonly kind: ExtensionSessionDocumentStateKind.Closed }
  | {
      readonly kind: ExtensionSessionDocumentStateKind.Creating
      readonly operation: Promise<
        ExtensionSessionTransportResult<OpenExtensionSessionDocument>
      >
    }
  | {
      readonly kind: ExtensionSessionDocumentStateKind.Open
      readonly document: OpenExtensionSessionDocument
    }
  | {
      readonly kind: ExtensionSessionDocumentStateKind.Closing
      readonly operation: Promise<ExtensionSessionTransportResult<void>>
    }
  | {
      readonly kind: ExtensionSessionDocumentStateKind.ClosureFailed
      readonly document: OpenExtensionSessionDocument
      readonly failure: ExtensionSessionTransportFailure
    }

/** Owns one browser document and serializes opening with acknowledged revocation. */
export class ExtensionSessionDocumentOwner {
  private state: ExtensionSessionDocumentState = {
    kind: ExtensionSessionDocumentStateKind.Unobserved,
  }

  private async create(): Promise<
    ExtensionSessionTransportResult<OpenExtensionSessionDocument>
  > {
    try {
      // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
      await chrome.offscreen.createDocument({
        url: extensionSessionDocument,
        reasons: [chrome.offscreen.Reason.WORKERS],
        justification:
          'Keep a user-authorized extension device identity in memory for a 15-minute session.',
      })
    } catch {
      return err(
        new ExtensionSessionTransportFailure(
          ExtensionSessionTransportFailureKind.CreationFailed,
        ),
      )
    }
    return ok(new OpenExtensionSessionDocument())
  }

  async open(): Promise<
    ExtensionSessionTransportResult<ExtensionSessionTransport>
  > {
    const state = this.state
    switch (state.kind) {
      case ExtensionSessionDocumentStateKind.Closing: {
        const closed = await state.operation
        if (closed.isErr()) return err(closed.error)
        return this.open()
      }
      case ExtensionSessionDocumentStateKind.ObservationFailed:
      case ExtensionSessionDocumentStateKind.ClosureFailed:
        return err(state.failure)
      case ExtensionSessionDocumentStateKind.Open:
        return ok(state.document)
      case ExtensionSessionDocumentStateKind.Creating:
        return this.admitCreatedDocument(state.operation)
      case ExtensionSessionDocumentStateKind.Unobserved:
      case ExtensionSessionDocumentStateKind.Closed:
        break
    }
    const operation = this.create().then((created) => {
      if (
        this.state.kind === ExtensionSessionDocumentStateKind.Creating &&
        this.state.operation === operation
      ) {
        this.state = created.isOk()
          ? {
              kind: ExtensionSessionDocumentStateKind.Open,
              document: created.value,
            }
          : { kind: ExtensionSessionDocumentStateKind.Unobserved }
      }
      return created
    })
    this.state = { kind: ExtensionSessionDocumentStateKind.Creating, operation }
    return this.admitCreatedDocument(operation)
  }

  private async admitCreatedDocument(
    operation: Promise<
      ExtensionSessionTransportResult<OpenExtensionSessionDocument>
    >,
  ): Promise<ExtensionSessionTransportResult<ExtensionSessionTransport>> {
    const created = await operation
    if (created.isErr()) return err(created.error)
    if (
      this.state.kind !== ExtensionSessionDocumentStateKind.Open ||
      this.state.document !== created.value
    )
      return err(
        new ExtensionSessionTransportFailure(
          ExtensionSessionTransportFailureKind.Closed,
        ),
      )
    return ok(created.value)
  }

  private async closeDocument(
    document: OpenExtensionSessionDocument,
  ): Promise<ExtensionSessionTransportResult<void>> {
    const closed = await document.close()
    this.state = closed.isOk()
      ? { kind: ExtensionSessionDocumentStateKind.Closed }
      : {
          kind: ExtensionSessionDocumentStateKind.ClosureFailed,
          document,
          failure: closed.error,
        }
    return closed
  }

  private async closeUnobservedDocument(): Promise<
    ExtensionSessionTransportResult<void>
  > {
    try {
      // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
      const contexts = await chrome.runtime.getContexts({
        contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
        documentUrls: [chrome.runtime.getURL(extensionSessionDocument)],
      })
      if (contexts.length === 0) {
        this.state = { kind: ExtensionSessionDocumentStateKind.Closed }
        return ok()
      }
    } catch {
      const failure = new ExtensionSessionTransportFailure(
        ExtensionSessionTransportFailureKind.ObservationFailed,
      )
      this.state = {
        kind: ExtensionSessionDocumentStateKind.ObservationFailed,
        failure,
      }
      return err(failure)
    }
    return this.closeDocument(new OpenExtensionSessionDocument())
  }

  close(): Promise<ExtensionSessionTransportResult<void>> {
    const state = this.state
    if (state.kind === ExtensionSessionDocumentStateKind.Closed)
      return Promise.resolve(ok())
    if (state.kind === ExtensionSessionDocumentStateKind.Closing)
      return state.operation
    if (
      state.kind === ExtensionSessionDocumentStateKind.Unobserved ||
      state.kind === ExtensionSessionDocumentStateKind.ObservationFailed
    ) {
      // Publish Closing before observation can settle or throw synchronously.
      const operation = Promise.resolve().then(() =>
        this.closeUnobservedDocument(),
      )
      this.state = {
        kind: ExtensionSessionDocumentStateKind.Closing,
        operation,
      }
      return operation
    }
    // Already-open aliases are revoked synchronously by closeDocument before its first await.
    const operation =
      state.kind === ExtensionSessionDocumentStateKind.Creating
        ? state.operation.then(
            (created): Promise<ExtensionSessionTransportResult<void>> => {
              if (created.isErr()) {
                this.state = {
                  kind: ExtensionSessionDocumentStateKind.Unobserved,
                }
                return Promise.resolve(err(created.error))
              }
              return this.closeDocument(created.value)
            },
          )
        : this.closeDocument(state.document)
    this.state = { kind: ExtensionSessionDocumentStateKind.Closing, operation }
    return operation
  }
}
