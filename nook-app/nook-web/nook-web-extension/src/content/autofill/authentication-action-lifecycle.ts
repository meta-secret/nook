export enum AuthenticationControlActivationDisposition {
  Ignore = 'ignore',
  Invalidate = 'invalidate',
}

export type AuthenticationControlActivationRequest = {
  controlTouchesRenderedWorkflow: boolean
  controlBelongsToMountedWidget: boolean
  credentialActuationInFlight: boolean
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
