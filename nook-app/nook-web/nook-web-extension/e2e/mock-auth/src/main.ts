import { mount } from 'svelte'
import App from './App.svelte'
import './app.css'

const appTarget = document.querySelector('#app')
if (!appTarget) {
  throw new Error('mock-auth app target is missing')
}
mount(App, { target: appTarget })
