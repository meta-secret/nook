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
  CredentialFillPlanningOutcome,
  CredentialFillRejection,
  CredentialFillResult,
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

    const result = plan_companion_credential_fill(fields)
    try {
      expect(result).toBeInstanceOf(CredentialFillResult)
      expect(result.kind).toBe(CredentialFillPlanningOutcome.Planned)
      const plan = result.plan()
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
      }
    } finally {
      result.free()
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
    const fieldIndex = CredentialFillFieldIndex.zero()
    const currentPasswordRole = CredentialFillFieldRole.current_password()
    const readonly = CredentialFillEditability.readonly()
    const observation = CredentialFillObservation.credential(
      fieldIndex,
      currentPasswordRole,
      readonly,
    )
    const fields = new CredentialFillObservations()
    fields.add(observation)

    const result = plan_companion_credential_fill(fields)
    try {
      expect(result).toBeInstanceOf(CredentialFillResult)
      expect(result.kind).toBe(CredentialFillPlanningOutcome.Rejected)
      expect(result.rejection()).toBe(
        CredentialFillRejection.PasswordFieldsReadonly,
      )
    } finally {
      result.free()
      fields.free()
      observation.free()
      readonly.free()
      currentPasswordRole.free()
      fieldIndex.free()
    }
  })

  test('fails closed for generated unsafe observation variants', () => {
    const newPasswordIndex = CredentialFillFieldIndex.one()
    const oneTimeCodeIndex = CredentialFillFieldIndex.two()
    const newPassword = CredentialFillObservation.new_password(newPasswordIndex)
    const oneTimeCode =
      CredentialFillObservation.one_time_code(oneTimeCodeIndex)
    const newPasswordFields = new CredentialFillObservations()
    const oneTimeCodeFields = new CredentialFillObservations()
    newPasswordFields.add(newPassword)
    oneTimeCodeFields.add(oneTimeCode)

    const newPasswordResult = plan_companion_credential_fill(newPasswordFields)
    try {
      expect(newPasswordResult).toBeInstanceOf(CredentialFillResult)
      expect(newPasswordResult.kind).toBe(
        CredentialFillPlanningOutcome.Rejected,
      )
      expect(newPasswordResult.rejection()).toBe(
        CredentialFillRejection.NewPasswordFieldPresent,
      )
      const oneTimeCodeResult =
        plan_companion_credential_fill(oneTimeCodeFields)
      try {
        expect(oneTimeCodeResult).toBeInstanceOf(CredentialFillResult)
        expect(oneTimeCodeResult.kind).toBe(
          CredentialFillPlanningOutcome.Rejected,
        )
        expect(oneTimeCodeResult.rejection()).toBe(
          CredentialFillRejection.OneTimeCodeFieldPresent,
        )
      } finally {
        oneTimeCodeResult.free()
      }
    } finally {
      newPasswordResult.free()
      newPasswordFields.free()
      oneTimeCodeFields.free()
      newPassword.free()
      oneTimeCode.free()
      newPasswordIndex.free()
      oneTimeCodeIndex.free()
    }
  })

  test('returns a typed rejection above the generated batch bound', () => {
    const fieldIndex = CredentialFillFieldIndex.zero()
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
      for (let count = 0; count <= maxCount.value; count += 1) {
        fields.add(observation)
      }
      const result = plan_companion_credential_fill(fields)
      try {
        expect(result).toBeInstanceOf(CredentialFillResult)
        expect(result.kind).toBe(CredentialFillPlanningOutcome.Rejected)
        expect(result.rejection()).toBe(
          CredentialFillRejection.TooManyObservedFields,
        )
      } finally {
        result.free()
      }
      fields.add(observation)
      const repeatedResult = plan_companion_credential_fill(fields)
      try {
        expect(repeatedResult.kind).toBe(CredentialFillPlanningOutcome.Rejected)
        expect(repeatedResult.rejection()).toBe(
          CredentialFillRejection.TooManyObservedFields,
        )
      } finally {
        repeatedResult.free()
      }
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
