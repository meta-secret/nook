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
    deviceKeysUnlock.kind === DeviceKeysUnlockCapabilityKind.Available,
  )
  const deviceKeysUnavailable = $derived(
    deviceKeysUnlock.kind === DeviceKeysUnlockCapabilityKind.Unavailable,
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
        const [passwordEntry] = passwordEntries
        if (!passwordEntry) return
        const onSelectPasswordEntryArgs: Parameters<
          typeof onSelectPasswordEntry
        >[0] = {
          kind: PasswordEntrySelectionKind.Selected,
          entryId: passwordEntry.id,
        }
        onSelectPasswordEntry(onSelectPasswordEntryArgs)
      }
      onConsumeLoginPasswordPrompt()
    }
  })

  $effect(() => {
    if (
      deviceKeysUnavailable &&
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
      const [passwordEntry] = passwordEntries
      if (!passwordEntry) return
      const onSelectPasswordEntryArgs2: Parameters<
        typeof onSelectPasswordEntry
      >[0] = {
        kind: PasswordEntrySelectionKind.Selected,
        entryId: passwordEntry.id,
      }
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
      const unlockRequest: Parameters<typeof passwordUnlock.unlock>[0] = {
        entryId: selectedPasswordEntry.entryId,
        password: trimmed,
      }
      void passwordUnlock.unlock(unlockRequest)
      return
    }
    void onUnlock()
  }
</script>

<form class="space-y-3" onsubmit={handleSubmit}>
  <fieldset class="space-y-3" data-testid="login-unlock-method-fieldset">
    <legend class="sr-only">{vault.t(I18N_KEYS.LoginUnlockVault)}</legend>
    <div
      class="nk-chips"
      role="radiogroup"
      aria-label={vault.t(I18N_KEYS.LoginUnlockVault)}
    >
      <button
        type="button"
        role="radio"
        aria-checked={unlockMethod === UnlockMethod.Keys}
        class="nk-chip h-9 disabled:cursor-not-allowed disabled:opacity-50"
        data-testid="login-unlock-method-keys"
        disabled={isVerifying || isInitializing || !deviceKeysAvailable}
        onclick={() => {
          unlockMethod = UnlockMethod.Keys
          passwordInput = ''
        }}
      >
        <ShieldCheck class="size-3.5 shrink-0" />
        {vault.t(I18N_KEYS.LoginUnlockKeys)}
      </button>
      {#if showPasswordUnlockOption}
        <button
          type="button"
          role="radio"
          aria-checked={unlockMethod === UnlockMethod.Password}
          class="nk-chip h-9 disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="login-unlock-method-password"
          disabled={isVerifying || isInitializing}
          onclick={() => {
            unlockMethod = UnlockMethod.Password
          }}
        >
          <KeyRound class="size-3.5 shrink-0" />
          {vault.t(I18N_KEYS.LoginUnlockBackup)}
        </button>
      {/if}
    </div>

    {#if deviceKeysUnavailable}
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
      <div class="grid gap-2.5">
        <ul class="nk-list" data-testid="login-password-entry-list">
          {#each passwordEntries as entry (entry.id)}
            <li>
              <button
                type="button"
                class="flex w-full items-center gap-3 border-t border-border px-3.5 py-2.5 text-left text-sm transition-colors first:border-t-0 {selectedPasswordEntry.kind ===
                  PasswordEntrySelectionKind.Selected &&
                selectedPasswordEntry.entryId === entry.id
                  ? 'bg-accent text-foreground shadow-[inset_3px_0_0_var(--foreground)]'
                  : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'}"
                data-testid="login-password-entry-{entry.id}"
                onclick={() => {
                  const onSelectPasswordEntryArgs3: Parameters<
                    typeof onSelectPasswordEntry
                  >[0] = {
                    kind: PasswordEntrySelectionKind.Selected,
                    entryId: entry.id,
                  }
                  onSelectPasswordEntry(onSelectPasswordEntryArgs3)
                }}
              >
                <UserRound class="size-4 shrink-0" />
                <span class="truncate font-medium">{entry.label}</span>
              </button>
            </li>
          {/each}
        </ul>
        <input
          type="password"
          class="h-10 w-full rounded-none border border-input bg-background px-3 text-sm focus:border-foreground/40 focus:outline-none focus:ring-2 focus:ring-ring"
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
    class="nk-go w-full font-medium sm:w-auto sm:min-w-[160px]"
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
