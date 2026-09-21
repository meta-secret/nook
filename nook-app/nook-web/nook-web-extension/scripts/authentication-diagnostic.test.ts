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
import {
  AuthenticationWorkflowScopeDiagnosticCandidateKind,
  AuthenticationWorkflowScopeDiagnosticDisposition,
  AuthenticationWorkflowScopeDiagnosticGate,
  AuthenticationWorkflowScopeDiagnosticGateOutcome,
  AuthenticationWorkflowScopeDiagnosticSafeLabel,
  type AuthenticationWorkflowScopeDiagnostic,
} from '../../nook-web-shared/src/extension/password-form-scope-diagnostics'

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

  test('forwards only sanitized workflow scope rejection details when enabled', () => {
    const sink = new RecordingAuthenticationDiagnosticSink()
    const channel = new AuthenticationDiagnosticChannel({
      availability: AuthenticationDiagnosticAvailability.Enabled,
      sink,
    })
    const gate = {
      gate: AuthenticationWorkflowScopeDiagnosticGate.NoGenericTypeButtonControls,
      outcome: AuthenticationWorkflowScopeDiagnosticGateOutcome.Failed,
    }
    const diagnostic: AuthenticationWorkflowScopeDiagnostic = {
      disposition: AuthenticationWorkflowScopeDiagnosticDisposition.Rejected,
      candidateKind:
        AuthenticationWorkflowScopeDiagnosticCandidateKind.Username,
      candidateCount: 1,
      ancestors: [
        {
          tag: 'section',
          idTokens: ['identifier-shell'],
          classTokens: ['login-panel'],
        },
      ],
      controls: [
        {
          tag: 'div',
          type: '',
          role: '',
          label: AuthenticationWorkflowScopeDiagnosticSafeLabel.Next,
        },
      ],
      gates: [gate],
    }

    channel.recordWorkflowScopeDiagnostic(diagnostic)

    expect(sink.entries).toEqual([
      {
        channel: AuthenticationDiagnosticChannelName.AuthenticationDetection,
        gate: AuthenticationDiagnosticGate.WorkflowFormDiscovery,
        outcome: AuthenticationDiagnosticGateOutcome.Rejected,
        candidateCount: 1,
        scope: diagnostic,
      },
    ])
  })
})
