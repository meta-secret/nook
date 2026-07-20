import { describe, expect, test } from 'bun:test'
import { isAuthenticationWorkflowSnapshotMessage } from '../src/lib/auth-workflow-messages'

const validMessage = {
  type: 'nook:authentication-workflow-snapshot',
  payload: {
    origin: 'https://login.example.com',
    observation: {
      usernameFieldCount: 1,
      currentPasswordFieldCount: 1,
      newPasswordFieldCount: 0,
      genericPasswordFieldCount: 0,
      oneTimeCodeFieldCount: 0,
    },
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
            observation: {
              ...validMessage.payload.observation,
              oneTimeCodeFieldCount: invalidCount,
            },
          },
        }),
      ).toBe(false)
    }
  })
})
