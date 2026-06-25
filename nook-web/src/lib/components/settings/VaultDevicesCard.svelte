<script lang="ts">
  import {
    Check,
    ChevronDown,
    Copy,
    Laptop,
    Pencil,
    ShieldOff,
    Smartphone,
    TriangleAlert,
    X,
  } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import type { JoinRequest, VaultMember } from '$lib/nook'

  let {
    deviceId,
    devicePublicKey,
    pendingJoins = [] as JoinRequest[],
    vaultMembers = [] as VaultMember[],
    isBusy,
    hasPasswordEnvelope = false,
    onApproveJoin,
    onDenyJoin,
    onRenameDevice,
    onRevokeDevice,
  }: {
    deviceId: string
    devicePublicKey: string
    pendingJoins?: JoinRequest[]
    vaultMembers?: VaultMember[]
    isBusy: boolean
    hasPasswordEnvelope?: boolean
    onApproveJoin: (deviceId: string) => void | Promise<void>
    onDenyJoin: (deviceId: string) => void | Promise<void>
    onRenameDevice: (authId: string, label: string) => void | Promise<void>
    onRevokeDevice: (authId: string) => void | Promise<void>
  } = $props()

  let detailsAuthId = $state<string | null>(null)
  let renameAuthId = $state<string | null>(null)
  let renameLabel = $state('')
  let revokeAuthId = $state<string | null>(null)

  const sortedMembers = $derived(
    [...vaultMembers].sort((a, b) => {
      if (a.device_id === deviceId) return -1
      if (b.device_id === deviceId) return 1
      return displayName(a).localeCompare(displayName(b))
    }),
  )

  function currentDeviceName(): string {
    if (typeof navigator === 'undefined') return 'This browser'
    const ua = navigator.userAgent
    let os = 'Unknown OS'
    if (ua.includes('Android')) os = 'Android'
    else if (ua.includes('like Mac')) os = 'iOS'
    else if (ua.includes('Win')) os = 'Windows'
    else if (ua.includes('Mac')) os = 'Mac'
    else if (ua.includes('Linux')) os = 'Linux'

    let browser = 'Browser'
    if (ua.includes('Edg')) browser = 'Edge'
    else if (ua.includes('Firefox')) browser = 'Firefox'
    else if (ua.includes('Chrome')) browser = 'Chrome'
    else if (ua.includes('Safari')) browser = 'Safari'
    return `${browser} on ${os}`
  }

  function truncate(value: string, head = 8, tail = 6) {
    if (value.length <= head + tail + 3) return value
    return `${value.slice(0, head)}…${value.slice(-tail)}`
  }

  function formatDate(value: string): string {
    if (!value || value === 'genesis' || value === 'self-sync')
      return 'Enrolled'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return 'Enrolled'
    return `Enrolled ${date.toLocaleDateString()}`
  }

  function formatRequestDate(value: string): string {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return 'recently'
    return date.toLocaleDateString()
  }

  function displayName(member: VaultMember): string {
    const label = member.label.trim()
    if (label) return label
    if (member.device_id === deviceId) return currentDeviceName()
    return `Device ${truncate(member.device_id, 6, 4)}`
  }

  function beginRename(member: VaultMember) {
    renameAuthId = member.auth_id
    renameLabel = member.label.trim()
    revokeAuthId = null
  }

  async function saveRename(member: VaultMember) {
    await onRenameDevice(member.auth_id, renameLabel)
    renameAuthId = null
    renameLabel = ''
  }

  async function copyText(value: string) {
    if (!value) return
    await navigator.clipboard.writeText(value)
  }
</script>

