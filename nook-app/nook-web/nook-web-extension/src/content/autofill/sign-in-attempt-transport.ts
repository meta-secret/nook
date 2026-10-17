import { Effect } from 'effect'
import type {
  SignInAttemptEvent,
  SignInAttemptLoginReference,
  SignInAttemptPresentation,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  SignInAttemptMessageType,
  SignInAttemptOperation,
  SignInAttemptViewKind,
  type SignInAttemptMessage,
  type SignInAttemptRequest,
  type SignInAttemptRuntimeResponse,
} from '../../lib/sign-in-attempt-messages'

export enum SignInAttemptDeliveryKind {
  /** No attempt for this tab and site; the Pilot shows its normal fresh state. */
  Fresh = 'fresh',
  Presented = 'presented',
  Unavailable = 'unavailable',
}
export type SignInAttemptDelivery =
  | { readonly kind: SignInAttemptDeliveryKind.Fresh }
  | {
      readonly kind: SignInAttemptDeliveryKind.Presented
      readonly presentation: SignInAttemptPresentation
    }
  | { readonly kind: SignInAttemptDeliveryKind.Unavailable }

/** Sign-in attempts are top-level only; iframe logins keep their in-memory checklist. */
export enum SignInAttemptScope {
  TopDocument = 'top-document',
  Frame = 'frame',
}

/**
 * Chrome transport to the service-worker attempt owner. The message is
 * handed to Chrome synchronously, so a report sent right after a native
 * submit leaves before the submitting document unloads.
 */
export class SignInAttemptTransport {
  constructor(private readonly browser: typeof globalThis) {}

  scope(): SignInAttemptScope {
    switch (this.browser.window === this.browser.window.top) {
      case true:
        return SignInAttemptScope.TopDocument
      case false:
        return SignInAttemptScope.Frame
    }
  }

  begin(login: SignInAttemptLoginReference): Promise<SignInAttemptDelivery> {
    const request: SignInAttemptRequest = {
      operation: SignInAttemptOperation.Begin,
      login,
    }
    return this.send(request)
  }

  advance(event: SignInAttemptEvent): Promise<SignInAttemptDelivery> {
    const request: SignInAttemptRequest = {
      operation: SignInAttemptOperation.Advance,
      event,
    }
    return this.send(request)
  }

  private send(request: SignInAttemptRequest): Promise<SignInAttemptDelivery> {
    const message: SignInAttemptMessage = {
      type: SignInAttemptMessageType.Session,
      payload: request,
    }
    const unavailable: SignInAttemptDelivery = {
      kind: SignInAttemptDeliveryKind.Unavailable,
    }
    return Effect.runPromise(
      Effect.tryPromise(() =>
        this.browser.chrome.runtime.sendMessage<
          SignInAttemptMessage,
          SignInAttemptRuntimeResponse
        >(message),
      ).pipe(
        Effect.flatMap((response) => Effect.try(() => this.delivery(response))),
        Effect.catch(() => Effect.succeed(unavailable)),
      ),
    )
  }

  private delivery(
    response: SignInAttemptRuntimeResponse,
  ): SignInAttemptDelivery {
    switch (response.ok) {
      case false:
        return { kind: SignInAttemptDeliveryKind.Unavailable }
      case true:
        break
    }
    switch (response.attempt.kind) {
      case SignInAttemptViewKind.None:
        return { kind: SignInAttemptDeliveryKind.Fresh }
      case SignInAttemptViewKind.Presented:
        return {
          kind: SignInAttemptDeliveryKind.Presented,
          presentation: response.attempt.presentation,
        }
    }
  }
}

export const signInAttemptTransport = new SignInAttemptTransport(globalThis)
