import { Schema } from 'effect'
import type * as SchemaAST from 'effect/SchemaAST'

/**
 * Personal-data fill wire between the content script, the service worker and
 * the extension-origin personal picker document. Record titles stay inside the
 * picker document; the page receives only the selection's request identity and,
 * after it asks, the planned values. Rust decodes the group and kinds again at
 * the offscreen session boundary.
 */
export enum PersonalFillMessageType {
  /** Content script asks for a picker of one record group. */
  Open = 'nook:personal-fill-picker-open',
  /** Picker document lists its request's records. */
  Query = 'nook:personal-fill-picker-query',
  /** Picker document reports the chosen record. */
  Select = 'nook:personal-fill-picker-select',
  /** Picker document or content script ends the request. */
  Cancel = 'nook:personal-fill-picker-cancel',
  /** Content script asks for the selected record's planned values. */
  Reveal = 'nook:personal-fill-reveal',
  /** Service worker tells the requesting page that a record was chosen. */
  Selected = 'nook:personal-fill-selected',
  /** Service worker tells the requesting page that the picker ended. */
  Canceled = 'nook:personal-fill-canceled',
}

export enum PersonalFillOpenResponseKind {
  Ready = 'ready',
  Locked = 'locked',
  Unavailable = 'unavailable',
  Failed = 'failed',
}

export enum PersonalFillQueryResponseKind {
  Ready = 'ready',
  Failed = 'failed',
}

export enum PersonalFillSelectResponseKind {
  Selected = 'selected',
  Failed = 'failed',
}

export enum PersonalFillCancelResponseKind {
  Canceled = 'canceled',
  Forbidden = 'forbidden',
}

export enum PersonalFillRevealResponseKind {
  Revealed = 'revealed',
  Locked = 'locked',
  Failed = 'failed',
}

export enum PersonalFillPageResponseKind {
  Acknowledged = 'acknowledged',
  Ignored = 'ignored',
}

export type PersonalFillOpenPayload = {
  readonly origin: string
  /** Rust's `PersonalFieldGroup` name from the content script's plan. */
  readonly group: string
}

export type PersonalFillOpenMessage = {
  readonly type: PersonalFillMessageType.Open
  readonly payload: PersonalFillOpenPayload
}

export type PersonalFillOpenResponse =
  | {
      readonly kind: PersonalFillOpenResponseKind.Ready
      readonly requestId: string
      readonly expiresAt: number
    }
  | { readonly kind: PersonalFillOpenResponseKind.Locked }
  | { readonly kind: PersonalFillOpenResponseKind.Unavailable }
  | { readonly kind: PersonalFillOpenResponseKind.Failed }

export type PersonalFillQueryPayload = {
  readonly requestId: string
  readonly parentOrigin: string
}

export type PersonalFillQueryMessage = {
  readonly type: PersonalFillMessageType.Query
  readonly payload: PersonalFillQueryPayload
}

/** Non-secret list metadata Rust projected for one record. */
export type PersonalFillRecordOption = {
  readonly vaultStoreId: string
  readonly secretId: string
  readonly title: string
  readonly summary: string
}

export type PersonalFillRecordOptions = readonly PersonalFillRecordOption[]

export type PersonalFillQueryResponse =
  | {
      readonly kind: PersonalFillQueryResponseKind.Ready
      readonly records: PersonalFillRecordOptions
    }
  | { readonly kind: PersonalFillQueryResponseKind.Failed }

export type PersonalFillSelectPayload = {
  readonly requestId: string
  readonly vaultStoreId: string
  readonly secretId: string
}

export type PersonalFillSelectMessage = {
  readonly type: PersonalFillMessageType.Select
  readonly payload: PersonalFillSelectPayload
}

export type PersonalFillSelectResponse = {
  readonly kind: PersonalFillSelectResponseKind
}

export type PersonalFillRequestPayload = {
  readonly requestId: string
}

export type PersonalFillCancelMessage = {
  readonly type: PersonalFillMessageType.Cancel
  readonly payload: PersonalFillRequestPayload
}

export type PersonalFillCancelResponse = {
  readonly kind: PersonalFillCancelResponseKind
}

export type PersonalFillKindNames = string[]

export type PersonalFillRevealPayload = {
  readonly origin: string
  readonly requestId: string
  /** Rust's `PersonalFieldKind` names from the content script's plan. */
  readonly kinds: PersonalFillKindNames
}

export type PersonalFillRevealMessage = {
  readonly type: PersonalFillMessageType.Reveal
  readonly payload: PersonalFillRevealPayload
}

