<script lang="ts">
  import { KeyRound, QrCode, Settings2 } from '@lucide/svelte'

  let {
    settingsOpen = false,
    settingsSection = 'storage' as 'storage' | 'onboard',
    onSelectSecrets,
    onSelectOnboard,
    onSelectSettings,
  }: {
    settingsOpen?: boolean
    settingsSection?: 'storage' | 'onboard'
    onSelectSecrets?: () => void
    onSelectOnboard?: () => void
    onSelectSettings?: () => void
  } = $props()

  const vaultOpen = $derived(!settingsOpen)
  const onboardOpen = $derived(settingsOpen && settingsSection === 'onboard')
  const generalSettingsOpen = $derived(
    settingsOpen && settingsSection !== 'onboard',
  )
</script>

<nav
  class="border-t border-border bg-muted/40"
  aria-label="Vault views"
  data-testid="vault-bottom-nav"
>
  <div class="flex">
    <button
      type="button"
      aria-current={vaultOpen ? 'page' : undefined}
      class="relative flex flex-1 flex-col items-center gap-1 px-2 py-3 text-center transition-colors {vaultOpen
        ? 'bg-background text-primary'
        : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'}"
      data-testid="vault-secrets-tab"
      onclick={() => onSelectSecrets?.()}
    >
      <KeyRound class="size-5 shrink-0" />
      <span class="text-xs font-medium leading-none">Vault</span>
    </button>
    <button
      type="button"
      aria-current={onboardOpen ? 'page' : undefined}
      aria-label="Onboard another device"
      class="relative flex flex-1 flex-col items-center gap-1 border-l border-border/60 px-2 py-3 text-center transition-colors {onboardOpen
        ? 'bg-background text-primary'
        : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'}"
      data-testid="vault-onboard-tab"
      onclick={() => onSelectOnboard?.()}
    >
      <QrCode class="size-5 shrink-0" />
      <span class="text-xs font-medium leading-none">Onboard</span>
    </button>
    <button
      type="button"
      aria-current={generalSettingsOpen ? 'page' : undefined}
      aria-label="Vault settings"
      class="relative flex flex-1 flex-col items-center gap-1 border-l border-border/60 px-2 py-3 text-center transition-colors {generalSettingsOpen
        ? 'bg-background text-primary'
        : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'}"
      data-testid="vault-settings-tab"
      onclick={() => onSelectSettings?.()}
    >
      <Settings2 class="size-5 shrink-0" />
      <span class="text-xs font-medium leading-none">Settings</span>
    </button>
  </div>
</nav>
