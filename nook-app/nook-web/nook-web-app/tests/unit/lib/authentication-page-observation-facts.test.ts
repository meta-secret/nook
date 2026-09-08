import { expect, test } from 'vitest'
import {
  AuthenticationPageObservationFactsAssembler,
  type AuthenticationPageObservationFactsAssemblyRequest,
} from '../../../../nook-web-shared/src/extension/authentication-page-observation-facts'
import {
  AuthenticationPageObservationContextOwner,
  type AuthenticationPageObservationContextRequest,
} from '../../../../nook-web-shared/src/extension/authentication-page-observation-context'
import { PasswordFormScopeKind } from '../../../../nook-web-shared/src/extension/password-form-fields'
import type { PasswordFormObservation } from '../../../../nook-web-shared/src/extension/password-forms'

class CurrentAuthenticationPageObservationWriterScenario {
  private constructor() {}

  static assertsExplicitAbsentDisclosureControl(): void {
    const request: AuthenticationPageObservationFactsAssemblyRequest = {
      summary: {
        usernameFieldCount: 1,
        currentPasswordFieldCount: 1,
        newPasswordFieldCount: 0,
        genericPasswordFieldCount: 0,
        oneTimeCodeFieldCount: 0,
      },
      actionablePasswordFieldCount: 1,
      readonlyPasswordFieldCount: 0,
      oneTimeCodeHandlerSignals: [],
      authenticationUsername: 'explicit',
      sourceOrigin: 'https://login.example.test',
      formIdentity: 'login',
      destinationIdentity: '/login',
      manualCheckpoint: 'present',
      implicitSubmissionMethod: 'absent',
      advanceControl: 'implicit-submission',
      authenticatorSetup: 'present',
      backupCodesCopy: '',
      passkeyControl: 'present',
      detailedPasskeyControl: { kind: 'absent' },
      credentialSubmission: { kind: 'absent' },
      detailedAdvanceControl: { kind: 'absent' },
    }
    const facts = new AuthenticationPageObservationFactsAssembler(
      request,
    ).assemble()

    expect(facts).toMatchObject({
      fields: {
        usernameFieldCount: 1,
        currentPasswordFieldCount: 1,
        actionablePasswordFieldCount: 1,
        readonlyPasswordFieldCount: 0,
      },
      credentialDisclosureControl: { kind: 'absent' },
      credentialSubmission: { kind: 'absent' },
      detailedAdvanceControl: { kind: 'absent' },
    })
  }
}

class AuthenticationPageObservationContextScenario {
  private constructor() {}

  static assertsImplicitOwnedFormContext(): void {
    const form = document.createElement('form')
    form.id = 'login'
    form.method = 'post'
    form.action = '/login'
    document.body.append(form)
    const observation: PasswordFormObservation = {
      root: document,
      formScope: { kind: PasswordFormScopeKind.Owned, owner: form },
      summary: {
        passwordFieldCount: 0,
        currentPasswordFieldCount: 0,
        newPasswordFieldCount: 0,
        genericPasswordFieldCount: 0,
        usernameFieldCount: 1,
        oneTimeCodeFieldCount: 0,
        manualCheckpointPresent: false,
        passkeyControlPresent: false,
        formCount: 1,
        observedAt: 0,
      },
    }
    const request: AuthenticationPageObservationContextRequest = {
      observation,
      boundedAdvanceObservations: [],
      advanceControls: [],
      sourceOrigin: location.origin,
    }

    expect(
      new AuthenticationPageObservationContextOwner(request).observe(),
    ).toMatchObject({
      sourceOrigin: location.origin,
      formIdentity: 'login',
      implicitSubmissionMethod: 'post',
      advanceControl: 'implicit-submission',
      credentialSubmission: {
        kind: 'observed',
        facts: { actionability: 'actionable', method: 'post' },
      },
    })
  }
}

test(
  'current authentication facts writer emits explicit disclosure state',
  CurrentAuthenticationPageObservationWriterScenario.assertsExplicitAbsentDisclosureControl,
)

test(
  'owned authentication forms derive their implicit submission context',
  AuthenticationPageObservationContextScenario.assertsImplicitOwnedFormContext,
)
