import PopupApp from './PopupApp.svelte'
import './popup.css'
import { mount } from 'svelte'

const target = document.getElementById('app')

if (target) {
  mount(PopupApp, { target })
}
