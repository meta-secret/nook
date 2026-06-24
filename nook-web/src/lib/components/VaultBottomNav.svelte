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
  class="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur-md pb-[max(0.5rem,env(safe-area-inset-bottom))]"
  aria-label="Vault views"
  data-testid="vault-bottom-nav"
>
  <div class="mx-auto flex max-w-xl px-2">
    <button
      type="button"
      aria-current={!settingsOpen ? 'page' : undefined}
      class="relative flex flex-1 flex-col items-center gap-0.5 rounded-lg px-2 py-2.5 text-center transition-colors {!settingsOpen
        ? 'text-primary'
        : 'text-muted-foreground hover:text-foreground'}"
      data-testid="vault-secrets-tab"
      onclick={() => onSelectSecrets?.()}
    >
      <KeyRound class="size-5 shrink-0" />
      <span class="text-[11px] font-medium leading-none">Secrets</span>
    </button>
    <button
      type="button"
      aria-current={settingsOpen ? 'page' : undefined}
      aria-label="Vault settings"
      class="relative flex flex-1 flex-col items-center gap-0.5 rounded-lg px-2 py-2.5 text-center transition-colors {settingsOpen
        ? 'text-primary'
        : 'text-muted-foreground hover:text-foreground'}"
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
      <span class="text-[11px] font-medium leading-none">Settings</span>
    </button>
  </div>
</nav>
