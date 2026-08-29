import {
  authenticationPageObservationFacts,
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
  act: () => boolean
}

/**
 * Rebuild untrusted DOM facts and require a fresh Rust decision immediately
 * before a credential-bearing browser action. The second synchronous facts
 * comparison closes the interval while the background decision was awaited.
 */
export async function performRevalidatedAuthenticationAction({
  workflow,
  expectedAction,
  act,
}: RevalidatedAuthenticationActionArgs): Promise<boolean> {
  const factsRequest: Parameters<typeof authenticationPageObservationFacts>[0] =
    {
      observation: workflow,
      authenticatorSetupHint: false,
      backupCodesHint: false,
    }
  const approvedFacts = authenticationPageObservationFacts(factsRequest)
  const message: Parameters<
    typeof sendAuthenticationWorkflowSnapshotRuntimeMessage
  >[0] = {
    type: AuthenticationWorkflowSnapshotMessageType.NookAuthenticationWorkflowSnapshot,
    payload: {
      origin: location.origin,
      observations: [approvedFacts],
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

  const currentFacts = authenticationPageObservationFacts(factsRequest)
  if (JSON.stringify(currentFacts) !== JSON.stringify(approvedFacts)) {
    return false
  }
  return act()
}
