import {
  PasswordFormScopeKind,
  type PasswordFormObservation,
  passwordFormInteraction,
} from '../../../../nook-web-shared/src/extension/password-forms'
import { RefreshedAuthenticationObservation } from '../../../../nook-web-shared/src/extension/authentication-workflow-observation-refresh'
import {
  AuthenticationWorkflowScopeComparison,
  AuthenticationWorkflowScopeDisposition,
} from '../../../../nook-web-shared/src/extension/password-form-classified-observations'
import { recoveryCopyObservation } from '../../lib/backup-code-candidates'
import { pageQrCapture } from '../../lib/page-qr-capture'
import {
  AuthenticationWorkflowSnapshotResponseKind,
  type AuthenticationWorkflowAction,
  type AuthenticationObservationBindingToken,
  type AuthenticationPageObservationFacts,
  type AuthenticationPageObservationFactsBatch,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { CompanionWasmSessionMessageType } from '../../../../nook-web-shared/src/extension/companion-wasm-runtime-messages'
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
  approvedFacts: AuthenticationPageObservationFacts
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

enum AuthenticationControlIdentityComparison {
  Same = 'same',
  Changed = 'changed',
}

type AuthenticationControlList = Element[]

class AuthenticationControlIdentitySnapshot {
  private readonly controls: AuthenticationControlList

  private constructor(controls: AuthenticationControlList) {
    this.controls = controls
  }

  static capture(
    workflow: PasswordFormObservation,
  ): AuthenticationControlIdentitySnapshot {
    const controls = Array.from(
      workflow.root.querySelectorAll<Element>(
        boundAuthenticationControlSelector,
      ),
    )
    if (workflow.formScope.kind === PasswordFormScopeKind.Unowned) {
      return new AuthenticationControlIdentitySnapshot(controls)
    }
    const owner = workflow.formScope.owner
    return new AuthenticationControlIdentitySnapshot(
      controls.filter((control) =>
        'form' in control ? control.form === owner : owner.contains(control),
      ),
    )
  }

  compare(
    current: AuthenticationControlIdentitySnapshot,
  ): AuthenticationControlIdentityComparison {
    if (this.controls.length !== current.controls.length) {
      return AuthenticationControlIdentityComparison.Changed
    }
    for (const [index, control] of this.controls.entries()) {
      if (current.controls[index] !== control) {
        return AuthenticationControlIdentityComparison.Changed
      }
    }
    return AuthenticationControlIdentityComparison.Same
  }
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
        return (
          new AuthenticationWorkflowScopeComparison(scopePair).disposition ===
          AuthenticationWorkflowScopeDisposition.Same
        )
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
          AuthenticationControlIdentitySnapshot.capture(currentWorkflow),
      }
    }
    if (!approvalIsActive()) {
      return rejected()
    }
    const approvedObservation = observeCurrentFacts()
    if (!approvedObservation) {
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
    if (!approvalIsActive()) {
      return rejected()
    }
    if (delivery.kind === RuntimeMessageDeliveryKind.Unavailable)
      return rejected()
    const { verdict } = delivery.response
    if (
      verdict.kind !== AuthenticationWorkflowSnapshotResponseKind.Matched ||
      !('snapshot' in verdict) ||
      delivery.response.selectedFacts.state !== 'selected' ||
      verdict.snapshot.observationIndex !== approvedObservation.selectedIndex ||
      verdict.snapshot.action !== expectedAction
    ) {
      return rejected()
    }
    const selectedObservationBindingToken =
      typeof delivery.response.factsBindingToken === 'string'
        ? delivery.response.factsBindingToken
        : false
    if (!selectedObservationBindingToken) {
      return rejected()
    }
    if (
      observationBinding.kind ===
        AuthenticationObservationBindingKind.Required &&
      observationBinding.token !== selectedObservationBindingToken
    ) {
      return rejected()
    }

    const currentObservation = observeCurrentFacts()
    if (!currentObservation) return rejected()
    const currentMessage: Parameters<
      typeof authenticationRuntimeTransport.sendAuthenticationWorkflowSnapshotRuntimeMessage
    >[0] = {
      type: AuthenticationWorkflowSnapshotMessageType.NookAuthenticationWorkflowSnapshot,
      payload: {
        origin: location.origin,
        observations: currentObservation.observations,
      },
    }
    const currentDelivery =
      await authenticationRuntimeTransport.sendAuthenticationWorkflowSnapshotRuntimeMessage(
        currentMessage,
      )
    if (currentDelivery.kind === RuntimeMessageDeliveryKind.Unavailable)
      return rejected()
    const currentVerdict = currentDelivery.response.verdict
    const currentBindingToken = currentDelivery.response.factsBindingToken
    if (
      currentObservation.selectedIndex !== approvedObservation.selectedIndex ||
      currentVerdict.kind !==
        AuthenticationWorkflowSnapshotResponseKind.Matched ||
      !('snapshot' in currentVerdict) ||
      currentVerdict.snapshot.observationIndex !==
        currentObservation.selectedIndex ||
      currentVerdict.snapshot.action !== expectedAction ||
      currentDelivery.response.selectedFacts.state !== 'selected' ||
      typeof currentBindingToken !== 'string' ||
      currentBindingToken !== selectedObservationBindingToken ||
      approvedObservation.controlIdentities.compare(
        currentObservation.controlIdentities,
      ) === AuthenticationControlIdentityComparison.Changed ||
      !approvalIsActive()
    ) {
      return rejected()
    }
    const revalidateCurrentWorkflow = (): PasswordFormObservation | false => {
      if (!approvalIsActive()) return false
      const postActionObservation = observeCurrentFacts()
      if (!postActionObservation) return false
      if (
        postActionObservation.selectedIndex !==
          approvedObservation.selectedIndex ||
        approvedObservation.controlIdentities.compare(
          postActionObservation.controlIdentities,
        ) === AuthenticationControlIdentityComparison.Changed
      ) {
        return false
      }
      return postActionObservation.currentWorkflow
    }
    const actRequest: RevalidatedAuthenticationActRequest = {
      currentWorkflow: currentObservation.currentWorkflow,
      observationBindingToken: selectedObservationBindingToken,
      approvedFacts: currentDelivery.response.selectedFacts.facts,
      revalidateCurrentWorkflow,
    }
    const actResult = act(actRequest)
    if (actResult.kind === RevalidatedAuthenticationActResultKind.Acted) {
      return { kind: RevalidatedAuthenticationActionOutcomeKind.Acted }
    }
    if (
      actResult.kind === RevalidatedAuthenticationActResultKind.ControlMissing
    ) {
      return {
        kind: RevalidatedAuthenticationActionOutcomeKind.ControlMissing,
      }
    }
    return { kind: RevalidatedAuthenticationActionOutcomeKind.ActionFailed }
  }
  static requiredAuthenticationObservationBinding(
    facts: AuthenticationPageObservationFacts,
  ): Promise<AuthenticationObservationBinding> {
    const batch: AuthenticationPageObservationFactsBatch = {
      observations: [facts],
    }
    return authenticationRuntimeTransport
      .sendCompanionWasmRuntimeMessage({
        type: CompanionWasmSessionMessageType.BindAuthenticationPageObservationFacts,
        payload: { facts: batch },
      })
      .then((delivery) => {
        if (
          delivery.kind === RuntimeMessageDeliveryKind.Unavailable ||
          typeof delivery.response !== 'string'
        ) {
          return { kind: AuthenticationObservationBindingKind.Unbound }
        }
        return {
          kind: AuthenticationObservationBindingKind.Required,
          token: delivery.response,
        }
      })
  }
}
