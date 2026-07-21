import { findPlainMockAuthAccount } from '../../accounts'
import { navigate, recordLoginSubmission } from './navigation'

export type PlainLoginResult = 'success' | 'invalid'

/**
 * Validate a plain-login attempt against fixture accounts and navigate on
 * success. Quirk detection pages reuse this so Pilot fill-to-success is real.
 */
export function completePlainLogin(
  username: string,
  password: string,
): PlainLoginResult {
  recordLoginSubmission(username, password)
  const account = findPlainMockAuthAccount(username, password)
  if (!account) return 'invalid'
  navigate('/plain/success')
  return 'success'
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
