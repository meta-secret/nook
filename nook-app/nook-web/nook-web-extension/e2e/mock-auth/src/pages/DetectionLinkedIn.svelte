<script lang="ts">
  import { completePlainLogin, readLoginFields } from '../lib/plain-login'

  let error = $state('')

  function onsubmit(event: SubmitEvent) {
    event.preventDefault()
    const form = event.currentTarget
    if (!(form instanceof HTMLFormElement)) return
    const { username, password } = readLoginFields(
      form,
      '[id="username"]',
      '[id="password"]',
    )
    if (completePlainLogin(username, password) === 'invalid') {
      error = 'Invalid username or password.'
    }
  }
</script>

<main>
  <h1>Sign in</h1>
  <p data-testid="mock-auth-scenario">linkedin-login</p>
  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}
  <form class="login__form" {onsubmit}>
    <input
      type="text"
      id="username"
      name="session_key"
      autocomplete="username"
      placeholder="Email or phone"
      aria-label="Email or phone"
    />
    <input
      type="password"
      id="password"
      name="session_password"
      autocomplete="current-password"
      placeholder="Password"
      aria-label="Password"
    />
    <button type="submit">Sign in</button>
  </form>
</main>
