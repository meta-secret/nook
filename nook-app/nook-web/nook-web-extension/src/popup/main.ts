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

  const [i18n, vaultConnection] = await Promise.all([
    initializeExtensionI18n(),
    loadCompanionVaultConnection(),
  ])
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
      protectionStatus,
      activeSessionDevice,
    },
  })
}

void main()
