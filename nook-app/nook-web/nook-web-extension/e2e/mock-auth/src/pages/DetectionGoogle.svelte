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
      '[name="identifier"]',
      '[name="Passwd"]',
    )
    if (completePlainLogin(username, password) === 'invalid') {
      error = 'Invalid username or password.'
    }
  }
</script>

<main>
  <h1>Sign in</h1>
  <p data-testid="mock-auth-scenario">google-login</p>
  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}
  <form id="gaia_loginform" {onsubmit}>
    <input
      type="email"
      name="identifier"
      id="identifierId"
      autocomplete="username"
      placeholder="Email or phone"
      aria-label="Email or phone"
    />
    {#if showPassword}
      <input
        type="password"
        name="Passwd"
        autocomplete="current-password"
        placeholder="Enter your password"
        aria-label="Enter your password"
      />
      <button type="submit">Next</button>
    {:else}
      <button type="submit">Next</button>
    {/if}
  </form>
</main>
