import {
  NookPageInputFieldObservation,
  PersonalFillScopeObservations,
  classify_companion_personal_field,
  parse_page_input_type,
  plan_companion_personal_fill,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  CompanionWasmSessionMessageType,
  type CompanionWasmPageInputFieldObservation,
  type CompanionWasmPersonalFieldResponse,
  type CompanionWasmPersonalFillPlanResponse,
  type CompanionWasmPersonalFillScope,
  type CompanionWasmSessionMessage,
} from '../../../nook-web-shared/src/extension/companion-wasm-runtime-messages'

type PersonalFieldFillRequest = Extract<
  CompanionWasmSessionMessage,
  {
    type:
      | CompanionWasmSessionMessageType.ClassifyPersonalField
      | CompanionWasmSessionMessageType.PlanPersonalFill
  }
>
type PersonalFieldFillResponse =
  CompanionWasmPersonalFieldResponse | CompanionWasmPersonalFillPlanResponse
type ScopeFieldAddition = {
  readonly scope: PersonalFillScopeObservations
  readonly observation: CompanionWasmPageInputFieldObservation
  readonly position: number
  readonly focusedIndex: number
}
enum ScopeFieldRole {
  Focused = 'focused',
  Observed = 'observed',
}

/** Projects raw page observations onto Rust's personal-field classifier and fill planner. */
export class PersonalFieldFillOperation {
  constructor(private readonly request: PersonalFieldFillRequest) {}

  run(): PersonalFieldFillResponse {
    switch (this.request.type) {
      case CompanionWasmSessionMessageType.ClassifyPersonalField:
        return this.classify(this.request.payload.observation)
      case CompanionWasmSessionMessageType.PlanPersonalFill:
        return this.plan(this.request.payload)
    }
  }

  private field(
    observation: CompanionWasmPageInputFieldObservation,
  ): NookPageInputFieldObservation {
    return new NookPageInputFieldObservation(
      parse_page_input_type(observation.inputType),
      observation.disabled,
      observation.readOnly,
      [...observation.autocompleteTokens],
      observation.identityText,
      observation.loginContext,
      observation.secondFactorRoute,
      observation.inputMode,
      observation.maxLength,
      observation.pattern,
    )
  }

  private classify(
    observation: CompanionWasmPageInputFieldObservation,
  ): CompanionWasmPersonalFieldResponse {
    const field = this.field(observation)
    try {
      return {
        personalFieldClassification: classify_companion_personal_field(field),
      }
    } finally {
      field.free()
    }
  }

  private role(addition: ScopeFieldAddition): ScopeFieldRole {
    switch (addition.position === addition.focusedIndex) {
      case true:
        return ScopeFieldRole.Focused
      case false:
        return ScopeFieldRole.Observed
    }
  }

  private add(addition: ScopeFieldAddition): PersonalFillScopeObservations {
    const field = this.field(addition.observation)
    try {
      switch (this.role(addition)) {
        case ScopeFieldRole.Focused:
          return addition.scope.add_focused_field(field)
        case ScopeFieldRole.Observed:
          return addition.scope.add_field(field)
      }
    } finally {
      field.free()
    }
  }

  private plan(
    request: CompanionWasmPersonalFillScope,
  ): CompanionWasmPersonalFillPlanResponse {
    let scope = new PersonalFillScopeObservations()
    try {
      for (const [position, observation] of request.fields.entries()) {
        const addition: ScopeFieldAddition = {
          scope,
          observation,
          position,
          focusedIndex: request.focusedIndex,
        }
        scope = this.add(addition)
      }
      return { personalFillOpportunity: plan_companion_personal_fill(scope) }
    } finally {
      scope.free()
    }
  }
}
