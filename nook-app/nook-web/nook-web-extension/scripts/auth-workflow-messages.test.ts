import { describe, expect, test } from 'bun:test'
import { isAuthenticationWorkflowSnapshotMessage } from '../src/lib/auth-workflow-messages'

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
          backupCodes: 'absent',
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
})