<div class="space-y-4" data-testid="vault-devices-card">
  {#if vaultMembers.length <= 1}
    <div
      class="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:text-amber-300"
      role="alert"
      data-testid="single-device-warning"
    >
      <TriangleAlert class="mt-0.5 size-3.5 shrink-0" />
      <span>
        Add another device before removing this one. A backup password helps
        with recovery, but at least one device key must remain enrolled.
      </span>
    </div>
  {/if}

  {#if pendingJoins.length > 0}
    <section class="space-y-2" data-testid="pending-join-list">
      <div class="flex items-center justify-between gap-3">
        <h3 class="text-sm font-semibold text-foreground">Pending requests</h3>
        <span class="text-xs text-muted-foreground">
          {pendingJoins.length}
          {pendingJoins.length === 1 ? 'request' : 'requests'}
        </span>
      </div>
      <ul class="space-y-2">
        {#each pendingJoins as join (join.device_id)}
          <li
            class="rounded-lg border border-border/40 bg-background/60 p-3 sm:border-border/60"
            data-testid="pending-join-row"
          >
            <div class="flex items-center justify-between gap-3">
              <div class="flex min-w-0 items-center gap-3">
                <div
                  class="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/40 bg-muted/35 text-muted-foreground"
                >
                  <Smartphone class="size-4.5" />
                </div>
                <div class="min-w-0">
                  <p class="truncate text-sm font-medium text-foreground">
                    Device {truncate(join.device_id)}
                  </p>
                  <p class="text-xs text-muted-foreground">
                    Requested {formatRequestDate(join.requested_at)}
                  </p>
                </div>
              </div>
              <div class="flex shrink-0 items-center gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  class="border-border/50 px-2"
                  disabled={isBusy}
                  data-testid="deny-join-btn"
                  aria-label="Deny join request"
                  onclick={() => void onDenyJoin(join.device_id)}
                >
                  <X class="size-3.5" />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={isBusy}
                  data-testid="approve-join-btn"
                  onclick={() => void onApproveJoin(join.device_id)}
                >
                  <Check class="size-3.5" />
                  Approve
                </Button>
              </div>
            </div>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <section class="space-y-2">
    <div class="flex items-center justify-between gap-3">
      <h3 class="text-sm font-semibold text-foreground">Enrolled devices</h3>
      <span class="text-xs text-muted-foreground">
        {vaultMembers.length}
        {vaultMembers.length === 1 ? 'device' : 'devices'}
      </span>
    </div>

    {#if sortedMembers.length === 0}
      <div
        class="rounded-lg border border-border/40 bg-muted/15 px-3 py-4 text-center text-sm text-muted-foreground"
        data-testid="vault-devices-empty"
      >
        No enrolled devices found for this vault.
      </div>
    {:else}
      <ul class="space-y-2" data-testid="vault-members-list">
        {#each sortedMembers as member (member.auth_id)}
          {@const isCurrent = member.device_id === deviceId}
          {@const isRenaming = renameAuthId === member.auth_id}
          {@const isConfirmingRevoke = revokeAuthId === member.auth_id}
          {@const canRevoke = vaultMembers.length > 1}
          <li
            class="rounded-lg border border-border/40 bg-background/60 p-3 sm:border-border/60"
            data-testid="vault-member-row"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="flex min-w-0 items-start gap-3">
                <div
                  class="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/40 bg-muted/35 text-muted-foreground"
                >
                  {#if isCurrent}
                    <Laptop class="size-4.5" />
                  {:else}
                    <Smartphone class="size-4.5" />
                  {/if}
                </div>
                <div class="min-w-0 space-y-1">
                  {#if isRenaming}
                    <label class="sr-only" for={`rename-${member.auth_id}`}>
                      Device name
                    </label>
                    <input
                      id={`rename-${member.auth_id}`}
                      bind:value={renameLabel}
                      maxlength="80"
                      class="h-9 w-full rounded-md border border-border/45 bg-background/80 px-3 text-sm text-foreground focus:outline-hidden focus:ring-2 focus:ring-ring"
                      data-testid="device-rename-input"
                    />
                  {:else}
                    <p
                      class="truncate text-sm font-medium text-foreground"
                      data-testid="device-display-name"
                    >
                      {displayName(member)}
                    </p>
                  {/if}
                  <div class="flex flex-wrap items-center gap-1.5">
                    {#if isCurrent}
                      <span
                        class="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"
                        data-testid="current-device-badge"
                      >
                        Current
                      </span>
                    {:else}
                      <span
                        class="rounded-full border border-border/40 bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
                      >
                        Enrolled
                      </span>
                    {/if}
                    <span class="text-xs text-muted-foreground">
                      {formatDate(member.enrolled_at)}
                    </span>
                    {#if isCurrent && hasPasswordEnvelope}
                      <span class="text-xs text-muted-foreground">
                        Password recovery available
                      </span>
                    {/if}
                  </div>
                </div>
              </div>

              <div class="flex shrink-0 items-center gap-1">
                {#if isRenaming}
                  <Button
                    type="button"
                    size="sm"
                    class="px-2"
                    disabled={isBusy}
                    data-testid="device-rename-save"
                    aria-label="Save device name"
                    onclick={() => void saveRename(member)}
                  >
                    <Check class="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    class="border-border/50 px-2"
                    disabled={isBusy}
                    aria-label="Cancel rename"
                    onclick={() => {
                      renameAuthId = null
                      renameLabel = ''
                    }}
                  >
                    <X class="size-3.5" />
                  </Button>
                {:else}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    class="px-2 text-muted-foreground"
                    disabled={isBusy}
                    data-testid="device-rename-btn"
                    aria-label="Rename device"
                    onclick={() => beginRename(member)}
                  >
                    <Pencil class="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    class="px-2 text-muted-foreground hover:text-destructive"
                    disabled={isBusy || !canRevoke}
                    data-testid="device-revoke-btn"
                    aria-label="Revoke device"
                    onclick={() => {
                      revokeAuthId = member.auth_id
                      renameAuthId = null
                    }}
                  >
                    <ShieldOff class="size-3.5" />
                  </Button>
                {/if}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  class="px-2 text-muted-foreground"
                  aria-label="Toggle device details"
                  aria-expanded={detailsAuthId === member.auth_id}
                  data-testid="device-details-toggle"
                  onclick={() =>
                    (detailsAuthId =
                      detailsAuthId === member.auth_id ? null : member.auth_id)}
                >
                  <ChevronDown
                    class="size-3.5 transition-transform {detailsAuthId ===
                    member.auth_id
                      ? 'rotate-180'
                      : ''}"
                  />
                </Button>
              </div>
            </div>

            {#if isConfirmingRevoke}
              <div
                class="mt-3 rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                data-testid="device-revoke-confirm"
              >
                <div
                  class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
                >
                  <p>
                    {isCurrent
                      ? 'Remove this browser from the vault and lock it?'
                      : 'Remove this device from future vault access?'}
                  </p>
                  <div class="flex shrink-0 items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      class="h-8 border-destructive/30 bg-transparent text-destructive hover:bg-destructive/10 hover:text-destructive"
                      disabled={isBusy}
                      data-testid="device-revoke-cancel"
                      onclick={() => (revokeAuthId = null)}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      class="h-8"
                      disabled={isBusy}
                      data-testid="device-revoke-confirm-btn"
                      onclick={() => void onRevokeDevice(member.auth_id)}
                    >
                      Revoke
                    </Button>
                  </div>
                </div>
              </div>
            {/if}

            {#if detailsAuthId === member.auth_id}
              <dl
                class="mt-3 space-y-2 border-t border-border/30 pt-3 text-xs"
                data-testid="device-technical-details"
              >
                <div class="flex items-center justify-between gap-3">
                  <dt class="text-muted-foreground">Device ID</dt>
                  <dd class="flex min-w-0 items-center gap-1 font-mono">
                    <span class="truncate">{member.device_id}</span>
                    <button
                      type="button"
                      class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                      aria-label="Copy device ID"
                      onclick={() => void copyText(member.device_id)}
                    >
                      <Copy class="size-3" />
                    </button>
                  </dd>
                </div>
                <div class="flex items-center justify-between gap-3">
                  <dt class="text-muted-foreground">Auth ID</dt>
                  <dd class="font-mono" title={member.auth_id}>
                    {truncate(member.auth_id, 10, 8)}
                  </dd>
                </div>
                <div class="flex items-start justify-between gap-3">
                  <dt class="shrink-0 text-muted-foreground">Public key</dt>
                  <dd class="flex min-w-0 items-center gap-1 font-mono">
                    <span class="truncate" title={member.public_key}>
                      {truncate(member.public_key, 12, 10)}
                    </span>
                    <button
                      type="button"
                      class="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                      aria-label="Copy public key"
                      onclick={() => void copyText(member.public_key)}
                    >
                      <Copy class="size-3" />
                    </button>
                  </dd>
                </div>
              </dl>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <div
    class="rounded-lg border border-border/35 bg-muted/15 px-3 py-2 text-xs text-muted-foreground"
  >
    This browser: <span class="font-mono">{deviceId || 'not initialized'}</span>
    {#if devicePublicKey}
      <span class="sr-only">{devicePublicKey}</span>
    {/if}
  </div>
</div>
