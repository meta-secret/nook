import * as ParseResult from "effect/ParseResult";

export enum RuntimeMessageDecodeFailureKind {
  OpenCompanionLauncher = "open-companion-launcher",
  OpenSimpleVault = "open-simple-vault",
  BeginExtensionPairing = "begin-extension-pairing",
  ExtensionEventLogRecord = "extension-event-log-record",
  ExtensionLocalEventLogUpdated = "extension-local-event-log-updated",
  RuntimeMessageEnvelope = "runtime-message-envelope",
  ExtensionPairingApprovedGrant = "extension-pairing-approved-grant",
  ExtensionPairingStorageProvider = "extension-pairing-storage-provider",
  ExtensionPairingApprovedMessage = "extension-pairing-approved-message",
  ExtensionIdentityHandoffRequest = "extension-identity-handoff-request",
  ExtensionPairedVaultIdentityDiscovery = "extension-paired-vault-identity-discovery",
  ExtensionPairedVaultUnlockRequest = "extension-paired-vault-unlock-request",
  ExtensionPairedVaultIdentityHandoffRequest = "extension-paired-vault-identity-handoff-request",
}

export enum RuntimeMessageDecodeCauseKind {
  Parse = "parse",
  Error = "error",
  ThrownValue = "thrown-value",
}

export type RuntimeMessageDecodeCause =
  | {
      readonly kind: RuntimeMessageDecodeCauseKind.Parse;
      readonly error: ParseResult.ParseError;
    }
  | {
      readonly kind: RuntimeMessageDecodeCauseKind.Error;
      readonly error: Error;
    }
  | {
      readonly kind: RuntimeMessageDecodeCauseKind.ThrownValue;
      readonly detail: string;
    };

type RuntimeMessageDecodeFailureRequest<Cause> = {
  readonly kind: RuntimeMessageDecodeFailureKind;
  readonly cause: Cause;
};

export class RuntimeMessageDecodeFailure extends Error {
  readonly _tag = "RuntimeMessageDecodeFailure";

  private constructor(
    request: RuntimeMessageDecodeFailureRequest<RuntimeMessageDecodeCause>,
  ) {
    super(request.kind);
    this.kind = request.kind;
    this.cause = request.cause;
  }

  readonly kind: RuntimeMessageDecodeFailureKind;
  override readonly cause: RuntimeMessageDecodeCause;

  static fromParseError(
    request: RuntimeMessageDecodeFailureRequest<ParseResult.ParseError>,
  ): RuntimeMessageDecodeFailure {
    const parseCause: RuntimeMessageDecodeCause = {
      kind: RuntimeMessageDecodeCauseKind.Parse,
      error: request.cause,
    };
    const failureRequest: RuntimeMessageDecodeFailureRequest<RuntimeMessageDecodeCause> =
      {
        kind: request.kind,
        cause: parseCause,
      };
    return new RuntimeMessageDecodeFailure(failureRequest);
  }

  static fromCause<SourceCause>(
    request: RuntimeMessageDecodeFailureRequest<SourceCause>,
  ): RuntimeMessageDecodeFailure {
    const cause: RuntimeMessageDecodeCause =
      request.cause instanceof Error
        ? {
            kind: RuntimeMessageDecodeCauseKind.Error,
            error: request.cause,
          }
        : {
            kind: RuntimeMessageDecodeCauseKind.ThrownValue,
            detail: String(request.cause),
          };
    const failureRequest: RuntimeMessageDecodeFailureRequest<RuntimeMessageDecodeCause> =
      {
        kind: request.kind,
        cause,
      };
    return new RuntimeMessageDecodeFailure(failureRequest);
  }
}
