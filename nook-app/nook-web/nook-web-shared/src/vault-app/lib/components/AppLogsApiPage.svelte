<script lang="ts">
  import { omittedValue } from '../../../explicit-state'
  import { onMount } from 'svelte'
  import {
    loadAppLogsResponse,
    parseAppLogsQuery,
    type AppLogsResponse,
  } from '$lib/app-logs-api'

  type LogsPageState =
    | { kind: 'loading' }
    | { kind: 'loaded'; payload: AppLogsResponse }
    | { kind: 'failed'; message: string }

  let state = $state<LogsPageState>({ kind: 'loading' })

  onMount(() => {
    document.title = 'Nook app logs (JSON)'

    void (async () => {
      try {
        const query = parseAppLogsQuery(window.location.search)
        state = {
          kind: 'loaded',
          payload: await loadAppLogsResponse(query),
        }
      } catch (cause) {
        state = {
          kind: 'failed',
          message:
            cause instanceof Error ? cause.message : 'Failed to load app logs',
        }
      }
    })()
  })
</script>

<svelte:head>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<main class="app-logs-api-page">
  {#if state.kind === 'failed'}
    <pre data-testid="app-logs-error">{JSON.stringify(
        { error: state.message },
        omittedValue(),
        2,
      )}</pre>
  {:else if state.kind === 'loaded'}
    <pre data-testid="app-logs-json">{JSON.stringify(
        state.payload,
        omittedValue(),
        2,
      )}</pre>
  {:else}
    <pre data-testid="app-logs-loading">{JSON.stringify({
        loading: true,
      })}</pre>
  {/if}
</main>

<style>
  .app-logs-api-page {
    min-height: 100svh;
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
