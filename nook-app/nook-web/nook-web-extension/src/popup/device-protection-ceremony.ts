import {
  I18N_KEYS,
  type I18nKey,
} from '../../../nook-web-shared/src/generated/i18n-keys'
import { DeviceProtectionSetupWorkflow } from '../../../nook-web-shared/src/vault-app/lib/components/device-protection-gate-state'
import {
  DeviceProtectionStatus,
  type ExtensionSessionDeviceWire,
} from '../lib/nook-wasm'
import { DeviceActionFollowUp } from './popup-app-state'

/**
 * The extension's device-protection ceremony: set up its key with an
 * existing passkey (the default), a new passkey (explicit) or a PIN, and
 * unlock it again. The Nook tab and the side panel render this one
 * ceremony; each surface only frames it.
 */
export enum DeviceProtectionStage {
  /** No key yet: authenticate with an existing passkey or create one. */
  Setup = 'setup',
  /** Passkeys cannot protect this browser: a PIN or passphrase does. */
  PinSetup = 'pin-setup',
  PinUnlock = 'pin-unlock',
  PasskeyUnlock = 'passkey-unlock',
}

/** Which kind of key the stage sets up or unlocks. */
export enum DeviceProtectionKeyKind {
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Passkey = 'passkey',
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Pin = 'pin',
}

/** Whether the stage creates the key or opens an existing one. */
export enum DeviceProtectionPhase {
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Setup = 'setup',
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Unlock = 'unlock',
}

export enum DeviceProtectionPurposeKind {
  /** The key that unlocks this extension. */
  ExtensionKey = 'extension-key',
  /** A further key, for the next identity this extension connects. */
  IdentityKey = 'identity-key',
}

export enum IdentityKeyCancelOutcome {
  Cancelled = 'cancelled',
  Failed = 'failed',
}

export type IdentityKeyCancel = () => Promise<IdentityKeyCancelOutcome>

export type DeviceProtectionPurpose =
  | { readonly kind: DeviceProtectionPurposeKind.ExtensionKey }
  | {
      readonly kind: DeviceProtectionPurposeKind.IdentityKey
      /** Drop the identity staged for this key. */
      readonly cancel: IdentityKeyCancel
    }

/** A key that was just set up or unlocked, and what the host does next. */
export type DeviceProtectionUnlock = {
  readonly device: ExtensionSessionDeviceWire
  readonly followUp: DeviceActionFollowUp
}

export type DeviceProtectionCopyRequest = {
  readonly stage: DeviceProtectionStage
  readonly purpose: DeviceProtectionPurposeKind
  readonly workflow: DeviceProtectionSetupWorkflow
}

/** The stage the ceremony shows for the extension's protection status. */
export class DeviceProtectionStageMap {
  private constructor() {}

  static from(status: DeviceProtectionStatus): DeviceProtectionStage {
    switch (status) {
      case DeviceProtectionStatus.Missing:
      case DeviceProtectionStatus.Plaintext:
        return DeviceProtectionStage.Setup
      case DeviceProtectionStatus.PinSetup:
        return DeviceProtectionStage.PinSetup
      case DeviceProtectionStatus.Pin:
        return DeviceProtectionStage.PinUnlock
      // A status the ceremony cannot set up asks for the connected passkey,
      // as the Nook tab always did; the side panel shows its failure view
      // for those before the ceremony mounts.
      case DeviceProtectionStatus.Passkey:
      case DeviceProtectionStatus.Unlocked:
      case DeviceProtectionStatus.Loading:
      case DeviceProtectionStatus.Error:
      case DeviceProtectionStatus.Unknown:
        return DeviceProtectionStage.PasskeyUnlock
    }
  }

  static noticePlace(
    stage: DeviceProtectionStage,
  ): DeviceProtectionNoticePlace {
    switch (stage) {
      case DeviceProtectionStage.PinSetup:
      case DeviceProtectionStage.PinUnlock:
        return DeviceProtectionNoticePlace.InForm
      case DeviceProtectionStage.Setup:
      case DeviceProtectionStage.PasskeyUnlock:
        return DeviceProtectionNoticePlace.AfterControls
    }
  }

