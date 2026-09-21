import {
  AuthenticationWorkflowScopeDiagnosticDisposition,
  type AuthenticationWorkflowScopeDiagnostic,
} from '../../../../nook-web-shared/src/extension/password-form-scope-diagnostics'
import type { AuthenticationFieldCandidateDiagnostic } from '../../../../nook-web-shared/src/extension/password-form-field-candidate-diagnostics'
import type { AuthenticationSelectorEntryDiagnostic } from '../../../../nook-web-shared/src/extension/password-form-selector-entry-diagnostics'

export enum AuthenticationDiagnosticAvailability {
  Disabled = 'disabled',
  Enabled = 'enabled',
}

export enum AuthenticationDiagnosticChannelName {
  AuthenticationDetection = 'authentication-detection',
}

export enum AuthenticationDiagnosticGate {
  Scan = 'scan',
  WorkflowFormDiscovery = 'workflow-form-discovery',
  WorkflowClassification = 'workflow-classification',
  RuntimeTransport = 'runtime-transport',
  RustAdmission = 'rust-admission',
  WidgetRendering = 'widget-rendering',
  FieldCandidateEligibility = 'field-candidate-eligibility',
  SelectorEntry = 'selector-entry',
}

export enum AuthenticationDiagnosticGateOutcome {
  Started = 'started',
  Skipped = 'skipped',
  CandidatesFound = 'candidates-found',
  Empty = 'empty',
  Unavailable = 'unavailable',
  Rejected = 'rejected',
  Hidden = 'hidden',
  Missing = 'missing',
  Rendered = 'rendered',
  Stale = 'stale',
}

export type AuthenticationDiagnosticObservation = {
  readonly gate: AuthenticationDiagnosticGate
  readonly outcome: AuthenticationDiagnosticGateOutcome
  readonly candidateCount: number
}

type AuthenticationDiagnosticStageEntry = {
  readonly channel: AuthenticationDiagnosticChannelName
  readonly gate: AuthenticationDiagnosticGate
  readonly outcome: AuthenticationDiagnosticGateOutcome
  readonly candidateCount: number
}

type AuthenticationDiagnosticScopeEntry = {
  readonly channel: AuthenticationDiagnosticChannelName
  readonly gate: AuthenticationDiagnosticGate.WorkflowFormDiscovery
  readonly outcome: AuthenticationDiagnosticGateOutcome
  readonly candidateCount: number
  readonly scope: AuthenticationWorkflowScopeDiagnostic
}

type AuthenticationDiagnosticFieldCandidateEntry = {
  readonly channel: AuthenticationDiagnosticChannelName
  readonly gate: AuthenticationDiagnosticGate.FieldCandidateEligibility
  readonly candidate: AuthenticationFieldCandidateDiagnostic
}

type AuthenticationDiagnosticSelectorEntry = {
  readonly channel: AuthenticationDiagnosticChannelName
  readonly gate: AuthenticationDiagnosticGate.SelectorEntry
  readonly selectorEntry: AuthenticationSelectorEntryDiagnostic
}

export type AuthenticationDiagnosticEntry =
  | AuthenticationDiagnosticStageEntry
  | AuthenticationDiagnosticScopeEntry
  | AuthenticationDiagnosticFieldCandidateEntry
  | AuthenticationDiagnosticSelectorEntry

export interface AuthenticationDiagnosticSink {
  record(entry: AuthenticationDiagnosticEntry): void
}

export type AuthenticationDiagnosticChannelRequest = {
  readonly availability: AuthenticationDiagnosticAvailability
  readonly sink: AuthenticationDiagnosticSink
}

/** Owns the development-only, secret-free authentication detector trace. */
export class AuthenticationDiagnosticChannel {
  constructor(
    private readonly request: AuthenticationDiagnosticChannelRequest,
  ) {}

  record(observation: AuthenticationDiagnosticObservation): void {
    if (
      this.request.availability !== AuthenticationDiagnosticAvailability.Enabled
    ) {
      return
    }
    const entry: AuthenticationDiagnosticEntry = {
      channel: AuthenticationDiagnosticChannelName.AuthenticationDetection,
      gate: observation.gate,
      outcome: observation.outcome,
      candidateCount: observation.candidateCount,
    }
    this.request.sink.record(entry)
  }

  recordWorkflowScopeDiagnostic(
    observation: AuthenticationWorkflowScopeDiagnostic,
  ): void {
    if (
      this.request.availability !== AuthenticationDiagnosticAvailability.Enabled
    ) {
      return
    }
    const entry: AuthenticationDiagnosticScopeEntry = {
      channel: AuthenticationDiagnosticChannelName.AuthenticationDetection,
      gate: AuthenticationDiagnosticGate.WorkflowFormDiscovery,
      outcome:
        observation.disposition ===
        AuthenticationWorkflowScopeDiagnosticDisposition.Accepted
          ? AuthenticationDiagnosticGateOutcome.CandidatesFound
          : AuthenticationDiagnosticGateOutcome.Rejected,
      candidateCount: observation.candidateCount,
      scope: observation,
    }
    this.request.sink.record(entry)
  }

  recordFieldCandidateDiagnostic(
    candidate: AuthenticationFieldCandidateDiagnostic,
  ): void {
    if (
      this.request.availability !== AuthenticationDiagnosticAvailability.Enabled
    ) {
      return
    }
    const entry: AuthenticationDiagnosticFieldCandidateEntry = {
      channel: AuthenticationDiagnosticChannelName.AuthenticationDetection,
      gate: AuthenticationDiagnosticGate.FieldCandidateEligibility,
      candidate,
    }
    this.request.sink.record(entry)
  }

  recordSelectorEntryDiagnostic(
    selectorEntry: AuthenticationSelectorEntryDiagnostic,
  ): void {
    if (
      this.request.availability !== AuthenticationDiagnosticAvailability.Enabled
    ) {
      return
    }
    const entry: AuthenticationDiagnosticSelectorEntry = {
      channel: AuthenticationDiagnosticChannelName.AuthenticationDetection,
      gate: AuthenticationDiagnosticGate.SelectorEntry,
      selectorEntry,
    }
    this.request.sink.record(entry)
  }
}

/** Owns delivery of the safe detector trace to the browser's CDP console. */
export class BrowserConsoleAuthenticationDiagnosticSink implements AuthenticationDiagnosticSink {
  record(entry: AuthenticationDiagnosticEntry): void {
    console.info(entry)
  }
}
