import { DeviceProtectionStatus } from "$app-wasm";

/** Which reset of this browser's device identity a locked surface offers. */
export enum DeviceRecoveryKind {
  None = "none",
  /** The passkey that protects this browser's key is not usable. */
  Passkey = "passkey",
  /** The PIN that protects this browser's key is forgotten. */
  Pin = "pin",
  /** This browser's protected key cannot be read at all. */
  Unavailable = "unavailable",
}

export type DeviceRecoveryRequest = {
  readonly status: DeviceProtectionStatus;
  /** The last unlock of this browser's key did not finish. */
  readonly unlockFailed: boolean;
};

/**
 * Recovery is offered where unlocking happens: after a passkey or PIN unlock
 * fails, or at once when the key cannot be read, since unlocking cannot work.
 */
export class DeviceRecoveryOffer {
  constructor(private readonly request: DeviceRecoveryRequest) {}

  get kind(): DeviceRecoveryKind {
    const { status, unlockFailed } = this.request;
    switch (status) {
      case DeviceProtectionStatus.Error:
        return DeviceRecoveryKind.Unavailable;
      case DeviceProtectionStatus.Passkey:
        return unlockFailed
          ? DeviceRecoveryKind.Passkey
          : DeviceRecoveryKind.None;
      case DeviceProtectionStatus.Pin:
        return unlockFailed ? DeviceRecoveryKind.Pin : DeviceRecoveryKind.None;
      case DeviceProtectionStatus.Loading:
      case DeviceProtectionStatus.Missing:
      case DeviceProtectionStatus.Plaintext:
      case DeviceProtectionStatus.PinSetup:
      case DeviceProtectionStatus.Unlocked:
        return DeviceRecoveryKind.None;
    }
  }
}
