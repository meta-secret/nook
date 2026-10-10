import { Effect } from 'effect'
import { err, ok, type Result } from 'neverthrow'
import { companionWasmReady } from '../../../nook-web-shared/src/extension/companion-ready'
import {
  begin_google_two_step_login,
  CredentialKind,
  GoogleLoginContinuationDecision,
  type GoogleTwoStepLoginContinuation,
  type GoogleLoginStartRequest,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  GoogleLoginContinuationMessageType,
  GoogleLoginContinuationOperation,
  GoogleLoginContextKey,
  type GoogleLoginBrowserContext,
  type GoogleLoginTabId,
  type GoogleLoginFrameId,
  type GoogleLoginDocumentId,
  type GoogleLoginSourceOrigin,
  type GoogleLoginSessionMessage,
  type GoogleLoginSessionResponse,
} from '../../../nook-web-shared/src/extension/google-login-continuation-messages'
import {
  CompanionWasmSessionMessageType,
  type CompanionWasmSessionMessage,
  type CompanionWasmSessionResponse,
} from '../../../nook-web-shared/src/extension/companion-wasm-runtime-messages'
import { handleCompanionWasmMessage } from './session-companion-wasm-operations'
import {
  SessionOperationFailure,
  SessionOperationFailureKind,
} from '../lib/session-operation-queue'

type GoogleLoginBeginPayload = Extract<
  GoogleLoginSessionMessage['payload'],
  { readonly operation: GoogleLoginContinuationOperation.Begin }
>
type GoogleLoginBeginMessage = Omit<GoogleLoginSessionMessage, 'payload'> & {
  readonly payload: GoogleLoginBeginPayload
}
type GoogleLoginContextTuple = readonly [
  GoogleLoginTabId,
  GoogleLoginFrameId,
  GoogleLoginDocumentId,
  GoogleLoginSourceOrigin,
]
interface GoogleLoginRetainedContinuation {
  readonly handle: GoogleTwoStepLoginContinuation
  readonly timer: ReturnType<typeof setTimeout>
}

/** Owns only live Google handles belonging to actual Chrome documents. */
export class GoogleLoginSessionContinuations {
  private readonly pending = new Map<
    GoogleLoginContextKey,
    GoogleLoginRetainedContinuation
  >()

