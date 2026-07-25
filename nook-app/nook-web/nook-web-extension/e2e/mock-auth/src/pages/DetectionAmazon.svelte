<script lang="ts">
  import { completePlainLogin, readLoginFields } from '../lib/plain-login'

  let showPassword = $state(false)
  let error = $state('')

  function onsubmit(event: SubmitEvent) {
    event.preventDefault()
    const form = event.currentTarget
    if (!(form instanceof HTMLFormElement)) return
    if (!showPassword) {
      showPassword = true
      return
    }
    const { username, password } = readLoginFields(
      form,
      '[name="email"]',
      '[name="password"]',
    )
    if (completePlainLogin(username, password) === 'invalid') {
      error = 'Invalid username or password.'
    }
  }
</script>

<main>
  <h1>Sign in</h1>
  <p data-testid="mock-auth-scenario">amazon-login</p>
  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}
  <form id="ap_login_form" name="signIn" {onsubmit}>
    <input
      type="email"
      name="email"
      id="ap_email"
      autocomplete="username"
      placeholder="Email or mobile phone number"
      aria-label="Email or mobile phone number"
    />
    {#if showPassword}
      <input
        type="password"
        name="password"
        id="ap_password"
        autocomplete="current-password"
        placeholder="Amazon password"
        aria-label="Amazon password"
      />
      <button type="submit" id="signInSubmit">Sign in</button>
    {:else}
      <button type="submit" id="continue">Continue</button>
    {/if}
  </form>
</main>
