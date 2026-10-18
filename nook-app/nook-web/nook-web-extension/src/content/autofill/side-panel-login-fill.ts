import { Effect } from 'effect'
import { AuthenticationWorkflowAction } from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  PasswordFormQueryKind,
  passwordFormCredentialInteraction,
  passwordFormInteraction,
  type LoginCredentials,
  type LoginCredentialsFillRequest,
  type PasswordFormObservation,
  type PasswordFormScopeQuery,
} from '../../../../nook-web-shared/src/extension/password-forms'
import type { BrowserRuntimeMessageValue } from '../../lib/browser-runtime-message'
import {
  WebsiteLoginRevealMessageType,
  type WebsiteLoginRevealMessage,
} from '../../lib/login-fill-messages'
import {
  SidePanelPageFillMessages,
  SidePanelPageFillReplyKind,
  type SidePanelPageFillAccount,
  type SidePanelPageFillReply,
} from '../../lib/side-panel-page-fill'
import {
  LoginFillDeliveryKind,
  loginFillRuntimeTransport,
  type LoginFillDelivery,
} from './login-fill-runtime-adapter'
import {
  SidePanelLoginWorkflowDiscovery,
  SidePanelLoginWorkflowKind,
  type SidePanelLoginWorkflowSource,
} from './side-panel-login-workflow'
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

/** The page capabilities a side-panel Fill acts through. */
export interface SidePanelLoginFillCollaborators {
  readonly workflows: SidePanelLoginWorkflowSource
  readonly revalidate: (
    request: RevalidationRequest,
  ) => Promise<RevalidatedAuthenticationActionOutcome>
  readonly reveal: (
    message: WebsiteLoginRevealMessage,
  ) => Promise<LoginFillDelivery>
  readonly fillCredentials: (request: LoginCredentialsFillRequest) => boolean
  readonly clearCredentials: (request: PasswordFormScopeQuery) => void
}

enum SidePanelFillAttemptKind {
  None = 'none',
  Attempted = 'attempted',
}

type SidePanelFillAttempt =
  | { readonly kind: SidePanelFillAttemptKind.None }
  | {
      readonly kind: SidePanelFillAttemptKind.Attempted
      readonly fill: LoginCredentialsFillRequest
    }

type SidePanelCredentialWriteRequest = {
  readonly credentials: LoginCredentials
  readonly collaborators: SidePanelLoginFillCollaborators
}

/**
 * Owns the one plaintext credential of a Fill: it writes it only into the
 * revalidated workflow's scoped fields, clears those fields when the write is
 * not approved, and drops the values when the interaction ends.
 */
class SidePanelCredentialWrite {
  private attempt: SidePanelFillAttempt = {
    kind: SidePanelFillAttemptKind.None,
  }

  constructor(private readonly request: SidePanelCredentialWriteRequest) {}

  act({
    currentWorkflow,
  }: RevalidatedAuthenticationActRequest): RevalidatedAuthenticationActResult {
    const fill: LoginCredentialsFillRequest = {
      credentials: this.request.credentials,
      kind: PasswordFormQueryKind.Scoped,
      root: currentWorkflow.root,
      formScope: currentWorkflow.formScope,
    }
    this.attempt = { kind: SidePanelFillAttemptKind.Attempted, fill }
    switch (this.request.collaborators.fillCredentials(fill)) {
      case true:
        return { kind: RevalidatedAuthenticationActResultKind.Acted }
      case false:
        return { kind: RevalidatedAuthenticationActResultKind.Failed }
    }
  }

  clearFields(): void {
    switch (this.attempt.kind) {
      case SidePanelFillAttemptKind.None:
        return
      case SidePanelFillAttemptKind.Attempted:
        this.request.collaborators.clearCredentials(this.attempt.fill)
    }
  }

  release(): void {
    this.request.credentials.username = ''
    this.request.credentials.password = ''
  }
}

type SidePanelFillWriteRequest = {
  readonly workflow: PasswordFormObservation
  readonly binding: AuthenticationObservationBinding
  readonly credentials: LoginCredentials
  readonly approvalIsActive: () => boolean
}

/**
 * Fills a saved login chosen in the side panel into this top document. It
 * needs a Rust-classified Login workflow, revalidates it before the reveal and
 * again before writing, and never submits or advances the form.
 */
export class SidePanelLoginFillAction {
  private approval = 0
  private readonly generatorContext: SidePanelLoginFillActionGeneratorContext =
    { self: this }

  constructor(
    private readonly collaborators: SidePanelLoginFillCollaborators,
  ) {}

  /**
   * Withdraws the in-flight Fill's approval, as when the session changes. The
   * surface refresh behind it does not say why (lock, pairing import or a
   * local vault update), so a withdrawn Fill answers fill-failed; a lock the
   * reveal itself observes answers locked.
   */
  withdraw(): void {
    this.approval += 1
  }

