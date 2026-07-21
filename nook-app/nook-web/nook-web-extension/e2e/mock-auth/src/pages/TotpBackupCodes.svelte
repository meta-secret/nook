<script lang="ts">
  const backupCodes = [
    'A1B2-C3D4-E5F6',
    'G7H8-I9J0-K1L2',
    'M3N4-O5P6-Q7R8',
    'S9T0-U1V2-W3X4',
  ]
</script>

<main data-testid="mock-auth-totp-backup">
  <h1>Save your backup codes</h1>
  <p data-testid="mock-auth-scenario">totp-backup-codes</p>
  <p>
    Store these recovery codes in a safe place. Each code can be used once if you
    lose access to your authenticator.
  </p>
  <ul data-testid="mock-auth-backup-code-list">
    {#each backupCodes as code (code)}
      <li data-testid="mock-auth-backup-code">{code}</li>
    {/each}
  </ul>
</main>
