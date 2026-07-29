import { findPlainMockAuthAccount } from '../../accounts'
import { findDynamicMockAuthAccount } from './dynamic-accounts'
import { navigate, recordLoginSubmission } from './navigation'

export enum PlainLoginResult {
  Success = 'success',
  Invalid = 'invalid',
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
  const account =
    findPlainMockAuthAccount(username, password) ??
    findDynamicMockAuthAccount(username, password)
  if (!account) return PlainLoginResult.Invalid
  navigate('/plain/success')
  return PlainLoginResult.Success
}

export function readLoginFields(
  form: HTMLFormElement,
  usernameSelector: string,
  passwordSelector: string,
): { username: string; password: string } {
  const username =
    form.querySelector<HTMLInputElement>(usernameSelector)?.value ?? ''
  const password =
    form.querySelector<HTMLInputElement>(passwordSelector)?.value ?? ''
  return { username, password }
}
