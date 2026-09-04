import {
  CredentialFillEditability,
  CredentialFillFieldIndex,
  CredentialFillFieldRole,
  CredentialFillObservation,
  CredentialFillObservations,
  CredentialKind,
  plan_companion_credential_fill,
  type CredentialFillPlan,
  type CredentialFillAssignment,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

export type FakeLoginCredentials = {
  readonly username: string
  readonly password: string
}

export type SimulatedCredentialFieldDefinition = {
  readonly field_index: CredentialFillFieldIndex
  readonly role: CredentialFillFieldRole
  readonly editability: CredentialFillEditability
  readonly value: string
}

export class SimulatedCredentialField {
  readonly field_index: CredentialFillFieldIndex
  readonly observation: CredentialFillObservation
  value: string

  private readonly role: CredentialFillFieldRole
  private readonly editability: CredentialFillEditability

  constructor({
    field_index,
    role,
    editability,
    value,
  }: SimulatedCredentialFieldDefinition) {
    this.field_index = field_index
    this.role = role
    this.editability = editability
    this.value = value
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

export type SimulatedCredentialFields = SimulatedCredentialField[]

export type SimulatedCredentialFormDefinition = {
  readonly fields: SimulatedCredentialFields
}

export class SimulatedCredentialForm {
  readonly fields: SimulatedCredentialFields

  constructor({ fields }: SimulatedCredentialFormDefinition) {
    this.fields = fields
  }

  free(): void {
    for (const field of this.fields) field.free()
  }
}

type ApplyCredentialPlanRequest = {
  readonly plan: CredentialFillPlan
  readonly form: SimulatedCredentialForm
  readonly credentials: FakeLoginCredentials
}

type FakeCredentialValues = Record<CredentialKind, string>

type ApplyCredentialAssignmentRequest = {
  readonly assignment: CredentialFillAssignment
  readonly form: SimulatedCredentialForm
  readonly credentialValues: FakeCredentialValues
}

function applyCredentialAssignment({
  assignment,
  form,
  credentialValues,
}: ApplyCredentialAssignmentRequest): void {
  const assignedFieldIndex = assignment.field_index
  try {
    for (const field of form.fields) {
      if (field.field_index.value === assignedFieldIndex.value) {
        field.value = credentialValues[assignment.credential]
        return
      }
    }
    throw new Error('credential fill plan referenced an unknown fake field')
  } finally {
    assignedFieldIndex.free()
  }
}

function applyCredentialPlan({
  plan,
  form,
  credentials,
}: ApplyCredentialPlanRequest): void {
  const credentialValues = {
    [CredentialKind.Username]: credentials.username,
    [CredentialKind.CurrentPassword]: credentials.password,
  } satisfies FakeCredentialValues
  const assignments = plan.take_assignments()
  try {
    for (const assignment of assignments) {
      const assignmentRequest: ApplyCredentialAssignmentRequest = {
        assignment,
        form,
        credentialValues,
      }
      applyCredentialAssignment(assignmentRequest)
    }
  } finally {
    for (const assignment of assignments) assignment.free()
  }
}

export type CredentialFillSimulationRequest = {
  readonly observedFields: SimulatedCredentialFields
  readonly form: SimulatedCredentialForm
  readonly credentials: FakeLoginCredentials
}

export function simulateCredentialFill({
  observedFields,
  form,
  credentials,
}: CredentialFillSimulationRequest): void {
  const observations = new CredentialFillObservations()
  try {
    for (const field of observedFields) {
      observations.add(field.observation)
    }
    const plan = plan_companion_credential_fill(observations)
    try {
      const applyRequest: ApplyCredentialPlanRequest = {
        plan,
        form,
        credentials,
      }
      applyCredentialPlan(applyRequest)
    } finally {
      plan.free()
    }
  } finally {
    observations.free()
  }
}
