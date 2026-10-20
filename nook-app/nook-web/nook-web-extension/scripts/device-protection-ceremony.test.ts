import { describe, expect, test } from 'bun:test'
import { I18N_KEYS } from '../../nook-web-shared/src/generated/i18n-keys'
import { DeviceProtectionSetupWorkflow } from '../../nook-web-shared/src/vault-app/lib/components/device-protection-gate-state'
import { DeviceProtectionStatus } from '../src/lib/nook-wasm'
import {
  DeviceProtectionCopy,
  DeviceProtectionFailureKind,
  DeviceProtectionFailureMap,
  DeviceProtectionAttempt,
  DeviceProtectionFocus,
  DeviceProtectionKeyKind,
  DeviceProtectionNoticePlace,
  DeviceProtectionPhase,
  DeviceProtectionPurposeKind,
  DeviceProtectionStage,
  DeviceProtectionStageMap,
  PasskeyNotAllowedMap,
  PasskeyNotAllowedOutcome,
  PasskeyNotAllowedReaction,
  type DeviceProtectionCopyRequest,
  type DeviceProtectionFailureRequest,
} from '../src/popup/device-protection-ceremony'

describe('device-protection ceremony stages', () => {
  test('each protection status opens its ceremony stage', () => {
    expect(DeviceProtectionStageMap.from(DeviceProtectionStatus.Missing)).toBe(
      DeviceProtectionStage.Setup,
    )
    expect(
      DeviceProtectionStageMap.from(DeviceProtectionStatus.Plaintext),
    ).toBe(DeviceProtectionStage.Setup)
    expect(DeviceProtectionStageMap.from(DeviceProtectionStatus.PinSetup)).toBe(
      DeviceProtectionStage.PinSetup,
    )
    expect(DeviceProtectionStageMap.from(DeviceProtectionStatus.Pin)).toBe(
      DeviceProtectionStage.PinUnlock,
    )
    expect(DeviceProtectionStageMap.from(DeviceProtectionStatus.Passkey)).toBe(
      DeviceProtectionStage.PasskeyUnlock,
    )
  })

  test('the Nook tab chain shows the key kind and whether setup is under way', () => {
    expect(DeviceProtectionStageMap.keyKind(DeviceProtectionStage.Setup)).toBe(
      DeviceProtectionKeyKind.Passkey,
    )
    expect(
      DeviceProtectionStageMap.keyKind(DeviceProtectionStage.PinSetup),
    ).toBe(DeviceProtectionKeyKind.Pin)
    expect(
      DeviceProtectionStageMap.keyKind(DeviceProtectionStage.PinUnlock),
    ).toBe(DeviceProtectionKeyKind.Pin)
    expect(DeviceProtectionStageMap.phase(DeviceProtectionStage.PinSetup)).toBe(
      DeviceProtectionPhase.Setup,
    )
    expect(
      DeviceProtectionStageMap.phase(DeviceProtectionStage.PasskeyUnlock),
    ).toBe(DeviceProtectionPhase.Unlock)
  })

  test('passkey autofill listens only while extension setup offers an existing passkey', () => {
    const authenticate: DeviceProtectionCopyRequest = {
      stage: DeviceProtectionStage.Setup,
      purpose: DeviceProtectionPurposeKind.ExtensionKey,
      workflow: DeviceProtectionSetupWorkflow.Authenticate,
    }
    expect(DeviceProtectionStageMap.offersAutofill(authenticate)).toBe(true)
    for (const workflow of [
      DeviceProtectionSetupWorkflow.Create,
      DeviceProtectionSetupWorkflow.NotFound,
    ]) {
      const other: DeviceProtectionCopyRequest = { ...authenticate, workflow }
      expect(DeviceProtectionStageMap.offersAutofill(other)).toBe(false)
    }
    // A further identity's key is always new: nothing to suggest.
    const identityKey: DeviceProtectionCopyRequest = {
      ...authenticate,
      purpose: DeviceProtectionPurposeKind.IdentityKey,
    }
    expect(DeviceProtectionStageMap.offersAutofill(identityKey)).toBe(false)
    for (const stage of [
      DeviceProtectionStage.PinSetup,
      DeviceProtectionStage.PinUnlock,
      DeviceProtectionStage.PasskeyUnlock,
    ]) {
      const unlock: DeviceProtectionCopyRequest = { ...authenticate, stage }
      expect(DeviceProtectionStageMap.offersAutofill(unlock)).toBe(false)
    }
  })

  test('setup starts with an existing passkey; creating one is a choice', () => {
    expect(
      DeviceProtectionStageMap.initialWorkflow(
        DeviceProtectionPurposeKind.ExtensionKey,
      ),
    ).toBe(DeviceProtectionSetupWorkflow.Authenticate)
    // The next identity's key is always new: there is nothing to reuse.
    expect(
      DeviceProtectionStageMap.initialWorkflow(
        DeviceProtectionPurposeKind.IdentityKey,
      ),
    ).toBe(DeviceProtectionSetupWorkflow.Create)
  })
})

