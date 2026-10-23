import { Effect, Schema } from 'effect'
import type * as SchemaAST from 'effect/SchemaAST'
import type {
  BrowserRuntimeMessage,
  BrowserRuntimeMessageValue,
} from './browser-runtime-message'

/** Session-storage keys of stored Fill 2FA code requests; the panel watches
 * them change and asks the worker again. */
export const AUTHENTICATOR_PICKER_STORAGE_PREFIX =
  'nook.extension.authenticator-picker.'

/**
 * The side panel asks whether a page in its window wants a 2FA code: the
 * Nook Pilot's Fill 2FA code opens the panel, which then shows the picker
 * for that request. The panel names only its window; the worker checks the
 * sender and finds the request itself.
 */
export enum SidePanelAuthenticatorPickerMessageType {
  Pending = 'nook:side-panel-authenticator-picker',
}

export enum SidePanelAuthenticatorPickerKind {
  /** A page in this window asked for a 2FA code; the newest request. */
  Pending = 'pending',
  /** No page in this window is waiting for a 2FA code. */
  None = 'none',
  /** The sender is not the side panel. */
  Forbidden = 'forbidden',
}

export type SidePanelAuthenticatorPickerMessage = {
  readonly type: SidePanelAuthenticatorPickerMessageType.Pending
  readonly payload: { readonly windowId: number }
}

export type SidePanelAuthenticatorPicker =
  | {
      readonly kind: SidePanelAuthenticatorPickerKind.Pending
      readonly requestId: string
    }
  | {
      readonly kind:
        | SidePanelAuthenticatorPickerKind.None
        | SidePanelAuthenticatorPickerKind.Forbidden
    }

type WindowSelectionFields = { readonly windowId: Schema.Codec<number> }
type MessageFields = {
  readonly type: Schema.Codec<SidePanelAuthenticatorPickerMessageType.Pending>
  readonly payload: Schema.Codec<SidePanelAuthenticatorPickerMessage['payload']>
}
type TypeFields = {
  readonly type: Schema.Codec<SidePanelAuthenticatorPickerMessageType.Pending>
}
type PendingFields = {
  readonly kind: Schema.Codec<SidePanelAuthenticatorPickerKind.Pending>
  readonly requestId: Schema.Codec<string>
}
type AbsentFields = {
  readonly kind: Schema.Codec<
    | SidePanelAuthenticatorPickerKind.None
    | SidePanelAuthenticatorPickerKind.Forbidden
  >
}

/** Strict wire codecs for the panel's request and the worker's answer. */
export class SidePanelAuthenticatorPickerMessages {
  private constructor() {}

  private static readonly REQUEST_ID_MAX_LENGTH = 256

  private static readonly strict: SchemaAST.ParseOptions = {
    onExcessProperty: 'error',
  }
  private static readonly windowSelectionFields: WindowSelectionFields = {
    windowId: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  }
  private static readonly messageFields: MessageFields = {
    type: Schema.Literal(SidePanelAuthenticatorPickerMessageType.Pending),
    payload: Schema.Struct(
      SidePanelAuthenticatorPickerMessages.windowSelectionFields,
    ),
  }
  private static readonly typeFields: TypeFields = {
    type: Schema.Literal(SidePanelAuthenticatorPickerMessageType.Pending),
  }
  private static readonly pendingFields: PendingFields = {
    kind: Schema.Literal(SidePanelAuthenticatorPickerKind.Pending),
    requestId: Schema.String.check(
      Schema.isBetweenLength(
        1,
        SidePanelAuthenticatorPickerMessages.REQUEST_ID_MAX_LENGTH,
      ),
    ),
  }
  private static readonly absentFields: AbsentFields = {
    kind: Schema.Literals([
      SidePanelAuthenticatorPickerKind.None,
      SidePanelAuthenticatorPickerKind.Forbidden,
    ]),
  }
  private static readonly answer: Schema.Codec<SidePanelAuthenticatorPicker> =
    Schema.Union([
      Schema.Struct(SidePanelAuthenticatorPickerMessages.pendingFields),
      Schema.Struct(SidePanelAuthenticatorPickerMessages.absentFields),
    ])

  /** Matches the request by type only; the lookup decodes it strictly. */
  static matches(message: BrowserRuntimeMessage) {
    return Schema.decodeUnknownEffect(
      Schema.Struct(SidePanelAuthenticatorPickerMessages.typeFields),
    )(message).pipe(Effect.as(message))
  }

  static decodeMessage(message: BrowserRuntimeMessage) {
    return Schema.decodeUnknownEffect(
      Schema.Struct(SidePanelAuthenticatorPickerMessages.messageFields),
      SidePanelAuthenticatorPickerMessages.strict,
    )(message)
  }

  static decodeAnswer(response: BrowserRuntimeMessageValue) {
    return Schema.decodeUnknownEffect(
      SidePanelAuthenticatorPickerMessages.answer,
      SidePanelAuthenticatorPickerMessages.strict,
    )(response)
  }
}

type SessionStorageChanges = Record<string, chrome.storage.StorageChange>

/** The stored Fill 2FA code requests, as the side panel follows them. */
export class AuthenticatorPickerRequests {
  private constructor() {}

  /** Calls `onchange` whenever a request is stored, used or dropped. */
  static follow(onchange: () => void): () => void {
    const listener = (changes: SessionStorageChanges): void => {
      if (
        Object.keys(changes).some((key) =>
          key.startsWith(AUTHENTICATOR_PICKER_STORAGE_PREFIX),
        )
      )
        onchange()
    }
    chrome.storage.session.onChanged.addListener(listener)
    return () => chrome.storage.session.onChanged.removeListener(listener)
  }
}
