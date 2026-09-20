import { describe, expect, test } from 'bun:test'
import {
  AuthenticationDiagnosticAvailability,
  AuthenticationDiagnosticChannelName,
  AuthenticationDiagnosticChannel,
  AuthenticationDiagnosticGate,
  AuthenticationDiagnosticGateOutcome,
  type AuthenticationDiagnosticEntry,
  type AuthenticationDiagnosticSink,
} from '../src/content/autofill/authentication-diagnostics'

class RecordingAuthenticationDiagnosticSink implements AuthenticationDiagnosticSink {
  readonly entries: AuthenticationDiagnosticEntry[] = []

  record(entry: AuthenticationDiagnosticEntry): void {
    this.entries.push(entry)
  }
}

describe('authentication runtime diagnostics', () => {
  test('records only structured stage outcomes and candidate counts when enabled', () => {
    const sink = new RecordingAuthenticationDiagnosticSink()
    const channel = new AuthenticationDiagnosticChannel({
      availability: AuthenticationDiagnosticAvailability.Enabled,
      sink,
    })

    channel.record({
      gate: AuthenticationDiagnosticGate.WorkflowFormDiscovery,
      outcome: AuthenticationDiagnosticGateOutcome.CandidatesFound,
      candidateCount: 1,
    })

    expect(sink.entries).toEqual([
      {
        channel: AuthenticationDiagnosticChannelName.AuthenticationDetection,
        gate: AuthenticationDiagnosticGate.WorkflowFormDiscovery,
        outcome: AuthenticationDiagnosticGateOutcome.CandidatesFound,
        candidateCount: 1,
      },
    ])
  })

  test('does not emit anything when disabled for a production build', () => {
    const sink = new RecordingAuthenticationDiagnosticSink()
    const channel = new AuthenticationDiagnosticChannel({
      availability: AuthenticationDiagnosticAvailability.Disabled,
      sink,
    })

    channel.record({
      gate: AuthenticationDiagnosticGate.RustAdmission,
      outcome: AuthenticationDiagnosticGateOutcome.Rejected,
      candidateCount: 1,
    })

    expect(sink.entries).toEqual([])
  })
})