  fill(account: SidePanelPageFillAccount): Promise<SidePanelPageFillReply> {
    return Effect.runPromise(
      this.filled(account).pipe(
        Effect.catch(() =>
          Effect.succeed(this.reply(SidePanelPageFillReplyKind.FillFailed)),
        ),
      ),
    )
  }

  private reply(kind: SidePanelPageFillReplyKind): SidePanelPageFillReply {
    return { kind }
  }

  private filled = Effect.fn(
    this.generatorContext,
    function* (account: SidePanelPageFillAccount) {
      this.approval += 1
      const approval = this.approval
      const approvalIsActive = () => this.approval === approval
      const discovered = yield* Effect.tryPromise(() =>
        this.collaborators.workflows.loginWorkflow(),
      )
      switch (discovered.kind) {
        case SidePanelLoginWorkflowKind.Absent:
          return this.reply(SidePanelPageFillReplyKind.NoLoginForm)
        case SidePanelLoginWorkflowKind.Unavailable:
          return this.reply(SidePanelPageFillReplyKind.FillFailed)
        case SidePanelLoginWorkflowKind.Found:
          break
      }
      const workflow = discovered.workflow
      let binding: AuthenticationObservationBinding = {
        kind: AuthenticationObservationBindingKind.Unbound,
      }
      const release: RevalidationRequest = {
        workflow,
        expectedAction: AuthenticationWorkflowAction.ContinueWithNook,
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
          return this.reply(SidePanelPageFillReplyKind.NoLoginForm)
      }
      const reveal: WebsiteLoginRevealMessage = {
        type: WebsiteLoginRevealMessageType.NookWebsiteLoginFill,
        payload: {
          origin: location.origin,
          vaultStoreId: account.vaultStoreId,
          secretId: account.secretId,
          authorizationGeneration: account.authorizationGeneration,
        },
      }
      const delivery = yield* Effect.tryPromise(() =>
        this.collaborators.reveal(reveal),
      )
      switch (delivery.kind) {
        case LoginFillDeliveryKind.Unavailable:
          return this.reply(SidePanelPageFillReplyKind.FillFailed)
        case LoginFillDeliveryKind.Delivered:
          break
      }
      const response = delivery.response
      switch (response.ok) {
        case false:
          return this.reply(this.revealFailure(response.reason))
        case true:
          break
      }
      const credentials: LoginCredentials = {
        username: response.username,
        password: response.password,
      }
      response.password = ''
      response.username = ''
      const write: SidePanelFillWriteRequest = {
        workflow,
        binding,
        credentials,
        approvalIsActive,
      }
      return yield* this.write(write)
    },
  )

  private revealFailure(reason: string): SidePanelPageFillReplyKind {
    switch (reason) {
      case 'login-locked':
        return SidePanelPageFillReplyKind.Locked
      default:
        return SidePanelPageFillReplyKind.FillFailed
    }
  }

  private write = Effect.fn(
    this.generatorContext,
    function* (request: SidePanelFillWriteRequest) {
      const writeRequest: SidePanelCredentialWriteRequest = {
        credentials: request.credentials,
        collaborators: this.collaborators,
      }
      const write = new SidePanelCredentialWrite(writeRequest)
      const eligible =
        request.approvalIsActive() && request.credentials.username !== ''
      switch (eligible) {
        case false:
          write.release()
          return this.reply(SidePanelPageFillReplyKind.FillFailed)
        case true:
          break
      }
      // A Pilot fill may have started while the reveal was in flight; never
      // interleave writes into its fields.
      switch (widgetState.selectionAdmission()) {
        case WidgetSelectionAdmission.Interacting:
        case WidgetSelectionAdmission.Actuating:
          write.release()
          return this.reply(SidePanelPageFillReplyKind.FillFailed)
        case WidgetSelectionAdmission.Available:
          break
      }
      const revalidation: RevalidationRequest = {
        workflow: request.workflow,
        expectedAction: AuthenticationWorkflowAction.ContinueWithNook,
        observationBinding: request.binding,
        approvalIsActive: request.approvalIsActive,
        act: write.act.bind(write),
      }
      widgetState.credentialActuation = WidgetCredentialActuation.WorkflowFill
      const outcome = yield* Effect.tryPromise(() =>
        this.collaborators.revalidate(revalidation),
      ).pipe(
        Effect.tapError(() => Effect.sync(() => write.clearFields())),
        Effect.ensuring(
          Effect.sync(() => {
            write.release()
            widgetState.credentialActuation = WidgetCredentialActuation.Idle
          }),
        ),
      )
      switch (outcome.kind) {
        case RevalidatedAuthenticationActionOutcomeKind.Acted:
          return this.reply(SidePanelPageFillReplyKind.Filled)
        case RevalidatedAuthenticationActionOutcomeKind.Rejected:
        case RevalidatedAuthenticationActionOutcomeKind.ActionFailed:
        case RevalidatedAuthenticationActionOutcomeKind.ControlMissing:
          write.clearFields()
          return this.reply(SidePanelPageFillReplyKind.FillFailed)
      }
    },
  )
}

