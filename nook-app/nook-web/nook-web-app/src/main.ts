import { mount } from 'svelte'
import '$vault-shared/app.css'
import App from '$vault-shared/App.svelte'

mount(App, {
  target: document.getElementById('app')!,
})

export default undefined
