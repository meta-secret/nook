import { Effect } from 'effect'
import {
  AuthenticationWorkflowAction,
  AuthenticatorCodeResponseKind,
  type AuthenticatorCodeResponse,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  PasswordFormQueryKind,
  passwordFormCredentialInteraction,
  type OneTimeCodeFillRequest,
  type PasswordFormObservation,
} from '../../../../nook-web-shared/src/extension/password-forms'
import type { BrowserRuntimeMessageValue } from '../../lib/browser-runtime-message'
import {
  WebsiteAuthenticatorFillMessageType,
  type WebsiteAuthenticatorFillMessage,
} from '../../lib/login-fill-messages'
import {
  SidePanelPageCodeFillReplyKind,
  SidePanelPageFillMessages,
  type SidePanelPageCodeFillReply,
  type SidePanelPageFillAccount,
} from '../../lib/side-panel-page-fill'
import {
  RuntimeMessageDeliveryKind,
  authenticationRuntimeTransport,
  type RuntimeMessageDelivery,
} from './runtime-message-adapter'
import {
  SidePanelPageSender,
  SidePanelPageSenderAdmission,
} from './side-panel-page-sender'
import {
  SidePanelPageWorkflowDiscovery,
  SidePanelPageWorkflowKind,
  type SidePanelPageWorkflowSource,
} from './side-panel-page-workflow'
import {
  WidgetCredentialActuation,
  WidgetSelectionAdmission,
  widgetState,
} from './state'
import {
  AuthenticationObservationBindingKind,
  RevalidatedAuthenticationAction,
  RevalidatedAuthenticationActionOutcomeKind,
  RevalidatedAuthenticationActResultKind,
  type AuthenticationObservationBinding,
  type RevalidatedAuthenticationActionOutcome,
  type RevalidatedAuthenticationActRequest,
  type RevalidatedAuthenticationActResult,
} from './workflow-revalidation'

type RevalidationRequest = ConstructorParameters<
  typeof RevalidatedAuthenticationAction
>[0]

/** The page capabilities a side-panel Fill code acts through. */
export interface SidePanelCodeFillCollaborators {
  readonly pages: SidePanelPageWorkflowSource
  readonly revalidate: (
    request: RevalidationRequest,
  ) => Promise<RevalidatedAuthenticationActionOutcome>
  readonly code: (
    message: WebsiteAuthenticatorFillMessage,
  ) => Promise<RuntimeMessageDelivery<AuthenticatorCodeResponse>>
  readonly fillCode: (request: OneTimeCodeFillRequest) => boolean
  readonly now: () => number
}

/** Whether Rust classified the document as a one-time-code challenge. */
enum SidePanelCodeChallenge {
  Present = 'present',
  Absent = 'absent',
}

/** The one current code of a Fill code, with the moment it stops being valid. */
type SidePanelCodeWriteRequest = {
  readonly code: string
  readonly expiresAt: number
  readonly collaborators: SidePanelCodeFillCollaborators
}

/** Whether the code is still inside its validity window. */
enum SidePanelCodeValidity {
  Current = 'current',
  Expired = 'expired',
}

/**
 * Owns the plaintext code of one Fill code: it writes it only into the
 * revalidated workflow's one-time-code field, never after it expired, and
 * drops it when the interaction ends.
 */
class SidePanelCodeWrite {
  private code: string

  constructor(private readonly request: SidePanelCodeWriteRequest) {
    this.code = request.code
  }

  validity(): SidePanelCodeValidity {
    switch (this.request.expiresAt > this.request.collaborators.now()) {
      case true:
        return SidePanelCodeValidity.Current
      case false:
        return SidePanelCodeValidity.Expired
    }
  }

  act({
    currentWorkflow,
  }: RevalidatedAuthenticationActRequest): RevalidatedAuthenticationActResult {
    switch (this.validity()) {
      case SidePanelCodeValidity.Expired:
        return { kind: RevalidatedAuthenticationActResultKind.Failed }
      case SidePanelCodeValidity.Current:
        break
    }
    const fill: OneTimeCodeFillRequest = {
      code: this.code,
      kind: PasswordFormQueryKind.Scoped,
      root: currentWorkflow.root,
      formScope: currentWorkflow.formScope,
    }
    switch (this.request.collaborators.fillCode(fill)) {
      case true:
        return { kind: RevalidatedAuthenticationActResultKind.Acted }
      case false:
        return { kind: RevalidatedAuthenticationActResultKind.Failed }
    }
  }

