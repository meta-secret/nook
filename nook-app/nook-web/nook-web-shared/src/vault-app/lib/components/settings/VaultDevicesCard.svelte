<script lang="ts">
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
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
  import { configuredVaultApplicationSupportsExtension } from '$app-wasm'
  import { Button } from '$lib/components/ui/button'
  import { openInstalledExtension } from '$lib/extension/connect'
  import {
    ExtensionSetupStatus,
    loadExtensionInstallTarget,
    openExtensionInstallTarget,
    resolveExtensionSetupState,
    shouldOfferExtensionSetup,
  } from '$lib/extension/install'
  import type { JoinRequest, VaultMember } from '$lib/nook'
  import type { VaultState } from '$lib/vault.svelte'
  import { VaultType } from '$lib/vault/architecture-model'
  import {
    ExtensionSetupOfferKind,
    type ExtensionSetupOffer,
  } from '$lib/app/extension-setup'
  import {
    MemberDetailsKind,
    MemberRenameKind,
    MemberRevocationKind,
    type MemberDetails,
    type MemberRename,
    type MemberRevocation,
  } from './vault-devices-card-state'

  const SUPPORTS_EXTENSION = configuredVaultApplicationSupportsExtension()

  let {
    vault,
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
    vault: VaultState
    deviceId: string
    devicePublicKey: string
    pendingJoins?: JoinRequest[]
    vaultMembers?: VaultMember[]
    isBusy: boolean
    hasPasswordEnvelope?: boolean
    onApproveJoin: (deviceId: string) => void | Promise<void>
    onDenyJoin: (deviceId: string) => void | Promise<void>
    onRenameDevice: (args: { readonly authId: string; readonly label: string }) => void | Promise<void>
    onRevokeDevice: (authId: string) => void | Promise<void>
  } = $props()

  let detailsAuthId = $state<MemberDetails>({
    kind: MemberDetailsKind.Collapsed,
  })
  let renameAuthId = $state<MemberRename>({ kind: MemberRenameKind.Idle })
  let renameLabel = $state('')
  let revokeAuthId = $state<MemberRevocation>({
    kind: MemberRevocationKind.Idle,
  })
  let extensionSetupState = $state<ExtensionSetupOffer>({
    kind: ExtensionSetupOfferKind.Hidden,
  })
  let extensionInstallBusy = $state(false)
  let extensionConnectError = $state(false)
  const isSentinelVault = $derived(
    vault.vaultArchitecture.vault_type === VaultType.Sentinel,
  )

  async function refreshExtensionSetupStatus() {
    if (!SUPPORTS_EXTENSION) return
    const state = await resolveExtensionSetupState(vault.activeVault)
    extensionSetupState = (() => { const shouldOfferExtensionSetupArgs: Parameters<typeof shouldOfferExtensionSetup>[0] = { status: state.status, environment: navigator }; return shouldOfferExtensionSetup(shouldOfferExtensionSetupArgs); })()
      ? { kind: ExtensionSetupOfferKind.Visible, setup: state }
      : { kind: ExtensionSetupOfferKind.Hidden }
  }

  async function handleExtensionInstall() {
    extensionInstallBusy = true
    try {
      const target = await loadExtensionInstallTarget()
      openExtensionInstallTarget(target)
    } finally {
      extensionInstallBusy = false
    }
  }

  async function handleExtensionConnect() {
    extensionInstallBusy = true
    extensionConnectError = false
    try {
      extensionConnectError = !(await openInstalledExtension())
    } finally {
      extensionInstallBusy = false
    }
  }

  async function handleExtensionSetupAction() {
    if (extensionSetupState.kind !== ExtensionSetupOfferKind.Visible) return
    const state = extensionSetupState.setup
    if (state.status === ExtensionSetupStatus.NotInstalled) {
      await handleExtensionInstall()
      return
    }
    await handleExtensionConnect()
  }

  function extensionStatusLabel(status: ExtensionSetupStatus): string {
    if (status === ExtensionSetupStatus.NotInstalled) {
      return vault.t(I18N_KEYS.ExtensionSetupStatusNotInstalled)
    }
    if (status === ExtensionSetupStatus.InstalledUnpaired) {
      return vault.t(I18N_KEYS.ExtensionSetupStatusInstalledUnpaired)
    }
    if (status === ExtensionSetupStatus.PairedElsewhere) {
      return vault.t(I18N_KEYS.ExtensionSetupStatusPairedElsewhere)
    }
    return vault.t(I18N_KEYS.ExtensionSetupStatusPaired)
  }

  $effect(() => {
    void vault.activeVault
    void refreshExtensionSetupStatus()

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refreshExtensionSetupStatus()
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    const observer = new MutationObserver(() => {
      void refreshExtensionSetupStatus()
    })
    const observeArgs: Parameters<typeof observer.observe>[1] = {
      attributes: true,
      attributeFilter: ['data-nook-extension-runtime-id'],
    };
    observer.observe(document.documentElement, observeArgs)

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      observer.disconnect()
    }
  })

  const sortedMembers = $derived(
    [...vaultMembers].sort(// eslint-disable-next-line max-params -- Host API owns this positional callback signature.
    (a, b) => {
      if (a.deviceId === deviceId) return -1
      if (b.deviceId === deviceId) return 1
      return displayName(a).localeCompare(displayName(b))
    }),
  )

  function currentDeviceName(): string {
    if (!('navigator' in globalThis))
      return vault.t(I18N_KEYS.DevicesCardThisBrowserOs)
    const ua = navigator.userAgent
    let os = vault.t(I18N_KEYS.DevicesCardUnknownOs)
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
    return `${browser} ${vault.t(I18N_KEYS.DevicesCardOn)} ${os}`
  }

  function truncate({ value, head, tail }: { readonly value: string; readonly head: number; readonly tail: number }) {
    if (value.length <= head + tail + 3) return value
    return `${value.slice(0, head)}…${value.slice(-tail)}`
  }

  function formatDate(value: string): string {
    if (!value || value === 'genesis' || value === 'self-sync')
      return vault.t(I18N_KEYS.DevicesCardEnrolled)
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return vault.t(I18N_KEYS.DevicesCardEnrolled)
    return `${vault.t(I18N_KEYS.DevicesCardEnrolledDatePrefix)}${date.toLocaleDateString()}`
  }

  function formatRequestDate(value: string): string {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return vault.t(I18N_KEYS.DevicesCardRecently)
    return date.toLocaleDateString()
  }

  function displayName(member: VaultMember): string {
    const label = member.label.trim()
    if (label) return label
    if (member.deviceId === deviceId) return currentDeviceName()
    const truncateArgs: Parameters<typeof truncate>[0] = { value: member.deviceId, head: 6, tail: 4 };
    return `${vault.t(I18N_KEYS.DevicesCardDevicePrefix)}${truncate(truncateArgs)}`
  }

  function beginRename(member: VaultMember) {
    renameAuthId = { kind: MemberRenameKind.Editing, authId: member.authId }
    renameLabel = member.label.trim()
    revokeAuthId = { kind: MemberRevocationKind.Idle }
  }

  async function saveRename(member: VaultMember) {
    const onRenameDeviceArgs: Parameters<typeof onRenameDevice>[0] = { authId: member.authId, label: renameLabel };
    await onRenameDevice(onRenameDeviceArgs)
    renameAuthId = { kind: MemberRenameKind.Idle }
    renameLabel = ''
  }

  async function copyText(value: string) {
    if (!value) return
    await navigator.clipboard.writeText(value)
  }