export enum SidePanelLoginFillReception {
  Ignored = 'ignored',
  Responding = 'responding',
}

type SidePanelLoginFillResponse = (reply: SidePanelPageFillReply) => void

export interface SidePanelLoginFillDelivery {
  readonly message: BrowserRuntimeMessageValue
  readonly sender: chrome.runtime.MessageSender
  readonly sendResponse: SidePanelLoginFillResponse
}

enum SidePanelFillTriggerAdmission {
  NotATrigger = 'not-a-trigger',
  OtherContext = 'other-context',
  Trigger = 'trigger',
}

/**
 * Admits the worker's Fill trigger in the top document only: from this
 * extension, strictly decoded, for this document's origin, and while no Pilot
 * fill is already writing. It answers with a typed outcome only.
 */
export class SidePanelLoginFillReceiver {
  constructor(private readonly action: SidePanelLoginFillAction) {}

  withdraw(): void {
    this.action.withdraw()
  }

  receive(delivery: SidePanelLoginFillDelivery): SidePanelLoginFillReception {
    switch (this.admission(delivery)) {
      case SidePanelFillTriggerAdmission.NotATrigger:
      case SidePanelFillTriggerAdmission.OtherContext:
        return SidePanelLoginFillReception.Ignored
      case SidePanelFillTriggerAdmission.Trigger:
        break
    }
    const answer = new SidePanelLoginFillAnswer(delivery)
    const decoded = SidePanelPageFillMessages.decode(delivery.message)
    switch (decoded._tag) {
      case 'Failure':
        return answer.send(SidePanelPageFillReplyKind.FillFailed)
      case 'Success':
        break
    }
    const { payload } = decoded.success
    switch (payload.origin === location.origin) {
      case false:
        return answer.send(SidePanelPageFillReplyKind.TabChanged)
      case true:
        break
    }
    switch (widgetState.selectionAdmission()) {
      case WidgetSelectionAdmission.Interacting:
      case WidgetSelectionAdmission.Actuating:
        return answer.send(SidePanelPageFillReplyKind.FillFailed)
      case WidgetSelectionAdmission.Available:
        break
    }
    void this.action
      .fill(payload.account)
      .then(delivery.sendResponse)
      .catch(() => answer.send(SidePanelPageFillReplyKind.FillFailed))
    return SidePanelLoginFillReception.Responding
  }

  private admission(
    delivery: SidePanelLoginFillDelivery,
  ): SidePanelFillTriggerAdmission {
    switch (SidePanelPageFillMessages.matches(delivery.message)._tag) {
      case 'Failure':
        return SidePanelFillTriggerAdmission.NotATrigger
      case 'Success':
        break
    }
    const ownTopDocument =
      delivery.sender.id === chrome.runtime.id && window === window.top
    switch (ownTopDocument) {
      case true:
        return SidePanelFillTriggerAdmission.Trigger
      case false:
        return SidePanelFillTriggerAdmission.OtherContext
    }
  }
}

/** Answers one admitted trigger with its typed outcome. */
class SidePanelLoginFillAnswer {
  constructor(private readonly delivery: SidePanelLoginFillDelivery) {}

  send(kind: SidePanelPageFillReplyKind): SidePanelLoginFillReception {
    const reply: SidePanelPageFillReply = { kind }
    this.delivery.sendResponse(reply)
    return SidePanelLoginFillReception.Responding
  }
}

type SidePanelLoginFillActionGeneratorContext = {
  readonly self: SidePanelLoginFillAction
}

const sidePanelLoginFillCollaborators: SidePanelLoginFillCollaborators = {
  workflows: new SidePanelLoginWorkflowDiscovery(),
  revalidate: (request) =>
    new RevalidatedAuthenticationAction(request).execute(),
  reveal: loginFillRuntimeTransport.sendLoginFillMessage.bind(
    loginFillRuntimeTransport,
  ),
  fillCredentials: passwordFormInteraction.fillLoginCredentials.bind(
    passwordFormInteraction,
  ),
  clearCredentials:
    passwordFormCredentialInteraction.clearLoginCredentials.bind(
      passwordFormCredentialInteraction,
    ),
}

/** The content script's single side-panel Fill receiver. */
export const sidePanelLoginFill = new SidePanelLoginFillReceiver(
  new SidePanelLoginFillAction(sidePanelLoginFillCollaborators),
)
