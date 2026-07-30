import { mount } from 'svelte'
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
    mount(AuthenticatorPicker, {
      target,
      props: {
        i18n,
        requestId: searchParams.get('request') ?? '',
      },
    })
    return
  }
  if (searchParams.get('intent') === 'login-picker') {
    mount(LoginPicker, {
      target,
      props: {
        i18n,
        requestId: searchParams.get('request') ?? '',
      },
    })
    return
  }

  const vaultConnection = await loadCompanionVaultConnection()
  const protectionStatus = await extensionDeviceProtectionStatus()
  const activeSessionDevice: ExtensionSessionDeviceState =
    protectionStatus === DeviceProtectionStatus.Unlocked
      ? await extensionSessionDevice()
      : { kind: ExtensionSessionDeviceStateKind.Locked }

  mount(PopupApp, {
    target,
    props: {
      i18n,
      isConnected: vaultConnection.isConnected,
      vaultName: vaultConnection.vaultName,
      pairingRequested: searchParams.get('intent') === 'pair',
      protectionStatus,
      activeSessionDevice,
    },
  })
}

void main()
