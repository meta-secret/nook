import { mount } from 'svelte'
import {
  isExtensionReadySetupState,
  setupStorageKey,
} from '../background/pairing-grants'
import { initializeExtensionI18n } from '../lib/i18n'
import {
  extensionDeviceProtectionStatus,
  type ExtensionDeviceProtectionStatus,
} from '../lib/nook-wasm'
import PopupApp from './PopupApp.svelte'
import './popup.css'

function isConnectedToSimpleVault(): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.storage.local.get(setupStorageKey, (items) => {
      if (chrome.runtime.lastError) {
        resolve(false)
        return
      }
      resolve(isExtensionReadySetupState(items[setupStorageKey]))
    })
  })
}

async function main() {
  const target = document.getElementById('app')
  if (!target) return

  const [i18n, isConnected] = await Promise.all([
    initializeExtensionI18n(),
    isConnectedToSimpleVault(),
  ])
  let protectionStatus: ExtensionDeviceProtectionStatus = 'missing'
  protectionStatus = await extensionDeviceProtectionStatus()

  mount(PopupApp, {
    target,
    props: {
      i18n,
      isConnected,
      protectionStatus,
    },
  })
}

void main()
