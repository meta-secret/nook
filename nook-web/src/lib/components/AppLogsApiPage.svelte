<script lang="ts">
  import { onMount } from 'svelte'
  import {
    loadAppLogsResponse,
    parseAppLogsQuery,
    type AppLogsResponse,
  } from '$lib/app-logs-api'

  let payload = $state<AppLogsResponse | null>(null)
  let error = $state<string | null>(null)

  onMount(() => {
    document.title = 'Nook app logs (JSON)'

    void (async () => {
      try {
        const query = parseAppLogsQuery(window.location.search)
        payload = await loadAppLogsResponse(query)
      } catch (cause) {
        error =
          cause instanceof Error ? cause.message : 'Failed to load app logs'
      }
    })()
  })
</script>

<svelte:head>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

{#if error}
  <pre data-testid="app-logs-error">{JSON.stringify({ error }, null, 2)}</pre>
{:else if payload}
  <pre data-testid="app-logs-json">{JSON.stringify(payload, null, 2)}</pre>
{:else}
  <pre data-testid="app-logs-loading">{JSON.stringify({ loading: true })}</pre>
{/if}

<style>
  :global(body) {
    margin: 0;
    background: #0a0a0a;
    color: #e5e5e5;
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono',
      'Courier New', monospace;
    font-size: 12px;
    line-height: 1.45;
  }

  pre {
    margin: 0;
    padding: 1rem;
    white-space: pre-wrap;
    word-break: break-word;
  }
</style>