describe('device-protection ceremony messages and focus', () => {
  test('a PIN form shows its message by the field; passkey stages under the button', () => {
    expect(
      DeviceProtectionStageMap.noticePlace(DeviceProtectionStage.PinUnlock),
    ).toBe(DeviceProtectionNoticePlace.InForm)
    expect(
      DeviceProtectionStageMap.noticePlace(DeviceProtectionStage.PinSetup),
    ).toBe(DeviceProtectionNoticePlace.InForm)
    expect(
      DeviceProtectionStageMap.noticePlace(DeviceProtectionStage.PasskeyUnlock),
    ).toBe(DeviceProtectionNoticePlace.AfterControls)
    expect(
      DeviceProtectionStageMap.noticePlace(DeviceProtectionStage.Setup),
    ).toBe(DeviceProtectionNoticePlace.AfterControls)
  })

  test('only a failed try starts a new attempt, which re-runs the focus', () => {
    const first = DeviceProtectionAttempt.first()
    const retry = first.next()
    expect(retry).not.toEqual(first)
    expect(new DeviceProtectionFocus(retry).attempt).toBe(retry)
    expect(retry.next()).not.toEqual(retry)
  })
})

describe('device-protection ceremony copy', () => {
  test('setup asks to connect the existing passkey, or to create one', () => {
    const authenticate: DeviceProtectionCopyRequest = {
      stage: DeviceProtectionStage.Setup,
      purpose: DeviceProtectionPurposeKind.ExtensionKey,
      workflow: DeviceProtectionSetupWorkflow.Authenticate,
    }
    expect(DeviceProtectionCopy.title(authenticate)).toBe(
      I18N_KEYS.ExtensionDeviceSetupSetupTitle,
    )
    expect(DeviceProtectionCopy.description(authenticate)).toBe(
      I18N_KEYS.ExtensionDeviceSetupSetupDescription,
    )
    const create: DeviceProtectionCopyRequest = {
      ...authenticate,
      workflow: DeviceProtectionSetupWorkflow.Create,
    }
    expect(DeviceProtectionCopy.title(create)).toBe(
      I18N_KEYS.ExtensionDeviceSetupCreateTitle,
    )
    expect(DeviceProtectionCopy.description(create)).toBe(
      I18N_KEYS.ExtensionDeviceSetupCreateDescription,
    )
    const notFound: DeviceProtectionCopyRequest = {
      ...authenticate,
      workflow: DeviceProtectionSetupWorkflow.NotFound,
    }
    expect(DeviceProtectionCopy.title(notFound)).toBe(
      I18N_KEYS.ExtensionDeviceSetupNotFoundTitle,
    )
    expect(DeviceProtectionCopy.description(notFound)).toBe(
      I18N_KEYS.ExtensionDeviceSetupNotFoundDescription,
    )
  })

  test('unlocking names the key that opens the extension', () => {
    const pin: DeviceProtectionCopyRequest = {
      stage: DeviceProtectionStage.PinUnlock,
      purpose: DeviceProtectionPurposeKind.ExtensionKey,
      workflow: DeviceProtectionSetupWorkflow.Authenticate,
    }
    expect(DeviceProtectionCopy.title(pin)).toBe(
      I18N_KEYS.ExtensionDeviceSetupUnlockTitle,
    )
    expect(DeviceProtectionCopy.description(pin)).toBe(
      I18N_KEYS.ExtensionDeviceSetupPinUnlockDescription,
    )
    const passkey: DeviceProtectionCopyRequest = {
      ...pin,
      stage: DeviceProtectionStage.PasskeyUnlock,
    }
    expect(DeviceProtectionCopy.title(passkey)).toBe(
      I18N_KEYS.ExtensionDeviceSetupUnlockTitle,
    )
    expect(DeviceProtectionCopy.description(passkey)).toBe(
      I18N_KEYS.ExtensionDeviceSetupUnlockDescription,
    )
  })

  test('a PIN fallback is titled as PIN setup, also for the next identity', () => {
    const pinSetup: DeviceProtectionCopyRequest = {
      stage: DeviceProtectionStage.PinSetup,
      purpose: DeviceProtectionPurposeKind.IdentityKey,
      workflow: DeviceProtectionSetupWorkflow.Create,
    }
    expect(DeviceProtectionCopy.title(pinSetup)).toBe(
      I18N_KEYS.ExtensionDeviceSetupPinSetupTitle,
    )
    // The explanation stays about the next identity's own key.
    expect(DeviceProtectionCopy.description(pinSetup)).toBe(
      I18N_KEYS.ExtensionDeviceSetupIdentityKeyDescription,
    )
    const identityKey: DeviceProtectionCopyRequest = {
      ...pinSetup,
      stage: DeviceProtectionStage.Setup,
    }
    expect(DeviceProtectionCopy.title(identityKey)).toBe(
      I18N_KEYS.ExtensionDeviceSetupIdentityKeyTitle,
    )
  })
})

