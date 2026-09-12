import { mount } from 'svelte'
import type { ComponentProps, MountOptions } from 'svelte'
import { extensionLocaleCatalog } from '../lib/i18n'
import {
  ExtensionSetupLoadKind,
  ExtensionPairingStateQueryMessage as ExtensionPairingStateQueryMessageSchema,
} from '../lib/pairing-state'
import {
  ExtensionSessionDeviceStateKind,
  DeviceProtectionStatus,
  type ExtensionSessionDeviceState,
  extensionWasmRuntime,
} from '../lib/nook-wasm'
import PopupApp from './PopupApp.svelte'
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
    }
> {
  const setup =
    await ExtensionPairingStateQueryMessageSchema.loadExtensionSetupState()
  return setup.kind === ExtensionSetupLoadKind.Ready
    ? { isConnected: true, vaultName: setup.setup.selectedVaultName }
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

  const vaultConnection = await loadCompanionVaultConnection()
  const protectionStatus =
    await extensionWasmRuntime.extensionDeviceProtectionStatus()
  const activeSessionDevice: ExtensionSessionDeviceState =
    protectionStatus === DeviceProtectionStatus.Unlocked
      ? await extensionWasmRuntime.extensionSessionDevice()
      : { kind: ExtensionSessionDeviceStateKind.Locked }

  const nookTypedArgs0_2: MountOptions<ComponentProps<typeof PopupApp>> = {
    target,
    props: {
      i18n,
      isConnected: vaultConnection.isConnected,
      ...(vaultConnection.isConnected
        ? { vaultName: vaultConnection.vaultName }
        : {}),
      pairingRequested: searchParams.get('intent') === 'pair',
      protectionStatus,
      activeSessionDevice,
    },
  }
  mount(PopupApp, nookTypedArgs0_2)
}

void main()
