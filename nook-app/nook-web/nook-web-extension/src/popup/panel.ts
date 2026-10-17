import { mount } from 'svelte'
import type { ComponentProps, MountOptions } from 'svelte'
import { extensionLocaleCatalog } from '../lib/i18n'
import {
  ExtensionSessionDeviceStateKind,
  DeviceProtectionStatus,
  type ExtensionSessionDeviceState,
  extensionWasmRuntime,
} from '../lib/nook-wasm'
import { retryClosedExtensionSessionOnce } from '../lib/extension-runtime-retry'
import ActionPanel from './ActionPanel.svelte'
import PopupInitializationFailure from './PopupInitializationFailure.svelte'
import { PopupInitializationPhase } from './popup-app-state'
import './popup.css'
import './action.css'

/** The toolbar panel: reads the extension's state, then shows its actions. */
async function main() {
  const target = document.getElementById('app')
  if (!target) return
  const i18n = await extensionLocaleCatalog.initializeExtensionI18n()
  let initializationPhase = PopupInitializationPhase.DeviceProtectionStatus
  try {
    const { protectionStatus, activeSessionDevice } =
      await retryClosedExtensionSessionOnce(async () => {
        initializationPhase = PopupInitializationPhase.DeviceProtectionStatus
        const protectionStatus =
          await extensionWasmRuntime.extensionDeviceProtectionStatus()
        initializationPhase = PopupInitializationPhase.ActiveSessionDevice
        const activeSessionDevice: ExtensionSessionDeviceState =
          protectionStatus === DeviceProtectionStatus.Unlocked
            ? await extensionWasmRuntime.extensionSessionDevice()
            : { kind: ExtensionSessionDeviceStateKind.Locked }
        return { protectionStatus, activeSessionDevice }
      })
    const panelOptions: MountOptions<ComponentProps<typeof ActionPanel>> = {
      target,
      props: { i18n, protectionStatus, activeSessionDevice },
    }
    initializationPhase = PopupInitializationPhase.AppMount
    mount(ActionPanel, panelOptions)
  } catch {
    const failureMountOptions: MountOptions<
      ComponentProps<typeof PopupInitializationFailure>
    > = {
      target,
      props: { i18n, phase: initializationPhase },
    }
    mount(PopupInitializationFailure, failureMountOptions)
  }
}

void main()
