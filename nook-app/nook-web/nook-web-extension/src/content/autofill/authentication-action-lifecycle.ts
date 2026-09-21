export enum AuthenticationControlActivationDisposition {
  Ignore = 'ignore',
  Invalidate = 'invalidate',
}

export type AuthenticationControlActivationRequest = {
  controlTouchesRenderedWorkflow: boolean
  controlBelongsToMountedWidget: boolean
  credentialActuationInFlight: boolean
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
  credentialActuationInFlight,
}: AuthenticationControlActivationRequest): AuthenticationControlActivationDisposition {
  if (
    !controlTouchesRenderedWorkflow ||
    controlBelongsToMountedWidget ||
    credentialActuationInFlight
  ) {
    return AuthenticationControlActivationDisposition.Ignore
  }
  return AuthenticationControlActivationDisposition.Invalidate
}
