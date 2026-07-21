<script lang="ts">
  import { completePlainLogin } from '../lib/plain-login'

  let error = $state('')

  function onsubmit(event: SubmitEvent) {
    event.preventDefault()
    const form = event.currentTarget
    if (!(form instanceof HTMLFormElement)) return
    // Prefer the visible main-password field when both share a name.
    const password =
      form.querySelector<HTMLInputElement>('#main-password')?.value ??
      form.querySelector<HTMLInputElement>('[name="LoginPassword"]')?.value ??
      ''
    const username =
      form.querySelector<HTMLInputElement>(
        'fieldset.loginForm [name="LoginUserName"]',
      )?.value ??
      form.querySelector<HTMLInputElement>('[name="LoginUserName"]')?.value ??
      ''
    if (completePlainLogin(username, password) === 'invalid') {
      error = 'Invalid username or password.'
    }
  }
</script>

<form id="aspnetForm" {onsubmit}>
  <div class="gb-dropdown__holder" style="display: none">
    <input name="LoginUserName" type="text" />
    <input id="header-password" name="LoginPassword" type="password" />
  </div>
  <fieldset class="loginForm">
    <h1>Log in to your account</h1>
    <p data-testid="mock-auth-scenario">hidden-header-login</p>
    {#if error}
      <p class="error" role="alert">{error}</p>
    {/if}
    <input name="LoginUserName" type="text" />
    <input
      id="main-password"
      name="LoginPassword"
      type="password"
      autocomplete="on"
    />
    <button type="submit">Sign in</button>
  </fieldset>
</form>
