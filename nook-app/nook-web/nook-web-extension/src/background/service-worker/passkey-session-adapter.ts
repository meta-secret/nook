import type {
  WebsitePasskeyAccount,
  WebsitePasskeyAssertionResponse,
  WebsitePasskeyRegistrationResponse,
} from '../../lib/webauthn-messages'

export enum PasskeyAccountListKind {
  Ready = 'ready',
  Invalid = 'invalid',
}

export type PasskeyAccountList =
  | { kind: PasskeyAccountListKind.Ready; accounts: WebsitePasskeyAccount[] }
  | { kind: PasskeyAccountListKind.Invalid }

function isWebsitePasskeyAccount(
  account: unknown,
): account is WebsitePasskeyAccount {
  return (
    !!account &&
    typeof account === 'object' &&
    'credentialId' in account &&
    typeof account.credentialId === 'string' &&
    account.credentialId.length > 0 &&
    'userName' in account &&
    typeof account.userName === 'string' &&
    'userDisplayName' in account &&
    typeof account.userDisplayName === 'string'
  )
}

export function passkeyAccountListFromSession(
  response: unknown,
): PasskeyAccountList {
  if (
    !response ||
    typeof response !== 'object' ||
    !('ok' in response) ||
    response.ok !== true ||
    !('accounts' in response) ||
    !Array.isArray(response.accounts)
  ) {
    return { kind: PasskeyAccountListKind.Invalid }
  }
  if (!response.accounts.every(isWebsitePasskeyAccount)) {
    return { kind: PasskeyAccountListKind.Invalid }
  }
  return { kind: PasskeyAccountListKind.Ready, accounts: response.accounts }
}

export function passkeyCeremonyResponseFromSession(
  response: unknown,
): WebsitePasskeyRegistrationResponse | WebsitePasskeyAssertionResponse {
  if (!response || typeof response !== 'object' || !('ok' in response)) {
    throw new Error('Extension session returned an invalid passkey response.')
  }
  if (response.ok !== true) {
    throw new Error('Extension session rejected the passkey ceremony.')
  }
  if (
    !('credentialId' in response) ||
    typeof response.credentialId !== 'string' ||
    !('clientDataJSON' in response) ||
    typeof response.clientDataJSON !== 'string'
  ) {
    throw new Error('Extension session returned invalid passkey material.')
  }
  if (
    'attestationObject' in response &&
    typeof response.attestationObject === 'string' &&
    'transports' in response &&
    Array.isArray(response.transports) &&
    response.transports.every((transport) => typeof transport === 'string')
  ) {
    return {
      ok: true,
      credentialId: response.credentialId,
      clientDataJSON: response.clientDataJSON,
      attestationObject: response.attestationObject,
      transports: response.transports,
    }
  }
  if (
    'authenticatorData' in response &&
    typeof response.authenticatorData === 'string' &&
    'signature' in response &&
    typeof response.signature === 'string' &&
    'userHandle' in response &&
    typeof response.userHandle === 'string'
  ) {
    return {
      ok: true,
      credentialId: response.credentialId,
      clientDataJSON: response.clientDataJSON,
      authenticatorData: response.authenticatorData,
      signature: response.signature,
      userHandle: response.userHandle,
    }
  }
  throw new Error('Extension session returned incomplete passkey material.')
}
