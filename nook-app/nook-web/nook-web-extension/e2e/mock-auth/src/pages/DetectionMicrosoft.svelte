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
      '[name="loginfmt"]',
      '[name="passwd"]',
    )
    if (completePlainLogin(username, password) === 'invalid') {
      error = 'Invalid username or password.'
    }
  }
</script>

<main>
  <h1>Sign in</h1>
  <p data-testid="mock-auth-scenario">microsoft-login</p>
  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}
  <form id="loginForm" {onsubmit}>
    <input
      type="email"
      name="loginfmt"
      id="i0116"
      placeholder="Email, phone, or Skype"
      aria-label="Enter your email, phone, or Skype."
    />
    {#if showPassword}
      <input
        type="password"
        name="passwd"
        id="i0118"
        placeholder="Password"
        autocomplete="current-password"
      />
      <button type="submit" id="idSIButton9">Sign in</button>
    {:else}
      <button type="submit" id="idSIButton9">Next</button>
    {/if}
  </form>
</main>
