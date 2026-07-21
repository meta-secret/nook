<script lang="ts">
  import { MOCK_AUTH_ACCOUNTS } from '../../accounts'
  import { softNavigate } from '../lib/navigation'
  import { verifyTotpCode } from '../lib/totp'

  const enrollAccount = MOCK_AUTH_ACCOUNTS.find((account) => account.totpSecret)!

  let error = $state('')
  let busy = $state(false)

  async function onsubmit(event: SubmitEvent) {
    event.preventDefault()
    if (busy || !enrollAccount.totpSecret) return
    const form = event.currentTarget
    if (!(form instanceof HTMLFormElement)) return
    const otp = new FormData(form).get('Code')
    if (typeof otp !== 'string') return
    busy = true
    error = ''
    try {
      const ok = await verifyTotpCode(enrollAccount.totpSecret, otp)
      if (!ok) {
        error = 'Invalid authentication code.'
        return
      }
      softNavigate('/totp/enroll/success')
    } finally {
      busy = false
    }
  }
</script>

<main data-testid="mock-auth-totp-enroll-verify">
  <h1>Verify authenticator</h1>
  <p data-testid="mock-auth-scenario">totp-enroll-verify</p>
  {#if error}
    <p class="error" role="alert" data-nook-auth-outcome="error">{error}</p>
  {/if}
  <form id="enroll-otp-form" {onsubmit}>
    <h2>Enter OTP Code</h2>
    <p>
      Enter the code from the authenticator you just set up for
      <strong>{enrollAccount.username}</strong>.
    </p>
    <input
      data-testid="mock-auth-enroll-otp-input"
      id="Code"
      name="Code"
      type="text"
      inputmode="numeric"
      placeholder="Enter OTP Code"
      autocomplete="one-time-code"
    />
    <button type="submit" disabled={busy}>Verify</button>
  </form>
</main>
