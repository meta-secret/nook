<script lang="ts">
  import { CheckCircle2, Laptop, Lock, ShieldCheck } from '@lucide/svelte'
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
      'storage' as 'storage' | 'passwords' | 'devices',
    ),
  }: {
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
    accordionSection?: 'storage' | 'passwords' | 'devices'
  } = $props()

  const hasPasswords = $derived(passwordEntries.length > 0)
  const hasDevices = $derived(vaultMembers.length > 0)
</script>

<div class="space-y-2" data-testid="storage-settings-panel">
  <SettingsAccordionSection
    title="Storage providers"
    subtitle="Where your vault file lives"
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
          Connected
        </span>
      {/if}
    {/snippet}
    <AuthStorage
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
    title="Devices"
    subtitle="Enrolled browsers and pending access requests"
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
        {vaultMembers.length}
        {vaultMembers.length === 1 ? 'device' : 'devices'}
      </span>
    {/snippet}
    <VaultDevicesCard
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
    title="Vault passwords"
    subtitle="Passwords available for unlock and device onboarding"
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
          {passwordEntries.length}
          {passwordEntries.length === 1 ? 'password' : 'passwords'}
        {:else}
          <Lock class="size-3" />
          None
        {/if}
      </span>
    {/snippet}
    <VaultPasswordCard
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
</div>
