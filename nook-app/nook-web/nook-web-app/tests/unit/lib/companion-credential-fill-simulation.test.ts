import { describe, expect, test } from 'vitest'

import {
  CredentialFillEditability,
  CredentialFillFieldIndex,
  CredentialFillFieldRole,
  CredentialFillObservation,
  CredentialFillObservations,
  CredentialKind,
  plan_companion_credential_fill,
  type CredentialFillPlan,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

const FAKE_CREDENTIALS = {
  username: 'zero-vault-user@example.test',
  password: 'fake-login-password',
} as const
const FAKE_CREDENTIAL_VALUES = {
  [CredentialKind.Username]: FAKE_CREDENTIALS.username,
  [CredentialKind.CurrentPassword]: FAKE_CREDENTIALS.password,
} satisfies Record<CredentialKind, string>

class SimulatedCredentialField {
  readonly observation: CredentialFillObservation
  value = ''

  constructor(
    readonly field_index: CredentialFillFieldIndex,
    private readonly role: CredentialFillFieldRole,
    private readonly editability: CredentialFillEditability,
  ) {
    this.observation = CredentialFillObservation.credential(
      field_index,
      role,
      editability,
    )
  }

  free(): void {
    this.observation.free()
    this.editability.free()
    this.role.free()
    this.field_index.free()
  }
}

class SimulatedCredentialForm {
  constructor(readonly fields: SimulatedCredentialField[]) {}

  free(): void {
    for (const field of this.fields) field.free()
  }
}

function applyCredentialPlan(
  plan: CredentialFillPlan,
  form: SimulatedCredentialForm,
): void {
  const assignments = plan.take_assignments()
  try {
    for (const assignment of assignments) {
      const assignedFieldIndex = assignment.field_index
      try {
        const field = form.fields.find(
          (candidate) =>
            candidate.field_index.value === assignedFieldIndex.value,
        )
        if (!field) {
          throw new Error('credential fill plan referenced an unknown fake field')
        }
        field.value = FAKE_CREDENTIAL_VALUES[assignment.credential]
      } finally {
        assignedFieldIndex.free()
      }
    }
  } finally {
    for (const assignment of assignments) assignment.free()
  }
}

function simulateCredentialFill(
  observedFields: SimulatedCredentialField[],
  form: SimulatedCredentialForm,
): void {
  const observations = new CredentialFillObservations()
  try {
    for (const field of observedFields) {
      observations.add(field.observation)
    }
    const plan = plan_companion_credential_fill(observations)
    try {
      applyCredentialPlan(plan, form)
    } finally {
      plan.free()
    }
  } finally {
    observations.free()
  }
}

function expectCredentialPlanningFailure(
  observedFields: SimulatedCredentialField[],
  message: string,
): void {
  const observations = new CredentialFillObservations()
  try {
    for (const field of observedFields) {
      observations.add(field.observation)
    }
    expect(() => {
      const unexpectedPlan = plan_companion_credential_fill(observations)
      unexpectedPlan.free()
      throw new Error('credential planning unexpectedly succeeded')
    }).toThrow(message)
  } finally {
    observations.free()
  }
}

describe('deterministic zero-vault credential-fill simulation', () => {
  test('fills non-contiguous username and generic-password fields', () => {
    const username = new SimulatedCredentialField(
      new CredentialFillFieldIndex(3),
      CredentialFillFieldRole.username(),
      CredentialFillEditability.writable(),
    )
    const password = new SimulatedCredentialField(
      new CredentialFillFieldIndex(19),
      CredentialFillFieldRole.generic_password(),
      CredentialFillEditability.writable(),
    )
    const form = new SimulatedCredentialForm([username, password])

    try {
      simulateCredentialFill(form.fields, form)
      expect(username.value).toBe(FAKE_CREDENTIALS.username)
      expect(password.value).toBe(FAKE_CREDENTIALS.password)
    } finally {
      form.free()
    }
  })

  test('fills sequential username-only and password-only steps', () => {
    const username = new SimulatedCredentialField(
      new CredentialFillFieldIndex(5),
      CredentialFillFieldRole.username(),
      CredentialFillEditability.writable(),
    )
    const password = new SimulatedCredentialField(
      new CredentialFillFieldIndex(12),
      CredentialFillFieldRole.current_password(),
      CredentialFillEditability.writable(),
    )
    const form = new SimulatedCredentialForm([username, password])

    try {
      simulateCredentialFill([username], form)
      expect(username.value).toBe(FAKE_CREDENTIALS.username)
      expect(password.value).toBe('')

      simulateCredentialFill([password], form)
      expect(username.value).toBe(FAKE_CREDENTIALS.username)
      expect(password.value).toBe(FAKE_CREDENTIALS.password)
    } finally {
      form.free()
    }
  })

  test('leaves fake fields unchanged when readonly password planning fails', () => {
    const password = new SimulatedCredentialField(
      new CredentialFillFieldIndex(8),
      CredentialFillFieldRole.current_password(),
      CredentialFillEditability.readonly(),
    )
    const form = new SimulatedCredentialForm([password])

    try {
      expectCredentialPlanningFailure(
        form.fields,
        'every password field is read-only, so credential disclosure is blocked',
      )
      expect(password.value).toBe('')
    } finally {
      form.free()
    }
  })
})
