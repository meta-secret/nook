<script lang="ts">
  import { KeyRound, RefreshCw, ShieldCheck, UserRound } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import type { NookPasswordEntrySummary } from '$app-wasm'

  import type { VaultState } from '$lib/vault.svelte'

  type PasswordEntrySummary = Pick<
    NookPasswordEntrySummary,
    'id' | 'label' | 'createdAt'
  >

  let {
    vault,
    passwordEntries = [] as PasswordEntrySummary[],
    selectedPasswordEntryId = $bindable(undefined as string | undefined),
    isVerifying,
    isInitializing,
    isUnlocking = false,
    loginPasswordPrompt = false,
    onUnlock,
    onUnlockWithPassword,
    onConsumeLoginPasswordPrompt,
  }: {
    vault: VaultState
    passwordEntries?: PasswordEntrySummary[]
    selectedPasswordEntryId?: string | undefined
    isVerifying: boolean
    isInitializing: boolean
    isUnlocking?: boolean
    loginPasswordPrompt?: boolean
    onUnlock: () => void | Promise<void>
    onUnlockWithPassword?: (
      entryId: string,
      password: string,
    ) => void | Promise<void>
    onConsumeLoginPasswordPrompt?: () => void
  } = $props()

  type UnlockMethod = 'keys' | 'password'

  let unlockMethod = $state<UnlockMethod>('keys')
  let passwordInput = $state('')

  const showPasswordUnlockOption = $derived(
    Boolean(onUnlockWithPassword) && passwordEntries.length > 0,
  )
  const isPasswordUnlock = $derived(
    unlockMethod === 'password' && showPasswordUnlockOption,
  )
  const canUnlock = $derived(
    !isPasswordUnlock ||
      (Boolean(selectedPasswordEntryId) && passwordInput.trim().length > 0),
  )

  $effect(() => {
    if (loginPasswordPrompt) {
      unlockMethod = 'password'
      if (passwordEntries.length === 1 && !selectedPasswordEntryId) {
        selectedPasswordEntryId = passwordEntries[0]!.id
      }
      onConsumeLoginPasswordPrompt?.()
    }
  })

  $effect(() => {
    if (
      unlockMethod === 'password' &&
      passwordEntries.length === 1 &&
      !selectedPasswordEntryId
    ) {
      selectedPasswordEntryId = passwordEntries[0]!.id
    }
  })

  $effect(() => {
    if (unlockMethod === 'password' && passwordEntries.length === 0) {
      unlockMethod = 'keys'
    }
  })

  function handleSubmit(e: Event) {
    e.preventDefault()
    if (unlockMethod === 'password' && onUnlockWithPassword) {
      if (!selectedPasswordEntryId) return
      const trimmed = passwordInput.trim()
      if (!trimmed) return
      void onUnlockWithPassword(selectedPasswordEntryId, trimmed)
      return
    }
    void onUnlock()
  }
</script>

<form class="space-y-3" onsubmit={handleSubmit}>
  <fieldset class="space-y-3" data-testid="login-unlock-method-fieldset">
    <legend class="sr-only">{vault.t('login.unlock_vault')}</legend>
    <div
      class="grid gap-2 overflow-hidden rounded-lg border border-border/50 sm:grid-cols-2"
      role="radiogroup"
      aria-label={vault.t('login.unlock_vault')}
    >
      <button
        type="button"
        role="radio"
        aria-checked={unlockMethod === 'keys'}
        class="flex items-center gap-2.5 px-3 py-3 text-left text-sm transition-colors {unlockMethod ===
        'keys'
          ? 'bg-primary/[0.06] text-foreground'
          : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground'}"
        data-testid="login-unlock-method-keys"
        disabled={isVerifying || isInitializing}
        onclick={() => {
          unlockMethod = 'keys'
          passwordInput = ''
        }}
      >
        <ShieldCheck class="size-4 shrink-0" />
        {vault.t('login.unlock_keys')}
      </button>
      {#if showPasswordUnlockOption}
        <button
          type="button"
          role="radio"
          aria-checked={unlockMethod === 'password'}
          class="flex items-center gap-2.5 border-t border-border/40 px-3 py-3 text-left text-sm transition-colors sm:border-t-0 sm:border-l {unlockMethod ===
          'password'
            ? 'bg-primary/[0.06] text-foreground'
            : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground'}"
          data-testid="login-unlock-method-password"
          disabled={isVerifying || isInitializing}
          onclick={() => {
            unlockMethod = 'password'
          }}
        >
          <KeyRound class="size-4 shrink-0" />
          {vault.t('login.unlock_backup')}
        </button>
      {/if}
    </div>

    {#if isPasswordUnlock}
      <div
        class="space-y-2.5 rounded-md border border-border/50 bg-muted/15 p-3"
      >
        <ul class="space-y-1.5" data-testid="login-password-entry-list">
          {#each passwordEntries as entry (entry.id)}
            <li>
              <button
                type="button"
                class="flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors {selectedPasswordEntryId ===
                entry.id
                  ? 'border-primary/40 bg-primary/5 text-foreground'
                  : 'border-border bg-muted/20 text-muted-foreground hover:bg-accent hover:text-foreground'}"
                data-testid="login-password-entry-{entry.id}"
                onclick={() => {
                  selectedPasswordEntryId = entry.id
                }}
              >
                <UserRound class="size-4 shrink-0 text-primary" />
                <span class="truncate font-medium">{entry.label}</span>
              </button>
            </li>
          {/each}
        </ul>
        <input
          type="password"
          class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          placeholder={vault.t('login.password_selected_placeholder')}
          bind:value={passwordInput}
          autocomplete="current-password"
          data-testid="login-password-input"
          required
        />
      </div>
    {/if}
  </fieldset>

  <Button
    type="submit"
    variant="outline"
    class="w-full border-primary/30 bg-primary/5 font-medium text-foreground hover:bg-primary/10 hover:text-foreground sm:w-auto sm:min-w-[160px]"
    data-testid="unlock-vault-btn"
    disabled={isVerifying || isInitializing || !canUnlock}
  >
    {#if isUnlocking}
      <RefreshCw class="size-4 animate-spin" />
      {vault.t('login.unlocking')}
    {:else}
      <ShieldCheck class="size-4" />
      {vault.t('login.unlock_vault_btn')}
    {/if}
  </Button>
</form>