describe('device-protection ceremony failures', () => {
  test('a cancelled prompt or empty lookup is reported as not allowed', () => {
    const cancelled: DeviceProtectionFailureRequest = {
      reported:
        'Error: PASSKEY_CEREMONY_NOT_ALLOWED: Passkey get request did not finish.',
      fallbackKey: I18N_KEYS.ExtensionDeviceSetupPasskeyUseNotAllowed,
    }
    expect(DeviceProtectionFailureMap.from(cancelled)).toEqual({
      kind: DeviceProtectionFailureKind.NotAllowed,
      message: I18N_KEYS.ExtensionDeviceSetupPasskeyUseNotAllowed,
    })
  })

  test('looking for a passkey without result offers the choice, never creation', () => {
    for (const workflow of [
      DeviceProtectionSetupWorkflow.Authenticate,
      DeviceProtectionSetupWorkflow.Create,
    ]) {
      expect(
        PasskeyNotAllowedMap.outcome({
          reaction: PasskeyNotAllowedReaction.OfferChoice,
          workflow,
        }),
      ).toBe(PasskeyNotAllowedOutcome.ShowChoice)
    }
    // On the choice itself, a closed picker just says so.
    expect(
      PasskeyNotAllowedMap.outcome({
        reaction: PasskeyNotAllowedReaction.OfferChoice,
        workflow: DeviceProtectionSetupWorkflow.NotFound,
      }),
    ).toBe(PasskeyNotAllowedOutcome.ShowNotice)
  })

  test('a closed prompt while creating or unlocking stays and says so', () => {
    for (const workflow of [
      DeviceProtectionSetupWorkflow.Authenticate,
      DeviceProtectionSetupWorkflow.Create,
      DeviceProtectionSetupWorkflow.NotFound,
    ]) {
      expect(
        PasskeyNotAllowedMap.outcome({
          reaction: PasskeyNotAllowedReaction.Notice,
          workflow,
        }),
      ).toBe(PasskeyNotAllowedOutcome.ShowNotice)
    }
  })

  test('a browser without passkeys or PRF moves to the PIN', () => {
    const unavailable: DeviceProtectionFailureRequest = {
      reported:
        'Error: PASSKEY_UNAVAILABLE: Passkeys are not available in this browser.',
      fallbackKey: I18N_KEYS.ExtensionDeviceSetupPasskeyCreateNotAllowed,
    }
    expect(DeviceProtectionFailureMap.from(unavailable)).toEqual({
      kind: DeviceProtectionFailureKind.PinFallback,
      notice: I18N_KEYS.DeviceProtectionPasskeyUnavailablePinFallbackReady,
    })
    const noPrf: DeviceProtectionFailureRequest = {
      reported:
        'Error: PASSKEY_PRF_UNAVAILABLE: The passkey did not return the required PRF output.',
      fallbackKey: I18N_KEYS.ExtensionDeviceSetupPasskeyCreateNotAllowed,
    }
    expect(DeviceProtectionFailureMap.from(noPrf)).toEqual({
      kind: DeviceProtectionFailureKind.PinFallback,
      notice: I18N_KEYS.DeviceProtectionPinFallbackReady,
    })
  })

  test('a busy or expired session asks to try again', () => {
    for (const reported of [
      'Error: EXTENSION_SESSION_REQUEST_EXPIRED',
      'Error: EXTENSION_SESSION_LOCKED',
    ]) {
      const busy: DeviceProtectionFailureRequest = {
        reported,
        fallbackKey: I18N_KEYS.DeviceProtectionPinUnlockFailed,
      }
      expect(DeviceProtectionFailureMap.from(busy)).toEqual({
        kind: DeviceProtectionFailureKind.Message,
        message: I18N_KEYS.ExtensionSetupSessionBusyRetry,
      })
    }
  })

  test('anything else keeps the step with its own message', () => {
    const wrongPin: DeviceProtectionFailureRequest = {
      reported: 'Error: Extension session returned malformed device identity.',
      fallbackKey: I18N_KEYS.DeviceProtectionPinUnlockFailed,
    }
    expect(DeviceProtectionFailureMap.from(wrongPin)).toEqual({
      kind: DeviceProtectionFailureKind.Message,
      message: I18N_KEYS.DeviceProtectionPinUnlockFailed,
    })
  })
})
