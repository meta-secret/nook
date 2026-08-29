import {
  authenticationPageObservationFacts,
  PasswordFormScopeKind,
  refreshAuthenticationWorkflowObservation,
  type PasswordFormObservation,
} from '../../../../nook-web-shared/src/extension/password-forms'
import {
  AuthenticationWorkflowSnapshotResponseKind,
  type AuthenticationWorkflowAction,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { AuthenticationWorkflowSnapshotMessageType } from '../../lib/auth-workflow-messages'
import {
  RuntimeMessageDeliveryKind,
  sendAuthenticationWorkflowSnapshotRuntimeMessage,
} from './runtime-message-adapter'

type RevalidatedAuthenticationActionArgs = {
  workflow: PasswordFormObservation
  expectedAction: AuthenticationWorkflowAction
  observationBinding: AuthenticationObservationBinding
  act: (request: RevalidatedAuthenticationActRequest) => boolean
}

export type RevalidatedAuthenticationActRequest = {
  currentWorkflow: PasswordFormObservation
  observationDigest: string
}

export enum AuthenticationObservationBindingKind {
  Unbound = 'unbound',
  Required = 'required',
}

export type AuthenticationObservationBinding =
  | { kind: AuthenticationObservationBindingKind.Unbound }
  | {
      kind: AuthenticationObservationBindingKind.Required
      observationDigest: string
    }

/**
 * Rebuild untrusted DOM facts and require a fresh Rust decision immediately
 * before a credential-bearing browser action. The second synchronous facts
 * comparison closes the interval while the background decision was awaited.
 */
export async function performRevalidatedAuthenticationAction({
  workflow,
  expectedAction,
  observationBinding,
  act,
}: RevalidatedAuthenticationActionArgs): Promise<boolean> {
  const workflowIsAttachedToCurrentDocument = () => {
    const root = workflow.root
    const rootIsCurrent =
      root === document ||
      (root instanceof Node &&
        root.isConnected &&
        root.ownerDocument === document)
    if (!rootIsCurrent) return false
    return (
      workflow.formScope.kind === PasswordFormScopeKind.Unowned ||
      (workflow.formScope.owner.isConnected &&
        workflow.formScope.owner.ownerDocument === document)
    )
  }
  const observeCurrentFacts = () => {
    if (!workflowIsAttachedToCurrentDocument()) return undefined
    const currentWorkflow = refreshAuthenticationWorkflowObservation(workflow)
    const factsRequest: Parameters<
      typeof authenticationPageObservationFacts
    >[0] = {
      observation: currentWorkflow,
      authenticatorSetupHint: false,
      backupCodesCopy: '',
    }
    return {
      currentWorkflow,
      facts: authenticationPageObservationFacts(factsRequest),
    }
  }
  const approvedObservation = observeCurrentFacts()
  if (!approvedObservation) return false
  const approvedObservationDigest = JSON.stringify(approvedObservation.facts)
  if (
    observationBinding.kind === AuthenticationObservationBindingKind.Required &&
    observationBinding.observationDigest !== approvedObservationDigest
  ) {
    return false
  }
  const message: Parameters<
    typeof sendAuthenticationWorkflowSnapshotRuntimeMessage
  >[0] = {
    type: AuthenticationWorkflowSnapshotMessageType.NookAuthenticationWorkflowSnapshot,
    payload: {
      origin: location.origin,
      observations: [approvedObservation.facts],
    },
  }
  const delivery =
    await sendAuthenticationWorkflowSnapshotRuntimeMessage(message)
  if (delivery.kind === RuntimeMessageDeliveryKind.Unavailable) return false
  const { response } = delivery
  if (
    response.kind !== AuthenticationWorkflowSnapshotResponseKind.Matched ||
    !('snapshot' in response) ||
    response.snapshot.observationIndex !== 0 ||
    response.snapshot.action !== expectedAction
  ) {
    return false
  }

  const currentObservation = observeCurrentFacts()
  if (!currentObservation) return false
  if (
    JSON.stringify(currentObservation.facts) !==
    JSON.stringify(approvedObservation.facts)
  ) {
    return false
  }
  const actRequest: RevalidatedAuthenticationActRequest = {
    currentWorkflow: currentObservation.currentWorkflow,
    observationDigest: approvedObservationDigest,
  }
  return act(actRequest)
}
