import { mount } from 'svelte'
import {
  isExtensionReadySetupState,
  setupStorageKey,
} from '../background/pairing-grants'
import { initializeExtensionI18n } from '../lib/i18n'
import {
  extensionDeviceProtectionStatus,
  extensionSessionDevice,
  type ExtensionDeviceProtectionResult,
  type ExtensionDeviceProtectionStatus,
} from '../lib/nook-wasm'
import PopupApp from './PopupApp.svelte'
import AuthenticatorPicker from './AuthenticatorPicker.svelte'
import './popup.css'

function loadCompanionVaultConnection(): Promise<{
  isConnected: boolean
  vaultName?: string
}> {
  return new Promise((resolve) => {
    chrome.storage.local.get(setupStorageKey, (items) => {
      if (chrome.runtime.lastError) {
        resolve({ isConnected: false })
        return
      }
      const setup = items[setupStorageKey]
      if (!isExtensionReadySetupState(setup)) {
        resolve({ isConnected: false })
        return
      }
      resolve({ isConnected: true, vaultName: setup.selectedVaultName })
    })
  })
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

  const vaultConnection = await loadCompanionVaultConnection()
  let protectionStatus: ExtensionDeviceProtectionStatus = 'missing'
  let activeSessionDevice: ExtensionDeviceProtectionResult | undefined
  protectionStatus = await extensionDeviceProtectionStatus()
  if (protectionStatus === 'unlocked') {
    activeSessionDevice = await extensionSessionDevice()
  }

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
