import type { AuthenticationPageObservationView } from '../../lib/auth-workflow-messages'
import type { PasswordFormSummary } from '../../../../nook-web-shared/src/extension/password-forms'

type AuthenticationPageObservationRequest = {
  summary: PasswordFormSummary
  authenticatorSetupPresent: boolean
  backupCodesPresent: boolean
  manualCheckpointPresent: boolean
}

type AuthenticationEnrollmentObservationRequest = {
  authenticatorSetupPresent: boolean
  backupCodesPresent: boolean
  manualCheckpointPresent: boolean
}

export function authenticationEnrollmentObservation({
  authenticatorSetupPresent,
  backupCodesPresent,
  manualCheckpointPresent,
}: AuthenticationEnrollmentObservationRequest): AuthenticationPageObservationView {
  return {
    fields: {
      usernameFieldCount: 0,
      currentPasswordFieldCount: 0,
      newPasswordFieldCount: 0,
      genericPasswordFieldCount: 0,
      oneTimeCodeFieldCount: 0,
    },
    ceremony: {
      oneTimeCodeProgression: 'advance-control-required',
      manualCheckpoint: manualCheckpointPresent ? 'present' : 'absent',
      advanceControl: 'absent',
    },
    authenticator: {
      authenticatorSetup: authenticatorSetupPresent ? 'present' : 'absent',
      backupCodes: backupCodesPresent ? 'present' : 'absent',
      passkeyControl: 'absent',
      passkeyVault: 'unavailable',
      matchingPasskeyAccountCount: 0,
    },
  }
}

export function authenticationPageObservation({
  summary,
  authenticatorSetupPresent,
  backupCodesPresent,
  manualCheckpointPresent,
}: AuthenticationPageObservationRequest): AuthenticationPageObservationView {
  return {
    fields: {
      usernameFieldCount: summary.usernameFieldCount,
      currentPasswordFieldCount: summary.currentPasswordFieldCount,
      newPasswordFieldCount: summary.newPasswordFieldCount,
      genericPasswordFieldCount: summary.genericPasswordFieldCount,
      oneTimeCodeFieldCount: summary.oneTimeCodeFieldCount,
    },
    ceremony: {
      oneTimeCodeProgression: summary.oneTimeCodeAutoSubmitObserved
        ? 'auto-submit-observed'
        : 'advance-control-required',
      manualCheckpoint:
        summary.manualCheckpointPresent || manualCheckpointPresent
          ? 'present'
          : 'absent',
      advanceControl: summary.authenticationAdvanceControlPresent
        ? 'present'
        : 'absent',
    },
    authenticator: {
      authenticatorSetup: authenticatorSetupPresent ? 'present' : 'absent',
      backupCodes: backupCodesPresent ? 'present' : 'absent',
      passkeyControl: summary.passkeyControlPresent ? 'present' : 'absent',
      passkeyVault: 'unavailable',
      matchingPasskeyAccountCount: 0,
    },
  }
}

export const AUTHENTICATION_MUTATION_ATTRIBUTE_FILTER = [
  'aria-disabled',
  'aria-hidden',
  'aria-label',
  'aria-labelledby',
  'alt',
  'action',
  'autocomplete',
  'class',
  'data-qa',
  'data-auto-submit',
  'data-autosubmit',
  'data-nook-manual-checkpoint',
  'data-nook-passkey-control',
  'data-submit-on-input',
  'data-testid',
  'disabled',
  'form',
  'for',
  'hidden',
  'href',
  'id',
  'inert',
  'name',
  'open',
  'onchange',
  'oninput',
  'placeholder',
  'readonly',
  'role',
  'src',
  'style',
  'tabindex',
  'title',
  'type',
  'value',
] as const

export const AUTHENTICATION_VIEWPORT_EVENTS = ['resize', 'scroll'] as const
