<script lang="ts">
  import { I18N_KEYS } from '../../../generated/i18n-keys'
  import {
    KeyRound,
    ShieldCheck,
    QrCode,
    Settings2,
    SlidersHorizontal,
  } from '@lucide/svelte'
  import type { VaultState } from '$lib/vault.svelte'
  import { SettingsSection } from '$lib/vault/state/ui.svelte'

  let {
    vault,
    settingsOpen = false,
    settingsSection = SettingsSection.Storage,
    onSelectSecrets,
    onSelectDevicesAccess,
    onSelectOnboard,
    onSelectAdmin,
    onSelectSettings,
  }: {
    vault: VaultState
    settingsOpen?: boolean
    settingsSection?: SettingsSection
    onSelectSecrets?: () => void
    onSelectDevicesAccess?: () => void
    onSelectOnboard?: () => void
    onSelectAdmin?: () => void
    onSelectSettings?: () => void
  } = $props()

  const vaultOpen = $derived(!settingsOpen)
  const onboardOpen = $derived(
    settingsOpen && settingsSection === SettingsSection.Onboard,
  )
  const devicesAccessOpen = $derived(
    settingsOpen && settingsSection === SettingsSection.DevicesAccess,
  )
  const adminOpen = $derived(
    settingsOpen && settingsSection === SettingsSection.Admin,
  )
  const generalSettingsOpen = $derived(
    settingsOpen && settingsSection === SettingsSection.Storage,
  )
</script>

<nav
  class="fixed inset-x-0 bottom-0 z-50 border-t border-border/35 bg-card/95 px-3 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-1 shadow-[0_-8px_24px_rgb(0_0_0_/_0.18)] backdrop-blur-md sm:static sm:z-auto sm:border-border/60 sm:bg-muted/35 sm:p-0 sm:shadow-none sm:backdrop-blur-0"
  aria-label={vault.t(I18N_KEYS.NavVault)}
  data-testid="vault-bottom-nav"
>
  <div
    class="mx-auto flex max-w-5xl overflow-hidden rounded-xl bg-muted/35 sm:max-w-none sm:rounded-none sm:bg-transparent"
  >
    <button
      type="button"
      aria-current={vaultOpen ? 'page' : false}
      class="relative flex flex-1 flex-col items-center gap-1 px-2 py-2.5 text-center transition-colors sm:py-3 {vaultOpen
        ? 'bg-background text-primary shadow-xs sm:shadow-none'
        : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'}"
      data-testid="vault-secrets-tab"
      onclick={() => onSelectSecrets?.()}
    >
      <KeyRound class="size-5 shrink-0" />
      <span class="text-xs font-medium leading-none"
        >{vault.t(I18N_KEYS.NavVault)}</span
      >
    </button>
    <button
      type="button"
      aria-current={devicesAccessOpen ? 'page' : false}
      aria-label={vault.t('nav.devices_access')}
      class="relative flex flex-1 flex-col items-center gap-1 border-l border-border/35 px-1 py-2.5 text-center transition-colors sm:border-border/60 sm:px-2 sm:py-3 {devicesAccessOpen
        ? 'bg-background text-primary shadow-xs sm:shadow-none'
        : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'}"
      data-testid="vault-devices-access-tab"
      onclick={() => onSelectDevicesAccess?.()}
    >
      <ShieldCheck class="size-5 shrink-0" />
      <span class="text-[0.68rem] font-medium leading-none sm:text-xs"
        >{vault.t('nav.devices_access')}</span
      >
    </button>
    <button
      type="button"
      aria-current={adminOpen ? 'page' : false}
      aria-label={vault.t(I18N_KEYS.NavAdmin)}
      class="relative flex flex-1 flex-col items-center gap-1 border-l border-border/35 px-2 py-2.5 text-center transition-colors sm:border-border/60 sm:py-3 {adminOpen
        ? 'bg-background text-primary shadow-xs sm:shadow-none'
        : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'}"
      data-testid="vault-admin-tab"
      onclick={() => onSelectAdmin?.()}
    >
      <SlidersHorizontal class="size-5 shrink-0" />
      <span class="text-xs font-medium leading-none"
        >{vault.t(I18N_KEYS.NavAdmin)}</span
      >
    </button>
    <button
      type="button"
      aria-current={onboardOpen ? 'page' : false}
      aria-label={vault.t(I18N_KEYS.NavOnboard)}
      class="relative flex flex-1 flex-col items-center gap-1 border-l border-border/35 px-2 py-2.5 text-center transition-colors sm:border-border/60 sm:py-3 {onboardOpen
        ? 'bg-background text-primary shadow-xs sm:shadow-none'
        : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'}"
      data-testid="vault-onboard-tab"
      onclick={() => onSelectOnboard?.()}
    >
      <QrCode class="size-5 shrink-0" />
      <span class="text-xs font-medium leading-none"
        >{vault.t(I18N_KEYS.NavOnboard)}</span
      >
    </button>
    <button
      type="button"
      aria-current={generalSettingsOpen ? 'page' : false}
      aria-label={vault.t(I18N_KEYS.NavSettings)}
      class="relative flex flex-1 flex-col items-center gap-1 border-l border-border/35 px-2 py-2.5 text-center transition-colors sm:border-border/60 sm:py-3 {generalSettingsOpen
        ? 'bg-background text-primary shadow-xs sm:shadow-none'
        : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'}"
      data-testid="vault-settings-tab"
      onclick={() => onSelectSettings?.()}
    >
      <Settings2 class="size-5 shrink-0" />
      <span class="text-xs font-medium leading-none"
        >{vault.t(I18N_KEYS.NavSettings)}</span
      >
    </button>
  </div>
</nav>