  static buildHandler(): typeof handleCompanionWasmMessage {
    const owner = new GoogleLoginSessionContinuations()
    return owner.handle.bind(owner)
  }
  private key(context: GoogleLoginBrowserContext): GoogleLoginContextKey {
    const identity: GoogleLoginContextTuple = [
      context.tabId,
      context.frameId,
      context.documentId,
      context.sourceOrigin,
    ]
    return GoogleLoginContextKey.make(JSON.stringify(identity))
  }
  cancel(context: GoogleLoginBrowserContext): void {
    const key = this.key(context)
    const retained = this.pending.get(key)
    switch (true) {
      case !retained:
        return
      case true:
        break
    }
    this.pending.delete(key)
    clearTimeout(retained.timer)
    retained.handle.free()
  }
  private begin(
    message: GoogleLoginBeginMessage,
  ): GoogleLoginContinuationDecision {
    this.cancel(message.browserContext)
    const request: GoogleLoginStartRequest = message.payload.request
    const handle = begin_google_two_step_login(request)
    const retained: GoogleLoginRetainedContinuation = {
      handle,
      timer: setTimeout(() => this.cancel(message.browserContext), 60_000),
    }
    this.pending.set(this.key(message.browserContext), retained)
    return GoogleLoginContinuationDecision.AwaitPassword
  }
  private execute(
    message: GoogleLoginSessionMessage,
  ): GoogleLoginContinuationDecision {
    const context = message.browserContext
    const payload = message.payload
    switch (payload.operation) {
      case GoogleLoginContinuationOperation.Cancel:
        this.cancel(context)
        return GoogleLoginContinuationDecision.Cancel
      case GoogleLoginContinuationOperation.Begin: {
        const beginMessage: GoogleLoginBeginMessage = { ...message, payload }
        return this.begin(beginMessage)
      }
      case GoogleLoginContinuationOperation.Inspect:
      case GoogleLoginContinuationOperation.Admit:
        break
    }
    const key = this.key(context)
    const retained = this.pending.get(key)
    switch (true) {
      case !retained:
        return GoogleLoginContinuationDecision.Cancel
      case true:
        break
    }
    switch (payload.operation) {
      case GoogleLoginContinuationOperation.Inspect: {
        const decision = retained.handle.inspect(payload.request)
        switch (decision) {
          case GoogleLoginContinuationDecision.AwaitPassword:
          case GoogleLoginContinuationDecision.FillPassword:
            return decision
          case GoogleLoginContinuationDecision.Cancel:
            this.cancel(context)
            return decision
        }
        throw new SessionOperationFailure(
          SessionOperationFailureKind.Verification,
        )
      }
      case GoogleLoginContinuationOperation.Admit: {
        // Remove ownership before consuming: an admission failure consumes too.
        this.pending.delete(key)
        clearTimeout(retained.timer)
        const credential = retained.handle.admit_password(payload.request)
        switch (credential) {
          case CredentialKind.CurrentPassword:
            return GoogleLoginContinuationDecision.FillPassword
          case CredentialKind.Username:
            throw new SessionOperationFailure(
              SessionOperationFailureKind.Verification,
            )
        }
      }
    }
  }
  handle(
    message: CompanionWasmSessionMessage,
  ): Promise<Result<CompanionWasmSessionResponse, SessionOperationFailure>> {
    switch (message.type) {
      case GoogleLoginContinuationMessageType.Session:
        return Effect.runPromise(
          Effect.promise(() => companionWasmReady).pipe(
            Effect.map(() => {
              const response: GoogleLoginSessionResponse = {
                ok: true,
                result: this.execute(message),
              }
              return ok(response)
            }),
            Effect.catchDefect(() => {
              this.cancel(message.browserContext)
              return Effect.succeed(
                err(
                  new SessionOperationFailure(
                    SessionOperationFailureKind.InvalidRequest,
                  ),
                ),
              )
            }),
          ),
        )
      case CompanionWasmSessionMessageType.ProjectAuthenticationLoginChecklist:
      case CompanionWasmSessionMessageType.ClassifyLoginSaveOutcome:
      case CompanionWasmSessionMessageType.ClassifyFocusedCredentialField:
      case CompanionWasmSessionMessageType.RevalidateFocusedCredentialField:
      case CompanionWasmSessionMessageType.GetAuthenticationActivityProgress:
      case CompanionWasmSessionMessageType.ExtractAuthenticationBackupCodeCandidates:
      case CompanionWasmSessionMessageType.ProjectAuthenticationNavigationPath:
      case CompanionWasmSessionMessageType.AuthenticationAuthenticatorSetupObservation:
      case CompanionWasmSessionMessageType.AuthenticationWorkflowPilotPresentationCapability:
      case CompanionWasmSessionMessageType.PasswordWorkflowActivity:
      case CompanionWasmSessionMessageType.BindAuthenticationPageObservationFacts:
      case CompanionWasmSessionMessageType.AuthenticationPageObservationFactsMatchBinding:
      case CompanionWasmSessionMessageType.AuthenticationEnrollmentWorkflowMatch:
      case CompanionWasmSessionMessageType.HasLoginContext:
      case CompanionWasmSessionMessageType.ClassifyPageInputField:
      case CompanionWasmSessionMessageType.ClassifyPageInputs:
      case CompanionWasmSessionMessageType.LooksLikeLoginAdvanceControlLabel:
      case CompanionWasmSessionMessageType.LooksLikeManualCheckpointLabel:
      case CompanionWasmSessionMessageType.LooksLikePasskeyControlLabel:
      case CompanionWasmSessionMessageType.LooksLikeEmailVerificationBody:
      case CompanionWasmSessionMessageType.LooksLikeOneTimeCodeAutoSubmitSignal:
      case CompanionWasmSessionMessageType.AuthenticationRecoveryCopyEvidence:
      case CompanionWasmSessionMessageType.IsNookVaultAppUrl:
      case CompanionWasmSessionMessageType.DecodeAuthenticationWorkflowRuntimeResponse:
      case CompanionWasmSessionMessageType.DecodeContentRuntimeResponse:
      case CompanionWasmSessionMessageType.EvaluateAuthenticationPolicies:
      case CompanionWasmSessionMessageType.RevalidateApprovedAuthenticationWorkflow:
        return handleCompanionWasmMessage(message)
    }
  }
}
