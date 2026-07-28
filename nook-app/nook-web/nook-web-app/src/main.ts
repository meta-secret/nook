import { mount } from 'svelte'
import '$vault-shared/app.css'
import { ensureAppWasm } from '$lib/wasm-bootstrap'

// Keep the initial root identity: a replacement page can supply a new #app
// while the asynchronous WASM bootstrap is pending.
const target = document.getElementById('app')

await ensureAppWasm()
const { default: App } = await import('$vault-shared/App.svelte')

// Content-script and UI-demo pages can replace the initial Vite document while
// the WASM bootstrap is still pending. In that case there is no vault mount
// point left to hydrate, and mounting would throw after the replacement page
// has already become active.
if (target?.isConnected) {
  mount(App, { target })
}

export default undefined
