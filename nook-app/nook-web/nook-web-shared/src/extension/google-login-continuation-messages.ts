/* eslint-disable @typescript-eslint/no-restricted-types -- The response codec immediately decodes the untrusted Chrome reply. */
import { Effect, Schema } from "effect";
import {
  GoogleLoginContinuationDecision,
  type GoogleLoginPageObservation,
  type GoogleLoginStartRequest,
} from "./nook-companion-wasm/nook_companion_wasm.js";

/** Chrome transport operations; eligibility remains in the generated provider. */
export enum GoogleLoginContinuationOperation {
  Begin = "begin",
  Inspect = "inspect",
  Admit = "admit",
  Cancel = "cancel",
}
export enum GoogleLoginContinuationMessageType {
  Session = "nook:extension-session-google-login-continuation",
}
export type GoogleLoginContinuationRequest =
  | {
      readonly operation: GoogleLoginContinuationOperation.Begin;
      readonly request: GoogleLoginStartRequest;
    }
  | {
      readonly operation: GoogleLoginContinuationOperation.Inspect;
      readonly request: GoogleLoginPageObservation;
    }
  | {
      readonly operation: GoogleLoginContinuationOperation.Admit;
      readonly request: GoogleLoginPageObservation;
    }
  | { readonly operation: GoogleLoginContinuationOperation.Cancel };

/** Browser identities are branded at the actual Chrome sender edge. */
export const GoogleLoginTabId = Schema.Number.pipe(
  Schema.brand("GoogleLoginTabId"),
);
export type GoogleLoginTabId = typeof GoogleLoginTabId.Type;
export const GoogleLoginFrameId = Schema.Number.pipe(
  Schema.brand("GoogleLoginFrameId"),
);
export type GoogleLoginFrameId = typeof GoogleLoginFrameId.Type;
export const GoogleLoginDocumentId = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.brand("GoogleLoginDocumentId"),
);
export type GoogleLoginDocumentId = typeof GoogleLoginDocumentId.Type;
export const GoogleLoginSourceOrigin = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.brand("GoogleLoginSourceOrigin"),
);
export type GoogleLoginSourceOrigin = typeof GoogleLoginSourceOrigin.Type;
export const GoogleLoginContextKey = Schema.String.pipe(
  Schema.brand("GoogleLoginContextKey"),
);
export type GoogleLoginContextKey = typeof GoogleLoginContextKey.Type;
type GoogleLoginBrowserContextFields = {
  readonly tabId: typeof GoogleLoginTabId;
  readonly frameId: typeof GoogleLoginFrameId;
  readonly documentId: typeof GoogleLoginDocumentId;
  readonly sourceOrigin: typeof GoogleLoginSourceOrigin;
};
const googleLoginBrowserContextFields: GoogleLoginBrowserContextFields = {
  tabId: GoogleLoginTabId,
  frameId: GoogleLoginFrameId,
  documentId: GoogleLoginDocumentId,
  sourceOrigin: GoogleLoginSourceOrigin,
};
export const GoogleLoginBrowserContextSchema = Schema.Struct(
  googleLoginBrowserContextFields,
);
export type GoogleLoginBrowserContext =
  typeof GoogleLoginBrowserContextSchema.Type;
export interface GoogleLoginBrowserMessage {
  readonly type: GoogleLoginContinuationMessageType.Session;
  readonly origin: string;
  readonly payload: GoogleLoginContinuationRequest;
}
export interface GoogleLoginSessionMessage extends GoogleLoginBrowserMessage {
  readonly browserContext: GoogleLoginBrowserContext;
}

export type GoogleLoginRuntimeResponse =
  | { readonly ok: true; readonly result: GoogleLoginContinuationDecision }
  | { readonly ok: false; readonly reason: string };
type GoogleLoginResponseFields = {
  readonly ok: Schema.Literal<true>;
  readonly result: ReturnType<
    typeof Schema.Enum<typeof GoogleLoginContinuationDecision>
  >;
};
const googleLoginResponseFields: GoogleLoginResponseFields = {
  ok: Schema.Literal(true),
  result: Schema.Enum(GoogleLoginContinuationDecision),
};
const googleLoginResponseSchema = Schema.Struct(googleLoginResponseFields);
/** The existing runtime transport owns delivery; this codec admits its policy value. */
export class GoogleLoginContinuationResponse {
  static decode(response: unknown) {
    return Schema.decodeUnknownEffect(googleLoginResponseSchema)(response).pipe(
      Effect.map((decoded) => decoded.result),
    );
  }
}
