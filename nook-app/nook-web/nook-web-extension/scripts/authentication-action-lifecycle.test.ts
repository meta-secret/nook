import { describe, expect, test } from 'bun:test'
import {
  AuthenticationControlActivationDisposition,
  authenticationControlActivationDisposition,
  authenticationWidgetOwnsControl,
} from '../src/content/autofill/authentication-action-lifecycle'
import {
  scanState,
  WidgetCredentialActuation,
} from '../src/content/autofill/state'

describe('authentication control activation lifecycle', () => {
  test('invalidates a stale page control before the pending rescan', () => {
    const pageControl: Parameters<
      typeof authenticationControlActivationDisposition
    >[0] = {
      controlTouchesRenderedWorkflow: true,
      controlBelongsToMountedWidget: false,
      credentialActuation: WidgetCredentialActuation.Idle,
    }
    expect(authenticationControlActivationDisposition(pageControl)).toBe(
      AuthenticationControlActivationDisposition.Invalidate,
    )
  })

  test('preserves mounted-widget and credential-actuation controls', () => {
    const protectedControls: Parameters<
      typeof authenticationControlActivationDisposition
    >[0][] = [
      {
        controlTouchesRenderedWorkflow: true,
        controlBelongsToMountedWidget: true,
        credentialActuation: WidgetCredentialActuation.Idle,
      },
      {
        controlTouchesRenderedWorkflow: true,
        controlBelongsToMountedWidget: false,
        credentialActuation: WidgetCredentialActuation.WorkflowFill,
      },
    ]
    for (const request of protectedControls) {
      expect(authenticationControlActivationDisposition(request)).toBe(
        AuthenticationControlActivationDisposition.Ignore,
      )
    }
  })

  test('recognizes controls rendered inside the widget shadow root', () => {
    expect(
      authenticationWidgetOwnsControl({
        lightTreeContainsControl: false,
        shadowTreeContainsControl: true,
      }),
    ).toBe(true)
  })

  test('prevents a pending scan from publishing after a page mutation', () => {
    const pendingGeneration = ++scanState.sequence

    scanState.invalidatePendingScan()

    expect(scanState.sequence).not.toBe(pendingGeneration)
    scanState.sequence = pendingGeneration - 1
  })
})
