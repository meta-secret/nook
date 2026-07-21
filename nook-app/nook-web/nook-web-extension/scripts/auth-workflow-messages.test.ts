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

  test('rejects missing, negative, fractional, and unbounded counts', () => {
    for (const invalidCount of [undefined, -1, 0.5, 101]) {
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

  test('rejects empty and oversized workflow observation batches', () => {
    for (const observations of [
      [],
      Array.from({ length: 21 }, () => validMessage.payload.observations[0]),
    ]) {
      expect(
        isAuthenticationWorkflowSnapshotMessage({
          ...validMessage,
          payload: { ...validMessage.payload, observations },
        }),
      ).toBe(false)
    }
  })
})
