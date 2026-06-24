<script lang="ts">
  import { KeyRound, Settings2 } from '@lucide/svelte'

  let {
    settingsOpen = false,
    pendingJoinCount = 0,
    onSelectSecrets,
    onSelectSettings,
  }: {
    settingsOpen?: boolean
    pendingJoinCount?: number
    onSelectSecrets?: () => void
    onSelectSettings?: () => void
  } = $props()
</script>

<nav
  class="border-t border-border bg-muted/40"
  aria-label="Vault views"
  data-testid="vault-bottom-nav"
>
  <div class="flex">
    <button
      type="button"
      aria-current={!settingsOpen ? 'page' : undefined}
      class="relative flex flex-1 flex-col items-center gap-1 px-2 py-3 text-center transition-colors {!settingsOpen
        ? 'bg-background text-primary'
        : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'}"
      data-testid="vault-secrets-tab"
      onclick={() => onSelectSecrets?.()}
    >
      <KeyRound class="size-5 shrink-0" />
      <span class="text-xs font-medium leading-none">Secrets</span>
    </button>
    <button
      type="button"
      aria-current={settingsOpen ? 'page' : undefined}
      aria-label="Vault settings"
      class="relative flex flex-1 flex-col items-center gap-1 border-l border-border/60 px-2 py-3 text-center transition-colors {settingsOpen
        ? 'bg-background text-primary'
        : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'}"
      data-testid="vault-settings-tab"
      onclick={() => onSelectSettings?.()}
    >
      <span class="relative">
        <Settings2 class="size-5 shrink-0" />
        {#if pendingJoinCount > 0}
          <span
            class="absolute -top-1.5 -right-2 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground"
            data-testid="pending-joins-badge"
          >
            {pendingJoinCount}
          </span>
        {/if}
      </span>
      <span class="text-xs font-medium leading-none">Settings</span>
    </button>
  </div>
</nav>