/** One planned value. It lives only for the fill that requested it. */
export type PersonalFillRevealedValue = {
  readonly kind: string
  value: string
}

export type PersonalFillRevealedValues = PersonalFillRevealedValue[]

export type PersonalFillRevealResponse =
  | {
      readonly kind: PersonalFillRevealResponseKind.Revealed
      readonly values: PersonalFillRevealedValues
    }
  | { readonly kind: PersonalFillRevealResponseKind.Locked }
  | { readonly kind: PersonalFillRevealResponseKind.Failed }

export type PersonalFillPagePayload = {
  readonly origin: string
  readonly requestId: string
}

export type PersonalFillSelectedMessage = {
  readonly type: PersonalFillMessageType.Selected
  readonly payload: PersonalFillPagePayload
}

export type PersonalFillCanceledMessage = {
  readonly type: PersonalFillMessageType.Canceled
  readonly payload: PersonalFillPagePayload
}

export type PersonalFillPageMessage =
  PersonalFillSelectedMessage | PersonalFillCanceledMessage

export type PersonalFillPageResponse = {
  readonly kind: PersonalFillPageResponseKind
}

type TextSchema = Schema.Codec<string>

/** Strict codecs for every personal-fill message and reply. */
export class PersonalFillMessages {
  private constructor() {}

  static readonly TEXT_MAX_LENGTH = 2048
  static readonly MAX_KINDS = 64
  static readonly MAX_RECORDS = 200

