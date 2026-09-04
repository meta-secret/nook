import { describe, expect, test } from 'vitest'

import {
  CredentialFillAssignment,
  CredentialFillEditability,
  CredentialFillFieldClassification,
  CredentialFillFieldClassificationOutcome,
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
  NookPageInputFieldObservation,
  PageInputType,
  classify_companion_credential_fill_field,
  plan_companion_credential_fill,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

describe('companion credential-fill WASM ABI', () => {
  test.each([
    {
      name: 'an unrelated text input',
      fieldIndexFactory: () => CredentialFillFieldIndex.zero(),
      fieldFactory: () =>
        new NookPageInputFieldObservation(
          PageInputType.Text,
          false,
          false,
          [],
          'search',
          false,
        ),
    },
    {
      name: 'a disabled OTP/new/current-password collision',
      fieldIndexFactory: () => CredentialFillFieldIndex.one(),
      fieldFactory: () =>
        new NookPageInputFieldObservation(
          PageInputType.Password,
          true,
          false,
          ['one-time-code', 'new-password', 'current-password'],
          'verification code password',
          true,
        ),
    },
    {
      name: 'a text input with current/new-password hints',
      fieldIndexFactory: () => CredentialFillFieldIndex.two(),
      fieldFactory: () =>
        new NookPageInputFieldObservation(
          PageInputType.Text,
          false,
          false,
          ['current-password', 'new-password'],
          'search',
          true,
        ),
    },
    {
      name: 'a card-security-code password input',
      fieldIndexFactory: () => CredentialFillFieldIndex.three(),
      fieldFactory: () =>
        new NookPageInputFieldObservation(
          PageInputType.Password,
          false,
          false,
          ['cc-csc'],
          'card security code',
          true,
        ),
    },
    {
      name: 'a field with conflicting username and cc-csc tokens',
      fieldIndexFactory: () => CredentialFillFieldIndex.zero(),
      fieldFactory: () =>
        new NookPageInputFieldObservation(
          PageInputType.Text,
          false,
          false,
          ['username', 'cc-csc'],
          'account username',
          true,
        ),
    },
  ])('returns closed Ignored for $name', (classifierCase) => {
    const fieldIndex = classifierCase.fieldIndexFactory()
    const field = classifierCase.fieldFactory()
    const classification = classify_companion_credential_fill_field(
      fieldIndex,
      field,
    )
    try {
      expect(classification).toBeInstanceOf(CredentialFillFieldClassification)
      expect(classification.kind).toBe(
        CredentialFillFieldClassificationOutcome.Ignored,
      )
      expect(() => classification.observation()).toThrow()
    } finally {
      classification.free()
      field.free()
      fieldIndex.free()
    }
  })

  test.each([
    {
      name: 'username',
      fieldIndexFactory: () => CredentialFillFieldIndex.zero(),
      fieldFactory: () =>
        new NookPageInputFieldObservation(
          PageInputType.Text,
          false,
          false,
          ['username'],
          'account username',
          true,
        ),
      expectedCredential: CredentialKind.Username,
    },
    {
      name: 'writable current password',
      fieldIndexFactory: () => CredentialFillFieldIndex.one(),
      fieldFactory: () =>
        new NookPageInputFieldObservation(
          PageInputType.Password,
          false,
          false,
          ['current-password'],
          'password',
          true,
        ),
      expectedCredential: CredentialKind.CurrentPassword,
    },
    {
      name: 'generic password',
      fieldIndexFactory: () => CredentialFillFieldIndex.two(),
      fieldFactory: () =>
        new NookPageInputFieldObservation(
          PageInputType.Password,
          false,
          false,
          [],
          'password',
          true,
        ),
      expectedCredential: CredentialKind.CurrentPassword,
    },
    {
      name: 'explicit username despite OTP-like identity',
      fieldIndexFactory: () => CredentialFillFieldIndex.three(),
      fieldFactory: () =>
        new NookPageInputFieldObservation(
          PageInputType.Text,
          false,
          false,
          ['username'],
          'verification code',
          true,
        ),
      expectedCredential: CredentialKind.Username,
    },
    {
      name: 'explicit email despite OTP-like identity',
      fieldIndexFactory: () => CredentialFillFieldIndex.zero(),
      fieldFactory: () =>
        new NookPageInputFieldObservation(
          PageInputType.Email,
          false,
          false,
          ['email'],
          'one time code',
          true,
        ),
      expectedCredential: CredentialKind.Username,
    },
  ])('classifies $name into a planned assignment', (classifierCase) => {
    const fieldIndex = classifierCase.fieldIndexFactory()
    const field = classifierCase.fieldFactory()
    const classification = classify_companion_credential_fill_field(
      fieldIndex,
      field,
    )
    try {
      expect(classification).toBeInstanceOf(CredentialFillFieldClassification)
      expect(classification.kind).toBe(
        CredentialFillFieldClassificationOutcome.Observed,
      )
      const observation = classification.observation()
      try {
        const fields = new CredentialFillObservations()
        try {
          fields.add(observation)
          const result = plan_companion_credential_fill(fields)
          try {
            expect(result.kind).toBe(CredentialFillPlanningOutcome.Planned)
            const plan = result.plan()
            try {
              const assignments = plan.take_assignments()
              try {
                expect(assignments).toHaveLength(1)
                const assignment = assignments[0]!
                expect(assignment).toBeInstanceOf(CredentialFillAssignment)
                expect(assignment.credential).toBe(
                  classifierCase.expectedCredential,
                )
              } finally {
                for (const assignment of assignments) assignment.free()
              }
            } finally {
              plan.free()
            }
          } finally {
            result.free()
          }
        } finally {
          fields.free()
        }
      } finally {
        observation.free()
      }
    } finally {
      classification.free()
      field.free()
      fieldIndex.free()
    }
  })

  test.each([
    {
      name: 'readonly username',
      fieldIndexFactory: () => CredentialFillFieldIndex.three(),
      fieldFactory: () =>
        new NookPageInputFieldObservation(
          PageInputType.Text,
          false,
          true,
          ['username'],
          'account username',
          true,
        ),
      expectedRejection: CredentialFillRejection.NoCredentialField,
    },
    {
      name: 'readonly current password',
      fieldIndexFactory: () => CredentialFillFieldIndex.zero(),
      fieldFactory: () =>
        new NookPageInputFieldObservation(
          PageInputType.Password,
          false,
          true,
          ['current-password'],
          'password',
          true,
        ),
      expectedRejection: CredentialFillRejection.PasswordFieldsReadonly,
    },
    {
      name: 'new password',
      fieldIndexFactory: () => CredentialFillFieldIndex.one(),
      fieldFactory: () =>
        new NookPageInputFieldObservation(
          PageInputType.Password,
          false,
          false,
          ['new-password'],
          'new password',
          true,
        ),
      expectedRejection: CredentialFillRejection.NewPasswordFieldPresent,
    },
    {
      name: 'one-time code',
      fieldIndexFactory: () => CredentialFillFieldIndex.two(),
      fieldFactory: () =>
        new NookPageInputFieldObservation(
          PageInputType.Text,
          false,
          false,
          ['one-time-code'],
          'verification code',
          true,
        ),
      expectedRejection: CredentialFillRejection.OneTimeCodeFieldPresent,
    },
    {
      name: 'password with a one-time-code token and empty identity',
      fieldIndexFactory: () => CredentialFillFieldIndex.three(),
      fieldFactory: () =>
        new NookPageInputFieldObservation(
          PageInputType.Password,
          false,
          false,
          ['one-time-code'],
          '',
          true,
        ),
      expectedRejection: CredentialFillRejection.OneTimeCodeFieldPresent,
    },
    {
      name: 'password with a one-time-code token and OTP-negative identity',
      fieldIndexFactory: () => CredentialFillFieldIndex.zero(),
      fieldFactory: () =>
        new NookPageInputFieldObservation(
          PageInputType.Password,
          false,
          false,
          ['one-time-code'],
          'card security code',
          true,
        ),
      expectedRejection: CredentialFillRejection.OneTimeCodeFieldPresent,
    },
    {
      name: 'email with a one-time-code token and username-positive identity',
      fieldIndexFactory: () => CredentialFillFieldIndex.one(),
      fieldFactory: () =>
        new NookPageInputFieldObservation(
          PageInputType.Email,
          false,
          false,
          ['one-time-code'],
          'account email username',
          true,
        ),
      expectedRejection: CredentialFillRejection.OneTimeCodeFieldPresent,
    },
    {
      name: 'email with explicit one-time-code and username tokens',
      fieldIndexFactory: () => CredentialFillFieldIndex.two(),
      fieldFactory: () =>
        new NookPageInputFieldObservation(
          PageInputType.Email,
          false,
          false,
          ['username', 'one-time-code'],
          'account email',
          true,
        ),
      expectedRejection: CredentialFillRejection.OneTimeCodeFieldPresent,
    },
    {
      name: 'password with explicit one-time-code and cc-csc tokens',
      fieldIndexFactory: () => CredentialFillFieldIndex.three(),
      fieldFactory: () =>
        new NookPageInputFieldObservation(
          PageInputType.Password,
          false,
          false,
          ['one-time-code', 'cc-csc'],
          'card security code',
          true,
        ),
      expectedRejection: CredentialFillRejection.OneTimeCodeFieldPresent,
    },
  ])('classifies $name into a typed rejection', (classifierCase) => {
    const fieldIndex = classifierCase.fieldIndexFactory()
    const field = classifierCase.fieldFactory()
    const classification = classify_companion_credential_fill_field(
      fieldIndex,
      field,
    )
    try {
      expect(classification).toBeInstanceOf(CredentialFillFieldClassification)
      expect(classification.kind).toBe(
        CredentialFillFieldClassificationOutcome.Observed,
      )
      const observation = classification.observation()
      try {
        const fields = new CredentialFillObservations()
        try {
          fields.add(observation)
          const result = plan_companion_credential_fill(fields)
          try {
            expect(result.kind).toBe(CredentialFillPlanningOutcome.Rejected)
            expect(result.rejection()).toBe(classifierCase.expectedRejection)
          } finally {
            result.free()
          }
        } finally {
          fields.free()
        }
      } finally {
        observation.free()
      }
    } finally {
      classification.free()
      field.free()
      fieldIndex.free()
    }
  })

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
