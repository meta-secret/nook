import { expect, test } from 'bun:test'
import { I18N_KEYS } from '../../nook-web-shared/src/generated/i18n-keys'
import {
  PopupInitializationPhase,
  popupInitializationFailureKey,
} from '../src/popup/popup-app-state'

test('reports the failed popup operation with a fixed catalog key', () => {
  expect(
    popupInitializationFailureKey(PopupInitializationPhase.PairingState),
  ).toBe(I18N_KEYS.ExtensionPopupInitializationPairingStateFailed)
  expect(
    popupInitializationFailureKey(
      PopupInitializationPhase.DeviceProtectionStatus,
    ),
  ).toBe(I18N_KEYS.ExtensionPopupInitializationDeviceStatusFailed)
  expect(
    popupInitializationFailureKey(PopupInitializationPhase.ActiveSessionDevice),
  ).toBe(I18N_KEYS.ExtensionPopupInitializationSessionDeviceFailed)
  expect(popupInitializationFailureKey(PopupInitializationPhase.AppMount)).toBe(
    I18N_KEYS.ExtensionPopupInitializationAppMountFailed,
  )
})
