<script lang="ts">
  import { softNavigate } from '../lib/navigation'
</script>

<main data-testid="mock-auth-totp-enroll">
  <h1>Authenticator setup</h1>
  <p data-testid="mock-auth-scenario">totp-enroll-qr</p>
  <p>
    Scan this QR with your authenticator app, or use Nook to capture it after
    you approve.
  </p>
  <img
    data-testid="mock-auth-totp-qr"
    src="/totp-enroll-qr.png"
    width="220"
    height="220"
    alt="Authenticator QR code"
    data-nook-otpauth-uri="otpauth://totp/Mock%20Auth:alice-2fa%40nook.test?secret=JBSWY3DPEHPK3PXP&issuer=Mock%20Auth"
  />
  <p>
    <button
      type="button"
      data-testid="mock-auth-enroll-continue-verify"
      onclick={() => softNavigate('/totp/enroll/verify')}
    >
      Continue to verification
    </button>
  </p>
</main>
