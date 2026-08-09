<script lang="ts">
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { KeyRound, RefreshCw, ShieldCheck, UserRound } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import type { NookPasswordEntrySummary } from '$app-wasm'

  import type { VaultState } from '$lib/vault.svelte'
  import {
    PasswordEntrySelectionKind,
    type PasswordEntrySelection,
  } from '$lib/vault/state/session.svelte'
  import {
    DeviceKeysUnlockCapabilityKind,
    PasswordUnlockCapabilityKind,
    UnlockMethod,
    type DeviceKeysUnlockCapability,
    type PasswordUnlockCapability,
  } from './login-unlock-state'

  type PasswordEntrySummary = Pick<
    NookPasswordEntrySummary,
    'id' | 'label' | 'createdAt'
  >

  let {
    vault,
    passwordEntries = [] as PasswordEntrySummary[],
    selectedPasswordEntry,
    isVerifying,
    isInitializing,
    isUnlocking = false,
    loginPasswordPrompt = false,
    deviceKeysUnlock = {
      kind: DeviceKeysUnlockCapabilityKind.Unknown,
    } as DeviceKeysUnlockCapability,
    onUnlock,
    passwordUnlock,
    onSelectPasswordEntry,
    onConsumeLoginPasswordPrompt,
  }: {
    vault: VaultState
    passwordEntries?: PasswordEntrySummary[]
    selectedPasswordEntry: PasswordEntrySelection
    isVerifying: boolean
    isInitializing: boolean
    isUnlocking?: boolean
    loginPasswordPrompt?: boolean
    deviceKeysUnlock?: DeviceKeysUnlockCapability
    onUnlock: () => void | Promise<void>
    passwordUnlock: PasswordUnlockCapability
    onSelectPasswordEntry: (selection: PasswordEntrySelection) => void
    onConsumeLoginPasswordPrompt: () => void
  } = $props()

  let unlockMethod = $state<UnlockMethod>(UnlockMethod.Keys)
  let passwordInput = $state('')

  const showPasswordUnlockOption = $derived(
    passwordUnlock.kind === PasswordUnlockCapabilityKind.Available &&
      passwordEntries.length > 0,
  )
  const deviceKeysAvailable = $derived(
    deviceKeysUnlock.kind !== DeviceKeysUnlockCapabilityKind.Unavailable,
  )
  const isPasswordUnlock = $derived(
    unlockMethod === UnlockMethod.Password && showPasswordUnlockOption,
  )
  const canUnlock = $derived(
    (isPasswordUnlock &&
      selectedPasswordEntry.kind === PasswordEntrySelectionKind.Selected &&
      passwordInput.trim().length > 0) ||
      (!isPasswordUnlock && deviceKeysAvailable),
  )

  $effect(() => {
    if (loginPasswordPrompt && showPasswordUnlockOption) {
      unlockMethod = UnlockMethod.Password
      if (
        passwordEntries.length === 1 &&
        selectedPasswordEntry.kind === PasswordEntrySelectionKind.NotSelected
      ) {
        const onSelectPasswordEntryArgs: Parameters<typeof onSelectPasswordEntry>[0] = {
          kind: PasswordEntrySelectionKind.Selected,
          entryId: passwordEntries[0]!.id,
        };
        onSelectPasswordEntry(onSelectPasswordEntryArgs)
      }
      onConsumeLoginPasswordPrompt()
    }
  })

  $effect(() => {
    if (
      !deviceKeysAvailable &&
      showPasswordUnlockOption &&
      unlockMethod === UnlockMethod.Keys
    ) {
      unlockMethod = UnlockMethod.Password
    }
  })

  $effect(() => {
    if (
      unlockMethod === UnlockMethod.Password &&
      passwordEntries.length === 1 &&
      selectedPasswordEntry.kind === PasswordEntrySelectionKind.NotSelected
    ) {
      const onSelectPasswordEntryArgs2: Parameters<typeof onSelectPasswordEntry>[0] = {
        kind: PasswordEntrySelectionKind.Selected,
        entryId: passwordEntries[0]!.id,
      };
      onSelectPasswordEntry(onSelectPasswordEntryArgs2)
    }
  })

  $effect(() => {
    if (
      unlockMethod === UnlockMethod.Password &&
      passwordEntries.length === 0 &&
      deviceKeysAvailable
    ) {
      unlockMethod = UnlockMethod.Keys
    }
  })

  function handleSubmit(e: Event) {
    e.preventDefault()
    if (
      unlockMethod === UnlockMethod.Password &&
      passwordUnlock.kind === PasswordUnlockCapabilityKind.Available &&
      selectedPasswordEntry.kind === PasswordEntrySelectionKind.Selected
    ) {
      const trimmed = passwordInput.trim()
      if (!trimmed) return
      void passwordUnlock.unlock(selectedPasswordEntry.entryId, trimmed)
      return
    }
    void onUnlock()
  }
