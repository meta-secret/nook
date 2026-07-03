<script lang="ts">
  import { Plus } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import LoginAuthorizationStep from '$lib/components/login/LoginAuthorizationStep.svelte'
  import type { VaultPasswordEntrySummary } from '$lib/vault-password'
  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
    passwordEntries = [] as VaultPasswordEntrySummary[],
    selectedPasswordEntryId = $bindable(null as string | null),
    isVerifying,
    isInitializing,
    isUnlocking = false,
    onUnlock,
    onUnlockWithPassword,
    onCreateAnotherVault,
  }: {
    vault: VaultState
    passwordEntries?: VaultPasswordEntrySummary[]
    selectedPasswordEntryId?: string | null
    isVerifying: boolean
    isInitializing: boolean
    isUnlocking?: boolean
    onUnlock: () => void | Promise<void>
    onUnlockWithPassword?: (
      entryId: string,
      password: string,
    ) => void | Promise<void>
    onCreateAnotherVault?: () => void | Promise<void>
  } = $props()
</script>

<div class="space-y-3" data-testid="login-local-unlock-step">
  <p class="text-sm text-pretty text-muted-foreground">
    {vault.t('login.local_vault_description')}
  </p>

  <LoginAuthorizationStep
    {vault}
    {passwordEntries}
    bind:selectedPasswordEntryId
    {isVerifying}
    {isInitializing}
    {isUnlocking}
    loginPasswordPrompt={vault.loginPasswordPrompt}
    onConsumeLoginPasswordPrompt={() => {
      vault.loginPasswordPrompt = false
    }}
    {onUnlock}
    {onUnlockWithPassword}
  />

  {#if onCreateAnotherVault}
    <Button
      type="button"
      variant="outline"
      class="w-full sm:w-auto"
      data-testid="login-create-additional-vault-btn"
      disabled={isVerifying || isInitializing}
      onclick={() => onCreateAnotherVault()}
    >
      <Plus class="size-4" />
      {vault.t('login.vault_picker_create_new')}
    </Button>
  {/if}
</div>
