import { describe, expect, test } from 'vitest'

import {
  AuthenticationCredentialKind,
  AuthenticationFillFieldEditability,
  AuthenticationFillFieldIndex,
  AuthenticationFillFieldObservation,
  AuthenticationFillFieldObservations,
  AuthenticationFillFieldRole,
  plan_companion_credential_fill,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

describe('companion credential-fill WASM ABI', () => {
  test('constructs generated fields and reads typed assignments', () => {
    const usernameIndex = new AuthenticationFillFieldIndex(4)
    const passwordIndex = new AuthenticationFillFieldIndex(7)
    const username = new AuthenticationFillFieldObservation(
      usernameIndex,
      AuthenticationFillFieldRole.Username,
      AuthenticationFillFieldEditability.Writable,
    )
    const password = new AuthenticationFillFieldObservation(
      passwordIndex,
      AuthenticationFillFieldRole.GenericPassword,
      AuthenticationFillFieldEditability.Writable,
    )
    const fields = new AuthenticationFillFieldObservations()
    fields.add(username)
    fields.add(password)

    const plan = plan_companion_credential_fill(fields)
    try {
      const assignments = plan.take_assignments()
      try {
        expect(assignments).toHaveLength(2)
        const usernameAssignment = assignments[0]!
        const passwordAssignment = assignments[1]!
        const assignedUsernameIndex = usernameAssignment.field_index
        const assignedPasswordIndex = passwordAssignment.field_index
        try {
          expect(assignedUsernameIndex.value).toBe(4)
          expect(usernameAssignment.credential).toBe(
            AuthenticationCredentialKind.Username,
          )
          expect(assignedPasswordIndex.value).toBe(7)
          expect(passwordAssignment.credential).toBe(
            AuthenticationCredentialKind.CurrentPassword,
          )
        } finally {
          assignedUsernameIndex.free()
          assignedPasswordIndex.free()
        }
      } finally {
        for (const assignment of assignments) assignment.free()
      }
    } finally {
      plan.free()
      fields.free()
      username.free()
      password.free()
      usernameIndex.free()
      passwordIndex.free()
    }
  })

  test('fails closed for a generated new-password observation', () => {
    const fieldIndex = new AuthenticationFillFieldIndex(1)
    const newPassword = new AuthenticationFillFieldObservation(
      fieldIndex,
      AuthenticationFillFieldRole.NewPassword,
      AuthenticationFillFieldEditability.Writable,
    )
    const fields = new AuthenticationFillFieldObservations()
    fields.add(newPassword)

    try {
      expect(() => plan_companion_credential_fill(fields)).toThrow(
        'the observed scope contains a new-password field',
      )
    } finally {
      fields.free()
      newPassword.free()
      fieldIndex.free()
    }
  })
})
