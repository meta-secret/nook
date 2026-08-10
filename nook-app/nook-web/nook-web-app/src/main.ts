import { mount } from 'svelte'
import '$vault-shared/app.css'
import { VaultApplication } from '$app-wasm'
import { ensureAppWasm } from '$lib/runtime/wasm-bootstrap'
import { companionWasmReady } from '$web-shared/extension/companion-ready'

// Keep the initial root identity: a replacement page can supply a new #app
// while the asynchronous WASM bootstrap is pending.
const target = document.getElementById('app')
if (!target) throw new Error('Vault app mount target is missing')

await ensureAppWasm(VaultApplication.UnifiedDevelopment)
await companionWasmReady
const { default: App } = await import('$vault-shared/App.svelte')

// Content-script and UI-demo pages can replace the initial Vite document while
// the WASM bootstrap is still pending. In that case there is no vault mount
// point left to hydrate, and mounting would throw after the replacement page
// has already become active.
if (target?.isConnected) {
  const mountArgs: { readonly target: HTMLElement } = { target }
  mount(App, mountArgs)
}

export default {}