  static keyKind(stage: DeviceProtectionStage): DeviceProtectionKeyKind {
    switch (stage) {
      case DeviceProtectionStage.PinSetup:
      case DeviceProtectionStage.PinUnlock:
        return DeviceProtectionKeyKind.Pin
      case DeviceProtectionStage.Setup:
      case DeviceProtectionStage.PasskeyUnlock:
        return DeviceProtectionKeyKind.Passkey
    }
  }

  static phase(stage: DeviceProtectionStage): DeviceProtectionPhase {
    switch (stage) {
      case DeviceProtectionStage.Setup:
      case DeviceProtectionStage.PinSetup:
        return DeviceProtectionPhase.Setup
      case DeviceProtectionStage.PinUnlock:
      case DeviceProtectionStage.PasskeyUnlock:
        return DeviceProtectionPhase.Unlock
    }
  }

  /** Setup starts by authenticating with an existing passkey; a further
   * identity's key is always a new one. */
  static initialWorkflow(
    purpose: DeviceProtectionPurposeKind,
  ): DeviceProtectionSetupWorkflow {
    switch (purpose) {
      case DeviceProtectionPurposeKind.ExtensionKey:
        return DeviceProtectionSetupWorkflow.Authenticate
      case DeviceProtectionPurposeKind.IdentityKey:
        return DeviceProtectionSetupWorkflow.Create
    }
  }
}

/** The title and explanation the ceremony shows. */
export class DeviceProtectionCopy {
  private constructor() {}

  static title(request: DeviceProtectionCopyRequest): I18nKey {
    const { stage, purpose, workflow } = request
    switch (stage) {
      case DeviceProtectionStage.PinSetup:
        return I18N_KEYS.ExtensionDeviceSetupPinSetupTitle
      case DeviceProtectionStage.Setup:
      case DeviceProtectionStage.PinUnlock:
      case DeviceProtectionStage.PasskeyUnlock:
        break
    }
    switch (purpose) {
      case DeviceProtectionPurposeKind.IdentityKey:
        return I18N_KEYS.ExtensionDeviceSetupIdentityKeyTitle
      case DeviceProtectionPurposeKind.ExtensionKey:
        break
    }
    switch (stage) {
      case DeviceProtectionStage.PinUnlock:
      case DeviceProtectionStage.PasskeyUnlock:
        return I18N_KEYS.ExtensionDeviceSetupUnlockTitle
      case DeviceProtectionStage.Setup:
        return DeviceProtectionCopy.setupTitle(workflow)
    }
  }

  static description(request: DeviceProtectionCopyRequest): I18nKey {
    const { stage, purpose, workflow } = request
    switch (purpose) {
      case DeviceProtectionPurposeKind.IdentityKey:
        return I18N_KEYS.ExtensionDeviceSetupIdentityKeyDescription
      case DeviceProtectionPurposeKind.ExtensionKey:
        break
    }
    switch (stage) {
      case DeviceProtectionStage.PinSetup:
        return I18N_KEYS.ExtensionDeviceSetupPinSetupDescription
      case DeviceProtectionStage.PinUnlock:
        return I18N_KEYS.ExtensionDeviceSetupPinUnlockDescription
      case DeviceProtectionStage.PasskeyUnlock:
        return I18N_KEYS.ExtensionDeviceSetupUnlockDescription
      case DeviceProtectionStage.Setup:
        return DeviceProtectionCopy.setupDescription(workflow)
    }
  }

  private static setupTitle(workflow: DeviceProtectionSetupWorkflow): I18nKey {
    switch (workflow) {
      case DeviceProtectionSetupWorkflow.Authenticate:
        return I18N_KEYS.ExtensionDeviceSetupSetupTitle
      case DeviceProtectionSetupWorkflow.Create:
        return I18N_KEYS.ExtensionDeviceSetupCreateTitle
      case DeviceProtectionSetupWorkflow.NotFound:
        return I18N_KEYS.ExtensionDeviceSetupNotFoundTitle
    }
  }

