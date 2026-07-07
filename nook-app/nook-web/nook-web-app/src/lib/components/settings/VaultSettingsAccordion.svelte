<script lang="ts">
  import { Laptop, Globe } from '@lucide/svelte'
  import type { VaultState } from '$lib/vault.svelte'
  import SettingsAccordionSection from '$lib/components/settings/SettingsAccordionSection.svelte'
  import VaultDevicesCard from '$lib/components/settings/VaultDevicesCard.svelte'
  import type { JoinRequest, VaultMember } from '$lib/nook'

  export type VaultSettingsAccordionSection = 'devices' | 'language'

  let {
    vault,
    isVerifying,
    isSaving,
    deviceId,
    devicePublicKey,
    pendingJoins,
    vaultMembers,
    hasPasswordEnvelope = false,
    onApproveJoin,
    onDenyJoin,
    onRenameDevice,
    onRevokeDevice,
    accordionSection = $bindable(
      undefined as VaultSettingsAccordionSection | undefined,
    ),
  }: {
    vault: VaultState
    isVerifying: boolean
    isSaving: boolean
    deviceId: string
    devicePublicKey: string
    pendingJoins: JoinRequest[]
    vaultMembers: VaultMember[]
    hasPasswordEnvelope?: boolean
    onApproveJoin: (deviceId: string) => void | Promise<void>
    onDenyJoin: (deviceId: string) => void | Promise<void>
    onRenameDevice: (authId: string, label: string) => void | Promise<void>
    onRevokeDevice: (authId: string) => void | Promise<void>
    accordionSection?: VaultSettingsAccordionSection | undefined
  } = $props()

  const hasDevices = $derived(vaultMembers.length > 0)
</script>

<div class="space-y-2" data-testid="storage-settings-panel">
  <SettingsAccordionSection
    title={vault.t('settings.devices')}
    subtitle={vault.t('settings.devices_desc')}
    section="devices"
    bind:activeSection={accordionSection}
    testId="vault-devices-section"
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
    title={vault.t('settings.language')}
    subtitle={vault.t('settings.select_language')}
    section="language"
    bind:activeSection={accordionSection}
    testId="vault-language-section"
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
