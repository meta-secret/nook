import {
  CredentialFillEditability,
  CredentialFillFieldIndex,
  CredentialFillFieldRole,
  CredentialFillObservation,
  CredentialFillObservations,
  CredentialFillPlanningOutcome,
  CredentialFillRejection,
  CredentialKind,
  plan_companion_credential_fill,
  type CredentialFillAssignment,
  type CredentialFillPlan,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

export type FakeLoginCredentials = {
  readonly username: string
  readonly password: string
}

export enum SimulatedCredentialFieldKind {
  Credential = 'credential',
  NewPassword = 'newPassword',
  OneTimeCode = 'oneTimeCode',
}

type SimulatedCredentialFieldBase = {
  readonly name: string
  readonly field_index: CredentialFillFieldIndex
  readonly value: string
}

export type SimulatedCredentialFieldDefinition = SimulatedCredentialFieldBase &
  (
    | {
        readonly kind: SimulatedCredentialFieldKind.Credential
        readonly role: CredentialFillFieldRole
        readonly editability: CredentialFillEditability
      }
    | { readonly kind: SimulatedCredentialFieldKind.NewPassword }
    | { readonly kind: SimulatedCredentialFieldKind.OneTimeCode }
  )

type SimulatedCredentialFieldOwnership =
  | {
      readonly kind: SimulatedCredentialFieldKind.Credential
      readonly role: CredentialFillFieldRole
      readonly editability: CredentialFillEditability
    }
  | { readonly kind: SimulatedCredentialFieldKind.NewPassword }
  | { readonly kind: SimulatedCredentialFieldKind.OneTimeCode }

export class SimulatedCredentialField {
  readonly name: string
  readonly field_index: CredentialFillFieldIndex
  readonly observation: CredentialFillObservation
  value: string

  private readonly ownership: SimulatedCredentialFieldOwnership

  constructor(definition: SimulatedCredentialFieldDefinition) {
    this.name = definition.name
    this.field_index = definition.field_index
    this.value = definition.value
    switch (definition.kind) {
      case SimulatedCredentialFieldKind.Credential:
        this.observation = CredentialFillObservation.credential(
          definition.field_index,
          definition.role,
          definition.editability,
        )
        this.ownership = {
          kind: SimulatedCredentialFieldKind.Credential,
          role: definition.role,
          editability: definition.editability,
        }
        break
      case SimulatedCredentialFieldKind.NewPassword:
        this.observation = CredentialFillObservation.new_password(
          definition.field_index,
        )
        this.ownership = { kind: SimulatedCredentialFieldKind.NewPassword }
        break
      case SimulatedCredentialFieldKind.OneTimeCode:
        this.observation = CredentialFillObservation.one_time_code(
          definition.field_index,
        )
        this.ownership = { kind: SimulatedCredentialFieldKind.OneTimeCode }
        break
    }
  }

  free(): void {
    this.observation.free()
    switch (this.ownership.kind) {
      case SimulatedCredentialFieldKind.Credential:
        this.ownership.editability.free()
        this.ownership.role.free()
        break
      case SimulatedCredentialFieldKind.NewPassword:
      case SimulatedCredentialFieldKind.OneTimeCode:
        break
    }
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
      readonly rejection: CredentialFillRejection
      readonly snapshot: SimulatedCredentialFormSnapshot
    }

export type CredentialFillJourneyRequest = {
  readonly form: SimulatedCredentialForm
  readonly steps: CredentialFillJourneyStep[]
  readonly credentials: FakeLoginCredentials
}

type CredentialFillPlanning =
  | {
      readonly kind: CredentialFillPlanningOutcome.Planned
      readonly plan: CredentialFillPlan
    }
  | {
      readonly kind: CredentialFillPlanningOutcome.Rejected
      readonly rejection: CredentialFillRejection
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
    const result = plan_companion_credential_fill(observations)
    try {
      switch (result.kind) {
        case CredentialFillPlanningOutcome.Planned:
          return {
            kind: CredentialFillPlanningOutcome.Planned,
            plan: result.plan(),
          }
        case CredentialFillPlanningOutcome.Rejected: {
          const rejection = result.rejection()
          return {
            kind: CredentialFillPlanningOutcome.Rejected,
            rejection,
          }
        }
      }
      throw new Error('credential fill result has an unsupported outcome')
    } finally {
      result.free()
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
        case CredentialFillPlanningOutcome.Planned: {
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
        case CredentialFillPlanningOutcome.Rejected: {
          const outcome: CredentialFillJourneyOutcome = {
            kind: CredentialFillJourneyOutcomeKind.Rejected,
            rejection: planning.rejection,
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
