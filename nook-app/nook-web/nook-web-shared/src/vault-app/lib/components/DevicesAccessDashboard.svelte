<!--
PRODUCT: Nook makes local device identity and vault access understandable without exposing secrets.
USER: A person who cannot remember which passkey manager, browser, PIN, or vault relationship they used.
MOMENT: They may have no vault, a locked vault, or an unlocked vault and need one trustworthy inventory.
DIRECTION: An evidence ledger—identity first, protection chain second, vault relationships third—with explicit provenance and unknown states.
DESIGN SYSTEM: Existing Nook typography, surfaces, semantic colors, controls, responsive shell, and light/dark themes.
-->
<script module lang="ts">
  enum DashboardLoadKind {
    Loading = 'loading',
    Ready = 'ready',
    Failed = 'failed',
  }
</script>

<script lang="ts">
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
    DeviceAccessProtectionKind,
    NookDeviceAccessValueState,
    NookDeviceVaultAccessState,
    NookPasskeyAttachmentState,
    NookPasskeyBackupState,
    deviceAccessSnapshot,
    setDeviceAccessPasskeyProviderLabel,
  } from '$app-wasm'
  import { Button } from '$lib/components/ui/button'
  import DeviceProtectionGate from '$lib/components/DeviceProtectionGate.svelte'
  import type { VaultState } from '$lib/vault.svelte'

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
    verifiedAt: string
    lastUnlockedKnown: boolean
    lastUnlockedAt: string
  }

  type DashboardView = {
    protection: DeviceAccessProtectionKind
    deviceId: string
    credentialId: string
    userHandleId: string
    passkeyNameKnown: boolean
    passkeyName: string
    providerLabelKnown: boolean
    providerLabel: string
    createdAtKnown: boolean
    createdAt: string
    lastUsedAtKnown: boolean
    lastUsedAt: string
    attachment: NookPasskeyAttachmentState
    transports: string
    backupState: NookPasskeyBackupState
    aaguidKnown: boolean
    aaguid: string
    clientEnvironmentKnown: boolean
    clientEnvironment: string
    vaults: VaultAccessView[]
  }

  type DashboardLoadState =
    | { kind: typeof DashboardLoadKind.Loading }
    | { kind: typeof DashboardLoadKind.Ready; view: DashboardView }
    | { kind: typeof DashboardLoadKind.Failed }

  let loadState = $state<DashboardLoadState>({
    kind: DashboardLoadKind.Loading,
  })
  let providerDraft = $state('')
  let providerSaving = $state(false)
  let providerSaveFailed = $state(false)
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

  function known(state: NookDeviceAccessValueState): boolean {
    return state === NookDeviceAccessValueState.Known
  }

  async function loadDashboard(): Promise<void> {
    const generation = ++loadGeneration
    loadState = { kind: DashboardLoadKind.Loading }
    try {
      const snapshot = await deviceAccessSnapshot(vault.deviceId)
      try {
        const vaults = snapshot.vaults().map((entry): VaultAccessView => {
          try {
            return {
              storeId: entry.storeId,
              label: entry.label,
              verified:
                entry.accessState === NookDeviceVaultAccessState.Verified,
              verifiedAt: entry.verifiedAt,
              lastUnlockedKnown: known(entry.lastUnlockedState),
              lastUnlockedAt: entry.lastUnlockedAt,
            }
          } finally {
            entry.free()
          }
        })
        if (generation !== loadGeneration) return
        const view: DashboardView = {
          protection: snapshot.protection,
          deviceId: snapshot.deviceId,
          credentialId: snapshot.credentialId,
          userHandleId: snapshot.userHandleId,
          passkeyNameKnown: known(snapshot.passkeyNameState()),
          passkeyName: snapshot.passkeyName,
          providerLabelKnown: known(snapshot.providerLabelState()),
          providerLabel: snapshot.providerLabel,
          createdAtKnown: known(snapshot.createdAtState()),
          createdAt: snapshot.createdAt,
          lastUsedAtKnown: known(snapshot.lastUsedAtState()),
          lastUsedAt: snapshot.lastUsedAt,
          attachment: snapshot.attachment,
          transports: snapshot.transports,
          backupState: snapshot.backupState,
          aaguidKnown: known(snapshot.aaguidState()),
          aaguid: snapshot.aaguid,
          clientEnvironmentKnown: known(snapshot.clientEnvironmentState()),
          clientEnvironment: snapshot.clientEnvironment,
          vaults,
        }
        providerDraft = view.providerLabel
        loadState = { kind: DashboardLoadKind.Ready, view }
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
    if (providerSaving) return
    providerSaving = true
    providerSaveFailed = false
    try {
      await setDeviceAccessPasskeyProviderLabel(providerDraft)
      await loadDashboard()
    } catch {
      providerSaveFailed = true
    } finally {
      providerSaving = false
    }
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
              <p class="text-sm text-muted-foreground">{vault.t('devices_access.this_browser_desc')}</p>
            </div>
            <span class="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/35 px-2.5 py-1 text-xs font-medium text-foreground">
              {#if loadState.view.protection === DeviceAccessProtectionKind.Missing}
                <CircleHelp class="size-3.5 text-muted-foreground" />
              {:else}
                <ShieldCheck class="size-3.5 text-emerald-600 dark:text-emerald-400" />
              {/if}
              {protectionLabel(loadState.view.protection)}
            </span>
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

          {#if loadState.view.protection === DeviceAccessProtectionKind.Missing}
            <div class="border-t border-border/60 pt-5" data-testid="devices-access-prepare-browser">
              <DeviceProtectionGate {vault} embedded />
            </div>
          {:else if isPasskeyProtection}
            <div class="grid gap-4 border-t border-border/60 pt-5 sm:grid-cols-2">
              <div>
                <p class="text-xs text-muted-foreground">{vault.t('devices_access.nook_passkey_name')}</p>
                <p class="mt-1 text-sm font-medium text-foreground">
                  {loadState.view.passkeyNameKnown
                    ? loadState.view.passkeyName
                    : vault.t('devices_access.unknown_legacy')}
                </p>
              </div>
              <div>
                <p class="text-xs text-muted-foreground">{vault.t('devices_access.last_successful_use')}</p>
                <p class="mt-1 text-sm font-medium text-foreground">
                  {loadState.view.lastUsedAtKnown
                    ? formatDate(loadState.view.lastUsedAt)
                    : vault.t('devices_access.unknown_legacy')}
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
                    disabled={providerSaving}
                    data-testid="devices-access-provider-label"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    class="min-h-11"
                    disabled={providerSaving || providerDraft.trim() === loadState.view.providerLabel}
                    data-testid="devices-access-provider-save"
                    onclick={() => void saveProviderLabel()}
                  >
                    {#if providerSaving}<RefreshCw class="size-4 animate-spin" />{:else}<Check class="size-4" />{/if}
                    {vault.t('common.save')}
                  </Button>
                </div>
                <p class="mt-1.5 text-xs text-muted-foreground">
                  {vault.t('devices_access.where_saved_help')}
                </p>
                {#if providerSaveFailed}
                  <p class="mt-1 text-xs text-destructive" role="alert">{vault.t('devices_access.provider_save_failed')}</p>
                {/if}
              </div>

              <details class="sm:col-span-2 rounded-lg bg-muted/35 open:bg-muted/50">
                <summary class="min-h-11 cursor-pointer list-none px-3 py-3 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                  {vault.t('devices_access.technical_details')}
                </summary>
                <dl class="grid gap-x-5 gap-y-3 border-t border-border/50 px-3 py-4 text-sm sm:grid-cols-2">
                  <div><dt class="text-xs text-muted-foreground">{vault.t('devices_access.device_id')}</dt><dd class="mt-1 break-all font-mono text-xs text-foreground">{loadState.view.deviceId}</dd></div>
                  <div><dt class="text-xs text-muted-foreground">{vault.t('devices_access.credential_id')}</dt><dd class="mt-1 break-all font-mono text-xs text-foreground">{loadState.view.credentialId}</dd></div>
                  <div><dt class="text-xs text-muted-foreground">{vault.t('devices_access.user_handle_id')}</dt><dd class="mt-1 break-all font-mono text-xs text-foreground">{loadState.view.userHandleId}</dd></div>
                  <div><dt class="text-xs text-muted-foreground">{vault.t('devices_access.created')}</dt><dd class="mt-1 text-foreground">{loadState.view.createdAtKnown ? formatDate(loadState.view.createdAt) : vault.t('devices_access.unknown_legacy')}</dd></div>
                  <div><dt class="text-xs text-muted-foreground">{vault.t('devices_access.attachment')}</dt><dd class="mt-1 text-foreground">{attachmentLabel(loadState.view.attachment)}</dd></div>
                  <div><dt class="text-xs text-muted-foreground">{vault.t('devices_access.backup_status')}</dt><dd class="mt-1 text-foreground">{backupLabel(loadState.view.backupState)}</dd></div>
                  <div><dt class="text-xs text-muted-foreground">{vault.t('devices_access.transports')}</dt><dd class="mt-1 text-foreground">{loadState.view.transports || vault.t('devices_access.unknown')}</dd></div>
                  <div><dt class="text-xs text-muted-foreground">AAGUID</dt><dd class="mt-1 break-all font-mono text-xs text-foreground">{loadState.view.aaguidKnown ? loadState.view.aaguid : vault.t('devices_access.unknown')}</dd></div>
                  <div class="sm:col-span-2"><dt class="text-xs text-muted-foreground">{vault.t('devices_access.last_client')}</dt><dd class="mt-1 text-foreground">{loadState.view.clientEnvironmentKnown ? loadState.view.clientEnvironment : vault.t('devices_access.unknown')}</dd></div>
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
                    <p class="mt-0.5 font-mono text-[0.7rem] text-muted-foreground">{entry.storeId}</p>
                  </div>
                  <div class="text-left sm:text-right">
                    {#if entry.verified}
                      <p class="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                        <ShieldCheck class="size-3.5" />
                        {vault.t('devices_access.access_verified')}
                      </p>
                      <p class="text-xs text-muted-foreground">{formatDate(entry.verifiedAt)}</p>
                    {:else}
                      <p class="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                        <CircleHelp class="size-3.5" />
                        {vault.t('devices_access.access_unknown')}
                      </p>
                      <p class="text-xs text-muted-foreground">
                        {entry.lastUnlockedKnown
                          ? vault.t('devices_access.last_opened', { date: formatDate(entry.lastUnlockedAt) })
                          : vault.t('devices_access.never_opened')}
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
                    <li class="flex items-center gap-2"><span class="size-1.5 rounded-full bg-muted-foreground/50"></span><span class="truncate">{member.label.trim() || member.deviceId}</span></li>
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
