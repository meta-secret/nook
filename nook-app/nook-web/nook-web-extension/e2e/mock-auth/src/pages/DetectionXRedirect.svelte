<script lang="ts">
  import { onMount } from 'svelte'

  import { X_AUTH_MOCK_ONBOARDING_PATH } from '../lib/x-auth-flow'

  onMount(() => {
    location.replace(X_AUTH_MOCK_ONBOARDING_PATH)
  })
</script>

<main>
  <h1>Redirecting to X sign in</h1>
</main>
