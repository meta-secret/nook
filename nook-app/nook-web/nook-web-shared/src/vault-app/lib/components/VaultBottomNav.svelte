<script lang="ts">
  import {
    KeyRound,
    QrCode,
    Settings2,
    SlidersHorizontal,
  } from '@lucide/svelte'
  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
    settingsOpen = false,
    settingsSection = 'storage' as 'storage' | 'onboard' | 'admin',
    onSelectSecrets,
    onSelectOnboard,
    onSelectAdmin,
    onSelectSettings,
  }: {
    vault: VaultState
    settingsOpen?: boolean
    settingsSection?: 'storage' | 'onboard' | 'admin'
    onSelectSecrets?: () => void
    onSelectOnboard?: () => void
    onSelectAdmin?: () => void
    onSelectSettings?: () => void
  } = $props()

  const vaultOpen = $derived(!settingsOpen)
  const onboardOpen = $derived(settingsOpen && settingsSection === 'onboard')
  const adminOpen = $derived(settingsOpen && settingsSection === 'admin')
  const generalSettingsOpen = $derived(
    settingsOpen && settingsSection === 'storage',
  )
</script>

<nav
  class="fixed inset-x-0 bottom-0 z-50 border-t border-border/35 bg-card/95 px-3 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-1 shadow-[0_-8px_24px_rgb(0_0_0_/_0.18)] backdrop-blur-md sm:static sm:z-auto sm:border-border/60 sm:bg-muted/35 sm:p-0 sm:shadow-none sm:backdrop-blur-0"
  aria-label={vault.t('nav.vault')}
  data-testid="vault-bottom-nav"
>
  <div
    class="mx-auto flex max-w-5xl overflow-hidden rounded-xl bg-muted/35 sm:max-w-none sm:rounded-none sm:bg-transparent"
  >
    <button
      type="button"
      aria-current={vaultOpen ? 'page' : undefined}
      class="relative flex flex-1 flex-col items-center gap-1 px-2 py-2.5 text-center transition-colors sm:py-3 {vaultOpen
        ? 'bg-background text-primary shadow-xs sm:shadow-none'
        : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'}"
      data-testid="vault-secrets-tab"
      onclick={() => onSelectSecrets?.()}
    >
      <KeyRound class="size-5 shrink-0" />
      <span class="text-xs font-medium leading-none"
        >{vault.t('nav.vault')}</span
      >
    </button>
    <button
      type="button"
      aria-current={adminOpen ? 'page' : undefined}
      aria-label={vault.t('nav.admin')}
      class="relative flex flex-1 flex-col items-center gap-1 border-l border-border/35 px-2 py-2.5 text-center transition-colors sm:border-border/60 sm:py-3 {adminOpen
        ? 'bg-background text-primary shadow-xs sm:shadow-none'
        : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'}"
      data-testid="vault-admin-tab"
      onclick={() => onSelectAdmin?.()}
    >
      <SlidersHorizontal class="size-5 shrink-0" />
      <span class="text-xs font-medium leading-none"
        >{vault.t('nav.admin')}</span
      >
    </button>
    <button
      type="button"
      aria-current={onboardOpen ? 'page' : undefined}
      aria-label={vault.t('nav.onboard')}
      class="relative flex flex-1 flex-col items-center gap-1 border-l border-border/35 px-2 py-2.5 text-center transition-colors sm:border-border/60 sm:py-3 {onboardOpen
        ? 'bg-background text-primary shadow-xs sm:shadow-none'
        : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'}"
      data-testid="vault-onboard-tab"
      onclick={() => onSelectOnboard?.()}
    >
      <QrCode class="size-5 shrink-0" />
      <span class="text-xs font-medium leading-none"
        >{vault.t('nav.onboard')}</span
      >
    </button>
    <button
      type="button"
      aria-current={generalSettingsOpen ? 'page' : undefined}
      aria-label={vault.t('nav.settings')}
      class="relative flex flex-1 flex-col items-center gap-1 border-l border-border/35 px-2 py-2.5 text-center transition-colors sm:border-border/60 sm:py-3 {generalSettingsOpen
        ? 'bg-background text-primary shadow-xs sm:shadow-none'
        : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'}"
      data-testid="vault-settings-tab"
      onclick={() => onSelectSettings?.()}
    >
      <Settings2 class="size-5 shrink-0" />
      <span class="text-xs font-medium leading-none"
        >{vault.t('nav.settings')}</span
      >
    </button>
  </div>
</nav>
