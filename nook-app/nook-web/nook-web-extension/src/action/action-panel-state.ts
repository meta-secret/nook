import {
  OpenCompanionLauncherIntent,
  OpenCompanionLauncherMessageType,
} from '../../../nook-web-shared/src/extension/companion-launcher-message'
import { OpenSimpleVaultMessageType } from '../../../nook-web-shared/src/extension/lifecycle-runtime-messages'
import { ExtensionSessionMessageType } from '../lib/extension-session-message-type'
import { DeviceProtectionStatus } from '../lib/nook-wasm'

/** What the toolbar panel offers for the extension's key. */
export enum ActionPanelState {
  Unlocked = 'unlocked',
  /** A PIN unlocks inside the panel. */
  PinLocked = 'pin-locked',
  /** A passkey prompt would close the panel: the Nook tab unlocks it. */
  PasskeyLocked = 'passkey-locked',
  /** No key yet: the Nook tab sets it up. */
  Setup = 'setup',
}

export function actionPanelState(
  status: DeviceProtectionStatus,
): ActionPanelState {
  switch (status) {
    case DeviceProtectionStatus.Unlocked:
      return ActionPanelState.Unlocked
    case DeviceProtectionStatus.Pin:
      return ActionPanelState.PinLocked
    case DeviceProtectionStatus.Passkey:
      return ActionPanelState.PasskeyLocked
    case DeviceProtectionStatus.Missing:
    case DeviceProtectionStatus.Plaintext:
    case DeviceProtectionStatus.PinSetup:
    case DeviceProtectionStatus.Loading:
    case DeviceProtectionStatus.Error:
    case DeviceProtectionStatus.Unknown:
      return ActionPanelState.Setup
  }
}

type ServiceWorkerMessage =
  | { readonly type: OpenSimpleVaultMessageType.NookOpenSimpleVault }
  | { readonly type: typeof ExtensionSessionMessageType.Lock }
  | {
      readonly type: OpenCompanionLauncherMessageType.NookOpenCompanionLauncher
      readonly payload?: { readonly intent: OpenCompanionLauncherIntent.Pair }
    }

/** The service worker's acknowledgement of a panel request. */
type ServiceWorkerAcknowledgement = { readonly ok?: boolean } | undefined

/** The panel's requests to the service worker; each settles to whether it
 * was done, so the panel can close or say what failed. */
export class ActionPanelMessages {
  private constructor() {}

  private static send(message: ServiceWorkerMessage): Promise<boolean> {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        message,
        (response: ServiceWorkerAcknowledgement) => {
          resolve(!chrome.runtime.lastError && response?.ok === true)
        },
      )
    })
  }

  static openVault(): Promise<boolean> {
    const message: ServiceWorkerMessage = {
      type: OpenSimpleVaultMessageType.NookOpenSimpleVault,
    }
    return ActionPanelMessages.send(message)
  }

  /** Open (or focus) the Nook tab, for pairing when `pair` is set. */
  static openTab(pair: boolean): Promise<boolean> {
    const toPair: ServiceWorkerMessage = {
      type: OpenCompanionLauncherMessageType.NookOpenCompanionLauncher,
      payload: { intent: OpenCompanionLauncherIntent.Pair },
    }
    const toUnlock: ServiceWorkerMessage = {
      type: OpenCompanionLauncherMessageType.NookOpenCompanionLauncher,
    }
    return ActionPanelMessages.send(pair ? toPair : toUnlock)
  }

  static lock(): Promise<boolean> {
    const message: ServiceWorkerMessage = {
      type: ExtensionSessionMessageType.Lock,
    }
    return ActionPanelMessages.send(message)
  }
}
