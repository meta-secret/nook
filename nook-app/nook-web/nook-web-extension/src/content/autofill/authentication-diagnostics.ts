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

export type AuthenticationDiagnosticEntry = {
  readonly channel: AuthenticationDiagnosticChannelName
  readonly gate: AuthenticationDiagnosticGate
  readonly outcome: AuthenticationDiagnosticGateOutcome
  readonly candidateCount: number
}

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
}

/** Owns delivery of the safe detector trace to the browser's CDP console. */
export class BrowserConsoleAuthenticationDiagnosticSink implements AuthenticationDiagnosticSink {
  record(entry: AuthenticationDiagnosticEntry): void {
    console.info(entry)
  }
}
