<script lang="ts">
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { Laptop, Globe, Trash2, TriangleAlert } from '@lucide/svelte'
  import type { NookAppLocale } from '$app-wasm'
  import type { VaultState } from '$lib/vault.svelte'
  import SettingsAccordionPanel from '$lib/components/settings/SettingsAccordionSection.svelte'
  import VaultDevicesCard from '$lib/components/settings/VaultDevicesCard.svelte'
  import type { JoinRequest, VaultMember } from '$lib/nook'
  import { Button } from '$lib/components/ui/button'
  import { SettingsAccordionSection } from '$lib/vault/state/ui.svelte'

  let deleteConfirmationOpen = $state(false)

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
    accordionSection = $bindable(SettingsAccordionSection.Devices),
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
    accordionSection?: SettingsAccordionSection
  } = $props()

  const hasDevices = $derived(vaultMembers.length > 0)

  function toggleSection(section: SettingsAccordionSection): void {
    accordionSection =
      accordionSection === section ? SettingsAccordionSection.Closed : section
  }
</script>

<div class="space-y-2" data-testid="storage-settings-panel">
  <SettingsAccordionPanel
    title={vault.t(I18N_KEYS.SettingsDevices)}
    subtitle={vault.t(I18N_KEYS.SettingsDevicesDesc)}
    open={accordionSection === SettingsAccordionSection.Devices}
    onToggle={() => toggleSection(SettingsAccordionSection.Devices)}
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
          ? vault.t(I18N_KEYS.SettingsDeviceCountSingular)
          : vault.t(I18N_KEYS.SettingsDeviceCountPlural, {
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
  </SettingsAccordionPanel>

  <SettingsAccordionPanel
    title={vault.t(I18N_KEYS.SettingsLanguage)}
    subtitle={vault.t(I18N_KEYS.SettingsSelectLanguage)}
    open={accordionSection === SettingsAccordionSection.Language}
    onToggle={() => toggleSection(SettingsAccordionSection.Language)}
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
        {vault.t(I18N_KEYS.SettingsSelectLanguage)}
      </label>
      <select
        id="language-select"
        class="w-full max-w-xs rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm focus:border-primary focus:ring-1 focus:ring-primary"
        value={vault.locale}
        onchange={(e) =>
          vault.updateLocale(e.currentTarget.value as NookAppLocale)}
      >
        <option value="en">English</option>
        <option value="ru">Русский</option>
      </select>
    </div>
  </SettingsAccordionPanel>

  <SettingsAccordionPanel
    title={vault.t(I18N_KEYS.SettingsDeleteLocalTitle)}
    subtitle={vault.t(I18N_KEYS.SettingsDeleteLocalDesc)}
    open={accordionSection === SettingsAccordionSection.Danger}
    onToggle={() => toggleSection(SettingsAccordionSection.Danger)}
    testId="vault-danger-section"
  >
    {#snippet badge()}
      <span
        class="inline-flex items-center gap-1 rounded-full border border-destructive/25 bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive"
      >
        <TriangleAlert class="size-3" />
        {vault.t(I18N_KEYS.SettingsDangerZone)}
      </span>
    {/snippet}
    <div class="space-y-3 p-4">
      <p class="text-sm text-muted-foreground text-pretty">
        {vault.t(I18N_KEYS.SettingsDeleteLocalDetails)}
      </p>
      {#if deleteConfirmationOpen}
        <div
          class="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3"
          data-testid="delete-local-vault-confirmation"
        >
          <p class="text-sm font-medium text-foreground">
            {vault.t(I18N_KEYS.SettingsDeleteLocalConfirm)}
          </p>
          <div class="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={vault.isSaving}
              data-testid="delete-local-vault-cancel"
              onclick={() => (deleteConfirmationOpen = false)}
            >
              {vault.t(I18N_KEYS.CommonCancel)}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={vault.isSaving}
              data-testid="delete-local-vault-confirm"
              onclick={() => void vault.deleteLocalBrowserData()}
            >
              <Trash2 class="size-3.5" />
              {vault.isSaving
                ? vault.t(I18N_KEYS.SettingsDeletingLocal)
                : vault.t(I18N_KEYS.SettingsDeleteLocalConfirmButton)}
            </Button>
          </div>
        </div>
      {:else}
        <Button
          type="button"
          variant="destructive"
          size="sm"
          data-testid="delete-local-vault-button"
          onclick={() => (deleteConfirmationOpen = true)}
        >
          <Trash2 class="size-3.5" />
          {vault.t(I18N_KEYS.SettingsDeleteLocalButton)}
        </Button>
      {/if}
    </div>
  </SettingsAccordionPanel>
</div>
