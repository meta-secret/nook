import { err, ok, type Result } from 'neverthrow'
import type { ExtensionSessionTransportRequest } from '../../offscreen/session-request-adapter'
import type { ExtensionSessionResponse } from '../../offscreen/session'
import {
  BrowserRuntimeMessage,
  BrowserRuntimeMessageAdmissionKind,
  type BrowserRuntimeMessageValue,
} from '../../lib/browser-runtime-message'
import {
  ConcreteDecoderResultKind,
  runConcreteDecoder,
} from '../../lib/concrete-decoder'
import {
  ExtensionSessionReadinessMessageType,
  ExtensionSessionReadyResponseDecoder,
  type ExtensionSessionReadyResponse,
  type ExtensionSessionReadinessQuery,
} from '../../lib/extension-session-readiness'

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

  toResult<Response, DecodeFailure = never>(): ExtensionSessionTransportResult<
    Response,
    DecodeFailure
  > {
    return err<Response, ExtensionSessionTransportFailure | DecodeFailure>(this)
  }

  get response() {
    return { ok: false as const, reason: this.kind }
  }
}

export type ExtensionSessionTransportResult<
  T = ExtensionSessionResponse,
  DecodeFailure = never,
> = Result<T, ExtensionSessionTransportFailure | DecodeFailure>

export type ExtensionSessionTransportDelivery = {
  readonly message: ExtensionSessionTransportRequest
}

export type DecodedExtensionSessionTransportDelivery<Response, DecodeFailure> =
  {
    readonly message: ExtensionSessionTransportRequest
    readonly decodeResponse: (
      response: ExtensionSessionResponse,
    ) => Result<Response, DecodeFailure>
  }

/** Host wire values are admitted by the concrete Rust response decoder at the caller. */
export interface ExtensionSessionTransport {
  sendMessage(
    delivery: ExtensionSessionTransportDelivery,
  ): Promise<ExtensionSessionTransportResult>
  sendMessage<Response, DecodeFailure>(
    delivery: DecodedExtensionSessionTransportDelivery<Response, DecodeFailure>,
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
    delivery: ExtensionSessionTransportDelivery,
  ): Promise<ExtensionSessionTransportResult>
  sendMessage<Response, DecodeFailure>(
    delivery: DecodedExtensionSessionTransportDelivery<Response, DecodeFailure>,
  ): Promise<ExtensionSessionTransportResult<Response, DecodeFailure>>
  sendMessage<Response = ExtensionSessionResponse, DecodeFailure = never>(
    delivery:
      | ExtensionSessionTransportDelivery
      | DecodedExtensionSessionTransportDelivery<Response, DecodeFailure>,
  ): Promise<
    | ExtensionSessionTransportResult
    | ExtensionSessionTransportResult<Response, DecodeFailure>
  > {
    const { message } = delivery
    if (this.access === SessionDocumentAccess.Revoked)
      return Promise.resolve(
        new ExtensionSessionTransportFailure(
          ExtensionSessionTransportFailureKind.Closed,
        ).toResult<Response, DecodeFailure>(),
      )
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(
          message,
          (response: ExtensionSessionResponse) => {
            const nativeFailure = chrome.runtime.lastError
            if (this.access === SessionDocumentAccess.Revoked) {
              resolve(
                new ExtensionSessionTransportFailure(
                  ExtensionSessionTransportFailureKind.Closed,
                ).toResult<Response, DecodeFailure>(),
              )
            } else if (nativeFailure) {
              resolve(
                new ExtensionSessionTransportFailure(
                  ExtensionSessionTransportFailureKind.DeliveryFailed,
                ).toResult<Response, DecodeFailure>(),
              )
            } else if (
              !response ||
              typeof response !== 'object' ||
              Array.isArray(response)
            ) {
              resolve(
                new ExtensionSessionTransportFailure(
                  ExtensionSessionTransportFailureKind.ResponseMissing,
                ).toResult<Response, DecodeFailure>(),
              )
            } else if ('decodeResponse' in delivery) {
              const decoded = delivery.decodeResponse(response)
              resolve(
                decoded.match(
                  (decodedResponse) =>
                    ok<
                      Response,
                      ExtensionSessionTransportFailure | DecodeFailure
                    >(decodedResponse),
                  (failure) =>
                    err<
                      Response,
                      ExtensionSessionTransportFailure | DecodeFailure
                    >(failure),
                ),
              )
            } else {
              resolve(
                ok<ExtensionSessionResponse, ExtensionSessionTransportFailure>(
                  response,
                ),
              )
            }
          },
        )
      } catch {
        resolve(
          new ExtensionSessionTransportFailure(
            ExtensionSessionTransportFailureKind.DeliveryFailed,
          ).toResult<Response, DecodeFailure>(),
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

enum SessionReadinessKind {
  Idle = 'idle',
  Waiting = 'waiting',
  Ready = 'ready',
}

type SessionReadiness =
  | { readonly kind: SessionReadinessKind.Idle }
  | {
      readonly kind: SessionReadinessKind.Waiting
      readonly operation: Promise<void>
      readonly resolve: () => void
    }
  | { readonly kind: SessionReadinessKind.Ready }

type ExtensionSessionDocumentReadinessListener = Parameters<
  typeof chrome.runtime.onMessage.addListener
>[0]

type ExtensionSessionDocumentReadinessListenerArguments = [
  message: BrowserRuntimeMessageValue,
  sender: chrome.runtime.MessageSender,
  sendResponse: Parameters<ExtensionSessionDocumentReadinessListener>[2],
]

type ExtensionSessionDocumentReadinessRequest = {
  readonly message: BrowserRuntimeMessageValue
  readonly sender: chrome.runtime.MessageSender
  readonly sendResponse: Parameters<ExtensionSessionDocumentReadinessListener>[2]
}

/** Owns one browser document and serializes opening with acknowledged revocation. */
export class ExtensionSessionDocumentOwner {
  private state: ExtensionSessionDocumentState = {
    kind: ExtensionSessionDocumentStateKind.Unobserved,
  }
  private readiness: SessionReadiness = { kind: SessionReadinessKind.Idle }

  constructor() {
    const runtimeMessages = chrome.runtime.onMessage
    if (runtimeMessages) {
      runtimeMessages.addListener(this.readinessListener())
    }
  }

  private readinessListener(): ExtensionSessionDocumentReadinessListener {
    return (
      ...listenerArguments: ExtensionSessionDocumentReadinessListenerArguments
    ) => {
      const [message, sender, sendResponse] = listenerArguments
      const request: ExtensionSessionDocumentReadinessRequest = {
        message,
        sender,
        sendResponse,
      }
      return this.handleReadinessMessage(request)
    }
  }

  private handleReadinessMessage(
    request: ExtensionSessionDocumentReadinessRequest,
  ): false {
    const { message, sender, sendResponse } = request
    const admission = BrowserRuntimeMessage.from(message)
    if (
      admission.kind === BrowserRuntimeMessageAdmissionKind.Rejected ||
      admission.message.type !== ExtensionSessionReadinessMessageType.Ready ||
      sender.id !== chrome.runtime.id ||
      sender.url !== chrome.runtime.getURL(extensionSessionDocument)
    ) {
      return false
    }
    const response: ExtensionSessionReadyResponse = { ok: true }
    sendResponse(response)
    this.markReady()
    return false
  }

  private markReady(): void {
    const readiness = this.readiness
    if (readiness.kind === SessionReadinessKind.Waiting) {
      readiness.resolve()
    }
    this.readiness = { kind: SessionReadinessKind.Ready }
  }

  private waitForReady(): Promise<void> {
    const readiness = this.readiness
    if (readiness.kind === SessionReadinessKind.Ready) {
      return Promise.resolve()
    }
    if (readiness.kind === SessionReadinessKind.Waiting) {
      return readiness.operation
    }
    let resolveReadiness: () => void = () => {}
    const operation = new Promise<void>((resolve) => {
      resolveReadiness = resolve
    })
    this.readiness = {
      kind: SessionReadinessKind.Waiting,
      operation,
      resolve: resolveReadiness,
    }
    return operation
  }

  private requestExistingDocumentReadiness(): Promise<
    ExtensionSessionTransportFailureKind | false
  > {
    const readinessQuery: ExtensionSessionReadinessQuery = {
      type: ExtensionSessionReadinessMessageType.Query,
    }
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage<BrowserRuntimeMessageValue>(
          readinessQuery,
          (response: BrowserRuntimeMessageValue) => {
            const deliveryFailure = chrome.runtime.lastError
            if (this.readiness.kind === SessionReadinessKind.Ready) {
              resolve(false)
            } else if (deliveryFailure) {
              resolve(ExtensionSessionTransportFailureKind.DeliveryFailed)
            } else {
              const decodedResponse = runConcreteDecoder(
                ExtensionSessionReadyResponseDecoder.decode,
                response,
              )
              if (decodedResponse.kind === ConcreteDecoderResultKind.Rejected) {
                resolve(ExtensionSessionTransportFailureKind.ResponseMissing)
              } else {
                this.markReady()
                resolve(false)
              }
            }
          },
        )
      } catch {
        resolve(ExtensionSessionTransportFailureKind.DeliveryFailed)
      }
    })
  }

