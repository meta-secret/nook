<!--
PRODUCT: Nook makes local device identity and vault access understandable without exposing secrets.
USER: A person who cannot remember which passkey manager, browser, PIN, or vault relationship they used.
MOMENT: They may have no vault, a locked vault, or an unlocked vault and need one trustworthy inventory.
DIRECTION: An evidence ledger—identity first, protection chain second, vault relationships third—with explicit provenance and unknown states.
DESIGN SYSTEM: Existing Nook typography, surfaces, semantic colors, controls, responsive shell, and light/dark themes.
-->
<script lang="ts">
  import { tick } from 'svelte'
  import {
    ArrowLeft,
    Check,
    ChevronRight,
    CircleHelp,
    Fingerprint,
    KeyRound,
    Laptop,
    LockKeyhole,
    RefreshCw,
    ShieldCheck,
    Users,
  } from '@lucide/svelte'
  import {
    DeviceAccessIdentityState,
    DeviceAccessProtectionKind,
    NookDeviceAccessTextKind,
    NookDeviceVaultAccessState,
    NookPasskeyAttachmentState,
    NookPasskeyBackupState,
    NookPasskeyTimestampEvidenceKind,
    PasskeyObservedBrowser,
    PasskeyObservedPlatform,
    PasskeyTransport,
    deviceAccessSnapshot,
    setDeviceAccessPasskeyProviderLabel,
  } from '$app-wasm'
  import type {
    NookDeviceAccessText,
    NookPasskeyTimestampEvidence,
  } from '$app-wasm'
  import { Button } from '$lib/components/ui/button'
  import DeviceProtectionGate from '$lib/components/DeviceProtectionGate.svelte'
  import type { VaultState } from '$lib/vault.svelte'
  import {
    DashboardFocusTargetKind,
    DashboardLoadKind,
    type DashboardLoadState,
    type DashboardText,
    DashboardTextKind,
    type DashboardTimestamp,
    DashboardTimestampKind,
    ProviderSaveKind,
  } from './devices-access-dashboard-state'

  let {
    vault,
    onBack,
    onManageVaultDevices,
    onManageVaultPasswords,
  }: {
    vault: VaultState
    onBack: () => void
    onManageVaultDevices: () => void
    onManageVaultPasswords: () => void
  } = $props()

  type VaultAccessView = {
    storeId: string
    label: string
    verified: boolean
    verifiedAt: DashboardText
    lastLocalUpdateAt: DashboardText
  }

  type DashboardView = {
    protection: DeviceAccessProtectionKind
    identityState: DeviceAccessIdentityState
    deviceId: DashboardText
    credentialId: DashboardText
    userHandleId: DashboardText
    passkeyName: DashboardText
    providerLabel: DashboardText
    createdAt: DashboardTimestamp
    lastUsedAt: DashboardTimestamp
    attachment: NookPasskeyAttachmentState
    transports: PasskeyTransport[]
    backupState: NookPasskeyBackupState
    aaguid: DashboardText
    observedBrowser: PasskeyObservedBrowser
    observedPlatform: PasskeyObservedPlatform
    vaults: VaultAccessView[]
  }

  let loadState = $state<DashboardLoadState<DashboardView>>({
    kind: DashboardLoadKind.Loading,
  })
  let providerDraft = $state('')
  let providerSaveState = $state<ProviderSaveKind>(ProviderSaveKind.Idle)
  let pendingFocusTarget = $state<DashboardFocusTargetKind>(
    DashboardFocusTargetKind.None,
  )
  let loadGeneration = 0

  const isPasskeyProtection = $derived(
    loadState.kind === DashboardLoadKind.Ready &&
      (loadState.view.protection ===
        DeviceAccessProtectionKind.PasskeyStandard ||
        loadState.view.protection ===
          DeviceAccessProtectionKind.PasskeyAntiHacker),
  )
  const verifiedVaultCount = $derived(
    loadState.kind === DashboardLoadKind.Ready
      ? loadState.view.vaults.filter((entry) => entry.verified).length
      : 0,
  )

  function readText(value: NookDeviceAccessText): DashboardText {
    try {
      return value.kind === NookDeviceAccessTextKind.Known
        ? { kind: DashboardTextKind.Known, value: value.value() }
        : { kind: DashboardTextKind.Unknown }
    } finally {
      value.free()
    }
  }

  function readTimestamp(
    value: NookPasskeyTimestampEvidence,
  ): DashboardTimestamp {
    try {
      if (value.kind === NookPasskeyTimestampEvidenceKind.Known) {
        return { kind: DashboardTimestampKind.Known, value: value.value() }
      }
      return value.kind === NookPasskeyTimestampEvidenceKind.NotYetObserved
        ? { kind: DashboardTimestampKind.NotYetObserved }
        : { kind: DashboardTimestampKind.Unavailable }
    } finally {
      value.free()
    }
  }

  function knownText(value: DashboardText): boolean {
    return value.kind === DashboardTextKind.Known
  }

  function textValue(value: DashboardText): string {
    return value.kind === DashboardTextKind.Known ? value.value : ''
  }

  function focusPendingDashboardTarget(): void {
    if (
      pendingFocusTarget !== DashboardFocusTargetKind.DeviceIdentityDetails
    ) {
      return
    }
    const target = document.querySelector<HTMLElement>(
      '[data-testid="devices-access-device-identity"] > summary',
    )
    if (!target) return
    pendingFocusTarget = DashboardFocusTargetKind.None
    target.focus()
  }

  async function focusAfterProtectionReady(): Promise<void> {
    pendingFocusTarget = DashboardFocusTargetKind.DeviceIdentityDetails
    if (loadState.kind !== DashboardLoadKind.Ready) return
    await tick()
    focusPendingDashboardTarget()
  }

  async function loadDashboard(): Promise<void> {
    const generation = ++loadGeneration
    loadState = { kind: DashboardLoadKind.Loading }
    try {
      const snapshot = await deviceAccessSnapshot(vault.deviceId)
      try {
        const vaults = snapshot.vaults().map((entry): VaultAccessView => {
          try {
            const verifiedAt = readText(entry.verifiedAt)
            return {
              storeId: entry.storeId,
              label: entry.label,
              verified:
                entry.accessState === NookDeviceVaultAccessState.Verified,
              verifiedAt,
              lastLocalUpdateAt: readText(entry.lastLocalUpdateAt),
            }
          } finally {
            entry.free()
          }
        })
        const transports = snapshot.transports().map((entry) => {
          try {
            return entry.kind
          } finally {
            entry.free()
          }
        })
        if (generation !== loadGeneration) return
        const view: DashboardView = {
          protection: snapshot.protection,
          identityState: snapshot.identityState,
          deviceId: readText(snapshot.deviceId),
          credentialId: readText(snapshot.credentialId),
          userHandleId: readText(snapshot.userHandleId),
          passkeyName: readText(snapshot.passkeyName),
          providerLabel: readText(snapshot.providerLabel),
          createdAt: readTimestamp(snapshot.createdAt),
          lastUsedAt: readTimestamp(snapshot.lastUsedAt),
          attachment: snapshot.attachment,
          transports,
          backupState: snapshot.backupState,
          aaguid: readText(snapshot.aaguid),
          observedBrowser: snapshot.observedBrowser,
          observedPlatform: snapshot.observedPlatform,
          vaults,
        }
        providerDraft = textValue(view.providerLabel)
        loadState = { kind: DashboardLoadKind.Ready, view }
        await tick()
        focusPendingDashboardTarget()
      } finally {
        snapshot.free()
      }
    } catch {
      if (generation === loadGeneration) {
        loadState = { kind: DashboardLoadKind.Failed }
      }
    }
  }

  async function saveProviderLabel(): Promise<void> {
    if (
      providerSaveState === ProviderSaveKind.Saving ||
      loadState.kind !== DashboardLoadKind.Ready ||
      loadState.view.credentialId.kind !== DashboardTextKind.Known
    ) {
      return
    }
    const credentialFingerprint = loadState.view.credentialId.value
    providerSaveState = ProviderSaveKind.Saving
    try {
      await setDeviceAccessPasskeyProviderLabel(
        credentialFingerprint,
        providerDraft,
      )
      await loadDashboard()
      providerSaveState = ProviderSaveKind.Idle
    } catch {
      providerSaveState = ProviderSaveKind.Failed
    } finally {
      if (loadState.kind === DashboardLoadKind.Ready) {
        await tick()
        document
          .querySelector<HTMLInputElement>(
            '[data-testid="devices-access-provider-label"]',
          )
          ?.focus()
      }
    }
  }

  function lastUsedLabel(value: DashboardTimestamp): string {
    if (value.kind === DashboardTimestampKind.Known) {
      return formatDate(value.value)
    }
    return value.kind === DashboardTimestampKind.NotYetObserved
      ? vault.t('devices_access.not_used_yet')
      : vault.t('devices_access.unknown_legacy')
  }

  function formatDate(value: string): string {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return vault.t('devices_access.unknown')
    return new Intl.DateTimeFormat(vault.locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date)
  }

  function protectionLabel(value: DeviceAccessProtectionKind): string {
    if (value === DeviceAccessProtectionKind.PasskeyStandard) {
      return vault.t('devices_access.passkey_standard')
    }
    if (value === DeviceAccessProtectionKind.CompanionSession) {
      return vault.t('devices_access.companion_session')
    }
    if (value === DeviceAccessProtectionKind.PasskeyAntiHacker) {
      return vault.t('devices_access.passkey_high_security')
    }
    if (value === DeviceAccessProtectionKind.PinOrPassphrase) {
      return vault.t('devices_access.pin_or_passphrase')
    }
    return vault.t('devices_access.not_prepared')
  }

  function identityStateLabel(value: DeviceAccessIdentityState): string {
    if (value === DeviceAccessIdentityState.Unlocked) {
      return vault.t('devices_access.identity_unlocked')
    }
    if (value === DeviceAccessIdentityState.Locked) {
      return vault.t('devices_access.identity_locked')
    }
    return vault.t('devices_access.identity_missing')
  }

  function browserLabel(value: PasskeyObservedBrowser): string {
    if (value === PasskeyObservedBrowser.Edge) return vault.t('devices_access.browser_edge')
    if (value === PasskeyObservedBrowser.Firefox) return vault.t('devices_access.browser_firefox')
    if (value === PasskeyObservedBrowser.Chrome) return vault.t('devices_access.browser_chrome')
    if (value === PasskeyObservedBrowser.Safari) return vault.t('devices_access.browser_safari')
    if (value === PasskeyObservedBrowser.Other) return vault.t('devices_access.browser_other')
    return vault.t('devices_access.unknown')
  }

  function platformLabel(value: PasskeyObservedPlatform): string {
    if (value === PasskeyObservedPlatform.Android) return vault.t('devices_access.platform_android')
    if (value === PasskeyObservedPlatform.AppleMobile) return vault.t('devices_access.platform_apple_mobile')
    if (value === PasskeyObservedPlatform.MacOs) return vault.t('devices_access.platform_macos')
    if (value === PasskeyObservedPlatform.Windows) return vault.t('devices_access.platform_windows')
    if (value === PasskeyObservedPlatform.Linux) return vault.t('devices_access.platform_linux')
    if (value === PasskeyObservedPlatform.Other) return vault.t('devices_access.platform_other')
    return vault.t('devices_access.unknown')
  }

  function clientEnvironmentLabel(
    browser: PasskeyObservedBrowser,
    platform: PasskeyObservedPlatform,
  ): string {
    if (
      browser === PasskeyObservedBrowser.Unknown &&
      platform === PasskeyObservedPlatform.Unknown
    ) {
      return vault.t('devices_access.unknown')
    }
    return vault.t('devices_access.client_description', {
      browser: browserLabel(browser),
      platform: platformLabel(platform),
    })
  }

  function attachmentLabel(value: NookPasskeyAttachmentState): string {
    if (value === NookPasskeyAttachmentState.Platform) {
      return vault.t('devices_access.attachment_platform')
    }
    if (value === NookPasskeyAttachmentState.CrossPlatform) {
      return vault.t('devices_access.attachment_cross_platform')
    }
    return vault.t('devices_access.unknown')
  }

  function backupLabel(value: NookPasskeyBackupState): string {
    if (value === NookPasskeyBackupState.BackedUp) {
      return vault.t('devices_access.backup_backed_up')
    }
    if (value === NookPasskeyBackupState.Eligible) {
      return vault.t('devices_access.backup_eligible')
    }
    if (value === NookPasskeyBackupState.NotEligible) {
      return vault.t('devices_access.backup_not_eligible')
    }
    return vault.t('devices_access.unknown')
  }

  function transportLabel(value: PasskeyTransport): string {
    if (value === PasskeyTransport.Ble) {
      return vault.t('devices_access.transport_ble')
    }
    if (value === PasskeyTransport.Hybrid) {
      return vault.t('devices_access.transport_hybrid')
    }
    if (value === PasskeyTransport.Internal) {
      return vault.t('devices_access.transport_internal')
    }
    if (value === PasskeyTransport.Nfc) {
      return vault.t('devices_access.transport_nfc')
    }
    return vault.t('devices_access.transport_usb')
  }

  function transportsLabel(values: PasskeyTransport[]): string {
    if (values.length === 0) return vault.t('devices_access.unknown')
    return new Intl.ListFormat(vault.locale, {
      style: 'long',
      type: 'conjunction',
    }).format(values.map(transportLabel))
  }

  $effect(() => {
    void vault.deviceProtectionStatus
    void vault.localVaults.length
    void loadDashboard()
  })
