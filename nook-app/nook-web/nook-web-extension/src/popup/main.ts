import { mount } from 'svelte'
import { initializeExtensionI18n } from '../lib/i18n'
import { loadExtensionSetupState } from '../lib/pairing-state'
import {
  extensionDeviceProtectionStatus,
  extensionSessionDevice,
  type ExtensionDeviceProtectionStatus,
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
  return setup
    ? { isConnected: true, vaultName: setup.selectedVaultName }
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
  const protectionStatus: ExtensionDeviceProtectionStatus =
    await extensionDeviceProtectionStatus()
  const activeSessionDevice =
    protectionStatus === 'unlocked' ? await extensionSessionDevice() : undefined

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
