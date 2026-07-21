<script lang="ts">
  import { onMount } from 'svelte'
  import { navigate } from '../lib/navigation'
  import {
    clearPendingTotpSession,
    readPendingTotpSession,
    type PendingTotpSession,
  } from '../lib/session'
  import { verifyTotpCode } from '../lib/totp'

  let session = $state<PendingTotpSession | undefined>(undefined)
  let error = $state('')
  let busy = $state(false)

  onMount(() => {
    const pending = readPendingTotpSession()
    if (!pending) {
      navigate('/totp/login')
      return
    }
    session = pending
  })

  async function onsubmit(event: SubmitEvent) {
    event.preventDefault()
    if (!session || busy) return
    const form = event.currentTarget
    if (!(form instanceof HTMLFormElement)) return
    const otp = new FormData(form).get('otp')
    if (typeof otp !== 'string') return
    busy = true
    error = ''
    try {
      const ok = await verifyTotpCode(session.totpSecret, otp)
      if (!ok) {
        error = 'Invalid authentication code.'
        return
      }
      clearPendingTotpSession()
      navigate('/totp/success')
    } finally {
      busy = false
    }
  }
</script>

<main>
  <h1>Verify account</h1>
  <p data-testid="mock-auth-scenario">totp-challenge</p>
  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}
  {#if session}
    <form id="otp-form" method="post" action="/totp/verify" {onsubmit}>
      <label
        >Authentication code
        <input
          autocomplete="one-time-code"
          inputmode="numeric"
          name="otp"
        />
      </label>
      <button type="submit" disabled={busy}>Verify</button>
    </form>
  {/if}
</main>
