enum ExtensionConnectionParameter {
  DeviceId = 'device_id',
  DevicePublicKey = 'device_public_key',
  DeviceSigningPublicKey = 'device_signing_public_key',
  HandoffNonce = 'nonce',
}
export enum ExtensionConnectionParametersParseKind {
  Valid = 'valid',
  Invalid = 'invalid',
}
type ExtensionConnectionParametersParseResult =
  | {
      kind: ExtensionConnectionParametersParseKind.Valid
      deviceId: string
      devicePublicKey: string
      deviceSigningPublicKey: string
      handoffNonce: string
    }
  | {
      kind: ExtensionConnectionParametersParseKind.Invalid
      missingParameter: ExtensionConnectionParameter
    }

export function parseExtensionConnectionParameters(
  connectionUrl: URL,
): ExtensionConnectionParametersParseResult {
  const deviceId = connectionUrl.searchParams.get(
    ExtensionConnectionParameter.DeviceId,
  )
  if (typeof deviceId !== 'string' || deviceId.trim().length === 0) {
    return {
      kind: ExtensionConnectionParametersParseKind.Invalid,
      missingParameter: ExtensionConnectionParameter.DeviceId,
    }
  }
  const devicePublicKey = connectionUrl.searchParams.get(
    ExtensionConnectionParameter.DevicePublicKey,
  )
  if (
    typeof devicePublicKey !== 'string' ||
    devicePublicKey.trim().length === 0
  ) {
    return {
      kind: ExtensionConnectionParametersParseKind.Invalid,
      missingParameter: ExtensionConnectionParameter.DevicePublicKey,
    }
  }
  const deviceSigningPublicKey = connectionUrl.searchParams.get(
    ExtensionConnectionParameter.DeviceSigningPublicKey,
  )
  if (
    typeof deviceSigningPublicKey !== 'string' ||
    deviceSigningPublicKey.trim().length === 0
  ) {
    return {
      kind: ExtensionConnectionParametersParseKind.Invalid,
      missingParameter: ExtensionConnectionParameter.DeviceSigningPublicKey,
    }
  }
  const handoffNonce = connectionUrl.searchParams.get(
    ExtensionConnectionParameter.HandoffNonce,
  )
  if (typeof handoffNonce !== 'string' || handoffNonce.trim().length === 0) {
    return {
      kind: ExtensionConnectionParametersParseKind.Invalid,
      missingParameter: ExtensionConnectionParameter.HandoffNonce,
    }
  }
  return {
    kind: ExtensionConnectionParametersParseKind.Valid,
    deviceId,
    devicePublicKey,
    deviceSigningPublicKey,
    handoffNonce,
  }
}
