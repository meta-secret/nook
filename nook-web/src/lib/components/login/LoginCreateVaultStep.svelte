<script lang="ts">
  import { RefreshCw, ShieldCheck } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
    isVerifying,
    isInitializing,
    onCreateVault,
  }: {
    vault: VaultState
    isVerifying: boolean
    isInitializing: boolean
    onCreateVault: (password: string) => void | Promise<void>
  } = $props()

  let password = $state('')
  let confirmPassword = $state('')

  const passwordsMatch = $derived(
    password.length > 0 && password === confirmPassword,
  )
  const canSubmit = $derived(
    passwordsMatch &&
      password.trim().length >= 8 &&
      !isVerifying &&
      !isInitializing,
  )

  function handleSubmit(e: Event) {
    e.preventDefault()
    if (!canSubmit) return
    void onCreateVault(password.trim())
  }
</script>

<form
  class="space-y-4"
  onsubmit={handleSubmit}
  data-testid="login-create-vault-form"
>
  <p class="text-sm text-pretty text-muted-foreground">
    {vault.t('login.create_vault_description')}
  </p>

  <div class="space-y-2">
    <label
      class="text-sm font-medium text-foreground"
      for="login-create-password"
    >
      {vault.t('login.master_password_label')}
    </label>
    <input
      id="login-create-password"
      type="password"
      class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      placeholder={vault.t('login.master_password_placeholder')}
      bind:value={password}
      autocomplete="new-password"
      data-testid="login-create-password-input"
      required
      minlength="8"
    />
  </div>

  <div class="space-y-2">
    <label
      class="text-sm font-medium text-foreground"
      for="login-create-password-confirm"
    >
      {vault.t('login.confirm_password_label')}
    </label>
    <input
      id="login-create-password-confirm"
      type="password"
      class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      placeholder={vault.t('login.confirm_password_placeholder')}
      bind:value={confirmPassword}
      autocomplete="new-password"
      data-testid="login-create-password-confirm"
      required
      minlength="8"
    />
    {#if confirmPassword.length > 0 && !passwordsMatch}
      <p class="text-xs text-destructive">
        {vault.t('login.passwords_mismatch')}
      </p>
    {/if}
  </div>

  <Button
    type="submit"
    class="w-full sm:w-auto sm:min-w-[180px]"
    data-testid="login-create-vault-btn"
    disabled={!canSubmit}
  >
    {#if isVerifying}
      <RefreshCw class="size-4 animate-spin" />
      {vault.t('login.creating_vault')}
    {:else}
      <ShieldCheck class="size-4" />
      {vault.t('login.create_vault_btn')}
    {/if}
  </Button>
</form>
