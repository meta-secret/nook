<script lang="ts">
  import { RefreshCw, UserPlus } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import type { JoinRequest } from '$lib/nook'

  let {
    pendingJoins,
    isBusy = false,
    onApproveJoin,
    onRefresh,
  }: {
    pendingJoins: JoinRequest[]
    isBusy?: boolean
    onApproveJoin: (deviceId: string) => void | Promise<void>
    onRefresh?: () => void | Promise<void>
  } = $props()

  function truncate(value: string, head = 10, tail = 8) {
    if (value.length <= head + tail + 3) return value
    return `${value.slice(0, head)}…${value.slice(-tail)}`
  }
</script>

{#if pendingJoins.length > 0}
  <div
    class="mb-6 rounded-lg border border-primary/25 bg-primary/5 p-4 animate-in fade-in slide-in-from-top-2"
    data-testid="pending-joins-banner"
  >
    <div class="flex items-start justify-between gap-3">
      <div class="space-y-1">
        <p class="text-sm font-semibold text-foreground inline-flex items-center gap-2">
          <UserPlus class="size-4 shrink-0 text-primary" />
          {pendingJoins.length === 1
            ? '1 device wants to join'
            : `${pendingJoins.length} devices want to join`}
        </p>
        <p class="text-xs leading-relaxed text-muted-foreground">
          Approve a device to encrypt vault keys for it. You can also manage joins in storage
          settings.
        </p>
      </div>
      {#if onRefresh}
        <Button
          type="button"
          variant="outline"
          size="sm"
          class="shrink-0 border-border"
          disabled={isBusy}
          data-testid="refresh-joins-banner-btn"
          aria-label="Refresh join requests"
          onclick={() => void onRefresh()}
        >
          <RefreshCw class="size-3.5 {isBusy ? 'animate-spin' : ''}" />
        </Button>
      {/if}
    </div>

    <ul class="mt-3 space-y-2" data-testid="pending-joins-list">
      {#each pendingJoins as join (join.device_id)}
        <li
          class="flex items-center justify-between gap-3 rounded-md border border-border bg-background/70 px-3 py-2.5"
          data-testid="device-join-row"
        >
          <div class="min-w-0">
            <p class="font-mono text-xs text-foreground">{join.device_id}</p>
            <p class="truncate text-[11px] text-muted-foreground" title={join.public_key}>
              {truncate(join.public_key, 10, 8)}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            disabled={isBusy}
            data-testid="approve-join-btn"
            onclick={() => void onApproveJoin(join.device_id)}
          >
            Approve
          </Button>
        </li>
      {/each}
    </ul>
  </div>
{/if}
