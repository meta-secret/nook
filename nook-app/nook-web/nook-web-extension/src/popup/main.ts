import PopupApp from './PopupApp.svelte'
import './popup.css'
import { initializeExtensionI18n } from '../lib/i18n'
import { mount } from 'svelte'

async function main() {
  const target = document.getElementById('app')

  if (target) {
    try {
      mount(PopupApp, {
        target,
        props: {
          i18n: await initializeExtensionI18n(),
        },
      })
    } catch (error) {
      console.error('Failed to initialize extension i18n:', error)
      target.textContent = 'Failed to load extension'
    }
  }
}

void main()
