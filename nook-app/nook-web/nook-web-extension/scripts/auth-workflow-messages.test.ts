import { describe, expect, test } from 'bun:test'
import type { AuthenticationPasskeyControlObservation } from '../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { isAuthenticationWorkflowSnapshotMessage } from '../src/lib/auth-workflow-messages'

const passkeyControlPresent =
  'present' satisfies AuthenticationPasskeyControlObservation

const validMessage = {
  type: 'nook:authentication-workflow-snapshot',
  payload: {
    origin: 'https://login.example.com',
    observations: [
      {
        fields: {
          usernameFieldCount: 1,
          currentPasswordFieldCount: 1,
          newPasswordFieldCount: 0,
          genericPasswordFieldCount: 0,
          oneTimeCodeFieldCount: 0,
        },
        ceremony: {
          oneTimeCodeProgression: 'advance-control-required',
          oneTimeCodeHandlerSignal: '',
          authenticationContext: {
            authenticationUsername: 'explicit',
            sourceOrigin: 'https://login.example.com',
            formIdentity: 'login',
            destinationIdentity: '/login',
          },
          manualCheckpoint: 'absent',
          advanceControl: 'absent',
        },
        authenticator: {
          authenticatorSetup: 'absent',
          backupCodesCopy: '',
          passkeyControl: 'absent',
          matchingPasskeyAccountCount: 0,
          detailedPasskeyControl: { kind: 'absent' },
        },
        detailedAdvanceControl: { kind: 'absent' },
      },
    ],
  },
}

