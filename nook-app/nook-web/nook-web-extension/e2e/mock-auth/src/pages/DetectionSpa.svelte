<script lang="ts">
  import { completePlainLogin, readLoginFields } from '../lib/plain-login'

  let showPassword = $state(false)
  let error = $state('')

  function onsubmit(event: SubmitEvent) {
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
</script>

<main>
  <h1>Sign in</h1>
  <p data-testid="mock-auth-scenario">spa-login</p>
  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}
  <form id="login-form" {onsubmit}>
    <input autocomplete="username" name="email" type="email" />
    {#if showPassword}
      <input autocomplete="current-password" name="password" type="password" />
      <button type="submit">Sign in</button>
    {:else}
      <button
        id="next"
        type="button"
        onclick={() => {
          showPassword = true
        }}>Next</button
      >
    {/if}
  </form>
</main>
