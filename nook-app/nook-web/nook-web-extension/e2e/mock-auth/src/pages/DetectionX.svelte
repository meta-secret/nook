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
      '[name="text"]',
      '[name="password"]',
    )
    if (completePlainLogin(username, password) === 'invalid') {
      error = 'Invalid username or password.'
    }
  }
</script>

<main>
  <h1>Sign in to X</h1>
  <p data-testid="mock-auth-scenario">x-login</p>
  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}
  <form {onsubmit}>
    <input
      type="text"
      name="text"
      autocomplete="username"
      placeholder="Phone, email, or username"
      aria-label="Phone, email, or username"
      data-testid="ocfEnterTextTextInput"
    />
    {#if showPassword}
      <input
        type="password"
        name="password"
        autocomplete="current-password"
        placeholder="Password"
        aria-label="Password"
      />
      <button type="submit">Log in</button>
    {:else}
      <button type="submit">Next</button>
    {/if}
  </form>
</main>
