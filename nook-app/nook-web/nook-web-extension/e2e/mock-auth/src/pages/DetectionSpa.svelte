<script lang="ts">
  let showPassword = $state(false)
</script>

<main>
  <form id="login-form">
    <input autocomplete="username" name="email" type="email" />
    {#if showPassword}
      <input
        autocomplete="current-password"
        name="password"
        type="password"
      />
      <button type="submit">Sign in</button>
    {:else}
      <button
        id="next"
        type="button"
        onclick={() => {
          showPassword = true
        }}>Next</button
      >
    {/if}
  </form>
</main>
