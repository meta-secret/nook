<script lang="ts">
  import { onMount } from 'svelte'
  import { loadAppLogsResponse, parseAppLogsQuery } from '$lib/app/logs-api'
  import {
    LogsPageStateKind,
    type LogsPageState,
  } from './app-logs-api-page-state'

  let state = $state<LogsPageState>({ kind: LogsPageStateKind.Loading })

  onMount(() => {
    document.title = 'Nook app logs (JSON)'

    void (async () => {
      try {
        const query = parseAppLogsQuery(window.location.search)
        state = {
          kind: LogsPageStateKind.Loaded,
          payload: await loadAppLogsResponse(query),
        }
      } catch (cause) {
        state = {
          kind: LogsPageStateKind.Failed,
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
  {#if state.kind === LogsPageStateKind.Failed}
    <pre data-testid="app-logs-error">{(() => { const stringifyArgs: Parameters<typeof JSON.stringify>[0] = { error: state.message }; return JSON.stringify(
        stringifyArgs,
        undefined,
        2,
      ); })()}</pre>
  {:else if state.kind === LogsPageStateKind.Loaded}
    <pre data-testid="app-logs-json">{JSON.stringify(
        state.payload,
        undefined,
        2,
      )}</pre>
  {:else}
    <pre data-testid="app-logs-loading">{(() => { const stringifyArgs2: Parameters<typeof JSON.stringify>[0] = {
        loading: true,
      }; return JSON.stringify(stringifyArgs2); })()}</pre>
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
