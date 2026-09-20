import {
  findPlainMockAuthAccount,
  MockAuthAccountLookupKind,
} from '../../accounts'
import {
  DynamicMockAuthAccountLookupKind,
  findDynamicMockAuthAccount,
} from './dynamic-accounts'
import { navigate, recordLoginSubmission } from './navigation'

export enum PlainLoginResult {
  Success = 'success',
  Invalid = 'invalid',
}

export type PlainLoginCredentials = {
  readonly username: string
  readonly password: string
}

export function plainLoginIsValid(
  credentials: PlainLoginCredentials,
): boolean {
  const fixtureAccount = findPlainMockAuthAccount(
    credentials.username,
    credentials.password,
  )
  const dynamicAccount = findDynamicMockAuthAccount(
    credentials.username,
    credentials.password,
  )
  return (
    fixtureAccount.kind !== MockAuthAccountLookupKind.Missing ||
    dynamicAccount.kind !== DynamicMockAuthAccountLookupKind.Missing
  )
}

/**
 * Validate a plain-login attempt against fixture accounts and navigate on
 * success. Quirk detection pages reuse this so Pilot fill-to-success is real.
 */
export function completePlainLogin(
  username: string,
  password: string,
): PlainLoginResult {
  recordLoginSubmission(username, password)
  const credentials: PlainLoginCredentials = { username, password }
  if (!plainLoginIsValid(credentials)) {
    return PlainLoginResult.Invalid
  }
  navigate('/plain/success')
  return PlainLoginResult.Success
}

export function readLoginFields(
  form: HTMLFormElement,
  usernameSelector: string,
  passwordSelector: string,
): { username: string; password: string } {
  const username = ((v) => (v ? v : ''))(
    form.querySelector<HTMLInputElement>(usernameSelector)?.value,
  )
  const password = ((v) => (v ? v : ''))(
    form.querySelector<HTMLInputElement>(passwordSelector)?.value,
  )
  return { username, password }
}
