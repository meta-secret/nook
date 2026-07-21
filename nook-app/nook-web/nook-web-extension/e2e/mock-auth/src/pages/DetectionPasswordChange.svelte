<script lang="ts">
  import { navigate } from '../lib/navigation'

  let error = $state('')

  function onsubmit(event: SubmitEvent) {
    event.preventDefault()
    const form = event.currentTarget
    if (!(form instanceof HTMLFormElement)) return
    const username =
      form.querySelector<HTMLInputElement>('[name="email"]')?.value.trim() ?? ''
    const current =
      form.querySelector<HTMLInputElement>('[name="current-password"]')
        ?.value ?? ''
    const next =
      form.querySelector<HTMLInputElement>('[name="new-password"]')?.value ?? ''
    const confirm =
      form.querySelector<HTMLInputElement>('[name="new-password-confirm"]')
        ?.value ?? ''
    if (!username || !current || !next) {
      error = 'Email, current password, and new password are required.'
      return
    }
    if (next !== confirm) {
      error = 'New passwords do not match.'
      return
    }
    navigate('/password-change/success')
  }
</script>

<main>
  <h1>Change password</h1>
  <p data-testid="mock-auth-scenario">password-change</p>
  {#if error}
    <p class="error" role="alert" data-nook-auth-outcome="error">{error}</p>
  {/if}
  <form {onsubmit}>
    <label
      >Email <input autocomplete="username" name="email" type="email" /></label
    >
    <label
      >Current password <input
        autocomplete="current-password"
        name="current-password"
        type="password"
      /></label
    >
    <label
      >New password <input
        autocomplete="new-password"
        name="new-password"
        type="password"
      /></label
    >
    <label
      >Confirm new password <input
        autocomplete="new-password"
        name="new-password-confirm"
        type="password"
      /></label
    >
    <button type="submit">Update password</button>
  </form>
</main>
