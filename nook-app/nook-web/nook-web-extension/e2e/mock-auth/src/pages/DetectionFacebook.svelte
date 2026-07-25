<script lang="ts">
  import { completePlainLogin, readLoginFields } from '../lib/plain-login'

  let error = $state('')

  function onsubmit(event: SubmitEvent) {
    event.preventDefault()
    const form = event.currentTarget
    if (!(form instanceof HTMLFormElement)) return
    const { username, password } = readLoginFields(
      form,
      '[name="email"]',
      '[name="pass"]',
    )
    if (completePlainLogin(username, password) === 'invalid') {
      error = 'Invalid username or password.'
    }
  }
</script>

<!-- aria-hidden wrapper mirrors Meta cookie/consent layers that hide the
     login subtree from assistive tech while fields stay visually interactable. -->
<div aria-hidden="true">
  <main>
    <h1>Facebook</h1>
    <p data-testid="mock-auth-scenario">facebook-login</p>
    {#if error}
      <p class="error" role="alert">{error}</p>
    {/if}
    <form id="login_form" {onsubmit}>
      <input
        type="text"
        name="email"
        id="email"
        placeholder="Email or phone number"
        aria-label="Email or phone number"
      />
      <input
        type="password"
        name="pass"
        id="pass"
        placeholder="Password"
        autocomplete="current-password"
        aria-label="Password"
      />
      <button type="submit" name="login" id="loginbutton">Log in</button>
    </form>
  </main>
</div>
