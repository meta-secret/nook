import { mount, type ComponentProps, type MountOptions } from 'svelte'
import App from './App.svelte'
import './app.css'

const app = document.getElementById('app')
if (!(app instanceof HTMLElement)) {
  throw new Error('Research application mount target is unavailable')
}
const nookNamedArgs0_0: MountOptions<ComponentProps<typeof App>> = { target: app }
mount(App, nookNamedArgs0_0)
