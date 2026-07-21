<script lang="ts">
  let { flow }: { flow: string } = $props()
</script>

<main>
  <h1>Signed in</h1>
  <p class="ok" data-testid="mock-auth-success">Authentication complete</p>
  <p data-testid="mock-auth-flow">{flow}</p>
</main>
