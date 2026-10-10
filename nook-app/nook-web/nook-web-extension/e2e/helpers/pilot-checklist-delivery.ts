/// <reference types="chrome" />
import type { Worker } from '@playwright/test'
import { CompanionWasmSessionMessageType } from '../../../nook-web-shared/src/extension/companion-wasm-runtime-messages'
import { GoogleLoginContinuationMessageType } from '../../../nook-web-shared/src/extension/google-login-continuation-messages'
import type { ExtensionSessionTransportRequest } from '../../src/offscreen/session-request-adapter'
import type { ExtensionSessionResponse } from '../../src/offscreen/session'
import { ExtensionSessionMessageType } from '../../src/lib/extension-session-message-type'

export enum PilotProjectionDeliveryKind {
  Armed = 'Armed',
  Held = 'Held',
  Released = 'Released',
}
enum PilotReplyCompletionKind {
  Callback = 'Callback',
  NoCallback = 'NoCallback',
}
enum PilotReplyDisposition {
  Hold = 'Hold',
  Forward = 'Forward',
}

type PilotChecklistReply =
  | { kind: PilotProjectionDeliveryKind.Armed }
  | { kind: PilotProjectionDeliveryKind.Held; release: () => void }
  | { kind: PilotProjectionDeliveryKind.Released }
export type PilotProjectionDeliveryState = PilotChecklistReply['kind']
declare global {
  interface Window {
    __nookPilotChecklistReply: PilotChecklistReply
  }
}

type FilledProjectionInstall = {
  companion: typeof CompanionWasmSessionMessageType
  google: typeof GoogleLoginContinuationMessageType
  session: typeof ExtensionSessionMessageType
  delivery: typeof PilotProjectionDeliveryKind
  completion: typeof PilotReplyCompletionKind
  disposition: typeof PilotReplyDisposition
}

