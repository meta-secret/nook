import { Effect, Schema } from 'effect'
import {
  advance_sign_in_attempt,
  begin_sign_in_attempt,
  type SignInAttemptAdvance,
  type SignInAttemptAdvanceRequest,
  type SignInAttemptBeginRequest,
  type SignInAttemptEvent,
  type SignInAttemptLoginReference,
  type SignInAttemptTransition,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import type { BrowserRuntimeMessage } from '../../lib/browser-runtime-message'
import {
  SignInAttemptFailureReason,
  SignInAttemptMessageCodec,
  SignInAttemptMessageType,
  SignInAttemptOperation,
  SignInAttemptViewKind,
  type SignInAttemptRuntimeResponse,
  type SignInAttemptView,
} from '../../lib/sign-in-attempt-messages'
import type { SchemaRuntimeMessageOperationRequest } from './schema-runtime-message-route'
import { extensionPairingIdentity } from './pairing-identity'
import {
  SignInAttemptTabRecords,
  StoredSignInAttemptKind,
  type SignInAttemptRecordRetention,
  type SignInAttemptTabId,
} from './sign-in-attempt-store'

type SignInAttemptOperationRequest =
  SchemaRuntimeMessageOperationRequest<BrowserRuntimeMessage>
type SignInAttemptSenderAdmission = Parameters<
  typeof extensionPairingIdentity.isAuthorizedWebsiteSender
>[0]

/** Chrome sender facts the attempt is bound to; never taken from the message body. */
type SignInAttemptBinding = {
  readonly tab: SignInAttemptTabId
  readonly senderOrigin: string
}
type SignInAttemptBegin = {
  readonly binding: SignInAttemptBinding
  readonly login: SignInAttemptLoginReference
}
type SignInAttemptAdvanceStep = {
  readonly binding: SignInAttemptBinding
  readonly event: SignInAttemptEvent
}
type SignInAttemptTransitionApplication = {
  readonly tab: SignInAttemptTabId
  readonly transition: SignInAttemptTransition
}

export class SignInAttemptRejection extends Schema.TaggedError<SignInAttemptRejection>()(
  'SignInAttemptRejection',
  { reason: Schema.Enum(SignInAttemptFailureReason) },
) {}

export type SignInAttemptRouteDependencies = {
  readonly records: SignInAttemptTabRecords
  readonly authorizesSender: (
    admission: SignInAttemptSenderAdmission,
  ) => boolean
  readonly companionReady: Promise<void>
  readonly now: () => number
}

/**
 * Service-worker control plane for one tab's sign-in attempt: binds the
 * request to the Chrome sender, stores Rust's opaque record verbatim, and
 * applies Rust's disposition. Every lifecycle decision is Rust's.
 */
export class SignInAttemptRoute {
  static readonly ENVELOPE = Schema.Struct({
    type: Schema.Literal(SignInAttemptMessageType.Session),
  })
  static readonly SENDER = Schema.Struct({
    frameId: Schema.Literal(0),
    tab: Schema.Struct({ id: SignInAttemptTabRecords.TAB_ID }),
    url: Schema.String,
  })
  static readonly failed: SignInAttemptRuntimeResponse = {
    ok: false,
    reason: SignInAttemptFailureReason.Unavailable,
  }

  constructor(private readonly dependencies: SignInAttemptRouteDependencies) {}

  /** Matches only the envelope type; the operation decodes the full request. */
  static decodeEnvelope(message: BrowserRuntimeMessage) {
    return Schema.decodeUnknownEffect(SignInAttemptRoute.ENVELOPE)(
      message,
    ).pipe(Effect.as(message))
  }

  respond(
    request: SignInAttemptOperationRequest,
  ): Promise<SignInAttemptRuntimeResponse> {
    return Effect.runPromise(
      this.run(request).pipe(
        Effect.catch((failure) => Effect.succeed(this.rejected(failure))),
      ),
    )
  }

  /** `chrome.tabs.onRemoved`: the attempt never outlives its tab. */
  forgetTab(tabId: number): Promise<void> {
    const tab = Schema.decodeUnknownOption(SignInAttemptTabRecords.TAB_ID)(
      tabId,
    )
    switch (tab._tag) {
      case 'None':
        return Promise.resolve()
      case 'Some':
        break
    }
    const records = this.dependencies.records
    return Effect.runPromise(
      records
        .serialized(records.remove(tab.value))
        .pipe(Effect.catch(() => Effect.void)),
    )
  }

  private rejected(
    failure: SignInAttemptRejection | Error,
  ): SignInAttemptRuntimeResponse {
    switch (true) {
      case failure instanceof SignInAttemptRejection:
        return { ok: false, reason: failure.reason }
    }
    return SignInAttemptRoute.failed
  }

  private readonly run = Effect.fnUntraced(function* (
    this: SignInAttemptRoute,
    request: SignInAttemptOperationRequest,
  ) {
    const message = yield* SignInAttemptMessageCodec.decode(request.message)
    const binding = yield* this.bind(request.sender)
    yield* Effect.promise(() => this.dependencies.companionReady)
    const payload = message.payload
    switch (payload.operation) {
      case SignInAttemptOperation.Begin: {
        const begin: SignInAttemptBegin = { binding, login: payload.login }
        const view = yield* this.dependencies.records.serialized(
          this.begin(begin),
        )
        return this.delivered(view)
      }
      case SignInAttemptOperation.Advance: {
        const step: SignInAttemptAdvanceStep = { binding, event: payload.event }
        const view = yield* this.dependencies.records.serialized(
          this.advance(step),
        )
        return this.delivered(view)
      }
    }
  })

  private delivered(attempt: SignInAttemptView): SignInAttemptRuntimeResponse {
    return { ok: true, attempt }
  }

  /** Top-level frame of a tab, with the origin derived from the Chrome sender. */
  private bind(sender: chrome.runtime.MessageSender) {
    const forbidden = new SignInAttemptRejection({
      reason: SignInAttemptFailureReason.ForbiddenSender,
    })
    return Schema.decodeUnknownEffect(SignInAttemptRoute.SENDER)(sender).pipe(
      Effect.mapError(() => forbidden),
      Effect.flatMap((decoded) => {
        const url = URL.parse(decoded.url)
        switch (true) {
          case url instanceof URL: {
            const origin: SignInAttemptSenderOrigin = {
              sender,
              tab: decoded.tab.id,
              origin: url.origin,
            }
            return this.authorize(origin)
          }
        }
        return Effect.fail(forbidden)
      }),
    )
  }

  /** The existing authorized-website-sender check: this extension, a tab, matching origin. */
  private authorize(origin: SignInAttemptSenderOrigin) {
    const admission: SignInAttemptSenderAdmission = {
      sender: origin.sender,
      origin: origin.origin,
    }
    const binding: SignInAttemptBinding = {
      tab: origin.tab,
      senderOrigin: origin.origin,
    }
    switch (this.dependencies.authorizesSender(admission)) {
      case true:
        return Effect.succeed(binding)
      case false:
        return Effect.fail(
          new SignInAttemptRejection({
            reason: SignInAttemptFailureReason.ForbiddenSender,
          }),
        )
    }
  }

  private begin(begin: SignInAttemptBegin) {
    const request: SignInAttemptBeginRequest = {
      senderOrigin: begin.binding.senderOrigin,
      login: begin.login,
      now: this.dependencies.now(),
    }
    return Effect.try(() => begin_sign_in_attempt(request)).pipe(
      Effect.flatMap((transition) => {
        const application: SignInAttemptTransitionApplication = {
          tab: begin.binding.tab,
          transition,
        }
        return this.apply(application)
      }),
    )
  }

  private advance(step: SignInAttemptAdvanceStep) {
    const records = this.dependencies.records
    return records.load(step.binding.tab).pipe(
      Effect.flatMap((stored) => {
        switch (stored.kind) {
          case StoredSignInAttemptKind.Absent:
            return Effect.succeed(this.none())
          case StoredSignInAttemptKind.Unreadable:
            return records.remove(step.binding.tab).pipe(Effect.as(this.none()))
          case StoredSignInAttemptKind.Stored: {
            const request: SignInAttemptAdvanceRequest = {
              record: stored.record,
              senderOrigin: step.binding.senderOrigin,
              now: this.dependencies.now(),
              event: step.event,
            }
            return Effect.try(() => advance_sign_in_attempt(request)).pipe(
              Effect.flatMap((advance) => {
                const outcome: SignInAttemptAdvanceOutcome = {
                  tab: step.binding.tab,
                  advance,
                }
                return this.applyAdvance(outcome)
              }),
            )
          }
        }
      }),
    )
  }

  private applyAdvance(outcome: SignInAttemptAdvanceOutcome) {
    switch (outcome.advance.kind) {
      case 'Advanced': {
        const application: SignInAttemptTransitionApplication = {
          tab: outcome.tab,
          transition: outcome.advance.transition,
        }
        return this.apply(application)
      }
      case 'RecordRejected':
        return this.dependencies.records
          .remove(outcome.tab)
          .pipe(Effect.as(this.none()))
      case 'OtherSite':
        return Effect.succeed(this.none())
    }
  }

  /** Retain stores the new opaque record; Close removes it after this delivery. */
  private apply(application: SignInAttemptTransitionApplication) {
    const records = this.dependencies.records
    const disposition = application.transition.disposition
    const presented: SignInAttemptView = {
      kind: SignInAttemptViewKind.Presented,
      presentation: application.transition.presentation,
    }
    switch (disposition.kind) {
      case 'Retain': {
        const retention: SignInAttemptRecordRetention = {
          tab: application.tab,
          record: disposition.record,
        }
        return records.retain(retention).pipe(Effect.as(presented))
      }
      case 'Close':
        return records.remove(application.tab).pipe(Effect.as(presented))
    }
  }

  private none(): SignInAttemptView {
    return { kind: SignInAttemptViewKind.None }
  }
}

type SignInAttemptSenderOrigin = {
  readonly sender: chrome.runtime.MessageSender
  readonly tab: SignInAttemptTabId
  readonly origin: string
}
type SignInAttemptAdvanceOutcome = {
  readonly tab: SignInAttemptTabId
  readonly advance: SignInAttemptAdvance
}
