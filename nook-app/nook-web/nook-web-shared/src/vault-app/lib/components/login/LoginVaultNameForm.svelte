<script lang="ts">
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { RefreshCw, ShieldCheck } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import type { VaultState } from '$lib/vault.svelte'
  import { VaultNameHint } from './login-vault-name-form'

  const VAULT_NAME_MAX_LENGTH = 64

  let {
    vault,
    isVerifying,
    isInitializing,
    submitLabel,
    testId = 'login-create-device-vault-btn',
    hint = VaultNameHint.Shown,
    onCreate,
  }: {
    vault: VaultState
    isVerifying: boolean
    isInitializing: boolean
    submitLabel: string
    testId?: string
    hint?: VaultNameHint
    onCreate: (label: string) => void | Promise<void>
  } = $props()

  let vaultName = $state('')

  const isBusy = $derived(isVerifying || isInitializing)
  const trimmedName = $derived(vaultName.trim())
  const canSubmit = $derived(
    trimmedName.length > 0 && trimmedName.length <= VAULT_NAME_MAX_LENGTH,
  )

  async function handleSubmit() {
    if (!canSubmit || isBusy) return
    await onCreate(trimmedName)
  }
</script>

<div class="space-y-3" data-testid="login-vault-name-form">
  <div class="space-y-1.5">
    <label class="nk-field-label" for="login-vault-name">
      {vault.t(I18N_KEYS.LoginVaultNameLabel)}
    </label>
    <input
      id="login-vault-name"
      type="text"
      class="h-10 w-full rounded-none border border-input bg-background px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-foreground/40 focus-visible:ring-2 focus-visible:ring-ring"
      placeholder={vault.t(I18N_KEYS.LoginVaultNamePlaceholder)}
      maxlength={VAULT_NAME_MAX_LENGTH}
      autocomplete="off"
      data-testid="login-vault-name-input"
      bind:value={vaultName}
      disabled={isBusy}
      onkeydown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          void handleSubmit()
        }
      }}
    />
    {#if hint === VaultNameHint.Shown}
      <p class="text-xs text-muted-foreground text-pretty">
        {vault.t(I18N_KEYS.LoginVaultNameHint)}
      </p>
    {/if}
  </div>

  <Button
    type="button"
    class="nk-go w-full sm:w-auto sm:min-w-[180px]"
    data-testid={testId}
    disabled={isBusy || !canSubmit}
    onclick={() => void handleSubmit()}
  >
    {#if isVerifying}
      <RefreshCw class="size-4 animate-spin" />
      {vault.t(I18N_KEYS.LoginCreatingVault)}
    {:else if isInitializing}
      <RefreshCw class="size-4 animate-spin" />
      {vault.t(I18N_KEYS.OnboardingLoadingEngine)}
    {:else}
      <ShieldCheck class="size-4" />
      {submitLabel}
    {/if}
  </Button>
</div>
