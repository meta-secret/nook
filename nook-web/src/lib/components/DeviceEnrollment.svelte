<script lang="ts">
  import {
    ChevronDown,
    Copy,
    RefreshCw,
    Smartphone,
    Users,
  } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import type { JoinRequest, VaultMember } from '$lib/nook'

  let {
    deviceId,
    devicePublicKey,
    pendingJoins,
    vaultMembers = [] as VaultMember[],
    isBusy,
    onApproveJoin,
    onRefresh,
  }: {
    deviceId: string
    devicePublicKey: string
    pendingJoins: JoinRequest[]
    vaultMembers?: VaultMember[]
    isBusy: boolean
    onApproveJoin?: (deviceId: string) => void | Promise<void>
    onRefresh?: () => void | Promise<void>
  } = $props()

  let showTechnicalDetails = $state(false)

  async function copyText(label: string, value: string) {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      console.error(`Copy failed for ${label}`)
    }
  }

  function truncate(value: string, head = 10, tail = 8) {
    if (value.length <= head + tail + 3) return value
    return `${value.slice(0, head)}…${value.slice(-tail)}`
  }
</script>

<div
  class="space-y-4 rounded-lg border border-border bg-muted/20 p-3"
  data-testid="device-enrollment-panel"
>
  <div class="flex items-start justify-between gap-3">
    <div class="space-y-1">
      <p
        class="text-xs font-medium text-foreground inline-flex items-center gap-1.5"
      >
        <Smartphone class="size-3.5" />
        Devices & access
      </p>
      <p class="text-[11px] text-muted-foreground">
        Approve new browsers that request access. Device details are only needed
        when troubleshooting or sharing with another device.
      </p>
    </div>
    {#if onRefresh}
      <Button
        type="button"
        variant="outline"
        size="sm"
        class="shrink-0 border-border"
        disabled={isBusy}
        data-testid="refresh-joins-btn"
        onclick={() => void onRefresh()}
      >
        <RefreshCw class="size-3.5 {isBusy ? 'animate-spin' : ''}" />
      </Button>
    {/if}
  </div>

  {#if pendingJoins.length > 0}
    <div class="space-y-2">
      <p class="text-xs font-medium text-foreground">Pending join requests</p>
      <ul class="space-y-2" data-testid="pending-joins-list">
        {#each pendingJoins as join (join.device_id)}
          <li
            class="flex items-center justify-between gap-2 rounded-md border border-border bg-background/60 px-3 py-2"
            data-testid="device-join-row"
          >
            <div class="min-w-0">
              <p class="font-mono text-xs text-foreground">{join.device_id}</p>
              <p
                class="truncate text-[11px] text-muted-foreground"
                title={join.public_key}
              >
                {truncate(join.public_key, 10, 8)}
              </p>
            </div>
            {#if onApproveJoin}
              <Button
                type="button"
                size="sm"
                disabled={isBusy}
                data-testid="approve-join-btn"
                onclick={() => void onApproveJoin(join.device_id)}
              >
                Approve
              </Button>
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if vaultMembers.length > 0}
    <div class="space-y-2 border-t border-border/60 pt-3">
      <p
        class="text-xs font-medium text-foreground inline-flex items-center gap-1.5"
      >
        <Users class="size-3.5" />
        Enrolled devices ({vaultMembers.length})
      </p>
      <ul class="space-y-1.5" data-testid="vault-members-list">
        {#each vaultMembers as member (member.auth_id)}
          <li
            class="flex items-center justify-between gap-2 rounded-md border border-border bg-background/60 px-3 py-2 text-xs"
            data-testid="vault-member-row"
          >
            <div class="min-w-0">
              <p class="font-mono text-foreground">
                {member.device_id}
                {#if member.device_id === deviceId}
                  <span class="ml-1.5 text-[10px] text-primary"
                    >(this browser)</span
                  >
                {/if}
              </p>
              <p
                class="truncate font-mono text-[10px] text-muted-foreground"
                title={member.auth_id}
              >
                {truncate(member.auth_id, 8, 8)}
              </p>
            </div>
            {#if member.enrolled_at}
              <span class="shrink-0 text-[10px] text-muted-foreground">
                {member.enrolled_at === 'genesis' ? 'genesis' : 'enrolled'}
              </span>
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  <div class="rounded-lg border border-border bg-background/40">
    <button
      type="button"
      class="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      data-testid="device-details-toggle"
      aria-expanded={showTechnicalDetails}
      onclick={() => (showTechnicalDetails = !showTechnicalDetails)}
    >
      <span>Technical details for this browser</span>
      <ChevronDown
        class="size-3.5 shrink-0 transition-transform {showTechnicalDetails
          ? 'rotate-180'
          : ''}"
      />
    </button>

    {#if showTechnicalDetails}
      <dl class="space-y-2 border-t border-border px-3 py-3 text-xs">
        <div class="flex items-center justify-between gap-2">
          <dt class="text-muted-foreground">Device ID</dt>
          <dd class="flex items-center gap-1 font-mono text-foreground/90">
            <span data-testid="device-id">{deviceId || '—'}</span>
            {#if deviceId}
              <button
                type="button"
                class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="Copy device ID"
                onclick={() => void copyText('device id', deviceId)}
              >
                <Copy class="size-3" />
              </button>
            {/if}
          </dd>
        </div>
        <div class="flex items-start justify-between gap-2">
          <dt class="shrink-0 text-muted-foreground">Public key</dt>
          <dd
            class="flex min-w-0 items-center gap-1 font-mono text-[11px] text-foreground/90"
          >
            <span
              class="truncate"
              data-testid="device-public-key"
              title={devicePublicKey}
            >
              {devicePublicKey ? truncate(devicePublicKey, 12, 10) : '—'}
            </span>
            {#if devicePublicKey}
              <button
                type="button"
                class="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="Copy public key"
                onclick={() => void copyText('public key', devicePublicKey)}
              >
                <Copy class="size-3" />
              </button>
            {/if}
          </dd>
        </div>
      </dl>
    {/if}
  </div>
</div>
