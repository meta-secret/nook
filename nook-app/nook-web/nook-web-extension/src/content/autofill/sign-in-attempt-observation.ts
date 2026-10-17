import type {
  SignInAttemptDocumentRelation,
  SignInAttemptSubmitBaseline,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

/**
 * What the acting content script remembered at its own submit: the path and
 * each collected message element's visible text. Held in memory only; never
 * sent, stored or logged.
 */
export type SignInAttemptSubmitSnapshot = {
  readonly pathname: string
  readonly messages: WeakMap<Element, string>
}

/** The baseline Rust receives and the snapshot this document keeps. */
export type SignInAttemptSubmitCapture = {
  readonly baseline: SignInAttemptSubmitBaseline
  readonly snapshot: SignInAttemptSubmitSnapshot
}

export enum SignInAttemptObservationKind {
  /** This instance did not perform the submit: it resumed after a load. */
  NewDocument = 'new-document',
  /** This instance performed the submit and observes its own document. */
  SameDocument = 'same-document',
}
export type SignInAttemptObservationContext =
  | { readonly kind: SignInAttemptObservationKind.NewDocument }
  | {
      readonly kind: SignInAttemptObservationKind.SameDocument
      readonly snapshot: SignInAttemptSubmitSnapshot
    }

export type SignInAttemptRouteRequest = {
  readonly context: SignInAttemptObservationContext
  readonly pathname: string
}
export type SignInAttemptMessageChangeRequest = {
  readonly context: SignInAttemptObservationContext
  readonly element: Element
  readonly text: string
}

/** Raw same-document facts for Rust; neither is a decision about the page. */
export class SignInAttemptObservation {
  static readonly NEW_DOCUMENT: SignInAttemptObservationContext = {
    kind: SignInAttemptObservationKind.NewDocument,
  }

  static relation(
    request: SignInAttemptRouteRequest,
  ): SignInAttemptDocumentRelation {
    const context = request.context
    switch (context.kind) {
      case SignInAttemptObservationKind.NewDocument:
        return 'NewDocument'
      case SignInAttemptObservationKind.SameDocument:
        break
    }
    switch (context.snapshot.pathname === request.pathname) {
      case true:
        return 'SameDocumentSameRoute'
      case false:
        return 'SameDocumentNewRoute'
    }
  }

  /** Absent at the submit, or its visible text differs now; never on a new document. */
  static changed(request: SignInAttemptMessageChangeRequest): boolean {
    const context = request.context
    switch (context.kind) {
      case SignInAttemptObservationKind.NewDocument:
        return false
      case SignInAttemptObservationKind.SameDocument:
        break
    }
    const messages = context.snapshot.messages
    switch (messages.has(request.element)) {
      case false:
        return true
      case true:
        return messages.get(request.element) !== request.text
    }
  }
}
