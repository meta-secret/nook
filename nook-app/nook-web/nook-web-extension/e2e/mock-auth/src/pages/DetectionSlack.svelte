<script lang="ts">
  import { completePlainLogin, readLoginFields } from '../lib/plain-login'

  let showPassword = $state(false)
  let error = $state('')

  function onEmailContinue() {
    showPassword = true
  }

  function onsubmit(event: SubmitEvent) {
    event.preventDefault()
    const form = event.currentTarget
    if (!(form instanceof HTMLFormElement)) return
    const { username, password } = readLoginFields(
      form,
      '[data-qa="login_email"]',
      '[data-qa="login_password"]',
    )
    if (completePlainLogin(username, password) === 'invalid') {
      error = 'Invalid username or password.'
    }
  }
</script>

<main>
  <h1>Sign in to Slack</h1>
  <p data-testid="mock-auth-scenario">slack-login</p>
  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}
  <div class="p-login_container">
    {#if showPassword}
      <form id="login-form" {onsubmit}>
        <input
          id="email"
          type="email"
          data-qa="login_email"
          name="email"
          placeholder="name@work-email.com"
        />
        <input
          id="password"
          type="password"
          data-qa="login_password"
          name="password"
          autocomplete="current-password"
        />
        <button type="submit" data-qa="signin_btn">Sign In</button>
      </form>
    {:else}
      <input
        id="email"
        type="email"
        data-qa="login_email"
        name="email"
        placeholder="name@work-email.com"
      />
      <button type="button" data-qa="signin_button" onclick={onEmailContinue}
        >Sign In</button
      >
    {/if}
  </div>
</main>
