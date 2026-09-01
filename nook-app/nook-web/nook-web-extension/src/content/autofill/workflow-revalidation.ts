import {
  authenticationPageObservationFacts,
  PasswordFormScopeKind,
  summarizeAuthenticationWorkflowForms,
  type PasswordFormObservation,
} from '../../../../nook-web-shared/src/extension/password-forms'
import { refreshAuthenticationWorkflowObservation } from '../../../../nook-web-shared/src/extension/authentication-workflow-observation-refresh'
import { authenticationWorkflowScopesMatch } from '../../../../nook-web-shared/src/extension/password-form-classified-observations'
import { pageHasDocumentBackupCodeHint } from '../../lib/backup-code-candidates'
import { pageHasQrEnrollmentHint } from '../../lib/page-qr-capture'
import {
  authentication_page_observation_facts_match_binding,
  AuthenticationWorkflowSnapshotResponseKind,
  bind_authentication_page_observation_facts,
  type AuthenticationWorkflowAction,
  type AuthenticationObservationBindingToken,
  type AuthenticationPageObservationFacts,
  type AuthenticationPageObservationFactsBatch,
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
  approvalIsActive: () => boolean
  act: (
    request: RevalidatedAuthenticationActRequest,
  ) => RevalidatedAuthenticationActResult
}

export type RevalidatedAuthenticationActRequest = {
  currentWorkflow: PasswordFormObservation
  observationBindingToken: AuthenticationObservationBindingToken
  revalidateCurrentWorkflow: () => PasswordFormObservation | false
}

export enum RevalidatedAuthenticationActResultKind {
  Acted = 'acted',
  Failed = 'failed',
  ControlMissing = 'control-missing',
}

export type RevalidatedAuthenticationActResult = {
  kind: RevalidatedAuthenticationActResultKind
}

export enum RevalidatedAuthenticationActionOutcomeKind {
  Acted = 'acted',
  Rejected = 'rejected',
  ActionFailed = 'action-failed',
  ControlMissing = 'control-missing',
}

export type RevalidatedAuthenticationActionOutcome = {
  kind: RevalidatedAuthenticationActionOutcomeKind
}

export enum AuthenticationObservationBindingKind {
  Unbound = 'unbound',
  Required = 'required',
}

export type AuthenticationObservationBinding =
  | { kind: AuthenticationObservationBindingKind.Unbound }
  | {
      kind: AuthenticationObservationBindingKind.Required
      token: AuthenticationObservationBindingToken
    }

export function requiredAuthenticationObservationBinding(
  facts: AuthenticationPageObservationFacts,
): AuthenticationObservationBinding {
  const batch: AuthenticationPageObservationFactsBatch = {
    observations: [facts],
  }
  return {
    kind: AuthenticationObservationBindingKind.Required,
    token: bind_authentication_page_observation_facts(batch),
  }
}

const boundAuthenticationControlSelector = [
  'input',
  'button',
  'select',
  'textarea',
  'a[href]',
].join(',')

type AuthenticationControlIdentitySnapshot = {
  controls: Element[]
}

function authenticationControlIdentitySnapshot(
  workflow: PasswordFormObservation,
): AuthenticationControlIdentitySnapshot {
  const queryRoot =
    workflow.formScope.kind === PasswordFormScopeKind.Owned
      ? workflow.formScope.owner.ownerDocument
      : workflow.root
  const controls = Array.from(
    queryRoot.querySelectorAll<Element>(boundAuthenticationControlSelector),
  )
  if (workflow.formScope.kind === PasswordFormScopeKind.Unowned) {
    return { controls }
  }
  const owner = workflow.formScope.owner
  return {
    controls: controls.filter((control) =>
      'form' in control ? control.form === owner : owner.contains(control),
    ),
  }
}

type AuthenticationControlIdentitiesMatchRequest = {
  approved: AuthenticationControlIdentitySnapshot
  current: AuthenticationControlIdentitySnapshot
}

