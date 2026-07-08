import PopupApp from './PopupApp.svelte'
import './popup.css'
import { initializeExtensionI18n } from '../lib/i18n'
import { mount } from 'svelte'

async function main() {
  const target = document.getElementById('app')

  if (target) {
    mount(PopupApp, {
      target,
      props: {
        i18n: await initializeExtensionI18n(),
      },
    })
  }
}

void main()
