import type {
  PersonalFillOpportunity,
  PersonalFillPlan,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  CompanionWasmSessionMessageType,
  type CompanionWasmPersonalFillScope,
  type CompanionWasmRuntimeMessage,
} from '../../../../nook-web-shared/src/extension/companion-wasm-runtime-messages'
import { passwordFieldDiscovery } from '../../../../nook-web-shared/src/extension/password-forms'
import { PageInputRendering } from '../../../../nook-web-shared/src/extension/authentication-input-surface'
import type { RetainedFocusedCredentialTarget } from './focused-credential-target'
import type { PersonalFillRevealedValues } from '../../lib/personal-fill-messages'

type PersonalFillScopeInputs = readonly HTMLInputElement[]

export enum PersonalFillScopeCurrentness {
  Current = 'current',
  Changed = 'changed',
}

export enum PersonalFillPlanKind {
  Unavailable = 'unavailable',
  Available = 'available',
}

/** The content script's reading of Rust's plan for this scope. */
export type PersonalFillPlanReading =
  | { readonly kind: PersonalFillPlanKind.Unavailable }
  | {
      readonly kind: PersonalFillPlanKind.Available
      readonly plan: PersonalFillPlan
    }

type PersonalFillScopeRequest = {
  readonly target: RetainedFocusedCredentialTarget
  readonly inputs: PersonalFillScopeInputs
}

type PersonalFillApplication = {
  readonly plan: PersonalFillPlan
  readonly values: PersonalFillRevealedValues
  readonly fill: (mutation: PersonalFillInputMutation) => void
}

type PersonalFillFieldWrite = {
  readonly position: number
  readonly value: string
  readonly fill: (mutation: PersonalFillInputMutation) => void
}

export type PersonalFillInputMutation = {
  readonly input: HTMLInputElement
  readonly value: string
}

/**
 * The focused field's form scope in document order. Positions are the indices
 * Rust plans with, so each planned field maps back to exactly one element.
 * The scope holds elements and raw attributes only, never a value.
 */
export class PersonalFillScope {
  private constructor(private readonly request: PersonalFillScopeRequest) {}

  /**
   * Observes the rendered inputs of the retained field's form, or the formless
   * rendered inputs of its document. Hidden and non-rendered inputs never enter
   * the scope, so a value the person cannot see is never planned or filled;
   * a hidden focused field leaves the scope without its focused field.
   */
  static observe(target: RetainedFocusedCredentialTarget): PersonalFillScope {
    const owner = target.input.form
    const inputs = Array.from(
      target.input.ownerDocument.querySelectorAll<HTMLInputElement>('input'),
    ).filter(
      (input) =>
        input.form === owner &&
        passwordFieldDiscovery.inputRendering(input) ===
          PageInputRendering.Rendered,
    )
    const request: PersonalFillScopeRequest = { target, inputs }
    return new PersonalFillScope(request)
  }

  get target(): RetainedFocusedCredentialTarget {
    return this.request.target
  }

  get classificationRequest(): CompanionWasmRuntimeMessage {
    return {
      type: CompanionWasmSessionMessageType.ClassifyPersonalField,
      origin: this.request.target.origin,
      payload: {
        observation: passwordFieldDiscovery.focusedFieldObservation(
          this.request.target.input,
        ),
      },
    }
  }

  get planRequest(): CompanionWasmRuntimeMessage {
    const payload: CompanionWasmPersonalFillScope = {
      fields: this.request.inputs.map((input) =>
        passwordFieldDiscovery.focusedFieldObservation(input),
      ),
      focusedIndex: this.request.inputs.indexOf(this.request.target.input),
    }
    return {
      type: CompanionWasmSessionMessageType.PlanPersonalFill,
      origin: this.request.target.origin,
      payload,
    }
  }

  /** Compares element identity and raw attributes with a fresh observation. */
  currentness(fresh: PersonalFillScope): PersonalFillScopeCurrentness {
    const sameInputs =
      fresh.request.inputs.length === this.request.inputs.length &&
      Array.from(fresh.request.inputs.keys()).every(
        (position) =>
          fresh.request.inputs.at(position) ===
          this.request.inputs.at(position),
      )
    switch (
      sameInputs &&
      fresh.request.target.input === this.request.target.input &&
      JSON.stringify(fresh.planRequest) === JSON.stringify(this.planRequest)
    ) {
      case true:
        return PersonalFillScopeCurrentness.Current
      case false:
        return PersonalFillScopeCurrentness.Changed
    }
  }

  static reading(
    opportunity: PersonalFillOpportunity,
  ): PersonalFillPlanReading {
    switch (true) {
      case 'Available' in opportunity:
        return {
          kind: PersonalFillPlanKind.Available,
          plan: opportunity.Available,
        }
      case true:
        return { kind: PersonalFillPlanKind.Unavailable }
    }
    return { kind: PersonalFillPlanKind.Unavailable }
  }

  /** Writes each revealed value into its planned element; kinds without a value stay untouched. */
  apply(application: PersonalFillApplication): void {
    for (const field of application.plan.fields) {
      const revealed = application.values.filter(
        (value) => value.kind === field.kind,
      )
      for (const value of revealed.slice(0, 1)) {
        const write: PersonalFillFieldWrite = {
          position: field.index.value,
          value: value.value,
          fill: application.fill,
        }
        this.write(write)
      }
    }
  }

  private write(write: PersonalFillFieldWrite): void {
    const input = this.request.inputs.at(write.position)
    switch (true) {
      case input instanceof HTMLInputElement: {
        const mutation: PersonalFillInputMutation = {
          input,
          value: write.value,
        }
        write.fill(mutation)
        return
      }
      case true:
        return
    }
  }
}
