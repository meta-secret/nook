import { describe, expect, test } from 'vitest'

import {
  CredentialFillAssignment,
  CredentialFillEditability,
  CredentialFillFieldIndex,
  CredentialFillFieldRole,
  CredentialFillObservation,
  CredentialFillObservationCount,
  CredentialFillObservations,
  CredentialFillPlan,
  CredentialKind,
  plan_companion_credential_fill,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

describe('companion credential-fill WASM ABI', () => {
  test('constructs generated fields and reads typed assignments', () => {
    const usernameIndex = new CredentialFillFieldIndex(4)
    const passwordIndex = new CredentialFillFieldIndex(7)
    const usernameRole = CredentialFillFieldRole.username()
    const genericPasswordRole = CredentialFillFieldRole.generic_password()
    const writable = CredentialFillEditability.writable()
    const username = CredentialFillObservation.credential(
      usernameIndex,
      usernameRole,
      writable,
    )
    const password = CredentialFillObservation.credential(
      passwordIndex,
      genericPasswordRole,
      writable,
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
        const assignedUsernameKind = usernameAssignment.credential
        const assignedPasswordKind = passwordAssignment.credential
        try {
          expect(assignedUsernameIndex.value).toBe(4)
          expect(assignedUsernameKind).toBe(CredentialKind.Username)
          expect(assignedPasswordIndex.value).toBe(7)
          expect(assignedPasswordKind).toBe(CredentialKind.CurrentPassword)
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
      usernameRole.free()
      genericPasswordRole.free()
      writable.free()
    }
  })

  test('fails closed for a generated readonly credential field', () => {
    const fieldIndex = new CredentialFillFieldIndex(0)
    const currentPasswordRole = CredentialFillFieldRole.current_password()
    const readonly = CredentialFillEditability.readonly()
    const observation = CredentialFillObservation.credential(
      fieldIndex,
      currentPasswordRole,
      readonly,
    )
    const fields = new CredentialFillObservations()
    fields.add(observation)

    try {
      expect(() => plan_companion_credential_fill(fields)).toThrow(
        'every password field is read-only, so credential disclosure is blocked',
      )
    } finally {
      fields.free()
      observation.free()
      readonly.free()
      currentPasswordRole.free()
      fieldIndex.free()
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

  test('rejects an observation above the generated batch bound', () => {
    const fieldIndex = new CredentialFillFieldIndex(0)
    const usernameRole = CredentialFillFieldRole.username()
    const writable = CredentialFillEditability.writable()
    const observation = CredentialFillObservation.credential(
      fieldIndex,
      usernameRole,
      writable,
    )
    const fields = new CredentialFillObservations()
    const maxCount = CredentialFillObservations.max_count()

    try {
      expect(maxCount).toBeInstanceOf(CredentialFillObservationCount)
      for (let count = 0; count < maxCount.value; count += 1) {
        fields.add(observation)
      }
      expect(() => fields.add(observation)).toThrow(
        'the observed scope exceeds the field-count limit',
      )
    } finally {
      fields.free()
      observation.free()
      writable.free()
      usernameRole.free()
      fieldIndex.free()
      maxCount.free()
    }
  })
})
