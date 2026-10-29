import { Effect, Schema } from "effect";
import type * as SchemaAST from "effect/SchemaAST";
import {
  RuntimeMessageDecodeFailure,
  RuntimeMessageDecodeFailureKind,
} from "./runtime-message-decode-failure";

/**
 * Where the person is on Nook's connect page, as the page tells the side
 * panel over its long-lived runtime port. A step is UI progress only: it
 * carries no identity data and grants nothing. The grant and event-log
 * import keep their own Rust/WASM validation.
 */
export enum ExtensionConnectStepKind {
  /** The connect page loaded and opened the port. */
  Opened = "opened",
  /** This browser holds a vault: the person unlocks the identity to connect. */
  Unlock = "unlock",
  /** This browser holds no vault: the person creates a first vault or joins. */
  Choosing = "choosing",
  /** The page is setting up the vault the person chose. */
  Creating = "creating",
  /** The page shows the extension's consent. */
  Consent = "consent",
  /** The extension accepted the grant and event log. */
  Approved = "approved",
  /** The page could not finish this connection. */
  Failed = "failed",
}

/** Whether a side panel follows a connect. The extension page that started
 * it named it with a fresh random id, and the connect page opens its port
 * under that name. The id only matches the port to that panel and grants
 * nothing. */
export enum ExtensionConnectFollowKind {
  /** The connect URL carries the starting page's connect id. */
  Named = "named",
  /** The connect URL carries no connect id: the page opens no port. */
  Unnamed = "unnamed",
}

export type ExtensionConnectFollow =
  | {
      readonly kind: ExtensionConnectFollowKind.Named;
      readonly connectId: string;
    }
  | { readonly kind: ExtensionConnectFollowKind.Unnamed };

/** Why the page could not finish connecting this browser. */
export enum ExtensionConnectFailureReason {
  /** The vault did not authorize the extension device. */
  Authorization = "authorization",
  /** The page could not prepare or confirm the extension's grant. */
  Grant = "grant",
  /** The extension did not take the grant. */
  Delivery = "delivery",
}

export type ExtensionConnectStep =
  | { readonly kind: ExtensionConnectStepKind.Opened }
  | { readonly kind: ExtensionConnectStepKind.Unlock }
  | { readonly kind: ExtensionConnectStepKind.Choosing }
  | { readonly kind: ExtensionConnectStepKind.Creating }
  | { readonly kind: ExtensionConnectStepKind.Consent }
  | { readonly kind: ExtensionConnectStepKind.Approved }
  | {
      readonly kind: ExtensionConnectStepKind.Failed;
      readonly reason: ExtensionConnectFailureReason;
    };

type ExtensionConnectProgressStepKind = Exclude<
  ExtensionConnectStepKind,
  ExtensionConnectStepKind.Failed
>;
type ExtensionConnectProgressStepKinds = Readonly<
  Record<ExtensionConnectProgressStepKind, ExtensionConnectProgressStepKind>
>;
type ExtensionConnectProgressStepFields = {
  readonly kind: Schema.Codec<ExtensionConnectProgressStepKind>;
};
type ExtensionConnectFailedStepFields = {
  readonly kind: Schema.Codec<ExtensionConnectStepKind.Failed>;
  readonly reason: Schema.Codec<ExtensionConnectFailureReason>;
};

/** The strict wire codec of the page's step messages. */
export class ExtensionConnectSteps {
  private constructor() {}

  private static readonly strict: SchemaAST.ParseOptions = {
    onExcessProperty: "error",
  };
  // Keyed by every step without a payload, so a new step cannot be left
  // undecodable.
  private static readonly progressKinds: ExtensionConnectProgressStepKinds = {
    [ExtensionConnectStepKind.Opened]: ExtensionConnectStepKind.Opened,
    [ExtensionConnectStepKind.Unlock]: ExtensionConnectStepKind.Unlock,
    [ExtensionConnectStepKind.Choosing]: ExtensionConnectStepKind.Choosing,
    [ExtensionConnectStepKind.Creating]: ExtensionConnectStepKind.Creating,
    [ExtensionConnectStepKind.Consent]: ExtensionConnectStepKind.Consent,
    [ExtensionConnectStepKind.Approved]: ExtensionConnectStepKind.Approved,
  };
  private static readonly progressFields: ExtensionConnectProgressStepFields = {
    kind: Schema.Literals(Object.values(ExtensionConnectSteps.progressKinds)),
  };
  private static readonly failedFields: ExtensionConnectFailedStepFields = {
    kind: Schema.Literal(ExtensionConnectStepKind.Failed),
    reason: Schema.Enum(ExtensionConnectFailureReason),
  };
  private static readonly step: Schema.Codec<ExtensionConnectStep> =
    Schema.Union([
      Schema.Struct(ExtensionConnectSteps.progressFields),
      Schema.Struct(ExtensionConnectSteps.failedFields),
    ]);

  /** Decodes one port message; anything else is a protocol failure. */
  static decode<WireMessage>(
    message: WireMessage,
  ): Effect.Effect<ExtensionConnectStep, RuntimeMessageDecodeFailure> {
    return Schema.decodeUnknownEffect(
      ExtensionConnectSteps.step,
      ExtensionConnectSteps.strict,
    )(message).pipe(
      Effect.mapError((cause) => {
        const failureRequest: Parameters<
          typeof RuntimeMessageDecodeFailure.fromParseError
        >[0] = {
          kind: RuntimeMessageDecodeFailureKind.ExtensionConnectStep,
          cause,
        };
        return RuntimeMessageDecodeFailure.fromParseError(failureRequest);
      }),
    );
  }
}
