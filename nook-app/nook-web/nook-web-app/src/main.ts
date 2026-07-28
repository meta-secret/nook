import { mount } from 'svelte'
import '$vault-shared/app.css'
import { ensureAppWasm } from '$lib/wasm-bootstrap'

await ensureAppWasm()
const { default: App } = await import('$vault-shared/App.svelte')

const target = document.getElementById('app')

// Content-script and UI-demo pages can replace the initial Vite document while
// the WASM bootstrap is still pending. In that case there is no vault mount
// point left to hydrate, and mounting would throw after the replacement page
// has already become active.
if (target) {
  mount(App, { target })
}

export default undefined