</script>

<section
  class="mx-auto w-full max-w-5xl space-y-6 pb-4"
  data-testid="devices-access-dashboard"
>
  <header class="flex items-start gap-3 border-b border-border/60 pb-5">
    <Button
      type="button"
      variant="ghost"
      size="icon"
      class="mt-0.5 shrink-0"
      aria-label={vault.t('common.back')}
      data-testid="devices-access-back"
      onclick={onBack}
    >
      <ArrowLeft class="size-4" />
    </Button>
    <div class="min-w-0 space-y-1">
      <h1 class="text-balance text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
        {vault.t('devices_access.title')}
      </h1>
      <p class="max-w-[70ch] text-pretty text-sm leading-relaxed text-muted-foreground">
        {vault.t('devices_access.description')}
      </p>
    </div>
  </header>

  {#if loadState.kind === DashboardLoadKind.Loading}
    <div class="flex min-h-56 items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
      <RefreshCw class="size-4 animate-spin" />
      {vault.t('devices_access.loading')}
    </div>
  {:else if loadState.kind === DashboardLoadKind.Failed}
    <div class="rounded-xl border border-destructive/30 bg-destructive/5 p-5" role="alert">
      <p class="font-medium text-foreground">{vault.t('devices_access.load_failed')}</p>
      <Button type="button" variant="outline" class="mt-3" onclick={() => void loadDashboard()}>
        <RefreshCw class="size-4" />
        {vault.t('devices_access.try_again')}
      </Button>
    </div>
  {:else}
    <div class="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside class="space-y-5 lg:sticky lg:top-24 lg:self-start">
        <div class="space-y-2">
          <h2 class="text-sm font-semibold text-foreground">
            {vault.t('devices_access.how_it_works')}
          </h2>
          <p class="text-pretty text-sm leading-relaxed text-muted-foreground">
            {vault.t('devices_access.how_it_works_desc')}
          </p>
        </div>
        <dl class="space-y-3 text-xs">
          <div class="flex gap-2">
            <ShieldCheck class="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <div>
              <dt class="font-medium text-foreground">{vault.t('devices_access.provenance_verified')}</dt>
              <dd class="text-muted-foreground">{vault.t('devices_access.provenance_verified_desc')}</dd>
            </div>
          </div>
          <div class="flex gap-2">
            <Laptop class="mt-0.5 size-3.5 shrink-0 text-primary" />
            <div>
              <dt class="font-medium text-foreground">{vault.t('devices_access.provenance_browser')}</dt>
              <dd class="text-muted-foreground">{vault.t('devices_access.provenance_browser_desc')}</dd>
            </div>
          </div>
          <div class="flex gap-2">
            <Fingerprint class="mt-0.5 size-3.5 shrink-0 text-primary" />
            <div>
              <dt class="font-medium text-foreground">{vault.t('devices_access.provenance_user')}</dt>
              <dd class="text-muted-foreground">{vault.t('devices_access.provenance_user_desc')}</dd>
            </div>
          </div>
          <div class="flex gap-2">
            <CircleHelp class="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            <div>
              <dt class="font-medium text-foreground">{vault.t('devices_access.provenance_unknown')}</dt>
              <dd class="text-muted-foreground">{vault.t('devices_access.provenance_unknown_desc')}</dd>
            </div>
          </div>
        </dl>
      </aside>

      <div class="overflow-hidden rounded-xl border border-border/70 bg-card" data-testid="devices-access-ledger">
        <section class="space-y-5 p-5 sm:p-6">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="space-y-1">
              <h2 class="text-lg font-semibold text-foreground">{vault.t('devices_access.this_browser')}</h2>
              <p class="text-sm text-muted-foreground">
                {#if loadState.view.protection === DeviceAccessProtectionKind.CompanionSession}
                  {vault.t('devices_access.this_browser_companion_desc')}
                {:else}
                  {vault.t('devices_access.this_browser_desc')}
                {/if}
              </p>
            </div>
            <div class="flex flex-wrap justify-end gap-2">
              <span
                class="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/35 px-2.5 py-1 text-xs font-medium text-foreground"
                data-testid="devices-access-identity-state"
              >
                {#if loadState.view.identityState === DeviceAccessIdentityState.Unlocked}
                  <ShieldCheck class="size-3.5 text-emerald-600 dark:text-emerald-400" />
                {:else if loadState.view.identityState === DeviceAccessIdentityState.Locked}
                  <LockKeyhole class="size-3.5 text-amber-600 dark:text-amber-400" />
                {:else}
                  <CircleHelp class="size-3.5 text-muted-foreground" />
                {/if}
                {identityStateLabel(loadState.view.identityState)}
              </span>
              <span class="inline-flex items-center rounded-full border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground">
                {protectionLabel(loadState.view.protection)}
              </span>
            </div>
          </div>

          <div class="grid gap-2 sm:grid-cols-[1fr_auto_1fr_auto_1fr] sm:items-stretch" aria-label={vault.t('devices_access.access_chain')}>
            <div class="rounded-lg bg-muted/45 p-3">
              <p class="text-xs text-muted-foreground">{vault.t('devices_access.protected_by')}</p>
              <p class="mt-1 text-sm font-medium text-foreground">{protectionLabel(loadState.view.protection)}</p>
            </div>
            <ChevronRight class="mx-auto size-4 rotate-90 self-center text-muted-foreground sm:rotate-0" />
            <div class="rounded-lg bg-muted/45 p-3">
              <p class="text-xs text-muted-foreground">{vault.t('devices_access.protects')}</p>
              <p class="mt-1 text-sm font-medium text-foreground">{vault.t('devices_access.device_age_key')}</p>
            </div>
            <ChevronRight class="mx-auto size-4 rotate-90 self-center text-muted-foreground sm:rotate-0" />
            <div class="rounded-lg bg-muted/45 p-3">
              <p class="text-xs text-muted-foreground">{vault.t('devices_access.opens')}</p>
              <p class="mt-1 text-sm font-medium text-foreground">
                {vault.t('devices_access.verified_vault_count', { count: String(verifiedVaultCount) })}
              </p>
            </div>
          </div>

          <p class="rounded-lg bg-primary/8 px-3 py-2.5 text-sm leading-relaxed text-foreground">
            <LockKeyhole class="mr-1 inline size-4 text-primary" />
            {vault.t('devices_access.backup_password_boundary')}
          </p>

          {#if loadState.view.protection !== DeviceAccessProtectionKind.Missing}
            <details class="rounded-lg border border-border/60 bg-background" data-testid="devices-access-device-identity">
              <summary class="min-h-11 cursor-pointer list-none px-3 py-3 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                {vault.t('devices_access.device_technical_details')}
              </summary>
              <p class="border-t border-border/50 px-3 pt-3 text-xs text-muted-foreground">{vault.t('devices_access.device_id')}</p>
              <p class="break-all px-3 pb-3 pt-1 font-mono text-xs text-foreground">
                {knownText(loadState.view.deviceId)
                  ? textValue(loadState.view.deviceId)
                  : vault.t('devices_access.unknown')}
              </p>
            </details>
          {/if}

          {#if loadState.view.protection === DeviceAccessProtectionKind.Missing}
            <div class="border-t border-border/60 pt-5" data-testid="devices-access-prepare-browser">
              <DeviceProtectionGate
                {vault}
                embedded
                onProtectionReady={() => void focusAfterProtectionReady()}
              />
            </div>
          {:else if isPasskeyProtection}
            <div class="grid gap-4 border-t border-border/60 pt-5 sm:grid-cols-2">
              <div>
                <p class="text-xs text-muted-foreground">{vault.t('devices_access.nook_passkey_name')}</p>
                <p class="mt-1 text-sm font-medium text-foreground">
                  {knownText(loadState.view.passkeyName)
                    ? textValue(loadState.view.passkeyName)
                    : vault.t('devices_access.unknown')}
                </p>
              </div>
              <div>
                <p class="text-xs text-muted-foreground">{vault.t('devices_access.last_successful_use')}</p>
                <p class="mt-1 text-sm font-medium text-foreground">
                  {lastUsedLabel(loadState.view.lastUsedAt)}
                </p>
              </div>
              <div class="sm:col-span-2">
                <label for="devices-access-provider-label" class="text-xs text-muted-foreground">
                  {vault.t('devices_access.where_saved')}
                </label>
                <div class="mt-1.5 flex flex-col gap-2 sm:flex-row">
                  <input
                    id="devices-access-provider-label"
                    class="min-h-11 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
                    maxlength="80"
                    placeholder={vault.t('devices_access.where_saved_placeholder')}
                    bind:value={providerDraft}
                    disabled={providerSaveState === ProviderSaveKind.Saving}
                    oninput={() => {
                      if (providerSaveState === ProviderSaveKind.Failed) {
                        providerSaveState = ProviderSaveKind.Idle
                      }
                    }}
                    data-testid="devices-access-provider-label"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    class="min-h-11"
                    disabled={providerSaveState === ProviderSaveKind.Saving || loadState.view.credentialId.kind !== DashboardTextKind.Known || providerDraft.trim() === textValue(loadState.view.providerLabel)}
                    data-testid="devices-access-provider-save"
                    onclick={() => void saveProviderLabel()}
                  >
                    {#if providerSaveState === ProviderSaveKind.Saving}<RefreshCw class="size-4 animate-spin" />{:else}<Check class="size-4" />{/if}
                    {vault.t('common.save')}
                  </Button>
                </div>
                <p class="mt-1.5 text-xs text-muted-foreground">
                  {vault.t('devices_access.where_saved_help')}
                </p>
                {#if providerSaveState === ProviderSaveKind.Failed}
                  <p class="mt-1 text-xs text-destructive" role="alert">{vault.t('devices_access.provider_save_failed')}</p>
                {/if}
              </div>

              <details class="sm:col-span-2 rounded-lg bg-muted/35 open:bg-muted/50">
                <summary class="min-h-11 cursor-pointer list-none px-3 py-3 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                  {vault.t('devices_access.technical_details')}
                </summary>
                <dl class="grid gap-x-5 gap-y-3 border-t border-border/50 px-3 py-4 text-sm sm:grid-cols-2">
                  <div><dt class="text-xs text-muted-foreground">{vault.t('devices_access.credential_id')}</dt><dd class="mt-1 break-all font-mono text-xs text-foreground">{knownText(loadState.view.credentialId) ? textValue(loadState.view.credentialId) : vault.t('devices_access.unknown')}</dd></div>
                  <div><dt class="text-xs text-muted-foreground">{vault.t('devices_access.user_handle_id')}</dt><dd class="mt-1 break-all font-mono text-xs text-foreground">{knownText(loadState.view.userHandleId) ? textValue(loadState.view.userHandleId) : vault.t('devices_access.unknown')}</dd></div>
                  <div><dt class="text-xs text-muted-foreground">{vault.t('devices_access.created')}</dt><dd class="mt-1 text-foreground">{loadState.view.createdAt.kind === DashboardTimestampKind.Known ? formatDate(loadState.view.createdAt.value) : vault.t('devices_access.unknown')}</dd></div>
                  <div><dt class="text-xs text-muted-foreground">{vault.t('devices_access.attachment')}</dt><dd class="mt-1 text-foreground">{attachmentLabel(loadState.view.attachment)}</dd></div>
                  <div><dt class="text-xs text-muted-foreground">{vault.t('devices_access.backup_status')}</dt><dd class="mt-1 text-foreground">{backupLabel(loadState.view.backupState)}</dd></div>
                  <div><dt class="text-xs text-muted-foreground">{vault.t('devices_access.transports')}</dt><dd class="mt-1 text-foreground">{transportsLabel(loadState.view.transports)}</dd></div>
                  <div><dt class="text-xs text-muted-foreground">{vault.t('devices_access.aaguid')}</dt><dd class="mt-1 break-all font-mono text-xs text-foreground">{knownText(loadState.view.aaguid) ? textValue(loadState.view.aaguid) : vault.t('devices_access.unknown')}</dd></div>
                  <div class="sm:col-span-2"><dt class="text-xs text-muted-foreground">{vault.t('devices_access.last_client')}</dt><dd class="mt-1 text-foreground">{clientEnvironmentLabel(loadState.view.observedBrowser, loadState.view.observedPlatform)}</dd></div>
                </dl>
              </details>
            </div>
          {/if}
        </section>

        <section class="space-y-4 border-t border-border/70 p-5 sm:p-6" data-testid="devices-access-vaults">
          <div>
            <h2 class="text-lg font-semibold text-foreground">{vault.t('devices_access.vault_relationships')}</h2>
            <p class="mt-1 text-sm text-muted-foreground">{vault.t('devices_access.vault_relationships_desc')}</p>
          </div>
          {#if loadState.view.vaults.length === 0}
            <div class="rounded-lg bg-muted/35 p-4 text-sm text-muted-foreground">
              {vault.t('devices_access.no_vaults')}
            </div>
          {:else}
            <ul class="divide-y divide-border/60 rounded-lg border border-border/60">
              {#each loadState.view.vaults as entry (entry.storeId)}
                <li class="grid gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div class="min-w-0">
                    <p class="truncate text-sm font-medium text-foreground">{entry.label}</p>
                    <details class="mt-1 text-xs text-muted-foreground">
                      <summary class="cursor-pointer select-none hover:text-foreground">
                        {vault.t('devices_access.vault_technical_details')}
                      </summary>
                      <p class="mt-1 break-all font-mono text-[0.7rem]">{entry.storeId}</p>
                    </details>
                  </div>
                  <div class="text-left sm:text-right">
                    {#if entry.verified}
                      <p class="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                        <ShieldCheck class="size-3.5" />
                        {vault.t('devices_access.access_verified')}
                      </p>
                      <p class="text-xs text-muted-foreground">{knownText(entry.verifiedAt) ? formatDate(textValue(entry.verifiedAt)) : vault.t('devices_access.unknown')}</p>
                    {:else}
                      <p class="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                        <CircleHelp class="size-3.5" />
                        {vault.t('devices_access.access_unknown')}
                      </p>
                      <p class="text-xs text-muted-foreground">
                        {knownText(entry.lastLocalUpdateAt)
                          ? vault.t('devices_access.last_local_update', { date: formatDate(textValue(entry.lastLocalUpdateAt)) })
                          : vault.t('devices_access.no_local_update')}
                      </p>
                    {/if}
                  </div>
                </li>
              {/each}
            </ul>
          {/if}
        </section>

        {#if vault.isAuthenticated}
          <section class="space-y-4 border-t border-border/70 p-5 sm:p-6" data-testid="devices-access-current-vault">
            <div>
              <h2 class="text-lg font-semibold text-foreground">{vault.t('devices_access.inside_current_vault')}</h2>
              <p class="mt-1 text-sm text-muted-foreground">{vault.t('devices_access.inside_current_vault_desc')}</p>
            </div>
            <div class="grid gap-5 sm:grid-cols-2">
              <div class="space-y-3">
                <div class="flex items-center gap-2">
                  <Users class="size-4 text-primary" />
                  <h3 class="text-sm font-semibold text-foreground">{vault.t('devices_access.enrolled_devices')}</h3>
                  <span class="text-xs text-muted-foreground">{vault.vaultMembers.length}</span>
                </div>
                <ul class="space-y-1.5 text-sm text-muted-foreground">
                  {#each vault.vaultMembers.slice(0, 4) as member (member.authId)}
                    {@const memberLabel = member.label.trim()}
                    <li class="flex items-start gap-2">
                      <span class="mt-2 size-1.5 shrink-0 rounded-full bg-muted-foreground/50"></span>
                      <div class="min-w-0">
                        <p class="truncate">
                          {memberLabel || vault.t('devices_access.unnamed_device')}
                        </p>
                        <details
                          class="mt-0.5 text-xs text-muted-foreground"
                          data-testid="devices-access-member-details"
                        >
                          <summary class="cursor-pointer select-none hover:text-foreground">
                            {vault.t('devices_access.device_technical_details')}
                          </summary>
                          <p class="mt-1 break-all font-mono text-[0.7rem]">{member.deviceId}</p>
                        </details>
                      </div>
                    </li>
                  {/each}
                </ul>
                <Button type="button" variant="outline" size="sm" onclick={onManageVaultDevices}>
                  {vault.t('devices_access.manage_devices')}
                </Button>
              </div>
              <div class="space-y-3">
                <div class="flex items-center gap-2">
                  <KeyRound class="size-4 text-primary" />
                  <h3 class="text-sm font-semibold text-foreground">{vault.t('devices_access.backup_passwords')}</h3>
                  <span class="text-xs text-muted-foreground">{vault.passwordEntries.length}</span>
                </div>
                {#if vault.passwordEntries.length > 0}
                  <ul class="space-y-1.5 text-sm text-muted-foreground">
                    {#each vault.passwordEntries.slice(0, 4) as entry (entry.id)}
                      <li class="flex items-center gap-2"><span class="size-1.5 rounded-full bg-muted-foreground/50"></span><span class="truncate">{entry.label}</span></li>
                    {/each}
                  </ul>
                {:else}
                  <p class="text-sm text-muted-foreground">{vault.t('devices_access.no_backup_passwords')}</p>
                {/if}
                <Button type="button" variant="outline" size="sm" onclick={onManageVaultPasswords}>
                  {vault.t('devices_access.manage_backup_passwords')}
                </Button>
              </div>
            </div>
          </section>
        {/if}
      </div>
    </div>
  {/if}
</section>