  private static readonly strict: SchemaAST.ParseOptions = {
    onExcessProperty: 'error',
  }
  private static readonly text: TextSchema = Schema.String.check(
    Schema.isBetweenLength(1, PersonalFillMessages.TEXT_MAX_LENGTH),
  )
  private static readonly displayText: TextSchema = Schema.String.check(
    Schema.isMaxLength(PersonalFillMessages.TEXT_MAX_LENGTH),
  )
  private static readonly kindNames = Schema.mutable(
    Schema.Array(PersonalFillMessages.text).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(PersonalFillMessages.MAX_KINDS),
    ),
  )

  private static readonly openPayloadFields = {
    origin: PersonalFillMessages.text,
    group: PersonalFillMessages.text,
  } satisfies Schema.Struct.Fields
  private static readonly openFields = {
    type: Schema.Literal(PersonalFillMessageType.Open),
    payload: Schema.Struct(PersonalFillMessages.openPayloadFields),
  } satisfies Schema.Struct.Fields
  private static readonly queryPayloadFields = {
    requestId: PersonalFillMessages.text,
    parentOrigin: PersonalFillMessages.text,
  } satisfies Schema.Struct.Fields
  private static readonly queryFields = {
    type: Schema.Literal(PersonalFillMessageType.Query),
    payload: Schema.Struct(PersonalFillMessages.queryPayloadFields),
  } satisfies Schema.Struct.Fields
  private static readonly selectPayloadFields = {
    requestId: PersonalFillMessages.text,
    vaultStoreId: PersonalFillMessages.text,
    secretId: PersonalFillMessages.text,
  } satisfies Schema.Struct.Fields
  private static readonly selectFields = {
    type: Schema.Literal(PersonalFillMessageType.Select),
    payload: Schema.Struct(PersonalFillMessages.selectPayloadFields),
  } satisfies Schema.Struct.Fields
  private static readonly requestPayloadFields = {
    requestId: PersonalFillMessages.text,
  } satisfies Schema.Struct.Fields
  private static readonly cancelFields = {
    type: Schema.Literal(PersonalFillMessageType.Cancel),
    payload: Schema.Struct(PersonalFillMessages.requestPayloadFields),
  } satisfies Schema.Struct.Fields
  private static readonly revealPayloadFields = {
    origin: PersonalFillMessages.text,
    requestId: PersonalFillMessages.text,
    kinds: PersonalFillMessages.kindNames,
  } satisfies Schema.Struct.Fields
  private static readonly revealFields = {
    type: Schema.Literal(PersonalFillMessageType.Reveal),
    payload: Schema.Struct(PersonalFillMessages.revealPayloadFields),
  } satisfies Schema.Struct.Fields
  private static readonly pagePayloadFields = {
    origin: PersonalFillMessages.text,
    requestId: PersonalFillMessages.text,
  } satisfies Schema.Struct.Fields
  private static readonly selectedFields = {
    type: Schema.Literal(PersonalFillMessageType.Selected),
    payload: Schema.Struct(PersonalFillMessages.pagePayloadFields),
  } satisfies Schema.Struct.Fields
  private static readonly canceledFields = {
    type: Schema.Literal(PersonalFillMessageType.Canceled),
    payload: Schema.Struct(PersonalFillMessages.pagePayloadFields),
  } satisfies Schema.Struct.Fields
  private static readonly openReadyFields = {
    kind: Schema.Literal(PersonalFillOpenResponseKind.Ready),
    requestId: PersonalFillMessages.text,
    expiresAt: Schema.Number,
  } satisfies Schema.Struct.Fields
  private static readonly openLockedFields = {
    kind: Schema.Literal(PersonalFillOpenResponseKind.Locked),
  } satisfies Schema.Struct.Fields
  private static readonly openUnavailableFields = {
    kind: Schema.Literal(PersonalFillOpenResponseKind.Unavailable),
  } satisfies Schema.Struct.Fields
  private static readonly openFailedFields = {
    kind: Schema.Literal(PersonalFillOpenResponseKind.Failed),
  } satisfies Schema.Struct.Fields
  private static readonly recordFields = {
    vaultStoreId: PersonalFillMessages.text,
    secretId: PersonalFillMessages.text,
    title: PersonalFillMessages.displayText,
    summary: PersonalFillMessages.displayText,
  } satisfies Schema.Struct.Fields
  private static readonly queryReadyFields = {
    kind: Schema.Literal(PersonalFillQueryResponseKind.Ready),
    records: Schema.Array(
      Schema.Struct(PersonalFillMessages.recordFields),
    ).check(Schema.isMaxLength(PersonalFillMessages.MAX_RECORDS)),
  } satisfies Schema.Struct.Fields
  private static readonly queryFailedFields = {
    kind: Schema.Literal(PersonalFillQueryResponseKind.Failed),
  } satisfies Schema.Struct.Fields
  private static readonly selectResponseFields = {
    kind: Schema.Enum(PersonalFillSelectResponseKind),
  } satisfies Schema.Struct.Fields
  private static readonly revealedValueFields = {
    kind: PersonalFillMessages.text,
    value: Schema.mutableKey(Schema.String),
  } satisfies Schema.Struct.Fields
  private static readonly revealedFields = {
    kind: Schema.Literal(PersonalFillRevealResponseKind.Revealed),
    values: Schema.mutable(
      Schema.Array(
        Schema.Struct(PersonalFillMessages.revealedValueFields),
      ).check(Schema.isMaxLength(PersonalFillMessages.MAX_KINDS)),
    ),
  } satisfies Schema.Struct.Fields
  private static readonly revealLockedFields = {
    kind: Schema.Literal(PersonalFillRevealResponseKind.Locked),
  } satisfies Schema.Struct.Fields
  private static readonly revealFailedFields = {
    kind: Schema.Literal(PersonalFillRevealResponseKind.Failed),
  } satisfies Schema.Struct.Fields
  private static readonly pageResponseFields = {
    kind: Schema.Enum(PersonalFillPageResponseKind),
  } satisfies Schema.Struct.Fields

  private static readonly openMessage: Schema.Codec<PersonalFillOpenMessage> =
    Schema.Struct(PersonalFillMessages.openFields)
  private static readonly queryMessage: Schema.Codec<PersonalFillQueryMessage> =
    Schema.Struct(PersonalFillMessages.queryFields)
  private static readonly selectMessage: Schema.Codec<PersonalFillSelectMessage> =
    Schema.Struct(PersonalFillMessages.selectFields)
  private static readonly cancelMessage: Schema.Codec<PersonalFillCancelMessage> =
    Schema.Struct(PersonalFillMessages.cancelFields)
  private static readonly revealMessage: Schema.Codec<PersonalFillRevealMessage> =
    Schema.Struct(PersonalFillMessages.revealFields)
  private static readonly selectedMessage: Schema.Codec<PersonalFillSelectedMessage> =
    Schema.Struct(PersonalFillMessages.selectedFields)
  private static readonly canceledMessage: Schema.Codec<PersonalFillCanceledMessage> =
    Schema.Struct(PersonalFillMessages.canceledFields)
  private static readonly openResponse: Schema.Codec<PersonalFillOpenResponse> =
    Schema.Union([
      Schema.Struct(PersonalFillMessages.openReadyFields),
      Schema.Struct(PersonalFillMessages.openLockedFields),
      Schema.Struct(PersonalFillMessages.openUnavailableFields),
      Schema.Struct(PersonalFillMessages.openFailedFields),
    ])
  private static readonly queryResponse: Schema.Codec<PersonalFillQueryResponse> =
    Schema.Union([
      Schema.Struct(PersonalFillMessages.queryReadyFields),
      Schema.Struct(PersonalFillMessages.queryFailedFields),
    ])
  private static readonly selectResponse: Schema.Codec<PersonalFillSelectResponse> =
    Schema.Struct(PersonalFillMessages.selectResponseFields)
  private static readonly revealResponse: Schema.Codec<PersonalFillRevealResponse> =
    Schema.Union([
      Schema.Struct(PersonalFillMessages.revealedFields),
      Schema.Struct(PersonalFillMessages.revealLockedFields),
      Schema.Struct(PersonalFillMessages.revealFailedFields),
    ])
  private static readonly pageResponse: Schema.Codec<PersonalFillPageResponse> =
    Schema.Struct(PersonalFillMessages.pageResponseFields)

  static decodeOpen(message: unknown) {
    return Schema.decodeUnknownEffect(PersonalFillMessages.openMessage)(
      message,
      PersonalFillMessages.strict,
    )
  }
  static decodeQuery(message: unknown) {
    return Schema.decodeUnknownEffect(PersonalFillMessages.queryMessage)(
      message,
      PersonalFillMessages.strict,
    )
  }
  static decodeSelect(message: unknown) {
    return Schema.decodeUnknownEffect(PersonalFillMessages.selectMessage)(
      message,
      PersonalFillMessages.strict,
    )
  }
  static decodeCancel(message: unknown) {
    return Schema.decodeUnknownEffect(PersonalFillMessages.cancelMessage)(
      message,
      PersonalFillMessages.strict,
    )
  }
  static decodeReveal(message: unknown) {
    return Schema.decodeUnknownEffect(PersonalFillMessages.revealMessage)(
      message,
      PersonalFillMessages.strict,
    )
  }
  static decodeSelected(message: unknown) {
    return Schema.decodeUnknownResult(PersonalFillMessages.selectedMessage)(
      message,
      PersonalFillMessages.strict,
    )
  }
  static decodeCanceled(message: unknown) {
    return Schema.decodeUnknownResult(PersonalFillMessages.canceledMessage)(
      message,
      PersonalFillMessages.strict,
    )
  }
  static decodeOpenResponse(response: unknown) {
    return Schema.decodeUnknownEffect(PersonalFillMessages.openResponse)(
      response,
      PersonalFillMessages.strict,
    )
  }
  static decodeQueryResponse(response: unknown) {
    return Schema.decodeUnknownEffect(PersonalFillMessages.queryResponse)(
      response,
      PersonalFillMessages.strict,
    )
  }
  static decodeSelectResponse(response: unknown) {
    return Schema.decodeUnknownEffect(PersonalFillMessages.selectResponse)(
      response,
      PersonalFillMessages.strict,
    )
  }
  static decodeRevealResponse(response: unknown) {
    return Schema.decodeUnknownEffect(PersonalFillMessages.revealResponse)(
      response,
      PersonalFillMessages.strict,
    )
  }
  static decodePageResponse(response: unknown) {
    return Schema.decodeUnknownEffect(PersonalFillMessages.pageResponse)(
      response,
      PersonalFillMessages.strict,
    )
  }
}

