import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'
import { handleGoogleOAuthCallbackIfPresent } from '$lib/google-oauth-callback'

async function bootstrap() {
  const handled = await handleGoogleOAuthCallbackIfPresent()
  if (handled) {
    return
  }

  mount(App, {
    target: document.getElementById('app')!,
  })
}

void bootstrap()

export default null
