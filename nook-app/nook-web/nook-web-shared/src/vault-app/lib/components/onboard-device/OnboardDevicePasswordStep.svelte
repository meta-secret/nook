<script lang="ts">
  import { RefreshCw, ShieldCheck } from '@lucide/svelte'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import {
    isVaultPasswordLongEnough,
    type NookPasswordEntrySummary,
  } from '$app-wasm'
  import type { VaultState } from '$lib/vault.svelte'
  import { Button } from '$lib/components/ui/button'
  import SetupWizardStep from '$lib/components/SetupWizardStep.svelte'
  import {
    PasswordEntrySelectionKind,
    type PasswordEntrySelection,
  } from '../onboard-device-state'

  let {
    vault,
    passwordEntries,
    effectivePasswordEntryId,
    subtitle,
    isBusy,
    isGenerating,
    passwordError,
    open = $bindable(false),
    passwordEntry = $bindable({
      kind: PasswordEntrySelectionKind.NotSelected,
    }),
    passwordInput = $bindable(''),
    onAddPassword,
  }: {
    vault: VaultState
    passwordEntries: NookPasswordEntrySummary[]
    effectivePasswordEntryId: string
    subtitle: string
    isBusy: boolean
    isGenerating: boolean
    passwordError: string
    open: boolean
    passwordEntry: PasswordEntrySelection
    passwordInput: string
    onAddPassword: (args: {
      readonly label: string
      readonly password: string
    }) => void | Promise<void>
  } = $props()

  let passwordLabelInput = $state('')
  let newPasswordInput = $state('')
  let newPasswordConfirm = $state('')
  let passwordFormError = $state('')

  async function submitAddPassword(): Promise<void> {
    passwordFormError = ''
    if (!passwordLabelInput.trim()) {
      passwordFormError = vault.t(I18N_KEYS.VaultPasswordsEnterLabelError)
      return
    }
    if (!isVaultPasswordLongEnough(newPasswordInput)) {
      passwordFormError = vault.t(I18N_KEYS.VaultPasswordsMinLengthError)
      return
    }
    if (newPasswordInput !== newPasswordConfirm) {
      passwordFormError = vault.t(I18N_KEYS.VaultPasswordsMismatchError)
      return
    }
    try {
      const addPasswordArgs: Parameters<typeof onAddPassword>[0] = {
        label: passwordLabelInput.trim(),
        password: newPasswordInput,
      }
      await onAddPassword(addPasswordArgs)
      passwordLabelInput = ''
      newPasswordInput = ''
      newPasswordConfirm = ''
    } catch {
      // The parent surfaces the domain error through passwordError.
    }
  }
</script>

<SetupWizardStep
  stepNumber={1}
  title={vault.t(I18N_KEYS.OnboardDeviceWizardPasswordStep)}
  {subtitle}
  bind:open
  testId="onboard-wizard-password-step"
>
  {#if passwordEntries.length > 0}
    <div class="space-y-3">
      <p class="text-sm text-muted-foreground text-pretty">
        {vault.t(I18N_KEYS.OnboardDeviceWizardPasswordExistingDesc)}
      </p>

      <div
        class="space-y-1.5"
        role="radiogroup"
        aria-label={vault.t(I18N_KEYS.OnboardDeviceVaultPassword)}
        data-testid="onboard-password-entry-list"
      >
        {#each passwordEntries as entry (entry.id)}
          {@const selected = entry.id === effectivePasswordEntryId}
          <button
            type="button"
            role="radio"
            aria-checked={selected}
            class="flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-all {selected
              ? 'border-primary/35 bg-primary/[0.08] text-foreground shadow-sm ring-1 ring-inset ring-primary/35'
              : 'border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground'}"
            data-testid="onboard-password-entry-{entry.id}"
            disabled={isBusy || isGenerating}
            onclick={() => {
              passwordEntry = {
                kind: PasswordEntrySelectionKind.Selected,
                entryId: entry.id,
              }
              passwordInput = ''
            }}
          >
            <span
              class="inline-flex size-[18px] shrink-0 items-center justify-center rounded-full border-2 {selected
                ? 'border-primary'
                : 'border-muted-foreground/35'}"
              aria-hidden="true"
            >
              {#if selected}
                <span class="size-2 rounded-full bg-primary"></span>
              {/if}
            </span>
            <ShieldCheck class="size-4 shrink-0 opacity-80" />
            <span class="min-w-0 flex-1">
              <span class="block truncate font-medium">{entry.label}</span>
              {#if entry.createdAt}
                <span
                  class="block truncate text-[11px] {selected
                    ? 'text-muted-foreground'
                    : 'text-muted-foreground/80'}"
                >
                  {(() => { const translationRequest: Parameters<typeof vault.t>[0] = { key: I18N_KEYS.VaultPasswordsAddedDate, replacements: {
                    date: entry.createdAt.slice(0, 10),
                  } }; return vault.t(translationRequest); })()}
                </span>
              {/if}
            </span>
          </button>
        {/each}
      </div>
    </div>
  {:else}
    <form
      class="space-y-4"
      data-testid="onboard-password-prerequisite"
      onsubmit={(event) => {
        event.preventDefault()
        void submitAddPassword()
      }}
    >
      <p class="text-sm text-foreground text-pretty">
        {vault.t(I18N_KEYS.OnboardDevicePasswordRequiredDesc)}
      </p>

      <div class="space-y-1.5">
        <label for="onboard-vault-pw-label" class="text-xs font-medium text-foreground">
          {vault.t(I18N_KEYS.VaultPasswordsLabel)}
        </label>
        <input
          id="onboard-vault-pw-label"
          type="text"
          class="flex h-9 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-hidden focus:ring-2 focus:ring-ring"
          placeholder={vault.t(I18N_KEYS.VaultPasswordsLabelPlaceholder)}
          bind:value={passwordLabelInput}
          data-testid="vault-password-label"
        />
      </div>

      <div class="space-y-1.5">
        <label for="onboard-vault-pw" class="text-xs font-medium text-foreground">
          {vault.t(I18N_KEYS.VaultFieldsPassword)}
        </label>
        <input
          id="onboard-vault-pw"
          type="password"
          class="flex h-9 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-hidden focus:ring-2 focus:ring-ring"
          bind:value={newPasswordInput}
          autocomplete="new-password"
          data-testid="vault-password-input"
        />
      </div>

      <div class="space-y-1.5">
        <label for="onboard-vault-pw-confirm" class="text-xs font-medium text-foreground">
          {vault.t(I18N_KEYS.VaultPasswordsConfirmPassword)}
        </label>
        <input
          id="onboard-vault-pw-confirm"
          type="password"
          class="flex h-9 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-hidden focus:ring-2 focus:ring-ring"
          bind:value={newPasswordConfirm}
          autocomplete="new-password"
          data-testid="vault-password-confirm"
        />
      </div>

      {#if passwordFormError || passwordError}
        <p class="text-xs text-destructive" data-testid="vault-password-error">
          {passwordFormError || passwordError}
        </p>
      {/if}

      <div class="flex justify-end">
        <Button
          type="submit"
          size="sm"
          disabled={isBusy}
          data-testid="submit-vault-password"
        >
          {#if isBusy}
            <RefreshCw class="size-3.5 animate-spin" />
            {vault.t(I18N_KEYS.VaultPasswordsWorking)}
          {:else}
            <ShieldCheck class="size-3.5" />
            {vault.t(I18N_KEYS.VaultPasswordsAddPassword)}
          {/if}
        </Button>
      </div>
    </form>
  {/if}
</SetupWizardStep>
