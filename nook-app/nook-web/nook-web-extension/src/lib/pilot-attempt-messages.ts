import { Schema } from 'effect'
import type {
  AuthenticationLoginChecklistActivity,
  AuthenticationLoginChecklistResult,
  AuthenticationLoginChecklistState,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

/** A Pilot sign-in attempt kept across the page reload that a submit often causes. */
export enum PilotAttemptMessageType {
  Save = 'nook:pilot-attempt-save',
  Load = 'nook:pilot-attempt-load',
  Clear = 'nook:pilot-attempt-clear',
}

/** Non-secret: the Rust checklist state plus when and where the submit happened. */
export type PilotAttempt = {
  readonly state: AuthenticationLoginChecklistState
  readonly authPath: string
  readonly startedAt: number
}

export type PilotAttemptMessage =
  | {
      readonly type: PilotAttemptMessageType.Save
      readonly attempt: PilotAttempt
    }
  | { readonly type: PilotAttemptMessageType.Load }
  | { readonly type: PilotAttemptMessageType.Clear }

export enum PilotAttemptLoadKind {
  Found = 'found',
  None = 'none',
}
export type PilotAttemptLoad =
  | {
      readonly kind: PilotAttemptLoadKind.Found
      readonly attempt: PilotAttempt
    }
  | { readonly kind: PilotAttemptLoadKind.None }

type ActivityStateFields = {
  kind: Schema.Codec<'Activity'>
  activity: Schema.Codec<AuthenticationLoginChecklistActivity>
}
type OutcomeStateFields = {
  kind: Schema.Codec<'Outcome'>
  result: Schema.Codec<AuthenticationLoginChecklistResult>
}
type AttemptFields = {
  state: Schema.Codec<AuthenticationLoginChecklistState>
  authPath: Schema.Codec<string>
  startedAt: Schema.Codec<number>
}
type SaveFields = {
  type: Schema.Codec<PilotAttemptMessageType.Save>
  attempt: Schema.Codec<PilotAttempt>
}
type TypeOnlyFields<Type extends PilotAttemptMessageType> = {
  type: Schema.Codec<Type>
}
type StoredFields = {
  origin: Schema.Codec<string>
  attempt: Schema.Codec<PilotAttempt>
}

const activityStateFields: ActivityStateFields = {
  kind: Schema.Literal('Activity'),
  activity: Schema.Literals([
    'Ready',
    'Filling',
    'Filled',
    'Submitting',
    'Submitted',
    'SubmissionRejected',
    'SubmissionUnobserved',
    'FillFailed',
    'TakenOver',
  ]),
}
const outcomeStateFields: OutcomeStateFields = {
  kind: Schema.Literal('Outcome'),
  result: Schema.Literals(['Waiting', 'Confirmed', 'Attention']),
}
const stateSchema = Schema.Union([
  Schema.Struct(activityStateFields),
  Schema.Struct(outcomeStateFields),
])

const attemptFields: AttemptFields = {
  state: stateSchema,
  authPath: Schema.String,
  startedAt: Schema.Number,
}
const attemptSchema = Schema.Struct(attemptFields)

const saveFields: SaveFields = {
  type: Schema.Literal(PilotAttemptMessageType.Save),
  attempt: attemptSchema,
}
const loadFields: TypeOnlyFields<PilotAttemptMessageType.Load> = {
  type: Schema.Literal(PilotAttemptMessageType.Load),
}
const clearFields: TypeOnlyFields<PilotAttemptMessageType.Clear> = {
  type: Schema.Literal(PilotAttemptMessageType.Clear),
}
const messageSchema = Schema.Union([
  Schema.Struct(saveFields),
  Schema.Struct(loadFields),
  Schema.Struct(clearFields),
])

/** What the service worker keeps per tab: the attempt and the origin it belongs to. */
const storedFields: StoredFields = {
  origin: Schema.String,
  attempt: attemptSchema,
}
const storedSchema = Schema.Struct(storedFields)

export const PilotAttemptCodec = {
  decodeMessage: Schema.decodeUnknownEffect(messageSchema),
  decodeStored: Schema.decodeUnknownOption(storedSchema),
}