export enum PersonalPickerFrameMessageType {
  Initialize = 'nook:personal-picker-initialize',
}

/** The request nonce crosses only the retained extension frame window. */
export type PersonalPickerInitialization = {
  readonly type: PersonalPickerFrameMessageType.Initialize
  readonly requestId: string
  readonly origin: string
}

/** Strict codec for the parent page's one initialization of the picker document. */
export class PersonalPickerInitializationCodec {
  private constructor() {}

  private static readonly text: TextSchema = Schema.String.check(
    Schema.isBetweenLength(1, PersonalFillMessages.TEXT_MAX_LENGTH),
  )
  private static readonly fields = {
    type: Schema.Literal(PersonalPickerFrameMessageType.Initialize),
    requestId: PersonalPickerInitializationCodec.text,
    origin: PersonalPickerInitializationCodec.text,
  } satisfies Schema.Struct.Fields
  private static readonly schema: Schema.Codec<PersonalPickerInitialization> =
    Schema.Struct(PersonalPickerInitializationCodec.fields)
  private static readonly strict: SchemaAST.ParseOptions = {
    onExcessProperty: 'error',
  }

  static decode(message: unknown) {
    return Schema.decodeUnknownResult(PersonalPickerInitializationCodec.schema)(
      message,
      PersonalPickerInitializationCodec.strict,
    )
  }
}
