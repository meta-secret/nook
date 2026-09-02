import { mount } from 'svelte'
import type { ComponentProps, MountOptions } from 'svelte'
import { initializeExtensionI18n } from '../lib/i18n'
import {
  ExtensionSetupLoadKind,
  loadExtensionSetupState,
} from '../lib/pairing-state'
import {
  extensionDeviceProtectionStatus,
  extensionSessionDevice,
  ExtensionSessionDeviceStateKind,
  DeviceProtectionStatus,
  type ExtensionSessionDeviceState,
} from '../lib/nook-wasm'
import PopupApp from './PopupApp.svelte'
import AuthenticatorPicker from './AuthenticatorPicker.svelte'
import LoginPicker from './LoginPicker.svelte'
import './popup.css'

async function loadCompanionVaultConnection(): Promise<{
  isConnected: boolean
  vaultName?: string
}> {
  const setup = await loadExtensionSetupState()
  return setup.kind === ExtensionSetupLoadKind.Ready
    ? { isConnected: true, vaultName: setup.setup.selectedVaultName }
    : { isConnected: false }
}

async function main() {
  const target = document.getElementById('app')
  if (!target) return

  const searchParams = new URLSearchParams(window.location.search)
  const i18n = await initializeExtensionI18n()
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
  const protectionStatus = await extensionDeviceProtectionStatus()
  const activeSessionDevice: ExtensionSessionDeviceState =
    protectionStatus === DeviceProtectionStatus.Unlocked
      ? await extensionSessionDevice()
      : { kind: ExtensionSessionDeviceStateKind.Locked }

  const nookTypedArgs0_2: MountOptions<ComponentProps<typeof PopupApp>> = {
    target,
    props: {
      i18n,
      isConnected: vaultConnection.isConnected,
      vaultName: vaultConnection.vaultName,
      pairingRequested: searchParams.get('intent') === 'pair',
      protectionStatus,
      activeSessionDevice,
    },
  }
  mount(PopupApp, nookTypedArgs0_2)
}

void main()