</script>

<form class="space-y-3" onsubmit={handleSubmit}>
  <fieldset class="space-y-3" data-testid="login-unlock-method-fieldset">
    <legend class="sr-only">{vault.t(I18N_KEYS.LoginUnlockVault)}</legend>
    <div
      class="grid gap-2 overflow-hidden rounded-lg border border-border/50 sm:grid-cols-2"
      role="radiogroup"
      aria-label={vault.t(I18N_KEYS.LoginUnlockVault)}
    >
      <button
        type="button"
        role="radio"
        aria-checked={unlockMethod === UnlockMethod.Keys}
        class="flex items-center gap-2.5 px-3 py-3 text-left text-sm transition-colors {unlockMethod ===
        UnlockMethod.Keys
          ? 'bg-primary/[0.06] text-foreground'
          : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground'}"
        data-testid="login-unlock-method-keys"
        disabled={isVerifying || isInitializing || !deviceKeysAvailable}
        onclick={() => {
          unlockMethod = UnlockMethod.Keys
          passwordInput = ''
        }}
      >
        <ShieldCheck class="size-4 shrink-0" />
        {vault.t(I18N_KEYS.LoginUnlockKeys)}
      </button>
      {#if showPasswordUnlockOption}
        <button
          type="button"
          role="radio"
          aria-checked={unlockMethod === UnlockMethod.Password}
          class="flex items-center gap-2.5 border-t border-border/40 px-3 py-3 text-left text-sm transition-colors sm:border-t-0 sm:border-l {unlockMethod ===
          UnlockMethod.Password
            ? 'bg-primary/[0.06] text-foreground'
            : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground'}"
          data-testid="login-unlock-method-password"
          disabled={isVerifying || isInitializing}
          onclick={() => {
            unlockMethod = UnlockMethod.Password
          }}
        >
          <KeyRound class="size-4 shrink-0" />
          {vault.t(I18N_KEYS.LoginUnlockBackup)}
        </button>
      {/if}
    </div>

    {#if !deviceKeysAvailable}
      <p
        class="text-sm text-pretty text-muted-foreground"
        data-testid="login-device-keys-unavailable"
      >
        {deviceKeysUnlock.kind === DeviceKeysUnlockCapabilityKind.Unavailable
          ? deviceKeysUnlock.reason
          : vault.t(I18N_KEYS.LoginUnlockDeviceKeysUnavailable)}
      </p>
    {/if}

    {#if isPasswordUnlock}
      <div
        class="space-y-2.5 rounded-md border border-border/50 bg-muted/15 p-3"
      >
        <ul class="space-y-1.5" data-testid="login-password-entry-list">
          {#each passwordEntries as entry (entry.id)}
            <li>
              <button
                type="button"
                class="flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors {selectedPasswordEntry.kind ===
                  PasswordEntrySelectionKind.Selected &&
                selectedPasswordEntry.entryId === entry.id
                  ? 'border-primary/40 bg-primary/5 text-foreground'
                  : 'border-border bg-muted/20 text-muted-foreground hover:bg-accent hover:text-foreground'}"
                data-testid="login-password-entry-{entry.id}"
                onclick={() => {
                  const onSelectPasswordEntryArgs3: Parameters<typeof onSelectPasswordEntry>[0] = {
                    kind: PasswordEntrySelectionKind.Selected,
                    entryId: entry.id,
                  };
                  onSelectPasswordEntry(onSelectPasswordEntryArgs3)
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
          placeholder={vault.t(I18N_KEYS.LoginPasswordSelectedPlaceholder)}
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
      {vault.t(I18N_KEYS.LoginUnlocking)}
    {:else}
      <ShieldCheck class="size-4" />
      {vault.t(I18N_KEYS.LoginUnlockVaultBtn)}
    {/if}
  </Button>
</form>