  private static setupDescription(
    workflow: DeviceProtectionSetupWorkflow,
  ): I18nKey {
    switch (workflow) {
      case DeviceProtectionSetupWorkflow.Authenticate:
        return I18N_KEYS.ExtensionDeviceSetupSetupDescription
      case DeviceProtectionSetupWorkflow.Create:
        return I18N_KEYS.ExtensionDeviceSetupCreateDescription
      case DeviceProtectionSetupWorkflow.NotFound:
        return I18N_KEYS.ExtensionDeviceSetupNotFoundDescription
    }
  }
}

/** A recognised reason in the text of a failed ceremony step. */
enum DeviceProtectionFailureMarker {
  PasskeyUnavailable = 'PASSKEY_UNAVAILABLE',
  PrfUnavailable = 'PASSKEY_PRF_UNAVAILABLE',
  /** WebAuthn reports cancel, timeout and refusal alike; it never proves
   * that no passkey exists. */
  CeremonyNotAllowed = 'PASSKEY_CEREMONY_NOT_ALLOWED',
  SessionExpired = 'EXTENSION_SESSION_REQUEST_EXPIRED',
  SessionLocked = 'EXTENSION_SESSION_LOCKED',
  Unrecognized = 'unrecognized',
}

export enum DeviceProtectionFailureKind {
  /** Passkeys cannot protect this browser: offer the PIN instead. */
  PinFallback = 'pin-fallback',
  /** Stay on the stage and say why. */
  Message = 'message',
  /** The browser closed the passkey prompt or found nothing to offer:
   * the step decides what follows. */
  NotAllowed = 'not-allowed',
}

export type DeviceProtectionFailure =
  | {
      readonly kind: DeviceProtectionFailureKind.PinFallback
      readonly notice: I18nKey
    }
  | {
      readonly kind:
        | DeviceProtectionFailureKind.Message
        | DeviceProtectionFailureKind.NotAllowed
      readonly message: I18nKey
    }

/** What a passkey step does when the browser did not let it finish. */
export enum PasskeyNotAllowedReaction {
  /** Stay on the stage and say why. */
  Notice = 'notice',
  /** Looking for an existing passkey ended without one: offer creating one
   * or looking again, instead of the same button. */
  OfferChoice = 'offer-choice',
}

export enum PasskeyNotAllowedOutcome {
  /** Show the not-found choice; its own words explain what happened. */
  ShowChoice = 'show-choice',
  /** Stay where the person is and say why. */
  ShowNotice = 'show-notice',
}

export type PasskeyNotAllowedRequest = {
  readonly reaction: PasskeyNotAllowedReaction
  readonly workflow: DeviceProtectionSetupWorkflow
}

/** Where a not-allowed passkey step leads. A closed picker never proves that
 * no passkey exists, so it never starts creating one: the person chooses. */
export class PasskeyNotAllowedMap {
  private constructor() {}

  static outcome(request: PasskeyNotAllowedRequest): PasskeyNotAllowedOutcome {
    const { reaction, workflow } = request
    switch (reaction) {
      case PasskeyNotAllowedReaction.Notice:
        return PasskeyNotAllowedOutcome.ShowNotice
      case PasskeyNotAllowedReaction.OfferChoice:
        break
    }
    switch (workflow) {
      case DeviceProtectionSetupWorkflow.NotFound:
        return PasskeyNotAllowedOutcome.ShowNotice
      case DeviceProtectionSetupWorkflow.Authenticate:
      case DeviceProtectionSetupWorkflow.Create:
        return PasskeyNotAllowedOutcome.ShowChoice
    }
  }
}

/** Whether a ceremony step is running; a running step keeps its control
 * focused and refuses a second start. */
