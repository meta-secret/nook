<script lang="ts">
  import { onMount } from 'svelte'
  import { MOCK_AUTH_ACCOUNTS } from '../../accounts'
  import FixtureCredentials from '../lib/FixtureCredentials.svelte'
  import { completePlainLogin } from '../lib/plain-login'

  const fixtureAccount = MOCK_AUTH_ACCOUNTS.find(
    (account) => !account.totpSecret,
  )!

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
    if (completePlainLogin(username, password) === 'invalid') {
      error = 'Invalid username or password.'
    }
  }
</script>

<main>
  <h1>Sign in</h1>
  <p data-testid="mock-auth-scenario">plain-login</p>
  <FixtureCredentials account={fixtureAccount} />
  {#if error}
    <p class="error" role="alert" data-nook-auth-outcome="error">{error}</p>
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
