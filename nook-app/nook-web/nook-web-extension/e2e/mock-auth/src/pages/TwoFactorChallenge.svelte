<script lang="ts">
  import { MOCK_AUTH_ACCOUNTS } from '../../accounts'
  import { verifyTotpCode } from '../lib/totp'

  /** A sign-in two-factor challenge that checks the code against the enrolled account. */
  const enrolledCandidate = MOCK_AUTH_ACCOUNTS.find(
    (account) => account.totpSecret,
  )
  if (!enrolledCandidate?.totpSecret) {
    throw new Error('TOTP enrollment fixture account is missing')
  }
  const enrolledSecret = enrolledCandidate.totpSecret

  let accepted = $state(false)
  let error = $state('')

  async function onsubmit(event: SubmitEvent) {
    event.preventDefault()
    const form = event.currentTarget
    if (!(form instanceof HTMLFormElement)) return
    const code = new FormData(form).get('otp')
    if (typeof code !== 'string') return
    accepted = await verifyTotpCode(enrolledSecret, code)
    error = accepted ? '' : 'Invalid authentication code.'
  }
</script>

<main>
  <h1>Two-step verification</h1>
  {#if accepted}
    <p data-testid="mock-auth-2fa-accepted" data-nook-auth-outcome="success">
      Code accepted
    </p>
  {:else}
    {#if error}
      <p class="error" role="alert" data-nook-auth-outcome="error">{error}</p>
    {/if}
    <form method="post" action="/auth/verify" {onsubmit}>
      <label for="otp">Authentication code</label>
      <input
        id="otp"
        data-testid="mock-auth-2fa-code"
        name="otp"
        autocomplete="one-time-code"
        inputmode="numeric"
      />
      <button type="submit">Verify</button>
    </form>
  {/if}
</main>
