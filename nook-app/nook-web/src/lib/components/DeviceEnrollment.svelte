<script lang="ts">
  import {
    ChevronDown,
    Copy,
    Laptop,
    Smartphone,
    TriangleAlert,
  } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import { createLogger } from '$lib/log'
  import type { JoinRequest, VaultMember } from '$lib/nook'

  const log = createLogger('device-enrollment')

  let {
    deviceId,
    devicePublicKey,
    pendingJoins,
    vaultMembers = [] as VaultMember[],
    isBusy,
    onApproveJoin,
  }: {
    deviceId: string
    devicePublicKey: string
    pendingJoins: JoinRequest[]
    vaultMembers?: VaultMember[]
    isBusy: boolean
    onApproveJoin?: (deviceId: string) => void | Promise<void>
    embedded?: boolean
  } = $props()

  let showTechnicalDetails = $state(false)

  function getCurrentDeviceName(): string {
    const ua = navigator.userAgent
    let os = 'Unknown OS'
    if (ua.includes('Win')) os = 'Windows'
    else if (ua.includes('Mac')) os = 'MacIntel'
    else if (ua.includes('Linux')) os = 'Linux'
    else if (ua.includes('Android')) os = 'Android'
    else if (ua.includes('like Mac')) os = 'iOS'

    let browser = 'Browser'
    if (ua.includes('Chrome')) browser = 'Chrome'
    else if (ua.includes('Safari')) browser = 'Safari'
    else if (ua.includes('Firefox')) browser = 'Firefox'
    else if (ua.includes('Edge')) browser = 'Edge'

    return `${browser} on ${os}`
  }

  async function copyText(label: string, value: string) {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
    } catch (error) {
      log.error(`Copy failed for ${label}`, error)
    }
  }

  function truncate(value: string, head = 10, tail = 8) {
    if (value.length <= head + tail + 3) return value
    return `${value.slice(0, head)}…${value.slice(-tail)}`
  }
</script>

<div class="w-full space-y-4" data-testid="device-enrollment-panel">
  {#if vaultMembers.length <= 1}
    <div
      class="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[11px] leading-normal text-amber-600 dark:text-amber-400 flex items-start gap-2"
      role="alert"
    >
      <TriangleAlert class="size-3.5 shrink-0 mt-0.5" />
      <span
        >Add another device to make your vault more resilient and ensure backup
        access if this browser is lost.</span
      >
    </div>
  {/if}

  {#if pendingJoins.length > 0 || vaultMembers.length > 0}
    <div class="space-y-3">
      <ul class="space-y-2.5" data-testid="vault-members-list">
        {#each vaultMembers as member (member.authId)}
          {@const isCurrent = member.deviceId === deviceId}
          <li
            class="flex items-center justify-between gap-3 rounded-lg border border-border bg-background/50 p-3"
            data-testid="vault-member-row"
          >
            <div class="flex items-center gap-3 min-w-0">
              <div
                class="flex size-9 items-center justify-center rounded-lg border border-border/60 bg-muted/40 text-muted-foreground"
              >
                {#if isCurrent}
                  <Laptop class="size-4.5" />
                {:else}
                  <Smartphone class="size-4.5" />
                {/if}
              </div>
              <div class="flex flex-col min-w-0">
                <span class="text-sm font-medium text-foreground truncate">
                  {#if isCurrent}
                    {getCurrentDeviceName()}
                  {:else}
                    Device {member.deviceId}
                  {/if}
                </span>
                <span class="text-xs text-muted-foreground">
                  {#if isCurrent}
                    Web
                  {:else}
                    Web · {member.deviceId === 'genesis'
                      ? 'Genesis'
                      : 'Enrolled'}
                  {/if}
                </span>
              </div>
            </div>
            {#if isCurrent}
              <span
                class="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-xs text-primary"
              >
                Current
              </span>
            {/if}
          </li>
        {/each}

        {#each pendingJoins as join (join.deviceId)}
          <li
            class="flex items-center justify-between gap-3 rounded-lg border border-border bg-background/50 p-3"
            data-testid="device-join-row"
          >
            <div class="flex items-center gap-3 min-w-0">
              <div
                class="flex size-9 items-center justify-center rounded-lg border border-border/60 bg-muted/40 text-muted-foreground"
              >
                <Smartphone class="size-4.5" />
              </div>
              <div class="flex flex-col min-w-0">
                <span class="text-sm font-medium text-foreground truncate">
                  Device {join.deviceId}
                </span>
                <span class="text-xs text-muted-foreground">
                  Web · Requested {new Date(
                    join.requestedAt,
                  ).toLocaleDateString()}
                </span>
              </div>
            </div>
            {#if onApproveJoin}
              <Button
                type="button"
                size="sm"
                disabled={isBusy}
                data-testid="approve-join-btn"
                onclick={() => void onApproveJoin(join.deviceId)}
              >
                Approve
              </Button>
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