export enum DeviceProtectionActivity {
  Idle = 'idle',
  Pending = 'pending',
}

export enum DeviceProtectionNoticeKind {
  None = 'none',
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Shown = 'shown',
}

/** The one message under the ceremony's controls. */
export type DeviceProtectionNotice =
  | { readonly kind: DeviceProtectionNoticeKind.None }
  | { readonly kind: DeviceProtectionNoticeKind.Shown; readonly key: I18nKey }

/** One try at a ceremony step. A failed try starts the next one, which
 * returns focus to the stage's first control; a running try leaves focus
 * where it is. */
export class DeviceProtectionAttempt {
  private constructor(private readonly ordinal: number) {}

  static first(): DeviceProtectionAttempt {
    return new DeviceProtectionAttempt(1)
  }

  next(): DeviceProtectionAttempt {
    return new DeviceProtectionAttempt(this.ordinal + 1)
  }
}

/** Focus for the stage just entered and after each failed try: a new
 * attempt re-runs the attachment, nothing else does. */
export class DeviceProtectionFocus {
  constructor(readonly attempt: DeviceProtectionAttempt) {}

  /** The stage's first control takes focus. */
  readonly enter = (element: HTMLElement): void => {
    element.focus()
  }
}

/** Where a stage shows its message: a PIN form shows it by its field,
 * above the button; a passkey stage under its controls. */
export enum DeviceProtectionNoticePlace {
  InForm = 'in-form',
  AfterControls = 'after-controls',
}

export type DeviceProtectionFailureRequest = {
  /** What the runtime reported, as text; never shown. */
  readonly reported: string
  /** The step's own message for an unrecognised failure. */
  readonly fallbackKey: I18nKey
}

/** What the ceremony says after a step failed. */
export class DeviceProtectionFailureMap {
  private constructor() {}

  static from(
    request: DeviceProtectionFailureRequest,
  ): DeviceProtectionFailure {
    const { reported, fallbackKey } = request
    switch (DeviceProtectionFailureMap.marker(reported)) {
      case DeviceProtectionFailureMarker.PasskeyUnavailable:
        return {
          kind: DeviceProtectionFailureKind.PinFallback,
          notice: I18N_KEYS.DeviceProtectionPasskeyUnavailablePinFallbackReady,
        }
      case DeviceProtectionFailureMarker.PrfUnavailable:
        return {
          kind: DeviceProtectionFailureKind.PinFallback,
          notice: I18N_KEYS.DeviceProtectionPinFallbackReady,
        }
      case DeviceProtectionFailureMarker.SessionExpired:
      case DeviceProtectionFailureMarker.SessionLocked:
        return {
          kind: DeviceProtectionFailureKind.Message,
          message: I18N_KEYS.ExtensionSetupSessionBusyRetry,
        }
      case DeviceProtectionFailureMarker.CeremonyNotAllowed:
        return {
          kind: DeviceProtectionFailureKind.NotAllowed,
          message: fallbackKey,
        }
      case DeviceProtectionFailureMarker.Unrecognized:
        return {
          kind: DeviceProtectionFailureKind.Message,
          message: fallbackKey,
        }
    }
  }

  /** Recognised reasons, in the order the Nook tab always checked them. */
  private static readonly MARKERS: readonly DeviceProtectionFailureMarker[] = [
    DeviceProtectionFailureMarker.PasskeyUnavailable,
    DeviceProtectionFailureMarker.PrfUnavailable,
    DeviceProtectionFailureMarker.CeremonyNotAllowed,
    DeviceProtectionFailureMarker.SessionExpired,
    DeviceProtectionFailureMarker.SessionLocked,
  ]

  private static marker(reported: string): DeviceProtectionFailureMarker {
    for (const marker of DeviceProtectionFailureMap.MARKERS) {
      switch (reported.includes(marker)) {
        case true:
          return marker
        case false:
          break
      }
    }
    return DeviceProtectionFailureMarker.Unrecognized
  }
}
