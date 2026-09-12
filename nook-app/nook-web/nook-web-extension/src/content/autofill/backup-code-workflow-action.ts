import { type PasswordFormObservation } from '../../../../nook-web-shared/src/extension/password-forms'
import { documentAuthenticationObservation } from '../../../../nook-web-shared/src/extension/document-authentication-workflow-observation'
import { AuthenticationWorkflowAction } from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import type { EnrollmentFlowHost } from '../enrollment-flow'
import {
  AuthenticationObservationBindingKind,
  RevalidatedAuthenticationAction,
  RevalidatedAuthenticationActionOutcomeKind,
  RevalidatedAuthenticationActResultKind,
} from './workflow-revalidation'

type StartRevalidatedEnrollmentActionArgs = {
  workflow?: PasswordFormObservation
  host: EnrollmentFlowHost
  action: AuthenticationWorkflowAction
  start: () => void
}

export class RevalidatedEnrollmentAction {
  constructor(private readonly request: StartRevalidatedEnrollmentActionArgs) {}
  async execute(): Promise<boolean> {
    const {
      workflow = documentAuthenticationObservation.documentAuthenticationWorkflowObservation(),
      host,
      action,
      start,
    } = this.request
    if (host.isBusy()) return false
    host.setBusy(true)
    let started = false
    try {
      const observationBinding: ConstructorParameters<
        typeof RevalidatedAuthenticationAction
      >[0]['observationBinding'] = {
        kind: AuthenticationObservationBindingKind.Unbound,
      }
      const revalidationRequest: ConstructorParameters<
        typeof RevalidatedAuthenticationAction
      >[0] = {
        workflow,
        expectedAction: action,
        observationBinding,
        approvalIsActive: () => host.isBusy() && host.panel.isConnected,
        act: () => {
          start()
          started = true
          const result: ReturnType<
            ConstructorParameters<
              typeof RevalidatedAuthenticationAction
            >[0]['act']
          > = { kind: RevalidatedAuthenticationActResultKind.Acted }
          return result
        },
      }
      const outcome = await new RevalidatedAuthenticationAction(
        revalidationRequest,
      ).execute()
      return outcome.kind === RevalidatedAuthenticationActionOutcomeKind.Acted
    } finally {
      if (!started) host.setBusy(false)
    }
  }
}
