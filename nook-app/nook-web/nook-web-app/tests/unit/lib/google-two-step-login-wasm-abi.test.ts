import { describe, expect, test } from 'vitest'
import { GoogleLoginSessionContinuations } from '../../../../nook-web-extension/src/offscreen/google-login-continuation'
import {
  GoogleLoginContinuationMessageType,
  GoogleLoginContinuationOperation,
  GoogleLoginTabId,
  GoogleLoginFrameId,
  GoogleLoginDocumentId,
  GoogleLoginSourceOrigin,
  type GoogleLoginBrowserContext,
  type GoogleLoginContinuationRequest,
  type GoogleLoginSessionMessage,
  type GoogleLoginSessionResponse,
} from '../../../../nook-web-shared/src/extension/google-login-continuation-messages'
import {
  begin_google_two_step_login,
  CredentialKind,
  GoogleLoginContinuationDecision,
  type GoogleLoginStartRequest,
  type GoogleLoginPageObservation,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

/** Builds structural observations at the generated provider boundary. */
class GoogleLoginFixture {
  identifier(): GoogleLoginPageObservation {
    const facts: GoogleLoginPageObservation['facts'] = {
      fields: {
        usernameFieldCount: 1,
        currentPasswordFieldCount: 0,
        newPasswordFieldCount: 0,
        genericPasswordFieldCount: 0,
        oneTimeCodeFieldCount: 0,
        actionablePasswordFieldCount: 0,
        readonlyPasswordFieldCount: 0,
      },
      ceremony: {
        oneTimeCodeProgression: 'advance-control-required',
        manualCheckpoint: 'absent',
        advanceControl: 'absent',
      },
      authenticator: {
        authenticatorSetup: 'absent',
        backupCodesCopy: '',
        passkeyControl: 'absent',
        passkeyAccountAvailability: 'unavailable',
        matchingPasskeyAccountCount: 0,
      },
      credentialSubmission: { kind: 'absent' },
      detailedAdvanceControl: {
        kind: 'observed',
        observations: [
          {
            actionability: 'actionable',
            ownership: 'locally-scoped',
            semantics: 'activation',
            authenticationUsername: 'explicit',
            passwordFieldCount: 0,
            newPasswordFieldCount: 0,
            oneTimeCodeFieldCount: 0,
            semanticSubmitControlCount: 0,
            sourceOrigin: 'https://accounts.google.com',
            formIdentity: 'signin-view',
            destinationIdentity:
              'https://accounts.google.com/v3/signin/identifier',
            label: 'Next',
            machineIdentity: 'identifierNext',
            submissionMethod: 'absent',
            submissionDestinationSource: 'omitted',
          },
        ],
      },
    }
    return {
      page_url: 'https://accounts.google.com/v3/signin/identifier',
      authorization_generation: 'generation',
      elapsed_milliseconds: 0,
      identifier_integrity: 'Unchanged',
      user_intent: 'Continuing',
      password_occupancy: 'Empty',
      facts,
    }
  }
  password(): GoogleLoginPageObservation {
    const identifier = this.identifier()
    return {
      ...identifier,
      page_url: 'https://accounts.google.com/v3/signin/challenge/pwd',
      elapsed_milliseconds: 1000,
      facts: {
        ...identifier.facts,
        fields: {
          ...identifier.facts.fields,
          usernameFieldCount: 0,
          currentPasswordFieldCount: 1,
          actionablePasswordFieldCount: 1,
        },
        detailedAdvanceControl: { kind: 'absent' },
      },
    }
  }
}

describe('Google selected-login generated ABI', () => {
  test('borrows inspection and consumes one fill-only password admission', () => {
    const fixture = new GoogleLoginFixture()
    const start: GoogleLoginStartRequest = {
      observation: fixture.identifier(),
      selection_authority: 'DetectedLogin',
    }
    const continuation = begin_google_two_step_login(start)
    expect(continuation.inspect(start.observation)).toBe(
      GoogleLoginContinuationDecision.AwaitPassword,
    )
    const password = fixture.password()
    expect(continuation.inspect(password)).toBe(
      GoogleLoginContinuationDecision.FillPassword,
    )
    expect(continuation.admit_password(password)).toBe(
      CredentialKind.CurrentPassword,
    )
    // admit_password consumes on success and failure: never free afterward.
    expect(() => continuation.inspect(password)).toThrow()
  })
  test('rejects a focused selection and malformed structural input as JS errors', () => {
    const fixture = new GoogleLoginFixture()
    const focused: GoogleLoginStartRequest = {
      observation: fixture.identifier(),
      selection_authority: 'FocusedField',
    }
    expect(() => begin_google_two_step_login(focused)).toThrow()
    const malformed: GoogleLoginStartRequest = {
      observation: { ...fixture.identifier(), elapsed_milliseconds: -1 },
      selection_authority: 'DetectedLogin',
    }
    expect(() => begin_google_two_step_login(malformed)).toThrow()
  })
})

/** Exercises the real offscreen owner with generated provider handles. */
class GoogleLoginOwnerFixture {
  readonly owner = new GoogleLoginSessionContinuations()
  readonly facts = new GoogleLoginFixture()
  readonly cancelled: GoogleLoginSessionResponse = {
    ok: true,
    result: GoogleLoginContinuationDecision.Cancel,
  }
  readonly awaitingPassword: GoogleLoginSessionResponse = {
    ok: true,
    result: GoogleLoginContinuationDecision.AwaitPassword,
  }
  readonly fillPassword: GoogleLoginSessionResponse = {
    ok: true,
    result: GoogleLoginContinuationDecision.FillPassword,
  }
  readonly context: GoogleLoginBrowserContext = {
    tabId: GoogleLoginTabId.make(7),
    frameId: GoogleLoginFrameId.make(0),
    documentId: GoogleLoginDocumentId.make('google-document'),
    sourceOrigin: GoogleLoginSourceOrigin.make('https://accounts.google.com'),
  }
  send(payload: GoogleLoginContinuationRequest) {
    const message: GoogleLoginSessionMessage = {
      type: GoogleLoginContinuationMessageType.Session,
      origin: this.context.sourceOrigin,
      browserContext: this.context,
      payload,
    }
    return this.owner.handle(message)
  }
  begin() {
    const payload: GoogleLoginContinuationRequest = {
      operation: GoogleLoginContinuationOperation.Begin,
      request: {
        observation: this.facts.identifier(),
        selection_authority: 'DetectedLogin',
      },
    }
    return this.send(payload)
  }
  inspect(request: GoogleLoginPageObservation) {
    const payload: GoogleLoginContinuationRequest = {
      operation: GoogleLoginContinuationOperation.Inspect,
      request,
    }
    return this.send(payload)
  }
  admit(request: GoogleLoginPageObservation) {
    const payload: GoogleLoginContinuationRequest = {
      operation: GoogleLoginContinuationOperation.Admit,
      request,
    }
    return this.send(payload)
  }
}

describe('Google continuation offscreen ownership', () => {
  test('returns explicit failure for rejected begin and malformed consuming admission', async () => {
    const fixture = new GoogleLoginOwnerFixture()
    const focused: GoogleLoginContinuationRequest = {
      operation: GoogleLoginContinuationOperation.Begin,
      request: {
        observation: fixture.facts.identifier(),
        selection_authority: 'FocusedField',
      },
    }
    expect((await fixture.send(focused)).isErr()).toBe(true)
    await fixture.begin()
    const malformed: GoogleLoginPageObservation = {
      ...fixture.facts.password(),
      elapsed_milliseconds: -1,
    }
    expect((await fixture.admit(malformed)).isErr()).toBe(true)
    expect(
      (await fixture.admit(fixture.facts.password()))._unsafeUnwrap(),
    ).toEqual(fixture.cancelled)
  })
  test('admits only the original document and consumes exactly once', async () => {
    const fixture = new GoogleLoginOwnerFixture()
    expect((await fixture.begin())._unsafeUnwrap()).toEqual(
      fixture.awaitingPassword,
    )
    const payload: GoogleLoginContinuationRequest = {
      operation: GoogleLoginContinuationOperation.Admit,
      request: fixture.facts.password(),
    }
    const other: GoogleLoginSessionMessage = {
      type: GoogleLoginContinuationMessageType.Session,
      origin: fixture.context.sourceOrigin,
      browserContext: {
        ...fixture.context,
        documentId: GoogleLoginDocumentId.make('another-document'),
      },
      payload,
    }
    expect((await fixture.owner.handle(other))._unsafeUnwrap()).toEqual(
      fixture.cancelled,
    )
    expect(
      (await fixture.admit(fixture.facts.password()))._unsafeUnwrap(),
    ).toEqual(fixture.fillPassword)
    expect(
      (await fixture.admit(fixture.facts.password()))._unsafeUnwrap(),
    ).toEqual(fixture.cancelled)
  })
  test.each([
    'edited',
    'interrupted',
    'populated',
    'generation',
    'expiry',
  ] as const)('cancels %s and cannot subsequently admit', async (reason) => {
    const fixture = new GoogleLoginOwnerFixture()
    await fixture.begin()
    const observation = fixture.facts.password()
    switch (reason) {
      case 'edited':
        observation.identifier_integrity = 'Edited'
        break
      case 'interrupted':
        observation.user_intent = 'Interrupted'
        break
      case 'populated':
        observation.password_occupancy = 'Populated'
        break
      case 'generation':
        observation.authorization_generation = 'revoked'
        break
      case 'expiry':
        observation.elapsed_milliseconds = 60_000
        break
    }
    expect((await fixture.inspect(observation))._unsafeUnwrap()).toEqual(
      fixture.cancelled,
    )
    expect(
      (await fixture.admit(fixture.facts.password()))._unsafeUnwrap(),
    ).toEqual(fixture.cancelled)
  })
  test('explicit lock or dismissal cleanup removes the live handle', async () => {
    const fixture = new GoogleLoginOwnerFixture()
    await fixture.begin()
    fixture.owner.cancel(fixture.context)
    expect(
      (await fixture.admit(fixture.facts.password()))._unsafeUnwrap(),
    ).toEqual(fixture.cancelled)
  })
})
