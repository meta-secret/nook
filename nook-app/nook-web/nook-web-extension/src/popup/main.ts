import { mount } from 'svelte'
import type { ComponentProps, MountOptions } from 'svelte'
import { extensionLocaleCatalog } from '../lib/i18n'
import { OpenCompanionLauncherIntent } from '../../../nook-web-shared/src/extension/companion-launcher-message'
import {
  extensionPairingStateLoader,
  ExtensionSetupLoadKind,
} from '../lib/pairing-state'
import {
  ExtensionSessionDeviceStateKind,
  DeviceProtectionStatus,
  type ExtensionSessionDeviceState,
  extensionWasmRuntime,
} from '../lib/nook-wasm'
import { retryClosedExtensionSessionOnce } from '../lib/extension-runtime-retry'
import PopupApp from './PopupApp.svelte'
import PopupInitializationFailure from './PopupInitializationFailure.svelte'
import { PopupInitializationPhase } from './popup-app-state'
import AuthenticatorPicker from './AuthenticatorPicker.svelte'
import LoginPicker from './LoginPicker.svelte'
import './popup.css'

async function loadCompanionVaultConnection(): Promise<
  | {
      isConnected: false
    }
  | {
      isConnected: true
      vaultName: string
      vaultStoreId: string
    }
> {
  const setup = await extensionPairingStateLoader.loadExtensionSetupState()
  return setup.kind === ExtensionSetupLoadKind.Ready
    ? {
        isConnected: true,
        vaultName: setup.setup.selectedVaultName,
        vaultStoreId: setup.setup.selectedVaultStoreId,
      }
    : { isConnected: false }
}

async function main() {
  const target = document.getElementById('app')
  if (!target) return

  const searchParams = new URLSearchParams(window.location.search)
  const i18n = await extensionLocaleCatalog.initializeExtensionI18n()
  if (searchParams.get('intent') === 'authenticator-picker') {
    const nookTypedArgs0_0: MountOptions<
      ComponentProps<typeof AuthenticatorPicker>
    > = {
      target,
      props: {
        i18n,
        requestId: ((v) => (v ? v : ''))(searchParams.get('request')),
      },
    }
    mount(AuthenticatorPicker, nookTypedArgs0_0)
    return
  }
  if (searchParams.get('intent') === 'login-picker') {
    const nookTypedArgs0_1: MountOptions<ComponentProps<typeof LoginPicker>> = {
      target,
      props: {
        i18n,
        requestId: ((v) => (v ? v : ''))(searchParams.get('request')),
      },
    }
    mount(LoginPicker, nookTypedArgs0_1)
    return
  }

  const [launcherIntentValue = ''] = searchParams.getAll('intent')
  let launcherIntent: OpenCompanionLauncherIntent
  switch (launcherIntentValue) {
    case OpenCompanionLauncherIntent.Pair:
      launcherIntent = OpenCompanionLauncherIntent.Pair
      break
    case OpenCompanionLauncherIntent.PilotAuth:
      launcherIntent = OpenCompanionLauncherIntent.PilotAuth
      break
    default:
      launcherIntent = OpenCompanionLauncherIntent.Default
      break
  }

  let initializationPhase = PopupInitializationPhase.PairingState
  try {
    const vaultConnection = await loadCompanionVaultConnection()
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

    const nookTypedArgs0_2: MountOptions<ComponentProps<typeof PopupApp>> = {
      target,
      props: {
        i18n,
        isConnected: vaultConnection.isConnected,
        ...(vaultConnection.isConnected
          ? {
              vaultName: vaultConnection.vaultName,
              vaultStoreId: vaultConnection.vaultStoreId,
            }
          : {}),
        launcherIntent,
        protectionStatus,
        activeSessionDevice,
      },
    }
    initializationPhase = PopupInitializationPhase.AppMount
    mount(PopupApp, nookTypedArgs0_2)
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
