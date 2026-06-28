<script lang="ts">
  import { RefreshCw, UserPlus } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import type { JoinRequest } from '$lib/nook'

  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
    pendingJoins,
    isBusy = false,
    onApproveJoin,
    onRefresh,
    onOpenDevicesSettings,
  }: {
    vault: VaultState
    pendingJoins: JoinRequest[]
    isBusy?: boolean
    onApproveJoin: (deviceId: string) => void | Promise<void>
    onRefresh?: () => void | Promise<void>
    onOpenDevicesSettings?: () => void
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
        <p
          class="text-sm font-semibold text-foreground inline-flex items-center gap-2"
        >
          <UserPlus class="size-4 shrink-0 text-primary" />
          {pendingJoins.length === 1
            ? vault.t('pending_joins.one_wants_join')
            : vault.t('pending_joins.count_wants_join', {
                count: String(pendingJoins.length),
              })}
        </p>
        <p class="text-xs leading-relaxed text-muted-foreground">
          {vault.t('pending_joins.instructions')}
        </p>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        {#if onOpenDevicesSettings}
          <Button
            type="button"
            variant="outline"
            size="sm"
            class="border-border"
            data-testid="open-devices-settings-btn"
            onclick={onOpenDevicesSettings}
          >
            {vault.t('pending_joins.devices')}
          </Button>
        {/if}
        {#if onRefresh}
          <Button
            type="button"
            variant="outline"
            size="sm"
            class="border-border"
            disabled={isBusy}
            data-testid="refresh-joins-banner-btn"
            aria-label={vault.t('pending_joins.refresh_aria')}
            onclick={() => void onRefresh()}
          >
            <RefreshCw class="size-3.5 {isBusy ? 'animate-spin' : ''}" />
          </Button>
        {/if}
      </div>
    </div>

    <ul class="mt-3 space-y-2" data-testid="pending-joins-list">
      {#each pendingJoins as join (join.deviceId)}
        <li
          class="flex items-center justify-between gap-3 rounded-md border border-border bg-background/70 px-3 py-2.5"
          data-testid="device-join-row"
        >
          <div class="min-w-0">
            <p class="font-mono text-xs text-foreground">{join.deviceId}</p>
            <p
              class="truncate text-[11px] text-muted-foreground"
              title={join.publicKey}
            >
              {truncate(join.publicKey, 10, 8)}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            disabled={isBusy}
            data-testid="approve-join-btn"
            onclick={() => void onApproveJoin(join.deviceId)}
          >
            {vault.t('settings.approve')}
          </Button>
        </li>
      {/each}
    </ul>
  </div>
{/if}
