export enum PasskeyOperation {
  Create = 'create',
  Get = 'get',
}

type PasskeyCeremonyErrorArgs = {
  error: unknown
  action: PasskeyOperation
}

export function passkeyCeremonyError(args: PasskeyCeremonyErrorArgs): Error {
  const { error, action } = args
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return new Error(
      `PASSKEY_CEREMONY_NOT_ALLOWED: Passkey ${action} request did not finish.`,
    )
  }
  return error instanceof Error
    ? error
    : new Error(`Passkey ${action} ceremony failed.`)
}
