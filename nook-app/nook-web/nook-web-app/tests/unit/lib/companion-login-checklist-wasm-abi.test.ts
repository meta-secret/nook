import { describe, expect, test } from 'vitest'
import {
  AuthenticationOutcomeVerdict,
  project_authentication_login_checklist,
  type AuthenticationLoginChecklistProjection,
  type AuthenticationLoginChecklistState,
  type AuthenticationOutcomeObservation,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

/** Structural fixtures use the generated DTO ABI, with no WASM handles to free. */
class LoginChecklistAbiFixture {
  readonly ready: AuthenticationLoginChecklistState = {
    kind: 'Activity',
    activity: 'Ready',
  }

  readonly submitted: AuthenticationLoginChecklistState = {
    kind: 'Activity',
    activity: 'Submitted',
  }

  readonly observation: AuthenticationOutcomeObservation = {
    navigatedAwayFromAuthPath: false,
    authFieldsPresent: true,
    successMarkerPresent: false,
    errorMarkerPresent: false,
    sameDocumentMutation: false,
    inIframe: false,
    elapsedMs: 0,
  }
}

describe('companion login checklist generated-package ABI', () => {
  test('projects observed submit and a sufficient runtime result through structural DTOs', () => {
    const fixture = new LoginChecklistAbiFixture()
    const submit_request: AuthenticationLoginChecklistProjection = {
      state: fixture.ready,
      observation: { kind: 'Activity', activity: 'Submitted' },
    }
    const submitted = project_authentication_login_checklist(submit_request)
    expect(submitted.rows.map((row) => row.step)).toEqual([
      'FillLogin',
      'SubmitForm',
      'CheckResult',
    ])
    expect(submitted.rows.map((row) => row.ordinal)).toEqual([1, 2, 3])
    expect(submitted.rows.map((row) => row.state)).toEqual([
      'Done',
      'Done',
      'Current',
    ])
    expect(submitted.status).toBe('Waiting')
    expect(submitted.outcome_polling).toBe('Wait')
    const outcome_request: AuthenticationLoginChecklistProjection = {
      state: submitted.state,
      observation: {
        kind: 'Outcome',
        verdict: AuthenticationOutcomeVerdict.Sufficient,
        observation: { ...fixture.observation, successMarkerPresent: true },
      },
    }
    const confirmed = project_authentication_login_checklist(outcome_request)
    expect(confirmed.rows.map((row) => row.state)).toEqual([
      'Done',
      'Done',
      'Done',
    ])
    expect(confirmed.status).toBe('Complete')
    expect(confirmed.status_key).toBe('widgetChecklistComplete')
    expect(confirmed.outcome_polling).toBe('Stop')
  })

  test('keeps unobserved submission pending even when success evidence arrives', () => {
    const fixture = new LoginChecklistAbiFixture()
    const request: AuthenticationLoginChecklistProjection = {
      state: { kind: 'Activity', activity: 'SubmissionUnobserved' },
      observation: {
        kind: 'Outcome',
        verdict: AuthenticationOutcomeVerdict.Sufficient,
        observation: { ...fixture.observation, successMarkerPresent: true },
      },
    }
    const manual = project_authentication_login_checklist(request)
    expect(manual.state).toEqual(request.state)
    expect(manual.rows.map((row) => row.state)).toEqual([
      'Done',
      'Current',
      'Pending',
    ])
    expect(manual.rows.map((row) => row.detail_key)).toEqual([
      'widgetChecklistFillDone',
      'widgetChecklistSubmitManual',
      'widgetChecklistResultPending',
    ])
    expect(manual.outcome_polling).toBe('Stop')
  })

  test('stops on the existing error-only insufficient verdict and retains attention', () => {
    const fixture = new LoginChecklistAbiFixture()
    const request: AuthenticationLoginChecklistProjection = {
      state: fixture.submitted,
      observation: {
        kind: 'Outcome',
        verdict: AuthenticationOutcomeVerdict.Insufficient,
        observation: { ...fixture.observation, errorMarkerPresent: true },
      },
    }
    const attention = project_authentication_login_checklist(request)
    expect(attention.status).toBe('Attention')
    expect(attention.outcome_polling).toBe('Stop')
    const later_request: AuthenticationLoginChecklistProjection = {
      state: attention.state,
      observation: {
        kind: 'Outcome',
        verdict: AuthenticationOutcomeVerdict.Insufficient,
        observation: fixture.observation,
      },
    }
    expect(project_authentication_login_checklist(later_request)).toEqual(
      attention,
    )
  })

  test('reports JsError for an unknown structural activity', () => {
    const fixture = new LoginChecklistAbiFixture()
    const request: AuthenticationLoginChecklistProjection = {
      state: fixture.ready,
      observation: { kind: 'Activity', activity: 'Filling' },
    }
    // Reflection deliberately supplies malformed external data to the ABI decoder.
    Reflect.set(request.observation, 'activity', 'Invented')
    expect(() => project_authentication_login_checklist(request)).toThrow(
      'Typed WASM value could not be converted.',
    )
  })

  test('reports JsError for a verdict outside the existing generated enum', () => {
    const fixture = new LoginChecklistAbiFixture()
    const request: AuthenticationLoginChecklistProjection = {
      state: fixture.submitted,
      observation: {
        kind: 'Outcome',
        verdict: AuthenticationOutcomeVerdict.Sufficient,
        observation: fixture.observation,
      },
    }
    Reflect.set(request.observation, 'verdict', 99)
    expect(() => project_authentication_login_checklist(request)).toThrow(
      'Typed WASM value could not be converted.',
    )
  })
})