  release(): void {
    this.code = ''
  }
}

type SidePanelCodeReleaseRequest = {
  readonly workflow: PasswordFormObservation
  readonly binding: AuthenticationObservationBinding
  readonly write: SidePanelCodeWrite
  readonly approvalIsActive: () => boolean
}

/**
 * Fills the current code of a saved authenticator, chosen in the side panel,
 * into this top document. It needs Rust's fill-TOTP decision for the
 * document's workflow, revalidates it before asking for the code and again
 * before writing, and never submits or advances the form.
 */
export class SidePanelCodeFillAction {
  private approval = 0
  private readonly generatorContext: SidePanelCodeFillActionGeneratorContext = {
    self: this,
  }

  constructor(private readonly collaborators: SidePanelCodeFillCollaborators) {}

  /** Withdraws the in-flight Fill code's approval, as when the session changes. */
  withdraw(): void {
    this.approval += 1
  }

  fill(account: SidePanelPageFillAccount): Promise<SidePanelPageCodeFillReply> {
    return Effect.runPromise(
      this.filled(account).pipe(
        Effect.catch(() =>
          Effect.succeed(this.reply(SidePanelPageCodeFillReplyKind.FillFailed)),
        ),
      ),
    )
  }

  private reply(
    kind: SidePanelPageCodeFillReplyKind,
  ): SidePanelPageCodeFillReply {
    return { kind }
  }

  private challenge(
    action: AuthenticationWorkflowAction,
  ): SidePanelCodeChallenge {
    switch (action) {
      case AuthenticationWorkflowAction.FillTotp:
        return SidePanelCodeChallenge.Present
      case AuthenticationWorkflowAction.ContinueWithNook:
      case AuthenticationWorkflowAction.GeneratePassword:
      case AuthenticationWorkflowAction.EnrollAuthenticator:
      case AuthenticationWorkflowAction.UsePasskey:
      case AuthenticationWorkflowAction.CreatePasskey:
      case AuthenticationWorkflowAction.TakeOver:
      case AuthenticationWorkflowAction.SaveBackupCodes:
        return SidePanelCodeChallenge.Absent
    }
  }

  private filled = Effect.fn(
    this.generatorContext,
    function* (account: SidePanelPageFillAccount) {
      this.approval += 1
      const approval = this.approval
      const approvalIsActive = () => this.approval === approval
      const page = yield* Effect.tryPromise(() =>
        this.collaborators.pages.pageWorkflow(),
      )
      switch (page.kind) {
        case SidePanelPageWorkflowKind.None:
          return this.reply(SidePanelPageCodeFillReplyKind.NoCodeField)
        case SidePanelPageWorkflowKind.Unavailable:
          return this.reply(SidePanelPageCodeFillReplyKind.FillFailed)
        case SidePanelPageWorkflowKind.Selected:
          break
      }
      switch (this.challenge(page.snapshot.action)) {
        case SidePanelCodeChallenge.Absent:
          return this.reply(SidePanelPageCodeFillReplyKind.NoCodeField)
        case SidePanelCodeChallenge.Present:
          break
      }
      const workflow = page.workflow
      let binding: AuthenticationObservationBinding = {
        kind: AuthenticationObservationBindingKind.Unbound,
      }
      const release: RevalidationRequest = {
        workflow,
        expectedAction: AuthenticationWorkflowAction.FillTotp,
        observationBinding: binding,
        approvalIsActive,
        act: ({ observationBindingToken }) => {
          binding = {
            kind: AuthenticationObservationBindingKind.Required,
            token: observationBindingToken,
          }
          return { kind: RevalidatedAuthenticationActResultKind.Acted }
        },
      }
      const released = yield* Effect.tryPromise(() =>
        this.collaborators.revalidate(release),
      )
      switch (released.kind) {
        case RevalidatedAuthenticationActionOutcomeKind.Acted:
          break
        case RevalidatedAuthenticationActionOutcomeKind.Rejected:
        case RevalidatedAuthenticationActionOutcomeKind.ActionFailed:
        case RevalidatedAuthenticationActionOutcomeKind.ControlMissing:
          return this.reply(SidePanelPageCodeFillReplyKind.NoCodeField)
      }
      const message: WebsiteAuthenticatorFillMessage = {
        type: WebsiteAuthenticatorFillMessageType.NookWebsiteAuthenticatorFill,
        payload: {
          origin: location.origin,
          vaultStoreId: account.vaultStoreId,
          secretId: account.secretId,
          authorizationGeneration: account.authorizationGeneration,
        },
      }
      const delivery = yield* Effect.tryPromise(() =>
        this.collaborators.code(message),
      )
      switch (delivery.kind) {
        case RuntimeMessageDeliveryKind.Unavailable:
          return this.reply(SidePanelPageCodeFillReplyKind.FillFailed)
        case RuntimeMessageDeliveryKind.Delivered:
          break
      }
      const response = delivery.response
      switch (response.kind) {
        case AuthenticatorCodeResponseKind.Rejected:
          return this.reply(this.rejection(response))
        case AuthenticatorCodeResponseKind.Ready:
          break
      }
      switch (true) {
        case 'code' in response && 'expiresAt' in response: {
          const writeRequest: SidePanelCodeWriteRequest = {
            code: response.code,
            expiresAt: response.expiresAt,
            collaborators: this.collaborators,
          }
          response.code = ''
          const releaseRequest: SidePanelCodeReleaseRequest = {
            workflow,
            binding,
            write: new SidePanelCodeWrite(writeRequest),
            approvalIsActive,
          }
          return yield* this.write(releaseRequest)
        }
        case true:
        default:
          return this.reply(SidePanelPageCodeFillReplyKind.FillFailed)
      }
    },
  )

