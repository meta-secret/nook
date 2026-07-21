<script lang="ts">
  import { onMount } from 'svelte'
  import { findMockAuthAccount, MOCK_AUTH_ACCOUNTS } from '../../accounts'
  import FixtureCredentials from '../lib/FixtureCredentials.svelte'
  import { navigate, recordLoginSubmission } from '../lib/navigation'

  const fixtureAccount = MOCK_AUTH_ACCOUNTS.find(
    (account) => !account.totpSecret,
  )!

  let error = $state('')
  let username = $state(fixtureAccount.username)
  let password = $state(fixtureAccount.password)

  onMount(() => {
    ;(
      window as Window & {
        __nookLoginSubmitted?: { email: string; password: string } | null
      }
    ).__nookLoginSubmitted = null
  })

  function onsubmit(event: SubmitEvent) {
    event.preventDefault()
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
  <FixtureCredentials account={fixtureAccount} />
  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}
  <form id="login-form" method="post" action="/plain/login" {onsubmit}>
    <label
      >Email <input
        autocomplete="username"
        name="username"
        type="email"
        bind:value={username}
      /></label
    >
    <label
      >Password <input
        autocomplete="current-password"
        name="password"
        type="password"
        bind:value={password}
      /></label
    >
    <button type="submit">Sign in</button>
  </form>
</main>
