<script lang="ts">
  import { registerDynamicMockAuthAccount } from '../lib/dynamic-accounts'
  import { navigate, recordLoginSubmission } from '../lib/navigation'

  let error = $state('')

  function onsubmit(event: SubmitEvent) {
    event.preventDefault()
    const form = event.currentTarget
    if (!(form instanceof HTMLFormElement)) return
    const username =
      form.querySelector<HTMLInputElement>('[name="email"]')?.value.trim() ?? ''
    const password =
      form.querySelector<HTMLInputElement>('[name="password"]')?.value ?? ''
    const confirm =
      form.querySelector<HTMLInputElement>('[name="password-confirm"]')
        ?.value ?? ''
    if (!username || !password) {
      error = 'Email and password are required.'
      return
    }
    if (password !== confirm) {
      error = 'Passwords do not match.'
      return
    }
    registerDynamicMockAuthAccount(username, password)
    recordLoginSubmission(username, password)
    navigate('/signup/success')
  }
</script>

<main>
  <h1>Create account</h1>
  <p data-testid="mock-auth-scenario">signup</p>
  {#if error}
    <p class="error" role="alert" data-nook-auth-outcome="error">{error}</p>
  {/if}
  <form {onsubmit}>
    <input autocomplete="username" name="email" type="email" />
    <input autocomplete="new-password" name="password" type="password" />
    <input
      autocomplete="new-password"
      name="password-confirm"
      type="password"
    />
    <button type="submit">Create account</button>
  </form>
</main>
