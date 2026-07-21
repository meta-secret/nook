<script lang="ts">
  import { findMockAuthAccount } from '../../accounts'
  import { navigate, recordLoginSubmission } from '../lib/navigation'

  let error = $state('')

  function onsubmit(event: SubmitEvent) {
    event.preventDefault()
    const form = event.currentTarget
    if (!(form instanceof HTMLFormElement)) return
    const username = new FormData(form).get('username')
    const password = new FormData(form).get('password')
    if (typeof username !== 'string' || typeof password !== 'string') return
    recordLoginSubmission(username, password)
    const account = findMockAuthAccount(username, password)
    if (!account || account.totpSecret) {
      error = 'Invalid username or password.'
      return
    }
    navigate('/plain/success')
  }
</script>

<main>
  <h1>Sign in</h1>
  <p data-testid="mock-auth-scenario">plain-login</p>
  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}
  <form id="login-form" method="post" action="/plain/login" {onsubmit}>
    <label
      >Email <input
        autocomplete="username"
        name="username"
        type="email"
      /></label
    >
    <label
      >Password <input
        autocomplete="current-password"
        name="password"
        type="password"
      /></label
    >
    <button type="submit">Sign in</button>
  </form>
</main>
