import { mount } from 'svelte'
import { initializeExtensionI18n } from '../lib/i18n'
import ConnectApp from './ConnectApp.svelte'
import './connect.css'

async function main() {
  const target = document.getElementById('app')
  if (!target) return

  mount(ConnectApp, {
    target,
    props: {
      i18n: await initializeExtensionI18n(),
    },
  })
}

void main()
