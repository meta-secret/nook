<script lang="ts">
  import { completePlainLogin, readLoginFields } from '../lib/plain-login'

  let error = $state('')

  function onsubmit(event: SubmitEvent) {
    event.preventDefault()
    const form = event.currentTarget
    if (!(form instanceof HTMLFormElement)) return
    const { username, password } = readLoginFields(
      form,
      '[id="account_name_text_field"]',
      '[id="password_text_field"]',
    )
    if (completePlainLogin(username, password) === 'invalid') {
      error = 'Invalid username or password.'
    }
  }
</script>

<main>
  <h1>Sign in with Apple ID</h1>
  <p data-testid="mock-auth-scenario">apple-login</p>
  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}
  <form id="sign_in_form" class="signin" {onsubmit}>
    <input
      type="text"
      id="account_name_text_field"
      name="accountName"
      autocomplete="username"
      placeholder="Apple ID"
      aria-label="Apple ID or email"
    />
    <input
      type="password"
      id="password_text_field"
      name="password"
      autocomplete="current-password"
      placeholder="Password"
      aria-label="Password"
    />
    <button type="submit">Sign In</button>
  </form>
</main>