</script>

<div class="space-y-4" data-testid="vault-devices-card">
  {#if SUPPORTS_EXTENSION && extensionSetupState.kind === ExtensionSetupOfferKind.Visible}
    {@const extensionSetup = extensionSetupState.setup}
    <section
      class="space-y-2 rounded-lg border border-border/40 bg-background/60 p-3 sm:border-border/60"
      data-testid="extension-setup-settings"
      data-status={extensionSetup.status}
    >
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0 space-y-1">
          <h3 class="text-sm font-semibold text-foreground">
            {vault.t(I18N_KEYS.ExtensionSetupSettingsTitle)}
          </h3>
          <p class="text-xs leading-relaxed text-muted-foreground">
            {vault.t(I18N_KEYS.ExtensionSetupSettingsBody)}
          </p>
        </div>
        {#if extensionSetup}
          <span
            class="shrink-0 rounded-full border border-border/40 bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
            data-testid="extension-setup-settings-status"
          >
            {extensionStatusLabel(extensionSetup.status)}
          </span>
        {/if}
      </div>
      {#if extensionSetup.status === ExtensionSetupStatus.PairedElsewhere}
        <p
          class="font-mono text-[11px] leading-relaxed text-amber-700 dark:text-amber-300"
          data-testid="extension-setup-settings-connected-vault"
        >
          {(() => { const tArgs: Parameters<typeof vault.t>[0] = { key: I18N_KEYS.ExtensionSetupConnectedVault, replacements: {
            vault: extensionSetup.connectedVaultName ?? '',
            store: extensionSetup.connectedVaultStoreId ?? '',
          } }; return vault.t(tArgs); })()}
        </p>
      {/if}
      {#if extensionSetup.status === ExtensionSetupStatus.InstalledUnpaired || extensionSetup.status === ExtensionSetupStatus.PairedElsewhere}
        <p class="text-[11px] leading-relaxed text-muted-foreground/80">
          {vault.t(I18N_KEYS.ExtensionSetupPairHint)}
        </p>
        {#if extensionConnectError}
          <p class="text-xs text-destructive" role="alert">
            {vault.t(I18N_KEYS.ExtensionSetupConnectFailed)}
          </p>
        {/if}
      {/if}
      {#if extensionSetup.status !== ExtensionSetupStatus.Paired}
        <Button
          type="button"
          size="sm"
          variant={extensionSetup.status === ExtensionSetupStatus.NotInstalled
            ? 'default'
            : 'outline'}
          class={extensionSetup.status === ExtensionSetupStatus.NotInstalled
            ? ''
            : 'border-border'}
          disabled={extensionInstallBusy || isBusy}
          data-testid="extension-setup-settings-cta"
          onclick={() => void handleExtensionSetupAction()}
        >
          {#if extensionInstallBusy}
            {vault.t(
              extensionSetup.status === ExtensionSetupStatus.NotInstalled
                ? I18N_KEYS.ExtensionSetupLoadingInstall
                : I18N_KEYS.ExtensionSetupOpeningExtension,
            )}
          {:else if extensionSetup.status === ExtensionSetupStatus.NotInstalled}
            {vault.t(I18N_KEYS.ExtensionSetupInstallCta)}
          {:else}
            {vault.t(
              extensionSetup.status === ExtensionSetupStatus.PairedElsewhere
                ? I18N_KEYS.ExtensionSetupSwitchCta
                : I18N_KEYS.ExtensionSetupConnectCta,
            )}
          {/if}
        </Button>
      {/if}
    </section>
  {/if}

  {#if vaultMembers.length <= 1}
    <div
      class="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:text-amber-300"
      role="alert"
      data-testid="single-device-warning"
    >
      <TriangleAlert class="mt-0.5 size-3.5 shrink-0" />
      <span>
        {vault.t(
          isSentinelVault
            ? I18N_KEYS.DevicesCardSentinelSingleDeviceWarning
            : I18N_KEYS.DevicesCardSingleDeviceWarning,
        )}
      </span>
    </div>
  {/if}

  {#if isSentinelVault}
    <div
      class="flex items-start gap-2 rounded-lg border border-border/50 bg-muted/25 px-3 py-2 text-xs leading-relaxed text-muted-foreground"
      role="status"
      data-testid="sentinel-device-change-guidance"
    >
      <TriangleAlert class="mt-0.5 size-3.5 shrink-0" />
      <span>{vault.t(I18N_KEYS.DevicesCardSentinelDeviceChangeGuidance)}</span>
    </div>
  {/if}

  {#if pendingJoins.length > 0}
    <section class="space-y-2" data-testid="pending-join-list">
      <div class="flex items-center justify-between gap-3">
        <h3 class="text-sm font-semibold text-foreground">
          {vault.t(I18N_KEYS.DevicesCardPendingRequests)}
        </h3>
        <span class="text-xs text-muted-foreground">
          {pendingJoins.length === 1
            ? vault.t(I18N_KEYS.DevicesCardRequestsCountSingular)
            : (() => { const tArgs2: Parameters<typeof vault.t>[0] = { key: I18N_KEYS.DevicesCardRequestsCountPlural, replacements: {
                count: String(pendingJoins.length),
              } }; return vault.t(tArgs2); })()}
        </span>
      </div>
      <ul class="space-y-2">
        {#each pendingJoins as join (join.deviceId)}
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
                    {vault.t(I18N_KEYS.DevicesCardDevicePrefix)}{(() => { const truncateArgs2: Parameters<typeof truncate>[0] = { value: join.deviceId, head: 14, tail: 10 }; return truncate(
                      truncateArgs2,
                    ); })()}
                  </p>
                  <p class="text-xs text-muted-foreground">
                    {vault.t(
                      I18N_KEYS.DevicesCardRequestedPrefix,
                    )}{formatRequestDate(join.requestedAt)}
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
                  aria-label={vault.t(I18N_KEYS.SettingsDeny)}
                  onclick={() => void onDenyJoin(join.deviceId)}
                >
                  <X class="size-3.5" />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={isBusy}
                  data-testid="approve-join-btn"
                  onclick={() => void onApproveJoin(join.deviceId)}
                >
                  <Check class="size-3.5" />
                  {vault.t(I18N_KEYS.DevicesCardApprove)}
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
      <h3 class="text-sm font-semibold text-foreground">
        {vault.t(I18N_KEYS.DevicesCardEnrolledDevices)}
      </h3>
      <span class="text-xs text-muted-foreground">
        {vaultMembers.length === 1
          ? vault.t(I18N_KEYS.DevicesCardDeviceCountSingular)
          : (() => { const tArgs3: Parameters<typeof vault.t>[0] = { key: I18N_KEYS.DevicesCardDeviceCountPlural, replacements: {
              count: String(vaultMembers.length),
            } }; return vault.t(tArgs3); })()}
      </span>
    </div>

    {#if sortedMembers.length === 0}
      <div
        class="rounded-lg border border-border/40 bg-muted/15 px-3 py-4 text-center text-sm text-muted-foreground"
        data-testid="vault-devices-empty"
      >
        {vault.t(I18N_KEYS.DevicesCardNoDevices)}
      </div>
    {:else}
      <ul class="space-y-2" data-testid="vault-members-list">
        {#each sortedMembers as member (member.authId)}
          {@const isCurrent = member.deviceId === deviceId}
          {@const isRenaming =
            renameAuthId.kind === MemberRenameKind.Editing &&
            renameAuthId.authId === member.authId}
          {@const isConfirmingRevoke =
            revokeAuthId.kind === MemberRevocationKind.Confirming &&
            revokeAuthId.authId === member.authId}
          {@const canRevoke = vaultMembers.length > 1 && !isSentinelVault}
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
                    <label class="sr-only" for={`rename-${member.authId}`}>
                      {vault.t(I18N_KEYS.DevicesCardDeviceNameLabel)}
                    </label>
                    <input
                      id={`rename-${member.authId}`}
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
                        {vault.t(I18N_KEYS.DevicesCardCurrent)}
                      </span>
                    {:else}
                      <span
                        class="rounded-full border border-border/40 bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
                      >
                        {vault.t(I18N_KEYS.DevicesCardEnrolled)}
                      </span>
                    {/if}
                    <span class="text-xs text-muted-foreground">
                      {formatDate(member.enrolledAt)}
                    </span>
                    {#if isCurrent && hasPasswordEnvelope}
                      <span class="text-xs text-muted-foreground">
                        {vault.t(I18N_KEYS.DevicesCardPwRecoveryAvailable)}
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
                    aria-label={vault.t(I18N_KEYS.DevicesCardSaveDeviceName)}
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
                    aria-label={vault.t(I18N_KEYS.DevicesCardCancelRename)}
                    onclick={() => {
                      renameAuthId = { kind: MemberRenameKind.Idle }
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
                    aria-label={vault.t(I18N_KEYS.DevicesCardRenameDevice)}
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
                    aria-label={vault.t(I18N_KEYS.DevicesCardRevokeDevice)}
                    onclick={() => {
                      revokeAuthId = {
                        kind: MemberRevocationKind.Confirming,
                        authId: member.authId,
                      }
                      renameAuthId = { kind: MemberRenameKind.Idle }
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
                  aria-label={vault.t(I18N_KEYS.DevicesCardToggleDetails)}
                  aria-expanded={detailsAuthId.kind ===
                    MemberDetailsKind.Expanded &&
                    detailsAuthId.authId === member.authId}
                  data-testid="device-details-toggle"
                  onclick={() =>
                    (detailsAuthId =
                      detailsAuthId.kind === MemberDetailsKind.Expanded &&
                      detailsAuthId.authId === member.authId
                        ? { kind: MemberDetailsKind.Collapsed }
                        : {
                            kind: MemberDetailsKind.Expanded,
                            authId: member.authId,
                          })}
                >
                  <ChevronDown
                    class="size-3.5 transition-transform {detailsAuthId.kind ===
                      MemberDetailsKind.Expanded &&
                    detailsAuthId.authId === member.authId
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
                      ? vault.t(I18N_KEYS.DevicesCardConfirmRevokeCurrent)
                      : vault.t(I18N_KEYS.DevicesCardConfirmRevokeOther)}
                  </p>
                  <div class="flex shrink-0 items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      class="h-8 border-destructive/30 bg-transparent text-destructive hover:bg-destructive/10 hover:text-destructive"
                      disabled={isBusy}
                      data-testid="device-revoke-cancel"
                      onclick={() =>
                        (revokeAuthId = {
                          kind: MemberRevocationKind.Idle,
                        })}
                    >
                      {vault.t(I18N_KEYS.DevicesCardCancel)}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      class="h-8"
                      disabled={isBusy}
                      data-testid="device-revoke-confirm-btn"
                      onclick={() => void onRevokeDevice(member.authId)}
                    >
                      {vault.t(I18N_KEYS.DevicesCardRevoke)}
                    </Button>
                  </div>
                </div>
              </div>
            {/if}

            {#if detailsAuthId.kind === MemberDetailsKind.Expanded && detailsAuthId.authId === member.authId}
              <dl
                class="mt-3 space-y-2 border-t border-border/30 pt-3 text-xs"
                data-testid="device-technical-details"
              >
                <div class="flex items-center justify-between gap-3">
                  <dt class="text-muted-foreground">
                    {vault.t(I18N_KEYS.DevicesCardDeviceId)}
                  </dt>
                  <dd class="flex min-w-0 items-center gap-1 font-mono">
                    <span class="truncate">{member.deviceId}</span>
                    <button
                      type="button"
                      class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                      aria-label={vault.t(I18N_KEYS.DevicesCardCopyDeviceId)}
                      onclick={() => void copyText(member.deviceId)}
                    >
                      <Copy class="size-3" />
                    </button>
                  </dd>
                </div>
                <div class="flex items-center justify-between gap-3">
                  <dt class="text-muted-foreground">
                    {vault.t(I18N_KEYS.DevicesCardAuthId)}
                  </dt>
                  <dd class="font-mono" title={member.authId}>
                    {(() => { const truncateArgs3: Parameters<typeof truncate>[0] = { value: member.authId, head: 10, tail: 8 }; return truncate(truncateArgs3); })()}
                  </dd>
                </div>
                <div class="flex items-start justify-between gap-3">
                  <dt class="shrink-0 text-muted-foreground">
                    {vault.t(I18N_KEYS.DevicesCardPublicKey)}
                  </dt>
                  <dd class="flex min-w-0 items-center gap-1 font-mono">
                    <span class="truncate" title={member.publicKey}>
                      {(() => { const truncateArgs4: Parameters<typeof truncate>[0] = { value: member.publicKey, head: 12, tail: 10 }; return truncate(truncateArgs4); })()}
                    </span>
                    <button
                      type="button"
                      class="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                      aria-label={vault.t(I18N_KEYS.DevicesCardCopyPublicKey)}
                      onclick={() => void copyText(member.publicKey)}
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
    {vault.t(I18N_KEYS.DevicesCardThisBrowserPrefix)}<span class="font-mono"
      >{deviceId || vault.t(I18N_KEYS.DevicesCardNotInitialized)}</span
    >
    {#if devicePublicKey}
      <span class="sr-only">{devicePublicKey}</span>
    {/if}
  </div>
</div>
