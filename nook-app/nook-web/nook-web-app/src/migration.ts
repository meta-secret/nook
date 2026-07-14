import { mount } from 'svelte'
import '$vault-shared/app.css'
import { ensureAppWasm } from '$lib/wasm-bootstrap'

await ensureAppWasm()
const { default: LegacyMigrationApp } =
  await import('$vault-shared/LegacyMigrationApp.svelte')

mount(LegacyMigrationApp, {
  target: document.getElementById('app')!,
})

export default undefined
