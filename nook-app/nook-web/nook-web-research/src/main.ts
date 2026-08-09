import { mount, type ComponentProps, type MountOptions } from 'svelte'
import App from './App.svelte'
import './app.css'

const nookNamedArgs0_0: MountOptions<ComponentProps<typeof App>> = {
  target: document.getElementById('app')!,
}
mount(App, nookNamedArgs0_0)
