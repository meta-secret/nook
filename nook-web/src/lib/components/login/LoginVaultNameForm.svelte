<script lang="ts">
  import { RefreshCw, ShieldCheck } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import type { VaultState } from '$lib/vault.svelte'

  const VAULT_NAME_MAX_LENGTH = 64

  let {
    vault,
    isVerifying,
    isInitializing,
    submitLabel,
    testId = 'login-create-device-vault-btn',
    onCreate,
  }: {
    vault: VaultState
    isVerifying: boolean
    isInitializing: boolean
    submitLabel: string
    testId?: string
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
    <label class="text-xs font-medium text-foreground" for="login-vault-name">
      {vault.t('login.vault_name_label')}
    </label>
    <input
      id="login-vault-name"
      type="text"
      class="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm text-foreground outline-none ring-offset-background transition-colors placeholder:text-muted-foreground focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20"
      placeholder={vault.t('login.vault_name_placeholder')}
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
    <p class="text-xs text-muted-foreground text-pretty">
      {vault.t('login.vault_name_hint')}
    </p>
  </div>

  <Button
    type="button"
    class="w-full sm:w-auto sm:min-w-[180px]"
    data-testid={testId}
    disabled={isBusy || !canSubmit}
    onclick={() => void handleSubmit()}
  >
    {#if isVerifying}
      <RefreshCw class="size-4 animate-spin" />
      {vault.t('login.creating_vault')}
    {:else if isInitializing}
      <RefreshCw class="size-4 animate-spin" />
      {vault.t('onboarding.loading_engine')}
    {:else}
      <ShieldCheck class="size-4" />
      {submitLabel}
    {/if}
  </Button>
</div>
