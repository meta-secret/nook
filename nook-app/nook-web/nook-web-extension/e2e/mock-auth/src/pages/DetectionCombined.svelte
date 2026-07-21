<script lang="ts">
  import { completePlainLogin, readLoginFields } from '../lib/plain-login'

  let error = $state('')

  function onLoginSubmit(event: SubmitEvent) {
    event.preventDefault()
    const form = event.currentTarget
    if (!(form instanceof HTMLFormElement)) return
    const { username, password } = readLoginFields(
      form,
      '[name="email"]',
      '[name="password"]',
    )
    if (completePlainLogin(username, password) === 'invalid') {
      error = 'Invalid username or password.'
    }
  }

  function onSignupSubmit(event: SubmitEvent) {
    event.preventDefault()
  }
</script>

<main>
  <p data-testid="mock-auth-scenario">combined-login</p>
  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}
  <form id="signup-form" onsubmit={onSignupSubmit}>
    <input
      autocomplete="section-signup username"
      name="signup-email"
      type="email"
    />
    <input
      autocomplete="section-signup new-password"
      name="signup-password"
      type="password"
    />
    <button type="submit">Create account</button>
  </form>
  <form id="login-form" onsubmit={onLoginSubmit}>
    <input autocomplete="section-login username" name="email" type="email" />
    <input
      autocomplete="section-login current-password webauthn"
      name="password"
      type="password"
    />
    <button type="submit">Sign in</button>
  </form>
</main>