/** Runs in the real service worker and holds only its actual post-clear Filled reply. */
function installFilledProjectionHold(install: FilledProjectionInstall): void {
  type ReplyCompletion =
    | {
        kind: PilotReplyCompletionKind.Callback
        callback: (response: ExtensionSessionResponse) => void
      }
    | { kind: PilotReplyCompletionKind.NoCallback }
  type ReplyRequest = {
    message: ExtensionSessionTransportRequest
    response: ExtensionSessionResponse
    completion: ReplyCompletion
  }
  type HeldDelivery =
    | { kind: PilotProjectionDeliveryKind.Armed }
    | { kind: PilotProjectionDeliveryKind.Held; reply: ReplyRequest }
    | { kind: PilotProjectionDeliveryKind.Released }
  const runtime = chrome.runtime
  const original = runtime.sendMessage.bind(runtime)

  class FilledProjectionHold {
    private delivery: HeldDelivery = { kind: install.delivery.Armed }
    send(
      message: ExtensionSessionTransportRequest,
      callback?: (response: ExtensionSessionResponse) => void,
    ): void {
      let completion: ReplyCompletion
      switch (typeof callback) {
        case 'function':
          completion = { kind: install.completion.Callback, callback }
          break
        case 'string':
        case 'number':
        case 'bigint':
        case 'boolean':
        case 'symbol':
        case 'undefined':
        case 'object':
          completion = { kind: install.completion.NoCallback }
      }
      const request: ConstructorParameters<typeof FilledProjectionReply>[0] = {
        owner: this,
        message,
        completion,
      }
      const reply = new FilledProjectionReply(request)
      original(message, reply.receive.bind(reply))
    }
    receive(reply: ReplyRequest): void {
      switch (this.disposition(reply.message)) {
        case install.disposition.Forward:
          this.forward(reply)
          return
        case install.disposition.Hold:
          this.delivery = { kind: install.delivery.Held, reply }
          self.__nookPilotChecklistReply = {
            kind: install.delivery.Held,
            release: this.release.bind(this),
          }
      }
    }
    private disposition(
      message: ExtensionSessionTransportRequest,
    ): PilotReplyDisposition {
      switch (this.delivery.kind) {
        case install.delivery.Held:
        case install.delivery.Released:
          return install.disposition.Forward
        case install.delivery.Armed:
          break
      }
      switch (message.type) {
        case install.companion.ProjectAuthenticationLoginChecklist:
          switch (message.payload.observation.kind) {
            case 'Outcome':
              return install.disposition.Forward
            case 'Activity':
              switch (message.payload.observation.activity) {
                case 'Filled':
                  return install.disposition.Hold
                case 'Ready':
                case 'Filling':
                case 'Submitting':
                case 'Submitted':
                case 'SubmissionRejected':
                case 'SubmissionUnobserved':
                case 'FillFailed':
                case 'TakenOver':
                  return install.disposition.Forward
              }
          }
          break
        case install.google.Session:
        case install.session.Status:
        case install.session.UnlockPin:
        case install.session.VaultSummary:
        case install.companion.ClassifyFocusedCredentialField:
        case install.companion.ClassifyLoginSaveOutcome:
        case install.companion.RevalidateFocusedCredentialField:
        case install.companion.GetAuthenticationActivityProgress:
        case install.companion.ExtractAuthenticationBackupCodeCandidates:
        case install.companion.ProjectAuthenticationNavigationPath:
        case install.companion.AuthenticationAuthenticatorSetupObservation:
        case install.companion
          .AuthenticationWorkflowPilotPresentationCapability:
        case install.companion.PasswordWorkflowActivity:
        case install.companion.BindAuthenticationPageObservationFacts:
        case install.companion.AuthenticationPageObservationFactsMatchBinding:
        case install.companion.AuthenticationEnrollmentWorkflowMatch:
        case install.companion.HasLoginContext:
        case install.companion.ClassifyPageInputField:
        case install.companion.ClassifyPageInputs:
        case install.companion.LooksLikeLoginAdvanceControlLabel:
        case install.companion.LooksLikeManualCheckpointLabel:
        case install.companion.LooksLikePasskeyControlLabel:
        case install.companion.LooksLikeEmailVerificationBody:
        case install.companion.LooksLikeOneTimeCodeAutoSubmitSignal:
        case install.companion.AuthenticationRecoveryCopyEvidence:
        case install.companion.IsNookVaultAppUrl:
        case install.companion.DecodeAuthenticationWorkflowRuntimeResponse:
        case install.companion.DecodeContentRuntimeResponse:
        case install.companion.EvaluateAuthenticationPolicies:
        case install.companion.RevalidateApprovedAuthenticationWorkflow:
        case install.session.ClassifyGrantAuthority:
        case install.session.ExportVaultEventLog:
        case install.session.Reset:
        case install.session.MigrateAuthProviders:
        case install.session.BeginPasskeySetup:
        case install.session.FinishPasskeySetup:
        case install.session.RecoverPasskey:
        case install.session.UnlockOptions:
        case install.session.UnlockPasskey:
        case install.session.CreatePin:
        case install.session.SealIdentityHandoff:
        case install.session.ImportVault:
        case install.session.UpdateVault:
        case install.session.ListPasskeys:
        case install.session.ListLogins:
        case install.session.RevealLogin:
        case install.session.RevealFocusedLogin:
        case install.session.ListAuthenticators:
        case install.session.AuthenticatorCode:
        case install.session.AuthenticatorEnrollPreview:
        case install.session.AuthenticatorEnrollCode:
        case install.session.AuthenticatorEnrollConfirm:
        case install.session.AuthenticatorBackupAttach:
        case install.session.PlanLoginSave:
        case install.session.PendingLoginSave:
        case install.session.CommitLoginSave:
        case install.session.DismissLoginSave:
        case install.session.CancelPasskey:
        case install.session.RegisterPasskey:
        case install.session.AssertPasskey:
        case install.session.Lock:
        case 'nook:extension-session-discover-companion-identity':
        case 'nook:extension-session-authorize-companion-identity-handoff':
          return install.disposition.Forward
      }
    }
    private forward(reply: ReplyRequest): void {
      switch (reply.completion.kind) {
        case install.completion.NoCallback:
          return
        case install.completion.Callback:
          reply.completion.callback(reply.response)
      }
    }
    release(): void {
      switch (this.delivery.kind) {
        case install.delivery.Armed:
        case install.delivery.Released:
          return
        case install.delivery.Held: {
          const reply = this.delivery.reply
          Reflect.set(runtime, 'sendMessage', original)
          this.delivery = { kind: install.delivery.Released }
          self.__nookPilotChecklistReply = { kind: install.delivery.Released }
          this.forward(reply)
        }
      }
    }
  }
  type FilledProjectionReplyRequest = {
    owner: FilledProjectionHold
    message: ExtensionSessionTransportRequest
    completion: ReplyCompletion
  }
  class FilledProjectionReply {
    constructor(private readonly request: FilledProjectionReplyRequest) {}
    receive(response: ExtensionSessionResponse): void {
      const reply: ReplyRequest = {
        message: this.request.message,
        completion: this.request.completion,
        response,
      }
      this.request.owner.receive(reply)
    }
  }
  const hold = new FilledProjectionHold()
  self.__nookPilotChecklistReply = { kind: install.delivery.Armed }
  Reflect.set(runtime, 'sendMessage', hold.send.bind(hold))
}
function projectionDeliveryState(): PilotProjectionDeliveryState {
  return self.__nookPilotChecklistReply.kind
}
function releaseHeldProjection(
  delivery: typeof PilotProjectionDeliveryKind,
): void {
  switch (self.__nookPilotChecklistReply.kind) {
    case delivery.Armed:
    case delivery.Released:
      return
    case delivery.Held:
      self.__nookPilotChecklistReply.release()
  }
}
export async function holdPilotFilledProjection(worker: Worker): Promise<void> {
  const request: FilledProjectionInstall = {
    companion: CompanionWasmSessionMessageType,
    google: GoogleLoginContinuationMessageType,
    session: ExtensionSessionMessageType,
    delivery: PilotProjectionDeliveryKind,
    completion: PilotReplyCompletionKind,
    disposition: PilotReplyDisposition,
  }
  await worker.evaluate<void, FilledProjectionInstall>(
    installFilledProjectionHold,
    request,
  )
}
export function pilotProjectionDeliveryState(
  worker: Worker,
): Promise<PilotProjectionDeliveryState> {
  return worker.evaluate(projectionDeliveryState)
}
export async function releasePilotProjection(worker: Worker): Promise<void> {
  await worker.evaluate(releaseHeldProjection, PilotProjectionDeliveryKind)
}
