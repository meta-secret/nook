import { Effect, Schema } from 'effect'
import { passwordFormInteraction } from '../../../../nook-web-shared/src/extension/password-forms'
import type { PasswordFormObservation } from '../../../../nook-web-shared/src/extension/password-forms'
import { AuthenticationOutcomeResponseKind } from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  CompanionWasmSessionMessageType,
  CompanionWasmNavigationPathDecoder,
  type CompanionWasmRuntimeMessage,
} from '../../../../nook-web-shared/src/extension/companion-wasm-runtime-messages'
import {
  CompanionWasmRuntimeDeliveryKind,
  sendCompanionWasmRuntimeMessage,
} from '../../../../nook-web-shared/src/extension/companion-wasm-runtime-transport'
import {
  AuthenticationOutcomeClassifyMessageType,
  type AuthenticationOutcomeObservationView,
  type AuthenticationOutcomeVerdictView,
} from '../../lib/outcome-evidence-messages'
import {
  RuntimeMessageDeliveryKind,
  authenticationRuntimeTransport,
} from './runtime-message-adapter'
import { authenticationSurfaceObservation } from './authentication-surface-observation'
import { OUTCOME_EVIDENCE_TIMEOUT_MS } from './workflow-ui'

export enum AuthenticationOutcomeReadKind {
  Available = 'available',
  Unavailable = 'unavailable',
}

enum WorkflowErrorScopeKind {
  Attached = 'attached',
  Excluded = 'excluded',
}
type WorkflowErrorScope =
  | { kind: WorkflowErrorScopeKind.Attached; boundary: Element }
  | { kind: WorkflowErrorScopeKind.Excluded }

type AuthenticationOutcomeRead =
  | {
      kind: AuthenticationOutcomeReadKind.Available
      verdict: AuthenticationOutcomeVerdictView
    }
  | { kind: AuthenticationOutcomeReadKind.Unavailable }

export type AuthenticationOutcomeObservationContext = {
  startedAt: number
  authPath: string
  sawMutation: boolean
}

/** Reuses the shipping non-secret evidence collector and Rust classifier. */
class AuthenticationOutcomeObservation {
  collectOutcomeObservation({
    startedAt,
    authPath,
    sawMutation,
  }: AuthenticationOutcomeObservationContext): AuthenticationOutcomeObservationView {
    const successMarkerPresent = Boolean(
      document.querySelector(
        '[data-nook-auth-outcome="success"], [data-testid="mock-auth-success"]',
      ),
    )
    const errorMarkerPresent = Boolean(
      document.querySelector(
        '[data-nook-auth-outcome="error"], [role="alert"], .error[role="alert"]',
      ),
    )
    const forms = passwordFormInteraction.summarizeAuthenticationWorkflowForms()
    const authFieldsPresent = forms.some(
      (form) =>
        form.summary.passwordFieldCount > 0 ||
        form.summary.usernameFieldCount > 0 ||
        form.summary.oneTimeCodeFieldCount > 0,
    )
    return {
      navigatedAwayFromAuthPath: location.pathname !== authPath,
      authFieldsPresent,
      successMarkerPresent,
      errorMarkerPresent,
      sameDocumentMutation: sawMutation,
      inIframe: window !== window.top,
      elapsedMs: Math.max(0, Date.now() - startedAt),
    }
  }

