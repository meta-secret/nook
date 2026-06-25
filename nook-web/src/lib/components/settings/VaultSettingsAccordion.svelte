<script lang="ts">
  import {
    CheckCircle2,
    Laptop,
    Lock,
    ShieldCheck,
    Globe,
  } from '@lucide/svelte'
  import type { VaultState } from '$lib/vault.svelte'
  import SettingsAccordionSection from '$lib/components/settings/SettingsAccordionSection.svelte'
  import AuthStorage from '$lib/components/AuthStorage.svelte'
  import VaultDevicesCard from '$lib/components/settings/VaultDevicesCard.svelte'
  import VaultPasswordCard from '$lib/components/VaultPasswordCard.svelte'
  import type { JoinRequest, VaultMember } from '$lib/nook'
  import type {
    StorageProvider,
    StorageProviderType,
  } from '$lib/auth-providers'
  import type { VaultPasswordEntrySummary } from '$lib/vault-password'

  let {
    vault,
    providers,
    activeProviderId,
    isAuthenticated,
    isVerifying,
    isSaving,
    isInitializing,
    addProviderOpen = false,
    setupType = $bindable(null as StorageProviderType | null),
    githubPat = $bindable(''),
    githubRepo = $bindable(''),
    passwordEntries,
    isPasswordBusy,
    passwordError,
    enrollmentCode,
    deviceId,
    devicePublicKey,
    pendingJoins,
    vaultMembers,
    hasPasswordEnvelope = false,
    onReconnect,
    onSelectProvider,
    onBeginAddProvider,
    onCancelAddProvider,
    onBeginSetup,
    onCancelSetup,
    onRemoveProvider,
    onLockVault,
    onAddPassword,
    onUpdatePassword,
    onRemovePassword,
    onIssueCode,
    onClearCode,
    onApproveJoin,
    onDenyJoin,
    onRenameDevice,
    onRevokeDevice,
    accordionSection = $bindable(
      'storage' as 'storage' | 'passwords' | 'devices' | 'language',
    ),
  }: {
    vault: VaultState
    providers: StorageProvider[]
    activeProviderId: string | null
    isAuthenticated: boolean
    isVerifying: boolean
    isSaving: boolean
    isInitializing: boolean
    addProviderOpen?: boolean
    setupType?: StorageProviderType | null
    githubPat: string
    githubRepo: string
    passwordEntries: VaultPasswordEntrySummary[]
    isPasswordBusy: boolean
    passwordError: string
    enrollmentCode: string
    deviceId: string
    devicePublicKey: string
    pendingJoins: JoinRequest[]
    vaultMembers: VaultMember[]
    hasPasswordEnvelope?: boolean
    onReconnect: () => void | Promise<void>
    onSelectProvider: (id: string) => void | Promise<void>
    onBeginAddProvider?: () => void
    onCancelAddProvider?: () => void
    onBeginSetup: (type: StorageProviderType) => void
    onCancelSetup: () => void
    onRemoveProvider?: (id: string) => void | Promise<void>
    onLockVault?: () => void
    onAddPassword: (label: string, password: string) => void | Promise<void>
    onUpdatePassword: (
      entryId: string,
      password: string,
    ) => void | Promise<void>
    onRemovePassword: (entryId: string) => void | Promise<void>
    onIssueCode: (entryId: string, password: string) => Promise<string | void>
    onClearCode: () => void
    onApproveJoin: (deviceId: string) => void | Promise<void>
    onDenyJoin: (deviceId: string) => void | Promise<void>
    onRenameDevice: (authId: string, label: string) => void | Promise<void>
    onRevokeDevice: (authId: string) => void | Promise<void>
    accordionSection?: 'storage' | 'passwords' | 'devices' | 'language'
  } = $props()

  const hasPasswords = $derived(passwordEntries.length > 0)
  const hasDevices = $derived(vaultMembers.length > 0)
</script>