function authenticationControlIdentitiesMatch({
  approved,
  current,
}: AuthenticationControlIdentitiesMatchRequest): boolean {
  if (approved.controls.length !== current.controls.length) return false
  for (const [index, control] of approved.controls.entries()) {
    if (current.controls[index] !== control) return false
  }
  return true
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
  approvalIsActive,
  act,
}: RevalidatedAuthenticationActionArgs): Promise<RevalidatedAuthenticationActionOutcome> {
  const rejected = (): RevalidatedAuthenticationActionOutcome => ({
    kind: RevalidatedAuthenticationActionOutcomeKind.Rejected,
  })
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
    if (!workflowIsAttachedToCurrentDocument()) return false
    let candidates = summarizeAuthenticationWorkflowForms()
    let selectedIndex = candidates.findIndex((candidate) => {
      const scopePair: Parameters<typeof authenticationWorkflowScopesMatch>[0] =
        {
          left: workflow,
          right: candidate,
        }
      return authenticationWorkflowScopesMatch(scopePair)
    })
    if (selectedIndex < 0) {
      candidates = [refreshAuthenticationWorkflowObservation(workflow)]
      selectedIndex = 0
    }
    if (selectedIndex < 0) return false
    const authenticatorSetupHint = pageHasQrEnrollmentHint()
    const backupCodesHint = pageHasDocumentBackupCodeHint()
    const observations = candidates.map((candidate) => {
      const factsRequest: Parameters<
        typeof authenticationPageObservationFacts
      >[0] = {
        observation: candidate,
        authenticatorSetupHint,
        backupCodesCopy: backupCodesHint ? 'Save backup codes' : '',
      }
      return authenticationPageObservationFacts(factsRequest)
    })
    const currentWorkflow = candidates[selectedIndex]
    const facts = observations[selectedIndex]
    if (!currentWorkflow || !facts) return false
    return {
      currentWorkflow,
      facts,
      observations,
      selectedIndex,
      controlIdentities: authenticationControlIdentitySnapshot(currentWorkflow),
    }
  }
  if (!approvalIsActive()) return rejected()
  const approvedObservation = observeCurrentFacts()
  if (!approvedObservation) return rejected()
  const approvedFactsBatch: AuthenticationPageObservationFactsBatch = {
    observations: [approvedObservation.facts],
  }
  let approvedObservationBindingToken: AuthenticationObservationBindingToken
  try {
    approvedObservationBindingToken =
      bind_authentication_page_observation_facts(approvedFactsBatch)
  } catch {
    return rejected()
  }
  const message: Parameters<
    typeof sendAuthenticationWorkflowSnapshotRuntimeMessage
  >[0] = {
    type: AuthenticationWorkflowSnapshotMessageType.NookAuthenticationWorkflowSnapshot,
    payload: {
      origin: location.origin,
      observations: approvedObservation.observations,
    },
  }
  const delivery =
    await sendAuthenticationWorkflowSnapshotRuntimeMessage(message)
  if (!approvalIsActive()) return rejected()
  if (delivery.kind === RuntimeMessageDeliveryKind.Unavailable)
    return rejected()
  const { verdict } = delivery.response
  if (
    verdict.kind !== AuthenticationWorkflowSnapshotResponseKind.Matched ||
    !('snapshot' in verdict) ||
    !delivery.response.selectedFacts ||
    verdict.snapshot.observationIndex !== approvedObservation.selectedIndex ||
    verdict.snapshot.action !== expectedAction
  ) {
    return rejected()
  }
  const selectedFactsBatch: AuthenticationPageObservationFactsBatch = {
    observations: [delivery.response.selectedFacts],
  }
  if (
    observationBinding.kind === AuthenticationObservationBindingKind.Required &&
    !authentication_page_observation_facts_match_binding(
      observationBinding.token,
      selectedFactsBatch,
    )
  ) {
    return rejected()
  }

  const currentObservation = observeCurrentFacts()
  if (!currentObservation) return rejected()
  const currentFactsBatch: AuthenticationPageObservationFactsBatch = {
    observations: [currentObservation.facts],
  }
  const currentIdentitiesMatchRequest: AuthenticationControlIdentitiesMatchRequest =
    {
      approved: approvedObservation.controlIdentities,
      current: currentObservation.controlIdentities,
    }
  if (
    currentObservation.selectedIndex !== approvedObservation.selectedIndex ||
    !authentication_page_observation_facts_match_binding(
      approvedObservationBindingToken,
      currentFactsBatch,
    ) ||
    !authenticationControlIdentitiesMatch(currentIdentitiesMatchRequest) ||
    !approvalIsActive()
  ) {
    return rejected()
  }
  const revalidateCurrentWorkflow = (): PasswordFormObservation | false => {
    if (!approvalIsActive()) return false
    const postActionObservation = observeCurrentFacts()
    if (!postActionObservation) return false
    const postActionFactsBatch: AuthenticationPageObservationFactsBatch = {
      observations: [postActionObservation.facts],
    }
    const postActionIdentitiesMatchRequest: AuthenticationControlIdentitiesMatchRequest =
      {
        approved: approvedObservation.controlIdentities,
        current: postActionObservation.controlIdentities,
      }
    if (
      postActionObservation.selectedIndex !==
        approvedObservation.selectedIndex ||
      !authentication_page_observation_facts_match_binding(
        approvedObservationBindingToken,
        postActionFactsBatch,
      ) ||
      !authenticationControlIdentitiesMatch(postActionIdentitiesMatchRequest)
    ) {
      return false
    }
    return postActionObservation.currentWorkflow
  }
  const actRequest: RevalidatedAuthenticationActRequest = {
    currentWorkflow: currentObservation.currentWorkflow,
    observationBindingToken: approvedObservationBindingToken,
    revalidateCurrentWorkflow,
  }
  const actResult = act(actRequest)
  if (actResult.kind === RevalidatedAuthenticationActResultKind.Acted) {
    return { kind: RevalidatedAuthenticationActionOutcomeKind.Acted }
  }
  if (
    actResult.kind === RevalidatedAuthenticationActResultKind.ControlMissing
  ) {
    return { kind: RevalidatedAuthenticationActionOutcomeKind.ControlMissing }
  }
  return { kind: RevalidatedAuthenticationActionOutcomeKind.ActionFailed }
}
