<script lang="ts">
  import { completePlainLogin, readLoginFields } from '../lib/plain-login'

  let error = $state('')

  function onsubmit(event: SubmitEvent) {
    event.preventDefault()
    const form = event.currentTarget
    if (!(form instanceof HTMLFormElement)) return
    const { username, password } = readLoginFields(
      form,
      '[name="login"]',
      '[name="password"]',
    )
    if (completePlainLogin(username, password) === 'invalid') {
      error = 'Invalid username or password.'
    }
  }
</script>

<main>
  <h1>Sign in to GitHub</h1>
  <p data-testid="mock-auth-scenario">github-login</p>
  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}
  <form {onsubmit}>
    <input
      type="text"
      name="login"
      id="login_field"
      autocomplete="username"
      placeholder="Username or email address"
      aria-label="Username or email address"
    />
    <input
      type="password"
      name="password"
      id="password"
      autocomplete="current-password"
      placeholder="Password"
      aria-label="Password"
    />
    <button type="submit" name="commit">Sign in</button>
  </form>
</main>