<div class="space-y-2" data-testid="storage-settings-panel">
  <SettingsAccordionSection
    title={vault.t('settings.storage')}
    subtitle={vault.t('settings.storage_desc')}
    open={accordionSection === 'storage'}
    testId="storage-providers-section"
    onToggle={() => {
      accordionSection = 'storage'
    }}
  >
    {#snippet badge()}
      {#if isAuthenticated}
        <span
          class="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-500"
          data-testid="connected-badge"
        >
          <CheckCircle2 class="size-3" />
          {vault.t('common.active')}
        </span>
      {/if}
    {/snippet}
    <AuthStorage
      {vault}
      embedded
      {providers}
      {activeProviderId}
      {isAuthenticated}
      {isVerifying}
      {isSaving}
      {isInitializing}
      {addProviderOpen}
      bind:setupType
      bind:githubPat
      bind:githubRepo
      {onReconnect}
      {onSelectProvider}
      {onBeginAddProvider}
      {onCancelAddProvider}
      {onBeginSetup}
      {onCancelSetup}
      {onRemoveProvider}
      {onLockVault}
    />
  </SettingsAccordionSection>

  <SettingsAccordionSection
    title={vault.t('settings.devices')}
    subtitle={vault.t('settings.devices_desc')}
    open={accordionSection === 'devices'}
    testId="vault-devices-section"
    onToggle={() => {
      accordionSection = 'devices'
    }}
  >
    {#snippet badge()}
      <span
        class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium {hasDevices
          ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
          : 'border-border bg-muted/40 text-muted-foreground'}"
        data-testid="vault-devices-status"
      >
        <Laptop class="size-3" />
        {vaultMembers.length === 1
          ? vault.t('settings.device_count_singular')
          : vault.t('settings.device_count_plural', {
              count: String(vaultMembers.length),
            })}
      </span>
    {/snippet}
    <VaultDevicesCard
      {vault}
      {deviceId}
      {devicePublicKey}
      {pendingJoins}
      {vaultMembers}
      isBusy={isSaving || isVerifying}
      {hasPasswordEnvelope}
      {onApproveJoin}
      {onDenyJoin}
      {onRenameDevice}
      {onRevokeDevice}
    />
  </SettingsAccordionSection>

  <SettingsAccordionSection
    title={vault.t('settings.passwords')}
    subtitle={vault.t('settings.passwords_desc')}
    open={accordionSection === 'passwords'}
    testId="vault-unlock-section"
    onToggle={() => {
      accordionSection = 'passwords'
    }}
  >
    {#snippet badge()}
      <span
        class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium {hasPasswords
          ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
          : 'border-border bg-muted/40 text-muted-foreground'}"
        data-testid="vault-password-status"
      >
        {#if hasPasswords}
          <ShieldCheck class="size-3" />
          {passwordEntries.length === 1
            ? vault.t('settings.password_count_singular')
            : vault.t('settings.password_count_plural', {
                count: String(passwordEntries.length),
              })}
        {:else}
          <Lock class="size-3" />
          {vault.t('settings.no_passwords')}
        {/if}
      </span>
    {/snippet}
    <VaultPasswordCard
      {vault}
      embedded
      {passwordEntries}
      isBusy={isPasswordBusy}
      {passwordError}
      {enrollmentCode}
      {onAddPassword}
      {onUpdatePassword}
      {onRemovePassword}
      {onIssueCode}
      {onClearCode}
      allowIssueCode={false}
    />
  </SettingsAccordionSection>

  <SettingsAccordionSection
    title={vault.t('settings.language')}
    subtitle={vault.t('settings.select_language')}
    open={accordionSection === 'language'}
    testId="vault-language-section"
    onToggle={() => {
      accordionSection = 'language'
    }}
  >
    {#snippet badge()}
      <span
        class="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs font-medium text-muted-foreground"
      >
        <Globe class="size-3" />
        {vault.locale === 'en' ? 'English' : 'Русский'}
      </span>
    {/snippet}
    <div class="p-4 space-y-3">
      <label
        for="language-select"
        class="block text-sm font-medium text-muted-foreground"
      >
        {vault.t('settings.select_language')}
      </label>
      <select
        id="language-select"
        class="w-full max-w-xs rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm focus:border-primary focus:ring-1 focus:ring-primary"
        value={vault.locale}
        onchange={(e) =>
          vault.updateLocale(e.currentTarget.value as 'en' | 'ru')}
      >
        <option value="en">English</option>
        <option value="ru">Русский</option>
      </select>
    </div>
  </SettingsAccordionSection>
</div>
