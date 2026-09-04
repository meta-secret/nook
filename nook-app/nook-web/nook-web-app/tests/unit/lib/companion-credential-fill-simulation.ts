import {
  CredentialFillEditability,
  CredentialFillFieldIndex,
  CredentialFillFieldRole,
  CredentialFillObservation,
  CredentialFillObservations,
  CredentialKind,
  plan_companion_credential_fill,
  type CredentialFillAssignment,
  type CredentialFillPlan,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

export type FakeLoginCredentials = {
  readonly username: string
  readonly password: string
}

export type SimulatedCredentialFieldDefinition = {
  readonly name: string
  readonly field_index: CredentialFillFieldIndex
  readonly role: CredentialFillFieldRole
  readonly editability: CredentialFillEditability
  readonly value: string
}

export class SimulatedCredentialField {
  readonly name: string
  readonly field_index: CredentialFillFieldIndex
  readonly observation: CredentialFillObservation
  value: string

  private readonly role: CredentialFillFieldRole
  private readonly editability: CredentialFillEditability

  constructor({
    name,
    field_index,
    role,
    editability,
    value,
  }: SimulatedCredentialFieldDefinition) {
    this.name = name
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

export type SimulatedCredentialForm = SimulatedCredentialField[]
export type CredentialFillJourneyStep = {
  readonly observedFields: SimulatedCredentialField[]
}
export enum CredentialFillJourneyOutcomeKind {
  Filled = 'filled',
  Rejected = 'rejected',
}

export type SimulatedCredentialFormSnapshot = {
  readonly name: string
  readonly value: string
}[]

export type CredentialFillJourneyOutcome =
  | {
      readonly kind: CredentialFillJourneyOutcomeKind.Filled
      readonly snapshot: SimulatedCredentialFormSnapshot
    }
  | {
      readonly kind: CredentialFillJourneyOutcomeKind.Rejected
      readonly message: string
      readonly snapshot: SimulatedCredentialFormSnapshot
    }

export type CredentialFillJourneyRequest = {
  readonly form: SimulatedCredentialForm
  readonly steps: CredentialFillJourneyStep[]
  readonly credentials: FakeLoginCredentials
}

enum CredentialFillPlanningKind {
  Planned = 'planned',
  Rejected = 'rejected',
}

type CredentialFillPlanning =
  | {
      readonly kind: CredentialFillPlanningKind.Planned
      readonly plan: CredentialFillPlan
    }
  | {
      readonly kind: CredentialFillPlanningKind.Rejected
      readonly message: string
    }

type ApplyCredentialPlanRequest = {
  readonly plan: CredentialFillPlan
  readonly form: SimulatedCredentialForm
  readonly credentials: FakeLoginCredentials
}

type ApplyCredentialAssignmentRequest = {
  readonly assignment: CredentialFillAssignment
  readonly form: SimulatedCredentialForm
  readonly credentialValues: Record<CredentialKind, string>
}

function planCredentialFillStep(
  step: CredentialFillJourneyStep,
): CredentialFillPlanning {
  const observations = new CredentialFillObservations()
  try {
    for (const field of step.observedFields) {
      observations.add(field.observation)
    }
    try {
      const plan = plan_companion_credential_fill(observations)
      return { kind: CredentialFillPlanningKind.Planned, plan }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { kind: CredentialFillPlanningKind.Rejected, message }
    }
  } finally {
    observations.free()
  }
}

function applyCredentialAssignment({
  assignment,
  form,
  credentialValues,
}: ApplyCredentialAssignmentRequest): void {
  const assignedFieldIndex = assignment.field_index
  try {
    for (const field of form) {
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
  } satisfies Record<CredentialKind, string>
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

function snapshotForm(
  form: SimulatedCredentialForm,
): SimulatedCredentialFormSnapshot {
  return form.map((field) => ({ name: field.name, value: field.value }))
}

export function simulateLoginJourney({
  form,
  steps,
  credentials,
}: CredentialFillJourneyRequest): CredentialFillJourneyOutcome[] {
  const outcomes: CredentialFillJourneyOutcome[] = []
  try {
    for (const step of steps) {
      const planning = planCredentialFillStep(step)
      switch (planning.kind) {
        case CredentialFillPlanningKind.Planned: {
          try {
            const applyRequest: ApplyCredentialPlanRequest = {
              plan: planning.plan,
              form,
              credentials,
            }
            applyCredentialPlan(applyRequest)
            const outcome: CredentialFillJourneyOutcome = {
              kind: CredentialFillJourneyOutcomeKind.Filled,
              snapshot: snapshotForm(form),
            }
            outcomes.push(outcome)
          } finally {
            planning.plan.free()
          }
          break
        }
        case CredentialFillPlanningKind.Rejected: {
          const outcome: CredentialFillJourneyOutcome = {
            kind: CredentialFillJourneyOutcomeKind.Rejected,
            message: planning.message,
            snapshot: snapshotForm(form),
          }
          outcomes.push(outcome)
          break
        }
      }
    }
    return outcomes
  } finally {
    for (const field of form) field.free()
  }
}
