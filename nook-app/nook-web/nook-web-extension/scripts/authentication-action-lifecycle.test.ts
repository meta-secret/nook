import { describe, expect, test } from 'bun:test'
import {
  AuthenticationControlActivationDisposition,
  authenticationControlActivationDisposition,
} from '../src/content/autofill/authentication-action-lifecycle'
import { scanState } from '../src/content/autofill/state'

describe('authentication control activation lifecycle', () => {
  test('invalidates a stale page control before the pending rescan', () => {
    expect(
      authenticationControlActivationDisposition({
        controlTouchesRenderedWorkflow: true,
        controlBelongsToMountedWidget: false,
        credentialActuationInFlight: false,
      }),
    ).toBe(AuthenticationControlActivationDisposition.Invalidate)
  })

  test('preserves mounted-widget and credential-actuation controls', () => {
    for (const request of [
      {
        controlTouchesRenderedWorkflow: true,
        controlBelongsToMountedWidget: true,
        credentialActuationInFlight: false,
      },
      {
        controlTouchesRenderedWorkflow: true,
        controlBelongsToMountedWidget: false,
        credentialActuationInFlight: true,
      },
    ]) {
      expect(authenticationControlActivationDisposition(request)).toBe(
        AuthenticationControlActivationDisposition.Ignore,
      )
    }
  })

  test('invalidates a pending scan generation with the stale control', () => {
    const staleGeneration = scanState.sequence

    scanState.invalidatePendingScan()

    expect(scanState.sequence).not.toBe(staleGeneration)
    scanState.sequence = staleGeneration
  })
})
