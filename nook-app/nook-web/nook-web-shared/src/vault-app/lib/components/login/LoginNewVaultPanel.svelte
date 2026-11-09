<!--
New vault for a keyring: name it and create it here. It opens inside the
keyring card. Keyrings, not vaults, come from a sync provider: that is the
keyrings page's own Recover keyring.
-->
<script lang="ts">
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { X } from '@lucide/svelte'
  import LoginVaultNameForm from '$lib/components/login/LoginVaultNameForm.svelte'
  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
    isVerifying,
    isInitializing,
    onCreateVault,
    onClose,
  }: {
    vault: VaultState
    isVerifying: boolean
    isInitializing: boolean
    onCreateVault: (label: string) => void | Promise<void>
    onClose: () => void
  } = $props()
</script>

<section
  class="grid min-w-0 gap-5"
  aria-labelledby="login-new-vault-title"
  data-testid="login-new-vault-panel"
>
  <header class="flex items-start justify-between gap-4">
    <div class="grid gap-1">
      <h2
        id="login-new-vault-title"
        class="text-lg font-semibold tracking-tight text-foreground"
      >
        {vault.t(I18N_KEYS.LoginNewVaultTitle)}
      </h2>
      <p class="max-w-[60ch] text-sm text-pretty text-muted-foreground">
        {vault.t(I18N_KEYS.LoginNewVaultDescriptionCreate)}
      </p>
    </div>
    <button
      type="button"
      class="nk-icon-btn"
      aria-label={vault.t(I18N_KEYS.LoginNewVaultClose)}
      title={vault.t(I18N_KEYS.LoginNewVaultClose)}
      data-testid="login-new-vault-close"
      onclick={onClose}
    >
      <X class="size-4" />
    </button>
  </header>

  <div data-testid="login-vault-create-workflow">
    <LoginVaultNameForm
      {vault}
      {isVerifying}
      {isInitializing}
      testId="login-create-additional-vault-btn"
      submitLabel={vault.t(I18N_KEYS.LoginVaultPickerCreateNew)}
      onCreate={onCreateVault}
    />
  </div>
</section>
