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

export class SimulatedCredentialFieldIdentity {
  readonly value: string

  constructor(value: string) {
    this.value = value
  }
}

export enum SimulatedCredentialFieldKind {
  Credential = 'Credential',
  NewPassword = 'NewPassword',
  OneTimeCode = 'OneTimeCode',
}

type SimulatedCredentialFieldBase = {
  readonly field_identity: SimulatedCredentialFieldIdentity
  readonly name: string
  readonly value: string
}

export type SimulatedCredentialFieldDefinition = SimulatedCredentialFieldBase &
  (
    | {
        readonly kind: SimulatedCredentialFieldKind.Credential
        readonly roleFactory: () => CredentialFillFieldRole
        readonly editabilityFactory: () => CredentialFillEditability
      }
    | { readonly kind: SimulatedCredentialFieldKind.NewPassword }
    | { readonly kind: SimulatedCredentialFieldKind.OneTimeCode }
  )

export type SimulatedCredentialFieldDefinitions =
  readonly SimulatedCredentialFieldDefinition[]

export type CredentialFillJourneyStep = {
  readonly observed_field_identities: readonly SimulatedCredentialFieldIdentity[]
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

export enum SimulatedLoginJourneyValidationFailure {
  DuplicateFieldIdentity = 'duplicateFieldIdentity',
  UnknownStepFieldReference = 'unknownStepFieldReference',
}

export class SimulatedLoginJourneyValidationError extends Error {
  readonly failure: SimulatedLoginJourneyValidationFailure

  constructor(failure: SimulatedLoginJourneyValidationFailure) {
    super('invalid simulated login journey')
    this.failure = failure
  }
}

export type CredentialFillJourneyRequest = {
  readonly fields: SimulatedCredentialFieldDefinitions
  readonly steps: readonly CredentialFillJourneyStep[]
  readonly credentials: FakeLoginCredentials
}

type CredentialFieldOwnership = {
  readonly kind: SimulatedCredentialFieldKind.Credential
  readonly role: CredentialFillFieldRole
  readonly editability: CredentialFillEditability
}

type SimulatedCredentialFieldOwnership =
  | CredentialFieldOwnership
  | { readonly kind: SimulatedCredentialFieldKind.NewPassword }
  | { readonly kind: SimulatedCredentialFieldKind.OneTimeCode }

type MaterializedCredentialFieldDefinition = {
  readonly field_identity: SimulatedCredentialFieldIdentity
  readonly name: string
  readonly field_index: CredentialFillFieldIndex
  readonly observation: CredentialFillObservation
  readonly ownership: SimulatedCredentialFieldOwnership
  readonly value: string
}

class SimulatedCredentialField {
  readonly field_identity: SimulatedCredentialFieldIdentity
  readonly name: string
  readonly field_index: CredentialFillFieldIndex
  readonly observation: CredentialFillObservation
  value: string

  private readonly ownership: SimulatedCredentialFieldOwnership

  constructor(definition: MaterializedCredentialFieldDefinition) {
    this.field_identity = definition.field_identity
    this.name = definition.name
    this.field_index = definition.field_index
    this.observation = definition.observation
    this.ownership = definition.ownership
    this.value = definition.value
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

type SimulatedCredentialForm = SimulatedCredentialField[]

type MaterializeCredentialFieldRequest = {
  readonly definition: SimulatedCredentialFieldDefinition
  readonly field_index: CredentialFillFieldIndex
}

type MaterializeCredentialObservationRequest = {
  readonly definition: Extract<
    SimulatedCredentialFieldDefinition,
    { readonly kind: SimulatedCredentialFieldKind.Credential }
  >
  readonly field_index: CredentialFillFieldIndex
}

type MaterializedCredentialObservation = {
  readonly observation: CredentialFillObservation
  readonly ownership: CredentialFieldOwnership
}

function validateLoginJourney(request: CredentialFillJourneyRequest): void {
  const acceptedIdentities = new Set<string>()
  for (const field of request.fields) {
    if (acceptedIdentities.has(field.field_identity.value)) {
      throw new SimulatedLoginJourneyValidationError(
        SimulatedLoginJourneyValidationFailure.DuplicateFieldIdentity,
      )
    }
    acceptedIdentities.add(field.field_identity.value)
  }
  for (const step of request.steps) {
    for (const fieldIdentity of step.observed_field_identities) {
      if (!acceptedIdentities.has(fieldIdentity.value)) {
        throw new SimulatedLoginJourneyValidationError(
          SimulatedLoginJourneyValidationFailure.UnknownStepFieldReference,
        )
      }
    }
  }
}

function materializeCredentialObservation({
  definition,
  field_index,
}: MaterializeCredentialObservationRequest): MaterializedCredentialObservation {
  const role = definition.roleFactory()
  try {
    const editability = definition.editabilityFactory()
    try {
      const observation = CredentialFillObservation.credential(
        field_index,
        role,
        editability,
      )
      return {
        observation,
        ownership: {
          kind: SimulatedCredentialFieldKind.Credential,
          role,
          editability,
        },
      }
    } catch (error) {
      editability.free()
      throw error
    }
  } catch (error) {
    role.free()
    throw error
  }
}

function materializeCredentialField({
  definition,
  field_index,
}: MaterializeCredentialFieldRequest): SimulatedCredentialField {
  try {
    switch (definition.kind) {
      case SimulatedCredentialFieldKind.Credential: {
        const request: MaterializeCredentialObservationRequest = {
          definition,
          field_index,
        }
        const materialized = materializeCredentialObservation(request)
        const field: MaterializedCredentialFieldDefinition = {
          field_identity: definition.field_identity,
          name: definition.name,
          field_index,
          observation: materialized.observation,
          ownership: materialized.ownership,
          value: definition.value,
        }
        return new SimulatedCredentialField(field)
      }
      case SimulatedCredentialFieldKind.NewPassword: {
        const observation = CredentialFillObservation.new_password(field_index)
        const field: MaterializedCredentialFieldDefinition = {
          field_identity: definition.field_identity,
          name: definition.name,
          field_index,
          observation,
          ownership: { kind: SimulatedCredentialFieldKind.NewPassword },
          value: definition.value,
        }
        return new SimulatedCredentialField(field)
      }
      case SimulatedCredentialFieldKind.OneTimeCode: {
        const observation = CredentialFillObservation.one_time_code(field_index)
        const field: MaterializedCredentialFieldDefinition = {
          field_identity: definition.field_identity,
          name: definition.name,
          field_index,
          observation,
          ownership: { kind: SimulatedCredentialFieldKind.OneTimeCode },
          value: definition.value,
        }
        return new SimulatedCredentialField(field)
      }
    }
    throw new Error('unsupported simulated credential field kind')
  } catch (error) {
    field_index.free()
    throw error
  }
}

function materializeCredentialForm(
  definitions: SimulatedCredentialFieldDefinitions,
): SimulatedCredentialForm {
  const form: SimulatedCredentialForm = []
  let fieldIndexValue = 3
  try {
    for (const definition of definitions) {
      const field_index = new CredentialFillFieldIndex(fieldIndexValue)
      const request: MaterializeCredentialFieldRequest = {
        definition,
        field_index,
      }
      const field = materializeCredentialField(request)
      form.push(field)
      fieldIndexValue += 8
    }
    return form
  } catch (error) {
    for (const field of form) field.free()
    throw error
  }
}

type ResolveSimulatedCredentialFieldRequest = {
  readonly field_identity: SimulatedCredentialFieldIdentity
  readonly form: SimulatedCredentialForm
}

function resolveSimulatedCredentialField({
  field_identity,
  form,
}: ResolveSimulatedCredentialFieldRequest): SimulatedCredentialField {
  for (const field of form) {
    if (field.field_identity.value === field_identity.value) return field
  }
  throw new SimulatedLoginJourneyValidationError(
    SimulatedLoginJourneyValidationFailure.UnknownStepFieldReference,
  )
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

type PlanCredentialFillStepRequest = {
  readonly step: CredentialFillJourneyStep
  readonly form: SimulatedCredentialForm
}

function planCredentialFillStep({
  step,
  form,
}: PlanCredentialFillStepRequest): CredentialFillPlanning {
  const observations = new CredentialFillObservations()
  try {
    for (const field_identity of step.observed_field_identities) {
      const request: ResolveSimulatedCredentialFieldRequest = {
        field_identity,
        form,
      }
      const field = resolveSimulatedCredentialField(request)
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
        case CredentialFillPlanningOutcome.Rejected:
          return {
            kind: CredentialFillPlanningOutcome.Rejected,
            rejection: result.rejection(),
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

type ResolveCredentialValueRequest = {
  readonly credential: CredentialKind
  readonly credentials: FakeLoginCredentials
}

function resolveCredentialValue({
  credential,
  credentials,
}: ResolveCredentialValueRequest): string {
  switch (credential) {
    case CredentialKind.Username:
      return credentials.username
    case CredentialKind.CurrentPassword:
      return credentials.password
  }
  throw new Error(
    'credential fill plan contains an unsupported credential kind',
  )
}

type ResolvedCredentialAssignment = {
  readonly field: SimulatedCredentialField
  readonly value: string
}

type ResolveCredentialAssignmentRequest = {
  readonly assignment: CredentialFillAssignment
  readonly form: SimulatedCredentialForm
  readonly credentials: FakeLoginCredentials
  readonly resolvedFields: ReadonlySet<SimulatedCredentialField>
}

function resolveCredentialAssignment({
  assignment,
  form,
  credentials,
  resolvedFields,
}: ResolveCredentialAssignmentRequest): ResolvedCredentialAssignment {
  const assignedFieldIndex = assignment.field_index
  try {
    for (const field of form) {
      if (field.field_index.value === assignedFieldIndex.value) {
        if (resolvedFields.has(field)) {
          throw new Error('credential fill plan contains a duplicate target')
        }
        const valueRequest: ResolveCredentialValueRequest = {
          credential: assignment.credential,
          credentials,
        }
        return { field, value: resolveCredentialValue(valueRequest) }
      }
    }
    throw new Error('credential fill plan referenced an unknown fake field')
  } finally {
    assignedFieldIndex.free()
  }
}

type ApplyCredentialPlanRequest = {
  readonly plan: CredentialFillPlan
  readonly form: SimulatedCredentialForm
  readonly credentials: FakeLoginCredentials
}

function applyCredentialPlan({
  plan,
  form,
  credentials,
}: ApplyCredentialPlanRequest): void {
  const assignments = plan.take_assignments()
  const resolved: ResolvedCredentialAssignment[] = []
  const resolvedFields = new Set<SimulatedCredentialField>()
  try {
    for (const assignment of assignments) {
      const request: ResolveCredentialAssignmentRequest = {
        assignment,
        form,
        credentials,
        resolvedFields,
      }
      const resolvedAssignment = resolveCredentialAssignment(request)
      resolved.push(resolvedAssignment)
      resolvedFields.add(resolvedAssignment.field)
    }
    for (const assignment of resolved) assignment.field.value = assignment.value
  } finally {
    for (const assignment of assignments) assignment.free()
  }
}

function snapshotForm(
  form: SimulatedCredentialForm,
): SimulatedCredentialFormSnapshot {
  return form.map((field) => ({ name: field.name, value: field.value }))
}

export function simulateLoginJourney(
  request: CredentialFillJourneyRequest,
): CredentialFillJourneyOutcome[] {
  validateLoginJourney(request)
  const definitions = request.fields
  const form = materializeCredentialForm(definitions)
  const outcomes: CredentialFillJourneyOutcome[] = []
  try {
    for (const step of request.steps) {
      const planningRequest: PlanCredentialFillStepRequest = { step, form }
      const planning = planCredentialFillStep(planningRequest)
      switch (planning.kind) {
        case CredentialFillPlanningOutcome.Planned: {
          try {
            const applyRequest: ApplyCredentialPlanRequest = {
              plan: planning.plan,
              form,
              credentials: request.credentials,
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
          return outcomes
        }
      }
    }
    return outcomes
  } finally {
    for (const field of form) field.free()
  }
}