  async classifyOutcomeEvidence(
    observation: AuthenticationOutcomeObservationView,
  ): Promise<AuthenticationOutcomeRead> {
    try {
      await this.prepareOutcomeNavigationPath(observation)
    } catch {
      return { kind: AuthenticationOutcomeReadKind.Unavailable }
    }
    const message: Parameters<
      typeof authenticationRuntimeTransport.sendAuthenticationOutcomeRuntimeMessage
    >[0] = {
      type: AuthenticationOutcomeClassifyMessageType.NookAuthenticationOutcomeClassify,
      payload: {
        observation,
        timeoutMs: OUTCOME_EVIDENCE_TIMEOUT_MS,
      },
    }
    const sendMessage: Parameters<
      typeof authenticationRuntimeTransport.sendAuthenticationOutcomeRuntimeMessage
    >[0] = message
    const delivery =
      await authenticationRuntimeTransport.sendAuthenticationOutcomeRuntimeMessage(
        sendMessage,
      )
    if (
      delivery.kind === RuntimeMessageDeliveryKind.Unavailable ||
      delivery.response.kind !== AuthenticationOutcomeResponseKind.Completed ||
      !('verdict' in delivery.response)
    ) {
      return { kind: AuthenticationOutcomeReadKind.Unavailable }
    }
    return {
      kind: AuthenticationOutcomeReadKind.Available,
      verdict: delivery.response.verdict,
    }
  }

  prepareOutcomeNavigationPath(
    observation: AuthenticationOutcomeObservationView,
  ): Promise<void> {
    const pathname = location.pathname
    const request: CompanionWasmRuntimeMessage = {
      type: CompanionWasmSessionMessageType.ProjectAuthenticationNavigationPath,
      origin: location.origin,
      payload: { pathname },
    }
    return Effect.runPromise(
      Effect.gen(function* () {
        const delivery = yield* Effect.tryPromise(() =>
          sendCompanionWasmRuntimeMessage(globalThis, request),
        )
        if (
          delivery.kind !== CompanionWasmRuntimeDeliveryKind.Delivered ||
          location.pathname !== pathname
        )
          return yield* Effect.fail(
            new Error('Authentication navigation projection unavailable.'),
          )
        const projected = yield* Schema.decodeUnknownEffect(
          CompanionWasmNavigationPathDecoder,
        )(delivery.response)
        observation.navigatedAwayFromAuthPath ||=
          projected.observation === 'Unrelated'
      }),
    )
  }

  collectWorkflowOutcomeObservation(
    request: WorkflowOutcomeObservationRequest,
  ): AuthenticationOutcomeObservationView {
    const observation = this.collectOutcomeObservation(request.context)
    const scope = this.workflowErrorScope(request.workflow)
    const selector =
      '[data-nook-auth-outcome="error"], [role="alert"], .error[role="alert"]'
    switch (scope.kind) {
      case WorkflowErrorScopeKind.Excluded:
        observation.errorMarkerPresent = false
        break
      case WorkflowErrorScopeKind.Attached:
        observation.errorMarkerPresent = Boolean(
          scope.boundary.querySelector(selector) ||
          scope.boundary.matches(selector),
        )
        break
    }
    return observation
  }

  private workflowErrorScope(
    workflow: PasswordFormObservation,
  ): WorkflowErrorScope {
    const boundary =
      authenticationSurfaceObservation.authenticationWorkflowBoundary(workflow)
    switch (boundary) {
      case document:
      case document.body:
      case document.documentElement:
        return { kind: WorkflowErrorScopeKind.Excluded }
    }
    switch (true) {
      case boundary instanceof Element:
        return this.attachedWorkflowErrorScope(boundary)
      case true:
        break
    }
    return this.excludedWorkflowErrorScope()
  }
  private attachedWorkflowErrorScope(boundary: Element): WorkflowErrorScope {
    switch (boundary.isConnected) {
      case false:
        return { kind: WorkflowErrorScopeKind.Excluded }
      case true:
        return { kind: WorkflowErrorScopeKind.Attached, boundary }
    }
  }
  private excludedWorkflowErrorScope(): WorkflowErrorScope {
    return { kind: WorkflowErrorScopeKind.Excluded }
  }
}

export const authenticationOutcomeObservation =
  new AuthenticationOutcomeObservation()

type WorkflowOutcomeObservationRequest = {
  context: AuthenticationOutcomeObservationContext
  workflow: PasswordFormObservation
}
