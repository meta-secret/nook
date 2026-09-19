import { describe, expect, test } from 'bun:test'
import {
  AuthenticationControlActivationDisposition,
  authenticationControlActivationDisposition,
} from '../src/content/autofill/authentication-action-lifecycle'

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
})