  private rejection(
    response: AuthenticatorCodeResponse,
  ): SidePanelPageCodeFillReplyKind {
    switch (true) {
      case 'reason' in response && response.reason === 'authenticator-locked':
        return SidePanelPageCodeFillReplyKind.Locked
      case true:
      default:
        return SidePanelPageCodeFillReplyKind.FillFailed
    }
  }

  private write = Effect.fn(
    this.generatorContext,
    function* (request: SidePanelCodeReleaseRequest) {
      const { write } = request
      const eligible =
        request.approvalIsActive() &&
        write.validity() === SidePanelCodeValidity.Current
      switch (eligible) {
        case false:
          write.release()
          return this.reply(SidePanelPageCodeFillReplyKind.FillFailed)
        case true:
          break
      }
      // A Pilot fill may have started while the code was on its way; never
      // interleave writes into its fields.
      switch (widgetState.selectionAdmission()) {
        case WidgetSelectionAdmission.Interacting:
        case WidgetSelectionAdmission.Actuating:
          write.release()
          return this.reply(SidePanelPageCodeFillReplyKind.FillFailed)
        case WidgetSelectionAdmission.Available:
          break
      }
      const revalidation: RevalidationRequest = {
        workflow: request.workflow,
        expectedAction: AuthenticationWorkflowAction.FillTotp,
        observationBinding: request.binding,
        approvalIsActive: request.approvalIsActive,
        act: write.act.bind(write),
      }
      widgetState.credentialActuation = WidgetCredentialActuation.WorkflowFill
      const outcome = yield* Effect.tryPromise(() =>
        this.collaborators.revalidate(revalidation),
      ).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            write.release()
            widgetState.credentialActuation = WidgetCredentialActuation.Idle
          }),
        ),
      )
      switch (outcome.kind) {
        case RevalidatedAuthenticationActionOutcomeKind.Acted:
          return this.reply(SidePanelPageCodeFillReplyKind.Filled)
        case RevalidatedAuthenticationActionOutcomeKind.Rejected:
        case RevalidatedAuthenticationActionOutcomeKind.ActionFailed:
        case RevalidatedAuthenticationActionOutcomeKind.ControlMissing:
          return this.reply(SidePanelPageCodeFillReplyKind.FillFailed)
      }
    },
  )
}

export enum SidePanelCodeFillReception {
  Ignored = 'ignored',
  Responding = 'responding',
}

type SidePanelCodeFillResponse = (reply: SidePanelPageCodeFillReply) => void

