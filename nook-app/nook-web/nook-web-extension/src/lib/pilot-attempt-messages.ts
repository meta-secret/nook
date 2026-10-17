import { Schema } from 'effect'
import type { AuthenticationLoginChecklistState } from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

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

const stateSchema = Schema.Union([
  Schema.Struct({
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
  }),
  Schema.Struct({
    kind: Schema.Literal('Outcome'),
    result: Schema.Literals(['Waiting', 'Confirmed', 'Attention']),
  }),
])

const attemptSchema = Schema.Struct({
  state: stateSchema,
  authPath: Schema.String,
  startedAt: Schema.Number,
})

const messageSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal(PilotAttemptMessageType.Save),
    attempt: attemptSchema,
  }),
  Schema.Struct({ type: Schema.Literal(PilotAttemptMessageType.Load) }),
  Schema.Struct({ type: Schema.Literal(PilotAttemptMessageType.Clear) }),
])

/** What the service worker keeps per tab: the attempt and the origin it belongs to. */
const storedSchema = Schema.Struct({
  origin: Schema.String,
  attempt: attemptSchema,
})

export const PilotAttemptCodec = {
  decodeMessage: Schema.decodeUnknownEffect(messageSchema),
  decodeStored: Schema.decodeUnknownOption(storedSchema),
}
