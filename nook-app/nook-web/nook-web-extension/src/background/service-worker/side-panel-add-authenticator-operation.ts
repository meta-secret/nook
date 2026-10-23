import { Effect } from 'effect'
import {
  SidePanelAddAuthenticatorKind,
  SidePanelAuthenticatorSetupMessageType,
  SidePanelAuthenticatorSetupMessages,
  SidePanelPageAddAuthenticatorReplyKind,
  type SidePanelAddAuthenticatorOutcome,
  type SidePanelPageAddAuthenticatorMessage,
} from '../../lib/side-panel-authenticator-setup'
import type {
  SidePanelPageDelivery,
  SidePanelSiteDependencies,
} from './side-panel-site-access'
import type { SidePanelSiteOperationRequest } from './side-panel-site-operations'
import { SidePanelSenderAdmission } from './side-panel-sender'
import { SidePanelTabTargetKind } from './side-panel-tab-target'

/**
 * Starts "Add 2FA from this page" in the active tab of the panel's window.
 * The worker admits only the panel document, resolves the tab itself, and
 * sends frame 0 a trigger that names the origin it derived and nothing else.
 * The content script starts its own consented enrollment, which reads the
 * page's QR code or setup key and saves only after the user confirms.
 */
export class SidePanelAddAuthenticatorOperation {
  private readonly generatorContext: SidePanelAddAuthenticatorGeneratorContext =
    { self: this }

  constructor(private readonly dependencies: SidePanelSiteDependencies) {}

  run(
    request: SidePanelSiteOperationRequest,
  ): Promise<SidePanelAddAuthenticatorOutcome> {
    return Effect.runPromise(
      this.add(request).pipe(
        Effect.catch(() =>
          Effect.succeed(this.outcome(SidePanelAddAuthenticatorKind.Failed)),
        ),
      ),
    )
  }

  private outcome(
    kind: SidePanelAddAuthenticatorKind,
  ): SidePanelAddAuthenticatorOutcome {
    return { kind }
  }

  private add = Effect.fn(
    this.generatorContext,
    function* (request: SidePanelSiteOperationRequest) {
      switch (this.dependencies.senderAdmission(request.sender)) {
        case SidePanelSenderAdmission.Forbidden:
          return this.outcome(SidePanelAddAuthenticatorKind.Forbidden)
        case SidePanelSenderAdmission.Admitted:
          break
      }
      const decoded = yield* Effect.result(
        SidePanelAuthenticatorSetupMessages.decodeAdd(request.message),
      )
      switch (decoded._tag) {
        case 'Failure':
          return this.outcome(SidePanelAddAuthenticatorKind.Forbidden)
        case 'Success':
          break
      }
      const target = yield* Effect.tryPromise(() =>
        this.dependencies.tabTarget(decoded.success.payload),
      )
      switch (target.kind) {
        case SidePanelTabTargetKind.NonWeb:
          return this.outcome(SidePanelAddAuthenticatorKind.NonWeb)
        case SidePanelTabTargetKind.PageUnavailable:
          return this.outcome(SidePanelAddAuthenticatorKind.PageUnavailable)
        case SidePanelTabTargetKind.Failed:
          return this.outcome(SidePanelAddAuthenticatorKind.Failed)
        case SidePanelTabTargetKind.Web:
          break
      }
      const message: SidePanelPageAddAuthenticatorMessage = {
        type: SidePanelAuthenticatorSetupMessageType.PageAdd,
        payload: { origin: target.origin },
      }
      const delivery: SidePanelPageDelivery = { tabId: target.tabId, message }
      const sent = yield* Effect.result(
        Effect.tryPromise(() => this.dependencies.sendPageMessage(delivery)),
      )
      switch (sent._tag) {
        case 'Failure':
          return this.outcome(SidePanelAddAuthenticatorKind.PageUnavailable)
        case 'Success':
          break
      }
      const reply = yield* SidePanelAuthenticatorSetupMessages.decodePageReply(
        sent.success,
      )
      return this.outcome(this.replyKind(reply.kind))
    },
  )

  private replyKind(
    kind: SidePanelPageAddAuthenticatorReplyKind,
  ): SidePanelAddAuthenticatorKind {
    switch (kind) {
      case SidePanelPageAddAuthenticatorReplyKind.Started:
        return SidePanelAddAuthenticatorKind.Started
      case SidePanelPageAddAuthenticatorReplyKind.NoSetup:
        return SidePanelAddAuthenticatorKind.NoSetup
      case SidePanelPageAddAuthenticatorReplyKind.TabChanged:
        return SidePanelAddAuthenticatorKind.TabChanged
    }
  }
}

type SidePanelAddAuthenticatorGeneratorContext = {
  readonly self: SidePanelAddAuthenticatorOperation
}
