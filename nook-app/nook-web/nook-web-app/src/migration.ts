import { mount } from 'svelte'
import '$vault-shared/app.css'
import LegacyMigrationApp from '$vault-shared/LegacyMigrationApp.svelte'

mount(LegacyMigrationApp, {
  target: document.getElementById('app')!,
})

export default undefined
