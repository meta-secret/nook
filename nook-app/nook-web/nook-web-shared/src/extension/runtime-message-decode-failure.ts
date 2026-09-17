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

type RuntimeMessageDecodeFailureRequest = {
  readonly kind: RuntimeMessageDecodeFailureKind;
  readonly cause: unknown;
};

export class RuntimeMessageDecodeFailure extends Error {
  readonly _tag = "RuntimeMessageDecodeFailure";

  private constructor(request: RuntimeMessageDecodeFailureRequest) {
    super(request.kind);
    this.kind = request.kind;
    this.cause = request.cause;
  }

  readonly kind: RuntimeMessageDecodeFailureKind;
  readonly cause: unknown;

  static fromParseError(
    request: RuntimeMessageDecodeFailureRequest & {
      readonly cause: ParseResult.ParseError;
    },
  ): RuntimeMessageDecodeFailure {
    return new RuntimeMessageDecodeFailure(request);
  }

  static fromCause(
    request: RuntimeMessageDecodeFailureRequest,
  ): RuntimeMessageDecodeFailure {
    return new RuntimeMessageDecodeFailure(request);
  }
}
