<script lang="ts">
  import { onMount } from 'svelte'
  import { ChevronLeft, RefreshCw, Trash2, Copy } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
  } from '$lib/components/ui/card'
  import {
    clearLogs,
    dumpLogs,
    getLogLevel,
    logCount,
    setLogLevel,
    type LogEntry,
    type LogLevel,
  } from '$lib/log'

  let { onClose }: { onClose: () => void } = $props()

  const LEVELS: LogLevel[] = ['error', 'warn', 'info', 'debug', 'trace']
  const PAGE_SIZE = 100

  let minLevel = $state<LogLevel>('trace')
  let captureLevel = $state<LogLevel>('info')
  let entries = $state<LogEntry[]>([])
  let total = $state(0)
  let offset = $state(0)
  let loading = $state(false)
  let copied = $state(false)

  const newestFirst = $derived([...entries].reverse())
  const hasOlder = $derived(offset + PAGE_SIZE < total)
  const hasNewer = $derived(offset > 0)

  const LEVEL_CLASS: Record<LogLevel, string> = {
    error: 'text-red-400',
    warn: 'text-amber-400',
    info: 'text-sky-400',
    debug: 'text-emerald-400',
    trace: 'text-muted-foreground',
  }

  async function load() {
    loading = true
    try {
      total = await logCount()
      entries = await dumpLogs({ minLevel, limit: PAGE_SIZE, offset })
    } finally {
      loading = false
    }
  }

  function changeMinLevel(value: string) {
    minLevel = (value as LogLevel) ?? 'trace'
    offset = 0
    void load()
  }

  function changeCaptureLevel(value: string) {
    captureLevel = (value as LogLevel) ?? 'info'
    setLogLevel(captureLevel)
  }

  function older() {
    if (!hasOlder) return
    offset += PAGE_SIZE
    void load()
  }

  function newer() {
    if (!hasNewer) return
    offset = Math.max(0, offset - PAGE_SIZE)
    void load()
  }

  async function clearAll() {
    await clearLogs()
    offset = 0
    await load()
  }

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(newestFirst, null, 2))
      copied = true
      setTimeout(() => {
        copied = false
      }, 1500)
    } catch {
      // Clipboard may be unavailable; ignore.
    }
  }

  onMount(() => {
    captureLevel = getLogLevel()
    void load()
  })
</script>

<div class="w-full animate-in fade-in duration-300" data-testid="logs-page">
  <Card
    class="gap-0 border-border bg-card/80 py-0 shadow-lg shadow-black/20 backdrop-blur-sm overflow-hidden"
  >
    <CardHeader
      class="border-b border-border/60 space-y-0 gap-0 px-4 pb-3 pt-3 sm:px-5"
    >
      <div class="flex items-start justify-between gap-2">
        <div class="space-y-0.5">
          <CardTitle
            class="text-base font-semibold tracking-tight text-foreground"
          >
            Application logs
          </CardTitle>
          <CardDescription class="text-pretty text-xs leading-snug">
            Persisted locally in this browser (IndexedDB). Nothing is sent
            anywhere.
          </CardDescription>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          class="shrink-0 border-border"
          data-testid="logs-back-btn"
          onclick={onClose}
        >
          <ChevronLeft class="size-3.5" />
          Back
        </Button>
      </div>

      <div class="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <label class="flex items-center gap-1.5 text-muted-foreground">
          Show
          <select
            class="rounded-md border border-border/60 bg-background px-2 py-1 text-foreground"
            data-testid="logs-level-filter"
            value={minLevel}
            onchange={(event) => changeMinLevel(event.currentTarget.value)}
          >
            {#each LEVELS as level (level)}
              <option value={level}>{level} and above</option>
            {/each}
          </select>
        </label>

        <label class="flex items-center gap-1.5 text-muted-foreground">
          Capture
          <select
            class="rounded-md border border-border/60 bg-background px-2 py-1 text-foreground"
            data-testid="logs-capture-level"
            value={captureLevel}
            onchange={(event) => changeCaptureLevel(event.currentTarget.value)}
          >
            {#each LEVELS as level (level)}
              <option value={level}>{level}</option>
            {/each}
          </select>
        </label>

        <Button
          type="button"
          variant="outline"
          size="sm"
          class="border-border"
          data-testid="logs-refresh-btn"
          disabled={loading}
          onclick={() => load()}
        >
          <RefreshCw class="size-3.5" />
          Refresh
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          class="border-border"
          data-testid="logs-copy-btn"
          onclick={copyAll}
        >
          <Copy class="size-3.5" />
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          class="border-border"
          data-testid="logs-clear-btn"
          onclick={clearAll}
        >
          <Trash2 class="size-3.5" />
          Clear
        </Button>

        <span class="ml-auto text-muted-foreground" data-testid="logs-count">
          {total} stored
        </span>
      </div>
    </CardHeader>

    <CardContent class="px-0 py-0">
      {#if newestFirst.length === 0}
        <p
          class="px-4 py-8 text-center text-sm text-muted-foreground sm:px-5"
          data-testid="logs-empty"
        >
          {loading ? 'Loading…' : 'No log entries at this level.'}
        </p>
      {:else}
        <ul class="divide-y divide-border/40 font-mono text-xs">
          {#each newestFirst as entry (entry.ts + entry.scope + entry.message)}
            <li
              class="flex flex-col gap-0.5 px-4 py-2 sm:px-5"
              data-testid="logs-entry"
            >
              <div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span class="text-muted-foreground">{entry.ts}</span>
                <span
                  class="font-semibold uppercase {LEVEL_CLASS[entry.level]}"
                >
                  {entry.level}
                </span>
                <span class="text-foreground/70">[{entry.scope}]</span>
                <span class="break-all text-foreground">{entry.message}</span>
              </div>
              {#if entry.data}
                <pre
                  class="whitespace-pre-wrap break-all text-muted-foreground">{entry.data}</pre>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}

      <div
        class="flex items-center justify-between gap-2 border-t border-border/60 px-4 py-3 text-xs sm:px-5"
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          class="border-border"
          data-testid="logs-newer-btn"
          disabled={!hasNewer || loading}
          onclick={newer}
        >
          Newer
        </Button>
        <span class="text-muted-foreground">
          {offset + 1}–{offset + entries.length}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          class="border-border"
          data-testid="logs-older-btn"
          disabled={!hasOlder || loading}
          onclick={older}
        >
          Older
        </Button>
      </div>
    </CardContent>
  </Card>
</div>