describe('authentication workflow snapshot messages', () => {
  test('accepts bounded structural page observations', () => {
    expect(isAuthenticationWorkflowSnapshotMessage(validMessage)).toBe(true)
  })

  test('rejects invalid or oversized recovery copy', () => {
    const observation = validMessage.payload.observations[0]
    for (const backupCodesCopy of [42, 'x'.repeat(129)]) {
      expect(
        isAuthenticationWorkflowSnapshotMessage({
          ...validMessage,
          payload: {
            ...validMessage.payload,
            observations: [
              {
                ...observation,
                authenticator: {
                  ...observation.authenticator,
                  backupCodesCopy,
                },
              },
            ],
          },
        }),
      ).toBe(false)
    }
  })

  test('accepts the generated passkey presence representation', () => {
    expect(
      isAuthenticationWorkflowSnapshotMessage({
        ...validMessage,
        payload: {
          ...validMessage.payload,
          observations: [
            {
              ...validMessage.payload.observations[0],
              authenticator: {
                ...validMessage.payload.observations[0].authenticator,
                passkeyControl: passkeyControlPresent,
              },
            },
          ],
        },
      }),
    ).toBe(true)
  })

  test('accepts bounded passkey and OTP candidate facts', () => {
    const observation = validMessage.payload.observations[0]
    expect(
      isAuthenticationWorkflowSnapshotMessage({
        ...validMessage,
        payload: {
          ...validMessage.payload,
          observations: [
            {
              ...observation,
              ceremony: {
                ...observation.ceremony,
                oneTimeCodeHandlerSignals: [
                  'oninput=this.form.requestSubmit()',
                ],
                advanceControl: 'implicit-submission',
              },
              authenticator: {
                ...observation.authenticator,
                detailedPasskeyControl: {
                  kind: 'candidates',
                  observation: [
                    {
                      kind: 'labeled',
                      observation: {
                        actionability: 'actionable',
                        ownership: 'owned-form',
                        semantics: 'activation',
                        authenticationUsername: 'explicit',
                        passwordFieldCount: 1,
                        newPasswordFieldCount: 0,
                        oneTimeCodeFieldCount: 0,
                        semanticSubmitControlCount: 0,
                        sourceOrigin: 'https://login.example.com',
                        formIdentity: 'login',
                        destinationIdentity: 'https://login.example.com/login',
                        label: 'Use passkey',
                      },
                    },
                  ],
                },
              },
            },
          ],
        },
      }),
    ).toBe(true)
  })

  test('rejects missing, negative, and fractional counts structurally', () => {
    const observationWithoutOneTimeCodeCount = {
      ...validMessage.payload.observations[0],
      fields: { ...validMessage.payload.observations[0].fields },
    }
    expect(
      Reflect.deleteProperty(
        observationWithoutOneTimeCodeCount.fields,
        'oneTimeCodeFieldCount',
      ),
    ).toBe(true)
    expect(
      isAuthenticationWorkflowSnapshotMessage({
        ...validMessage,
        payload: {
          ...validMessage.payload,
          observations: [observationWithoutOneTimeCodeCount],
        },
      }),
    ).toBe(false)

    for (const invalidCount of [-1, 0.5]) {
      expect(
        isAuthenticationWorkflowSnapshotMessage({
          ...validMessage,
          payload: {
            ...validMessage.payload,
            observations: [
              {
                ...validMessage.payload.observations[0],
                fields: {
                  ...validMessage.payload.observations[0].fields,
                  oneTimeCodeFieldCount: invalidCount,
                },
              },
            ],
          },
        }),
      ).toBe(false)
    }
  })

  test('leaves portable upper bounds to the Rust workflow policy', () => {
    expect(
      isAuthenticationWorkflowSnapshotMessage({
        ...validMessage,
        payload: {
          ...validMessage.payload,
          observations: [
            {
              ...validMessage.payload.observations[0],
              fields: {
                ...validMessage.payload.observations[0].fields,
                oneTimeCodeFieldCount: 101,
              },
            },
          ],
        },
      }),
    ).toBe(true)
    expect(
      isAuthenticationWorkflowSnapshotMessage({
        ...validMessage,
        payload: {
          ...validMessage.payload,
          observations: [
            {
              ...validMessage.payload.observations[0],
              authenticator: {
                ...validMessage.payload.observations[0].authenticator,
                matchingPasskeyAccountCount: 101,
              },
            },
          ],
        },
      }),
    ).toBe(true)
    expect(
      isAuthenticationWorkflowSnapshotMessage({
        ...validMessage,
        payload: {
          ...validMessage.payload,
          observations: Array.from(
            { length: 21 },
            () => validMessage.payload.observations[0],
          ),
        },
      }),
    ).toBe(true)
  })

  test('rejects empty observation batches structurally', () => {
    expect(
      isAuthenticationWorkflowSnapshotMessage({
        ...validMessage,
        payload: { ...validMessage.payload, observations: [] },
      }),
    ).toBe(false)
  })

  test('accepts a typed control batch and rejects the obsolete singular shape', () => {
    const control = {
      actionability: 'actionable',
      ownership: 'owned-form',
      semantics: 'semantic-submit',
      authenticationUsername: 'explicit',
      passwordFieldCount: 1,
      newPasswordFieldCount: 0,
      oneTimeCodeFieldCount: 0,
      semanticSubmitControlCount: 2,
      sourceOrigin: 'https://login.example.com',
      formIdentity: 'login',
      destinationIdentity: '/login',
      label: 'Sign in',
    }
    expect(
      isAuthenticationWorkflowSnapshotMessage({
        ...validMessage,
        payload: {
          ...validMessage.payload,
          observations: [
            {
              ...validMessage.payload.observations[0],
              detailedAdvanceControl: {
                kind: 'observed',
                observations: [control],
              },
            },
          ],
        },
      }),
    ).toBe(true)
    expect(
      isAuthenticationWorkflowSnapshotMessage({
        ...validMessage,
        payload: {
          ...validMessage.payload,
          observations: [
            {
              ...validMessage.payload.observations[0],
              detailedAdvanceControl: {
                kind: 'observed',
                observation: control,
              },
            },
          ],
        },
      }),
    ).toBe(false)
  })
})
