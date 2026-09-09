import type {
  AuthenticationAdvanceControlObservation,
  AuthenticationDetailedAdvanceControlObservation,
  AuthenticationDetailedPasskeyControlObservation,
  AuthenticationPageObservationFacts,
  AuthenticationWorkflowSnapshot,
  AuthenticationPageObservationFactsBatch,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

import {
  authentication_page_observation_facts_match_binding,
  bind_authentication_page_observation_facts,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

export type AuthenticationPageObservationView =
  AuthenticationPageObservationFacts

export type AuthenticationWorkflowSnapshotView = AuthenticationWorkflowSnapshot

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class AuthenticationWorkflowApproval {
  private constructor() {}
  declare readonly workflowKey: string
  declare readonly facts: AuthenticationPageObservationFacts
  static authenticationWorkflowApprovalsMatch({
    approved,
    current,
    matcherDependencies,
  }: AuthenticationWorkflowApprovalPair): boolean {
    const dependencies = ((v) =>
      v ? v : authenticationWorkflowApprovalMatcherDependencies)(
      matcherDependencies,
    )
    if (approved.workflowKey !== current.workflowKey) return false
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
    } catch {
      return false
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

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class AuthenticationWorkflowSnapshotMessage {
  private constructor() {}
  declare readonly type: AuthenticationWorkflowSnapshotMessageType.NookAuthenticationWorkflowSnapshot
  declare readonly payload: {
    origin: string
    observations: AuthenticationPageObservationView[]
  }
  static isCount(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0
  }

  static isAdvanceControl(
    value: unknown,
  ): value is AuthenticationAdvanceControlObservation {
    if (!value || typeof value !== 'object') return false
    const control = value as AuthenticationAdvanceControlObservation
    return (
      ['inert', 'actionable'].includes(control.actionability) &&
      ['unowned', 'owned-form', 'locally-scoped'].includes(control.ownership) &&
      ['activation', 'semantic-submit'].includes(control.semantics) &&
      [
        'absent',
        'generic',
        'standards-based-email',
        'web-authn-email',
        'mixed-phone-or-email',
        'strong',
        'explicit',
      ].includes(control.authenticationUsername) &&
      [
        control.passwordFieldCount,
        control.newPasswordFieldCount,
        control.oneTimeCodeFieldCount,
        control.semanticSubmitControlCount,
      ].every(AuthenticationWorkflowSnapshotMessage.isCount) &&
      ['authored', 'omitted'].includes(control.submissionDestinationSource) &&
      [
        control.sourceOrigin,
        control.formIdentity,
        control.destinationIdentity,
        control.label,
      ].every((identity) => typeof identity === 'string')
    )
  }

  static isDetailedAdvanceControl(
    value: unknown,
  ): value is AuthenticationDetailedAdvanceControlObservation {
    if (!value || typeof value !== 'object' || !('kind' in value)) return false
    if (value.kind === 'absent') return true
    return (
      value.kind === 'observed' &&
      'observations' in value &&
      Array.isArray(value.observations) &&
      value.observations.length > 0 &&
      value.observations.every(
        AuthenticationWorkflowSnapshotMessage.isAdvanceControl,
      )
    )
  }

  static isDetailedPasskeyControl(
    value: unknown,
  ): value is AuthenticationDetailedPasskeyControlObservation {
    if (!value || typeof value !== 'object' || !('kind' in value)) return false
    if (value.kind === 'absent') return true
    if (
      (value.kind === 'observed' || value.kind === 'explicitly-marked') &&
      'observation' in value &&
      AuthenticationWorkflowSnapshotMessage.isAdvanceControl(value.observation)
    ) {
      return true
    }
    return (
      value.kind === 'candidates' &&
      'observation' in value &&
      Array.isArray(value.observation) &&
      value.observation.length > 0 &&
      value.observation.every(
        (candidate) =>
          Boolean(candidate) &&
          typeof candidate === 'object' &&
          'kind' in candidate &&
          (candidate.kind === 'labeled' ||
            candidate.kind === 'explicitly-marked') &&
          'observation' in candidate &&
          AuthenticationWorkflowSnapshotMessage.isAdvanceControl(
            candidate.observation,
          ),
      )
    )
  }

  static isAuthenticationPageObservationView(
    value: unknown,
  ): value is AuthenticationPageObservationView {
    if (!value || typeof value !== 'object') return false
    const observation = value as AuthenticationPageObservationView
    const { fields, ceremony, authenticator } = observation
    const authenticationContext = ceremony?.authenticationContext
    return (
      Boolean(fields && ceremony && authenticator) &&
      [
        fields.usernameFieldCount,
        fields.currentPasswordFieldCount,
        fields.newPasswordFieldCount,
        fields.genericPasswordFieldCount,
        fields.oneTimeCodeFieldCount,
        authenticator.matchingPasskeyAccountCount,
      ].every(AuthenticationWorkflowSnapshotMessage.isCount) &&
      ['absent', 'present'].includes(ceremony.manualCheckpoint) &&
      ['advance-control-required', 'auto-submit-observed'].includes(
        ceremony.oneTimeCodeProgression,
      ) &&
      typeof ceremony.oneTimeCodeHandlerSignal === 'string' &&
      (!('oneTimeCodeHandlerSignals' in ceremony) ||
        (Array.isArray(ceremony.oneTimeCodeHandlerSignals) &&
          ceremony.oneTimeCodeHandlerSignals.every(
            (signal) => typeof signal === 'string',
          ))) &&
      Boolean(authenticationContext) &&
      typeof authenticationContext?.sourceOrigin === 'string' &&
      typeof authenticationContext.formIdentity === 'string' &&
      typeof authenticationContext.destinationIdentity === 'string' &&
      ['absent', 'present'].includes(authenticator.authenticatorSetup) &&
      ['unavailable', 'ready'].includes(
        authenticator.passkeyAccountAvailability,
      ) &&
      typeof authenticator.backupCodesCopy === 'string' &&
      Array.from(authenticator.backupCodesCopy).length <= 128 &&
      ['absent', 'present'].includes(authenticator.passkeyControl) &&
      AuthenticationWorkflowSnapshotMessage.isDetailedAdvanceControl(
        observation.detailedAdvanceControl,
      ) &&
      AuthenticationWorkflowSnapshotMessage.isDetailedPasskeyControl(
        authenticator.detailedPasskeyControl,
      )
    )
  }

  static is(
    message: unknown,
  ): message is AuthenticationWorkflowSnapshotMessage {
    if (
      !message ||
      typeof message !== 'object' ||
      !('type' in message) ||
      message.type !==
        AuthenticationWorkflowSnapshotMessageType.NookAuthenticationWorkflowSnapshot ||
      !('payload' in message) ||
      !message.payload ||
      typeof message.payload !== 'object' ||
      !('origin' in message.payload) ||
      typeof message.payload.origin !== 'string' ||
      !('observations' in message.payload) ||
      !Array.isArray(message.payload.observations) ||
      message.payload.observations.length === 0 ||
      message.payload.observations.length >
        MAX_AUTHENTICATION_WORKFLOW_TRANSPORT_OBSERVATIONS
    ) {
      return false
    }
    return message.payload.observations.every(
      AuthenticationWorkflowSnapshotMessage.isAuthenticationPageObservationView,
    )
  }
}
