<script lang="ts">
  import { onMount } from 'svelte'
  import { findMockAuthAccount } from '../../accounts'
  import { navigate, recordLoginSubmission } from '../lib/navigation'
  import { setPendingTotpSession } from '../lib/session'

  let error = $state('')

  onMount(() => {
    ;(
      window as Window & {
        __nookLoginSubmitted?: { email: string; password: string } | null
      }
    ).__nookLoginSubmitted = null
  })

  function onsubmit(event: SubmitEvent) {
    event.preventDefault()
    const form = event.currentTarget
    if (!(form instanceof HTMLFormElement)) return
    const username =
      form.querySelector<HTMLInputElement>('[name="username"]')?.value ?? ''
    const password =
      form.querySelector<HTMLInputElement>('[name="password"]')?.value ?? ''
    recordLoginSubmission(username, password)
    const account = findMockAuthAccount(username, password)
    if (!account?.totpSecret) {
      error = 'Invalid username or password.'
      return
    }
    setPendingTotpSession({
      username: account.username,
      totpSecret: account.totpSecret,
    })
    navigate('/totp/verify')
  }
</script>

<main>
  <h1>Sign in</h1>
  <p data-testid="mock-auth-scenario">login-then-totp</p>
  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}
  <form id="login-form" method="post" action="/totp/login" {onsubmit}>
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
