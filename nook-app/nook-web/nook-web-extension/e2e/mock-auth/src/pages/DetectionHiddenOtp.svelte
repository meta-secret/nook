<script lang="ts">
  let revealed = $state(false)
</script>

<main>
  <h1>Verify account</h1>
  <form id="otp-form" hidden={!revealed}>
    <input autocomplete="one-time-code" inputmode="numeric" name="otp" />
    <button type="submit">Verify</button>
  </form>
  {#if !revealed}
    <button
      id="reveal-otp"
      type="button"
      onclick={() => {
        revealed = true
      }}>Continue to verification</button
    >
  {/if}
</main>
