import { WidgetCredentialActuation } from './state'

export enum AuthenticationControlActivationDisposition {
  Ignore = 'ignore',
  Invalidate = 'invalidate',
}

export type AuthenticationControlActivationRequest = {
  controlTouchesRenderedWorkflow: boolean
  controlBelongsToMountedWidget: boolean
  credentialActuation: WidgetCredentialActuation
}

export type AuthenticationWidgetControlOwnershipRequest = {
  lightTreeContainsControl: boolean
  shadowTreeContainsControl: boolean
}

/** Treat controls rendered inside the widget shadow root as widget-owned. */
export function authenticationWidgetOwnsControl({
  lightTreeContainsControl,
  shadowTreeContainsControl,
}: AuthenticationWidgetControlOwnershipRequest): boolean {
  return lightTreeContainsControl || shadowTreeContainsControl
}

/** Preserves credential actuation while invalidating controls that can change the page workflow. */
export function authenticationControlActivationDisposition({
  controlTouchesRenderedWorkflow,
  controlBelongsToMountedWidget,
  credentialActuation,
}: AuthenticationControlActivationRequest): AuthenticationControlActivationDisposition {
  switch (credentialActuation) {
    case WidgetCredentialActuation.WorkflowFill:
    case WidgetCredentialActuation.FocusedSelection:
      return AuthenticationControlActivationDisposition.Ignore
    case WidgetCredentialActuation.Idle:
      break
  }
  if (!controlTouchesRenderedWorkflow || controlBelongsToMountedWidget) {
    return AuthenticationControlActivationDisposition.Ignore
  }
  return AuthenticationControlActivationDisposition.Invalidate
}
