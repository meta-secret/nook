import { describe, expect, test } from 'vitest'

import {
  CredentialFillAssignment,
  CredentialFillEditability,
  CredentialFillFieldIndex,
  CredentialFillFieldRole,
  CredentialFillKind,
  CredentialFillObservation,
  CredentialFillObservations,
  CredentialFillPlan,
  plan_companion_credential_fill,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

describe('companion credential-fill WASM ABI', () => {
  test('constructs generated fields and reads typed assignments', () => {
    const usernameIndex = new CredentialFillFieldIndex(4)
    const passwordIndex = new CredentialFillFieldIndex(7)
    const username = CredentialFillObservation.credential(
      usernameIndex,
      CredentialFillFieldRole.Username,
      CredentialFillEditability.Writable,
    )
    const password = CredentialFillObservation.credential(
      passwordIndex,
      CredentialFillFieldRole.GenericPassword,
      CredentialFillEditability.Writable,
    )
    const fields = new CredentialFillObservations()
    fields.add(username)
    fields.add(password)

    const plan = plan_companion_credential_fill(fields)
    try {
      expect(plan).toBeInstanceOf(CredentialFillPlan)
      const assignments = plan.take_assignments()
      try {
        expect(assignments).toHaveLength(2)
        const usernameAssignment = assignments[0]!
        const passwordAssignment = assignments[1]!
        expect(usernameAssignment).toBeInstanceOf(CredentialFillAssignment)
        expect(passwordAssignment).toBeInstanceOf(CredentialFillAssignment)
        const assignedUsernameIndex = usernameAssignment.field_index
        const assignedPasswordIndex = passwordAssignment.field_index
        try {
          expect(assignedUsernameIndex.value).toBe(4)
          expect(usernameAssignment.credential).toBe(
            CredentialFillKind.Username,
          )
          expect(assignedPasswordIndex.value).toBe(7)
          expect(passwordAssignment.credential).toBe(
            CredentialFillKind.CurrentPassword,
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

  test('fails closed for generated unsafe observation variants', () => {
    const newPasswordIndex = new CredentialFillFieldIndex(1)
    const oneTimeCodeIndex = new CredentialFillFieldIndex(2)
    const newPassword = CredentialFillObservation.new_password(newPasswordIndex)
    const oneTimeCode =
      CredentialFillObservation.one_time_code(oneTimeCodeIndex)
    const newPasswordFields = new CredentialFillObservations()
    const oneTimeCodeFields = new CredentialFillObservations()
    newPasswordFields.add(newPassword)
    oneTimeCodeFields.add(oneTimeCode)

    try {
      expect(() => plan_companion_credential_fill(newPasswordFields)).toThrow(
        'the observed scope contains a new-password field',
      )
      expect(() => plan_companion_credential_fill(oneTimeCodeFields)).toThrow(
        'the observed scope contains a one-time-code field',
      )
    } finally {
      newPasswordFields.free()
      oneTimeCodeFields.free()
      newPassword.free()
      oneTimeCode.free()
      newPasswordIndex.free()
      oneTimeCodeIndex.free()
    }
  })
})
