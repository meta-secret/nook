import type {
  AuthenticationPageObservationFacts,
  AuthenticationWorkflowSnapshot,
  AuthenticationPageObservationFactsBatch,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

import {
  admit_authentication_workflow_snapshot_message,
  authentication_page_observation_facts_match_binding,
  bind_authentication_page_observation_facts,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

export type AuthenticationPageObservationView =
  AuthenticationPageObservationFacts

export type AuthenticationWorkflowSnapshotView = AuthenticationWorkflowSnapshot

export enum AuthenticationWorkflowApprovalDisposition {
  Current = 'current',
  Changed = 'changed',
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class AuthenticationWorkflowApproval {
  private constructor() {}
  declare readonly workflowKey: string
  declare readonly facts: AuthenticationPageObservationFacts
  static compare({
    approved,
    current,
    matcherDependencies,
  }: AuthenticationWorkflowApprovalPair): AuthenticationWorkflowApprovalDisposition {
    const dependencies = ((v) =>
      v ? v : authenticationWorkflowApprovalMatcherDependencies)(
      matcherDependencies,
    )
    if (approved.workflowKey !== current.workflowKey)
      return AuthenticationWorkflowApprovalDisposition.Changed
    const approvedBatch: AuthenticationPageObservationFactsBatch = {
      observations: [approved.facts],
    }
    const currentBatch: AuthenticationPageObservationFactsBatch = {
      observations: [current.facts],
    }
    try {
      const binding =
        dependencies.bind_authentication_page_observation_facts(approvedBatch)
      return dependencies.authentication_page_observation_facts_match_binding(
        binding,
        currentBatch,
      )
        ? AuthenticationWorkflowApprovalDisposition.Current
        : AuthenticationWorkflowApprovalDisposition.Changed
    } catch {
      return AuthenticationWorkflowApprovalDisposition.Changed
    }
  }
}

type AuthenticationWorkflowApprovalPair = {
  approved: AuthenticationWorkflowApproval
  current: AuthenticationWorkflowApproval
  matcherDependencies?: AuthenticationWorkflowApprovalMatcherDependencies
}

type AuthenticationWorkflowApprovalMatcherDependencies = {
  bind_authentication_page_observation_facts: typeof bind_authentication_page_observation_facts
  authentication_page_observation_facts_match_binding: typeof authentication_page_observation_facts_match_binding
}

const authenticationWorkflowApprovalMatcherDependencies: AuthenticationWorkflowApprovalMatcherDependencies =
  {
    bind_authentication_page_observation_facts,
    authentication_page_observation_facts_match_binding,
  }

export enum AuthenticationWorkflowSnapshotMessageType {
  NookAuthenticationWorkflowSnapshot = 'nook:authentication-workflow-snapshot',
}

export const MAX_AUTHENTICATION_WORKFLOW_TRANSPORT_OBSERVATIONS = 64

enum AuthenticationWorkflowTransportAdmissionKind {
  Accepted = 'accepted',
}

export type AuthenticationWorkflowSnapshotMessage = Extract<
  ReturnType<typeof admit_authentication_workflow_snapshot_message>,
  { kind: AuthenticationWorkflowTransportAdmissionKind.Accepted }
>['message']

/** Canonical protocol admission is owned by Rust; browser callers retain the decoded message. */
export class AuthenticationWorkflowSnapshotIngress {
  static admit(
    value: unknown,
  ): ReturnType<typeof admit_authentication_workflow_snapshot_message> {
    return admit_authentication_workflow_snapshot_message(value)
  }
  static is(value: unknown): boolean {
    return (
      this.admit(value).kind ===
      AuthenticationWorkflowTransportAdmissionKind.Accepted
    )
  }
}
