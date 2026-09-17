import { err, ok, type Result } from 'neverthrow'
import type { ExtensionSessionTransportRequest } from '../../offscreen/session-request-adapter'
import type { ExtensionSessionResponse } from '../../offscreen/session'

export const extensionSessionDocument = 'offscreen/session.html'

export enum ExtensionSessionTransportFailureKind {
  ObservationFailed = 'extension-session-document-observation-failed',
  CreationFailed = 'extension-session-document-creation-failed',
  Closed = 'extension-session-document-closed',
  DeliveryFailed = 'extension-session-delivery-failed',
  ResponseMissing = 'extension-session-response-missing',
  ClosureFailed = 'extension-session-document-closure-failed',
}

export class ExtensionSessionTransportFailure {
  constructor(readonly kind: ExtensionSessionTransportFailureKind) {}
  get response() {
    return { ok: false as const, reason: this.kind }
  }
}

export type ExtensionSessionTransportResult<
  T = ExtensionSessionResponse,
  DecodeFailure = never,
> = Result<
  T,
  ExtensionSessionTransportFailure | DecodeFailure
>

/** Host wire values are admitted by the concrete Rust response decoder at the caller. */
export interface ExtensionSessionTransport {
  sendMessage(
    message: ExtensionSessionTransportRequest,
  ): Promise<ExtensionSessionTransportResult<ExtensionSessionResponse>>
  sendMessage<Response, DecodeFailure>(
    message: ExtensionSessionTransportRequest,
    decodeResponse: (
      response: ExtensionSessionResponse,
    ) => Result<Response, DecodeFailure>,
  ): Promise<ExtensionSessionTransportResult<Response, DecodeFailure>>
}

enum SessionDocumentAccess {
  Sending = 'sending',
  Revoked = 'revoked',
}

/** Created only after the browser confirms the document exists. */
class OpenExtensionSessionDocument implements ExtensionSessionTransport {
  private access = SessionDocumentAccess.Sending

  sendMessage(
    message: ExtensionSessionTransportRequest,
  ): Promise<ExtensionSessionTransportResult<ExtensionSessionResponse>>
  sendMessage<Response, DecodeFailure>(
    message: ExtensionSessionTransportRequest,
    decodeResponse: (
      response: ExtensionSessionResponse,
    ) => Result<Response, DecodeFailure>,
  ): Promise<ExtensionSessionTransportResult<Response, DecodeFailure>>
  sendMessage<Response = ExtensionSessionResponse, DecodeFailure = never>(
    message: ExtensionSessionTransportRequest,
    decodeResponse?: (
      response: ExtensionSessionResponse,
    ) => Result<Response, DecodeFailure>,
  ): Promise<
    | ExtensionSessionTransportResult<ExtensionSessionResponse>
    | ExtensionSessionTransportResult<Response, DecodeFailure>
  > {
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
        chrome.runtime.sendMessage(
          message,
          (response: ExtensionSessionResponse) => {
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
            } else if (
              !response ||
              typeof response !== 'object' ||
              Array.isArray(response)
            ) {
              resolve(
                err(
                  new ExtensionSessionTransportFailure(
                    ExtensionSessionTransportFailureKind.ResponseMissing,
                  ),
                ),
              )
            } else if (decodeResponse) {
              const decoded = decodeResponse(response)
              resolve(decoded.mapErr((failure) => failure))
            } else {
              resolve(ok(response))
            }
          },
        )
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

  async close(): Promise<
    ExtensionSessionTransportResult<ExtensionSessionDocumentStateKind.Closed>
  > {
    this.access = SessionDocumentAccess.Revoked
    try {
      await chrome.offscreen.closeDocument()
      return ok(ExtensionSessionDocumentStateKind.Closed)
    } catch {
      return err(
        new ExtensionSessionTransportFailure(
          ExtensionSessionTransportFailureKind.ClosureFailed,
        ),
      )
    }
  }
}

export enum ExtensionSessionDocumentStateKind {
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
      readonly operation: Promise<
        ExtensionSessionTransportResult<ExtensionSessionDocumentStateKind.Closed>
      >
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

  private async openExistingOrCreate(): Promise<
    ExtensionSessionTransportResult<OpenExtensionSessionDocument>
  > {
    const documentUrl = chrome.runtime.getURL(extensionSessionDocument)
    let contexts: chrome.runtime.ExtensionContext[]
    try {
      const observationRequest: Parameters<
        typeof chrome.runtime.getContexts
      >[0] = {
        contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
        documentUrls: [documentUrl],
      }
      contexts = await chrome.runtime.getContexts(observationRequest)
    } catch {
      return err(
        new ExtensionSessionTransportFailure(
          ExtensionSessionTransportFailureKind.ObservationFailed,
        ),
      )
    }
    const inherited = contexts.some(
      (context) =>
        context.contextType === chrome.runtime.ContextType.OFFSCREEN_DOCUMENT &&
        context.documentUrl === documentUrl,
    )
    return inherited ? ok(new OpenExtensionSessionDocument()) : this.create()
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
    const operation = (
      state.kind === ExtensionSessionDocumentStateKind.Unobserved
        ? this.openExistingOrCreate()
        : this.create()
    ).then((created) => {
      if (
        this.state.kind === ExtensionSessionDocumentStateKind.Creating &&
        this.state.operation === operation
      ) {
        this.state = created.isOk()
          ? {
              kind: ExtensionSessionDocumentStateKind.Open,
              document: created.value,
            }
          : created.error.kind ===
              ExtensionSessionTransportFailureKind.ObservationFailed
            ? {
                kind: ExtensionSessionDocumentStateKind.ObservationFailed,
                failure: created.error,
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
  ): Promise<
    ExtensionSessionTransportResult<ExtensionSessionDocumentStateKind.Closed>
  > {
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
    ExtensionSessionTransportResult<ExtensionSessionDocumentStateKind.Closed>
  > {
    try {
      const contexts = await chrome.runtime.getContexts({
        contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
        documentUrls: [chrome.runtime.getURL(extensionSessionDocument)],
      })
      if (contexts.length === 0) {
        this.state = { kind: ExtensionSessionDocumentStateKind.Closed }
        return ok(ExtensionSessionDocumentStateKind.Closed)
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

  close(): Promise<
    ExtensionSessionTransportResult<ExtensionSessionDocumentStateKind.Closed>
  > {
    const state = this.state
    if (state.kind === ExtensionSessionDocumentStateKind.Closed)
      return Promise.resolve(ok(ExtensionSessionDocumentStateKind.Closed))
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
            (created): Promise<
              ExtensionSessionTransportResult<ExtensionSessionDocumentStateKind.Closed>
            > => {
              if (created.isErr()) {
                this.state =
                  created.error.kind ===
                  ExtensionSessionTransportFailureKind.ObservationFailed
                    ? {
                        kind: ExtensionSessionDocumentStateKind.ObservationFailed,
                        failure: created.error,
                      }
                    : { kind: ExtensionSessionDocumentStateKind.Unobserved }
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
