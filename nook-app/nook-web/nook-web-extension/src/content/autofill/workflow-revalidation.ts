import {
  PasswordFormScopeKind,
  type PasswordFormObservation,
  passwordFormInteraction,
} from '../../../../nook-web-shared/src/extension/password-forms'
import { RefreshedAuthenticationObservation } from '../../../../nook-web-shared/src/extension/authentication-workflow-observation-refresh'
import { AuthenticationWorkflowScopeComparison } from '../../../../nook-web-shared/src/extension/password-form-classified-observations'
import { recoveryCopyObservation } from '../../lib/backup-code-candidates'
import { pageQrCapture } from '../../lib/page-qr-capture'
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
  authenticationRuntimeTransport,
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

type AuthenticationControlIdentitiesMatchRequest = {
  approved: AuthenticationControlIdentitySnapshot
  current: AuthenticationControlIdentitySnapshot
}

/**
 * Rebuild untrusted DOM facts and require a fresh Rust decision immediately
 * before a credential-bearing browser action. The second synchronous facts
 * comparison closes the interval while the background decision was awaited.
 */
export class RevalidatedAuthenticationAction {
  constructor(private readonly request: RevalidatedAuthenticationActionArgs) {}
  async execute(): Promise<RevalidatedAuthenticationActionOutcome> {
    const {
      workflow,
      expectedAction,
      observationBinding,
      approvalIsActive,
      act,
    } = this.request

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
      let candidates =
        passwordFormInteraction.summarizeAuthenticationWorkflowForms()
      let selectedIndex = candidates.findIndex((candidate) => {
        const scopePair: ConstructorParameters<
          typeof AuthenticationWorkflowScopeComparison
        >[0] = {
          left: workflow,
          right: candidate,
        }
        return new AuthenticationWorkflowScopeComparison(scopePair).matches
      })
      if (selectedIndex < 0) {
        candidates = [new RefreshedAuthenticationObservation(workflow).value]
        selectedIndex = 0
      }
      if (selectedIndex < 0) return false
      const authenticatorSetupHint = pageQrCapture.pageHasQrEnrollmentHint()
      const backupCodesHint =
        recoveryCopyObservation.pageHasDocumentBackupCodeHint()
      const observations = candidates.map((candidate) => {
        const factsRequest: Parameters<
          typeof passwordFormInteraction.authenticationPageObservationFacts
        >[0] = {
          observation: candidate,
          authenticatorSetupHint,
          backupCodesCopy: backupCodesHint ? 'Save backup codes' : '',
        }
        return passwordFormInteraction.authenticationPageObservationFacts(
          factsRequest,
        )
      })
      const currentWorkflow = candidates[selectedIndex]
      const facts = observations[selectedIndex]
      if (!currentWorkflow || !facts) return false
      return {
        currentWorkflow,
        facts,
        observations,
        selectedIndex,
        controlIdentities:
          RevalidatedAuthenticationAction.authenticationControlIdentitySnapshot(
            currentWorkflow,
          ),
      }
    }
    if (!approvalIsActive()) return rejected()
    const approvedObservation = observeCurrentFacts()
    if (!approvedObservation) return rejected()
    const approvedFactsBatch: AuthenticationPageObservationFactsBatch = {
      observations: [approvedObservation.facts],
    }
    let approvedDomObservationBindingToken: AuthenticationObservationBindingToken
    try {
      approvedDomObservationBindingToken =
        bind_authentication_page_observation_facts(approvedFactsBatch)
    } catch {
      return rejected()
    }
    const message: Parameters<
      typeof authenticationRuntimeTransport.sendAuthenticationWorkflowSnapshotRuntimeMessage
    >[0] = {
      type: AuthenticationWorkflowSnapshotMessageType.NookAuthenticationWorkflowSnapshot,
      payload: {
        origin: location.origin,
        observations: approvedObservation.observations,
      },
    }
    const delivery =
      await authenticationRuntimeTransport.sendAuthenticationWorkflowSnapshotRuntimeMessage(
        message,
      )
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
    let selectedObservationBindingToken: AuthenticationObservationBindingToken
    try {
      selectedObservationBindingToken =
        bind_authentication_page_observation_facts(selectedFactsBatch)
    } catch {
      return rejected()
    }
    if (
      observationBinding.kind ===
        AuthenticationObservationBindingKind.Required &&
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
        approvedDomObservationBindingToken,
        currentFactsBatch,
      ) ||
      !RevalidatedAuthenticationAction.authenticationControlIdentitiesMatch(
        currentIdentitiesMatchRequest,
      ) ||
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
          approvedDomObservationBindingToken,
          postActionFactsBatch,
        ) ||
        !RevalidatedAuthenticationAction.authenticationControlIdentitiesMatch(
          postActionIdentitiesMatchRequest,
        )
      ) {
        return false
      }
      return postActionObservation.currentWorkflow
    }
    const actRequest: RevalidatedAuthenticationActRequest = {
      currentWorkflow: currentObservation.currentWorkflow,
      observationBindingToken: selectedObservationBindingToken,
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
  static requiredAuthenticationObservationBinding(
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
  private static authenticationControlIdentitySnapshot(
    workflow: PasswordFormObservation,
  ): AuthenticationControlIdentitySnapshot {
    const queryRoot = workflow.root
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
  private static authenticationControlIdentitiesMatch({
    approved,
    current,
  }: AuthenticationControlIdentitiesMatchRequest): boolean {
    if (approved.controls.length !== current.controls.length) return false
    for (const [index, control] of approved.controls.entries()) {
      if (current.controls[index] !== control) return false
    }
    return true
  }
}