  private async create(): Promise<
    ExtensionSessionTransportResult<OpenExtensionSessionDocument>
  > {
    try {
      type CreateCreateDocumentRequest = {
        url: string
        reasons: chrome.offscreen.Reason[]
        justification: string
      }
      const createCreateDocumentRequest: CreateCreateDocumentRequest = {
        url: extensionSessionDocument,
        reasons: [chrome.offscreen.Reason.WORKERS],
        justification:
          'Keep a user-authorized extension device identity in memory for a 15-minute session.',
      }
      await chrome.offscreen.createDocument(createCreateDocumentRequest)
    } catch {
      return err(
        new ExtensionSessionTransportFailure(
          ExtensionSessionTransportFailureKind.CreationFailed,
        ),
      )
    }
    await this.waitForReady()
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
    if (inherited) {
      if (this.readiness.kind !== SessionReadinessKind.Ready) {
        const failureKind = await this.requestExistingDocumentReadiness()
        if (failureKind) {
          return err(new ExtensionSessionTransportFailure(failureKind))
        }
      }
      return ok(new OpenExtensionSessionDocument())
    }
    return this.create()
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
    if (closed.isOk()) {
      this.readiness = { kind: SessionReadinessKind.Idle }
    }
    return closed
  }

  private async closeUnobservedDocument(): Promise<
    ExtensionSessionTransportResult<ExtensionSessionDocumentStateKind.Closed>
  > {
    try {
      type CloseUnobservedDocumentGetContextsRequest = {
        contextTypes: chrome.runtime.ContextType[]
        documentUrls: string[]
      }
      const closeUnobservedDocumentGetContextsRequest: CloseUnobservedDocumentGetContextsRequest =
        {
          contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
          documentUrls: [chrome.runtime.getURL(extensionSessionDocument)],
        }
      const contexts = await chrome.runtime.getContexts(
        closeUnobservedDocumentGetContextsRequest,
      )
      if (contexts.length === 0) {
        this.state = { kind: ExtensionSessionDocumentStateKind.Closed }
        this.readiness = { kind: SessionReadinessKind.Idle }
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
            (
              created,
            ): Promise<
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