export interface SidePanelCodeFillDelivery {
  readonly message: BrowserRuntimeMessageValue
  readonly sender: chrome.runtime.MessageSender
  readonly sendResponse: SidePanelCodeFillResponse
}

enum SidePanelCodeTriggerAdmission {
  NotATrigger = 'not-a-trigger',
  OtherContext = 'other-context',
  Trigger = 'trigger',
}

/**
 * Admits the worker's Fill code trigger in the top document only: from this
 * extension, strictly decoded, for this document's origin, and while no Pilot
 * fill is already writing. It answers with a typed outcome only.
 */
export class SidePanelCodeFillReceiver {
  constructor(private readonly action: SidePanelCodeFillAction) {}

  withdraw(): void {
    this.action.withdraw()
  }

  receive(delivery: SidePanelCodeFillDelivery): SidePanelCodeFillReception {
    switch (this.admission(delivery)) {
      case SidePanelCodeTriggerAdmission.NotATrigger:
      case SidePanelCodeTriggerAdmission.OtherContext:
        return SidePanelCodeFillReception.Ignored
      case SidePanelCodeTriggerAdmission.Trigger:
        break
    }
    const answer = new SidePanelCodeFillAnswer(delivery)
    const decoded = SidePanelPageFillMessages.decodeCode(delivery.message)
    switch (decoded._tag) {
      case 'Failure':
        return answer.send(SidePanelPageCodeFillReplyKind.FillFailed)
      case 'Success':
        break
    }
    const { payload } = decoded.success
    switch (payload.origin === location.origin) {
      case false:
        return answer.send(SidePanelPageCodeFillReplyKind.TabChanged)
      case true:
        break
    }
    switch (widgetState.selectionAdmission()) {
      case WidgetSelectionAdmission.Interacting:
      case WidgetSelectionAdmission.Actuating:
        return answer.send(SidePanelPageCodeFillReplyKind.FillFailed)
      case WidgetSelectionAdmission.Available:
        break
    }
    void this.action
      .fill(payload.account)
      .then(delivery.sendResponse)
      .catch(() => answer.send(SidePanelPageCodeFillReplyKind.FillFailed))
    return SidePanelCodeFillReception.Responding
  }

  private admission(
    delivery: SidePanelCodeFillDelivery,
  ): SidePanelCodeTriggerAdmission {
    switch (SidePanelPageFillMessages.matchesCode(delivery.message)._tag) {
      case 'Failure':
        return SidePanelCodeTriggerAdmission.NotATrigger
      case 'Success':
        break
    }
    switch (new SidePanelPageSender(delivery.sender).admission()) {
      case SidePanelPageSenderAdmission.OwnTopDocument:
        return SidePanelCodeTriggerAdmission.Trigger
      case SidePanelPageSenderAdmission.OtherContext:
        return SidePanelCodeTriggerAdmission.OtherContext
    }
  }
}

/** Answers one admitted trigger with its typed outcome. */
class SidePanelCodeFillAnswer {
  constructor(private readonly delivery: SidePanelCodeFillDelivery) {}

  send(kind: SidePanelPageCodeFillReplyKind): SidePanelCodeFillReception {
    const reply: SidePanelPageCodeFillReply = { kind }
    this.delivery.sendResponse(reply)
    return SidePanelCodeFillReception.Responding
  }
}

type SidePanelCodeFillActionGeneratorContext = {
  readonly self: SidePanelCodeFillAction
}

const sidePanelCodeFillCollaborators: SidePanelCodeFillCollaborators = {
  pages: new SidePanelPageWorkflowDiscovery(),
  revalidate: (request) =>
    new RevalidatedAuthenticationAction(request).execute(),
  code: authenticationRuntimeTransport.sendAuthenticatorCodeRuntimeMessage.bind(
    authenticationRuntimeTransport,
  ),
  fillCode: passwordFormCredentialInteraction.fillOneTimeCode.bind(
    passwordFormCredentialInteraction,
  ),
  now: () => Date.now(),
}

/** The content script's single side-panel Fill code receiver. */
export const sidePanelCodeFill = new SidePanelCodeFillReceiver(
  new SidePanelCodeFillAction(sidePanelCodeFillCollaborators),
)
