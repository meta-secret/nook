import { describe, expect, test } from 'bun:test'
import { isAuthenticationWorkflowSnapshotMessage } from '../src/lib/auth-workflow-messages'

const validMessage = {
  type: 'nook:authentication-workflow-snapshot',
  payload: {
    origin: 'https://login.example.com',
    observations: [
      {
        usernameFieldCount: 1,
        manualCheckpointPresent: false,
        authenticatorSetupHint: false,
        backupCodesHint: false,
        passkeyControlPresent: false,
        matchingPasskeyAccountCount: 0,
        currentPasswordFieldCount: 1,
        newPasswordFieldCount: 0,
        genericPasswordFieldCount: 0,
        oneTimeCodeFieldCount: 0,
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
    }
    expect(
      Reflect.deleteProperty(
        observationWithoutOneTimeCodeCount,
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
                oneTimeCodeFieldCount: invalidCount,
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
              oneTimeCodeFieldCount: 101,
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
              matchingPasskeyAccountCount: 101,
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
