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
          manualCheckpoint: 'absent',
          advanceControl: 'present',
          oneTimeCodeProgression: 'advance-control-required',
        },
        authenticator: {
          authenticatorSetup: 'absent',
          backupCodes: 'absent',
          passkeyControl: 'absent',
          passkeyVault: 'unavailable',
          matchingPasskeyAccountCount: 0,
        },
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

  test('requires explicit one-time-code progression facts', () => {
    const observationWithoutProgression = {
      ...validMessage.payload.observations[0],
      ceremony: { ...validMessage.payload.observations[0].ceremony },
    }
    expect(
      Reflect.deleteProperty(
        observationWithoutProgression.ceremony,
        'oneTimeCodeProgression',
      ),
    ).toBe(true)
    expect(
      isAuthenticationWorkflowSnapshotMessage({
        ...validMessage,
        payload: {
          ...validMessage.payload,
          observations: [observationWithoutProgression],
        },
      }),
    ).toBe(false)
  })

  test('requires explicit passkey vault availability', () => {
    const observationWithoutAvailability = {
      ...validMessage.payload.observations[0],
      authenticator: {
        ...validMessage.payload.observations[0].authenticator,
      },
    }
    expect(
      Reflect.deleteProperty(
        observationWithoutAvailability.authenticator,
        'passkeyVault',
      ),
    ).toBe(true)
    expect(
      isAuthenticationWorkflowSnapshotMessage({
        ...validMessage,
        payload: {
          ...validMessage.payload,
          observations: [observationWithoutAvailability],
        },
      }),
    ).toBe(false)
  })

  test('leaves semantic evidence vocabulary to Rust', () => {
    expect(
      isAuthenticationWorkflowSnapshotMessage({
        ...validMessage,
        payload: {
          ...validMessage.payload,
          observations: [
            {
              ...validMessage.payload.observations[0],
              ceremony: {
                ...validMessage.payload.observations[0].ceremony,
                oneTimeCodeProgression: 'future-progression',
              },
            },
          ],
        },
      }),
    ).toBe(true)
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
