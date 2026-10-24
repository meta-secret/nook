import { Schema } from 'effect'
import type * as SchemaAST from 'effect/SchemaAST'
import {
  decode_extension_session_request,
  type ExtensionSessionRequest as GeneratedExtensionSessionRequest,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { extensionSessionGrantIdentity } from '../pairing-grants'
import { ExtensionSessionMessageType } from '../../lib/extension-session-message-type'
import {
  PersonalFillRevealResponseKind,
  type PersonalFillRevealResponse,
  type PersonalFillRevealedValue,
} from '../../lib/personal-fill-messages'
import {
  MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
  type ExtensionSessionTransportRequest,
} from '../../offscreen/session-request-adapter'
import type { ExtensionSessionResponse } from '../../offscreen/session'
import type { ExtensionSessionTransportResult } from './session-document'
import {
  PersonalFillRecordListingKind,
  type PersonalFillGrantRecord,
  type PersonalFillRecordListing,
  type PersonalFillRecordListingRequest,
  type PersonalFillValueRevealRequest,
} from './personal-fill-pickers'

type PersonalFillSessionSender = (
  message: ExtensionSessionTransportRequest,
) => Promise<ExtensionSessionTransportResult<ExtensionSessionResponse>>

type PersonalFillSessionCandidate = {
  readonly type: string
  readonly payload: PersonalFillSessionCandidatePayload
}
type PersonalFillSessionCandidatePayload = Readonly<
  Record<
    string,
    string | readonly string[] | typeof MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE
  >
>

enum PersonalFillSessionAdmissionKind {
  Admitted = 'admitted',
  Rejected = 'rejected',
}
type PersonalFillSessionAdmission =
  | {
      readonly kind: PersonalFillSessionAdmissionKind.Admitted
      readonly request: ExtensionSessionTransportRequest
    }
  | { readonly kind: PersonalFillSessionAdmissionKind.Rejected }

/**
 * Builds the worker-only personal session requests and decodes their replies.
 * Rust admits each request, so the group and kinds pass the Rust vocabulary
 * before the offscreen session sees them.
 */
export class PersonalFillSessionAdapter {
  private static readonly strict: SchemaAST.ParseOptions = {
    onExcessProperty: 'error',
  }
  private static readonly recordFields = {
    secretId: Schema.String.check(Schema.isMinLength(1)),
    title: Schema.String,
    summary: Schema.String,
  } satisfies Schema.Struct.Fields
  private static readonly listingFields = {
    ok: Schema.Literal(true),
    records: Schema.Array(
      Schema.Struct(PersonalFillSessionAdapter.recordFields),
    ),
  } satisfies Schema.Struct.Fields
  private static readonly listing: Schema.Codec<{
    readonly ok: true
    readonly records: readonly PersonalFillGrantRecord[]
  }> = Schema.Struct(PersonalFillSessionAdapter.listingFields)
  private static readonly valueFields = {
    kind: Schema.String,
    value: Schema.mutableKey(Schema.String),
  } satisfies Schema.Struct.Fields
  private static readonly valuesFields = {
    ok: Schema.Literal(true),
    values: Schema.mutable(
      Schema.Array(Schema.Struct(PersonalFillSessionAdapter.valueFields)),
    ),
  } satisfies Schema.Struct.Fields
  private static readonly values: Schema.Codec<{
    readonly ok: true
    readonly values: PersonalFillRevealedValue[]
  }> = Schema.Struct(PersonalFillSessionAdapter.valuesFields)

  constructor(private readonly send: PersonalFillSessionSender) {}

  private admit(
    candidate: PersonalFillSessionCandidate,
  ): PersonalFillSessionAdmission {
    try {
      return this.personalRequest(decode_extension_session_request(candidate))
    } catch {
      return { kind: PersonalFillSessionAdmissionKind.Rejected }
    }
  }

  /** Admits only the two personal requests Rust decoded from the candidate. */
  private personalRequest(
    request: GeneratedExtensionSessionRequest,
  ): PersonalFillSessionAdmission {
    switch (true) {
      case request.type === ExtensionSessionMessageType.ListPersonalRecords:
        return { kind: PersonalFillSessionAdmissionKind.Admitted, request }
      case request.type === ExtensionSessionMessageType.RevealPersonalFill:
        return { kind: PersonalFillSessionAdmissionKind.Admitted, request }
      case true:
        return { kind: PersonalFillSessionAdmissionKind.Rejected }
    }
    return { kind: PersonalFillSessionAdmissionKind.Rejected }
  }

  async listRecords(
    request: PersonalFillRecordListingRequest,
  ): Promise<PersonalFillRecordListing> {
    const failed: PersonalFillRecordListing = {
      kind: PersonalFillRecordListingKind.Failed,
    }
    const candidate: PersonalFillSessionCandidate = {
      type: ExtensionSessionMessageType.ListPersonalRecords,
      payload: {
        ...extensionSessionGrantIdentity(request.grant),
        group: request.group,
        queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
      },
    }
    const admission = this.admit(candidate)
    switch (admission.kind) {
      case PersonalFillSessionAdmissionKind.Rejected:
        return failed
      case PersonalFillSessionAdmissionKind.Admitted:
        break
    }
    const delivery = await this.send(admission.request)
    return delivery.match(
      (response) => this.listing(response),
      () => failed,
    )
  }

  private listing(
    response: ExtensionSessionResponse,
  ): PersonalFillRecordListing {
    const decoded = Schema.decodeUnknownResult(
      PersonalFillSessionAdapter.listing,
    )(response, PersonalFillSessionAdapter.strict)
    switch (decoded._tag) {
      case 'Failure':
        return { kind: PersonalFillRecordListingKind.Failed }
      case 'Success':
        return {
          kind: PersonalFillRecordListingKind.Listed,
          records: decoded.success.records,
        }
    }
  }

  async revealValues(
    request: PersonalFillValueRevealRequest,
  ): Promise<PersonalFillRevealResponse> {
    const failed: PersonalFillRevealResponse = {
      kind: PersonalFillRevealResponseKind.Failed,
    }
    const candidate: PersonalFillSessionCandidate = {
      type: ExtensionSessionMessageType.RevealPersonalFill,
      payload: {
        ...extensionSessionGrantIdentity(request.grant),
        secretId: request.secretId,
        group: request.group,
        kinds: request.kinds,
        queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
      },
    }
    const admission = this.admit(candidate)
    switch (admission.kind) {
      case PersonalFillSessionAdmissionKind.Rejected:
        return failed
      case PersonalFillSessionAdmissionKind.Admitted:
        break
    }
    const delivery = await this.send(admission.request)
    return delivery.match(
      (response) => this.revealed(response),
      () => failed,
    )
  }

  private revealed(
    response: ExtensionSessionResponse,
  ): PersonalFillRevealResponse {
    const decoded = Schema.decodeUnknownResult(
      PersonalFillSessionAdapter.values,
    )(response, PersonalFillSessionAdapter.strict)
    switch (decoded._tag) {
      case 'Failure':
        return { kind: PersonalFillRevealResponseKind.Failed }
      case 'Success':
        return {
          kind: PersonalFillRevealResponseKind.Revealed,
          values: decoded.success.values,
        }
    }
  }
}
