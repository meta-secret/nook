<script lang="ts">
  import { softNavigate } from '../lib/navigation'
</script>

<main data-testid="mock-auth-totp-enroll">
  <h1>Authenticator setup</h1>
  <p data-testid="mock-auth-scenario">totp-enroll-qr</p>
  <div>
    <div>
      <div>
        Scan this QR with your authenticator app, or use Nook to capture it
        after you approve.
      </div>
    </div>
    <div>
      <div>
        <img
          data-testid="mock-auth-totp-qr"
          src="/totp-enroll-qr.png"
          width="220"
          height="220"
          alt="Authenticator QR code"
        />
      </div>
    </div>
  </div>
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
