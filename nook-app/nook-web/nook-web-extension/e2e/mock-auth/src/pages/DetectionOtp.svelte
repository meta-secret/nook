<script lang="ts">
  function preventSubmit(event: SubmitEvent): void {
    event.preventDefault()
  }
</script>

<main>
  <h1>Verify account</h1>
  <form method="post" action="/auth/verify" onsubmit={preventSubmit}>
    <input autocomplete="one-time-code" inputmode="numeric" name="otp" />
    <button type="submit">Verify</button>
  </form>
</main>
