import { ExtensionPairingApprovedMessageAdmissionFailure } from "$web-shared/extension/runtime-messages";

export enum ExtensionPairingDeliveryKind {
  Delivered = "delivered",
  MessagingUnavailable = "messaging-unavailable",
  PlaintextProviderMigrationRequired = "plaintext-provider-migration-required",
  Rejected = "rejected",
}

export enum ExtensionPairingRejectionReason {
  AuthenticationSurfaceRefreshFailed = "authentication-surface-refresh-failed",
  EventLogAccessNotGranted = "event-log-access-not-granted",
  EventLogImportFailed = "event-log-import-failed",
  ExtensionSessionDocumentClosed = "extension-session-document-closed",
  ExtensionSessionDocumentClosureFailed = "extension-session-document-closure-failed",
  ExtensionSessionDocumentCreationFailed = "extension-session-document-creation-failed",
  ExtensionSessionDocumentObservationFailed = "extension-session-document-observation-failed",
  ExtensionSessionDeliveryFailed = "extension-session-delivery-failed",
  ExtensionRuntimeUnavailable = "extension-runtime-unavailable",
  ExtensionVaultImportFailed = "extension-vault-import-failed",
  ForbiddenSender = "forbidden-sender",
  InvalidPairingGrant = "invalid-pairing-grant",
  InvalidPairingGrantApprovedAt = ExtensionPairingApprovedMessageAdmissionFailure.ApprovedAt,
  InvalidPairingGrantDeviceId = ExtensionPairingApprovedMessageAdmissionFailure.DeviceId,
  InvalidPairingGrantDeviceLabel = ExtensionPairingApprovedMessageAdmissionFailure.DeviceLabel,
  InvalidPairingGrantDevicePublicKey = ExtensionPairingApprovedMessageAdmissionFailure.DevicePublicKey,
  InvalidPairingGrantDeviceSigningPublicKey = ExtensionPairingApprovedMessageAdmissionFailure.DeviceSigningPublicKey,
  InvalidPairingGrantEventLogRecordEvent = ExtensionPairingApprovedMessageAdmissionFailure.EventLogRecordEvent,
  InvalidPairingGrantEventLogRecordEventId = ExtensionPairingApprovedMessageAdmissionFailure.EventLogRecordEventId,
  InvalidPairingGrantEventLogRecordPath = ExtensionPairingApprovedMessageAdmissionFailure.EventLogRecordPath,
  InvalidPairingGrantEventLogRecordSchemaVersion = ExtensionPairingApprovedMessageAdmissionFailure.EventLogRecordSchemaVersion,
  InvalidPairingGrantEventLogRecordsEmpty = ExtensionPairingApprovedMessageAdmissionFailure.EventLogRecordsEmpty,
  InvalidPairingGrantEventLogRecordsNotArray = ExtensionPairingApprovedMessageAdmissionFailure.EventLogRecordsNotArray,
  InvalidPairingGrantMessageEnvelope = ExtensionPairingApprovedMessageAdmissionFailure.MessageEnvelope,
  InvalidPairingGrantPayload = ExtensionPairingApprovedMessageAdmissionFailure.Payload,
  InvalidPairingGrantProviders = ExtensionPairingApprovedMessageAdmissionFailure.Providers,
  InvalidPairingGrantScopes = ExtensionPairingApprovedMessageAdmissionFailure.Scopes,
  InvalidPairingGrantVaultName = ExtensionPairingApprovedMessageAdmissionFailure.VaultName,
  InvalidPairingGrantVaultStoreId = ExtensionPairingApprovedMessageAdmissionFailure.VaultStoreId,
  InvalidPairingGrantVaultType = ExtensionPairingApprovedMessageAdmissionFailure.VaultType,
  InvalidProviderPayload = "invalid-provider-payload",
  PairingGrantAdmissionFailed = "pairing-grant-admission-failed",
}

export type ExtensionPairingDeliveryWithoutRejection = {
  readonly kind: Exclude<
    ExtensionPairingDeliveryKind,
    ExtensionPairingDeliveryKind.Rejected
  >;
};

export type ExtensionPairingDeliveryRejectedWithoutReason = {
  readonly kind: ExtensionPairingDeliveryKind.Rejected;
};

export type ExtensionPairingDeliveryRejectedWithReason = {
  readonly kind: ExtensionPairingDeliveryKind.Rejected;
  readonly reason: ExtensionPairingRejectionReason;
};

export type ExtensionPairingDelivery =
  | ExtensionPairingDeliveryWithoutRejection
  | ExtensionPairingDeliveryRejectedWithoutReason
  | ExtensionPairingDeliveryRejectedWithReason;
