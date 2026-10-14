<!--
New vault for an identity: create one here, or (while locked) bring an
existing one in from a sync provider. It opens inside the identity card.
-->
<script lang="ts">
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { CloudDownload, FolderPlus, X } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import LoginVaultNameForm from '$lib/components/login/LoginVaultNameForm.svelte'
  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
    isVerifying,
    isInitializing,
    onCreateVault,
    onImportVault = () => {},
    importable = true,
    onClose,
  }: {
    vault: VaultState
    isVerifying: boolean
    isInitializing: boolean
    onCreateVault: (label: string) => void | Promise<void>
    onImportVault?: () => void
    /** Offer "import from a sync provider" next to creating a vault. */
    importable?: boolean
    onClose: () => void
  } = $props()

  const isBusy = $derived(isVerifying || isInitializing)
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
        {importable
          ? vault.t(I18N_KEYS.LoginNewVaultDescription)
          : vault.t(I18N_KEYS.LoginNewVaultDescriptionCreate)}
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

  <div class="grid gap-4 {importable ? 'xl:grid-cols-2' : ''}">
    <section
      class="nk-frame-nick grid content-start gap-3 p-4"
      data-testid="login-vault-create-workflow"
    >
      <span class="nk-tile" aria-hidden="true"
        ><FolderPlus class="size-4" /></span
      >
      <div class="grid gap-1">
        <h3 class="text-[0.9375rem] font-semibold text-foreground">
          {vault.t(I18N_KEYS.LoginVaultPickerCreateNew)}
        </h3>
        <p class="text-sm text-pretty text-muted-foreground">
          {vault.t(I18N_KEYS.LoginVaultWorkflowCreateDescription)}
        </p>
      </div>
      <LoginVaultNameForm
        {vault}
        {isVerifying}
        {isInitializing}
        testId="login-create-additional-vault-btn"
        submitLabel={vault.t(I18N_KEYS.LoginVaultPickerCreateNew)}
        onCreate={onCreateVault}
      />
    </section>
    {#if importable}
      <section
        class="nk-frame-nick grid content-start gap-3 p-4"
        data-testid="login-vault-import-workflow"
      >
        <span class="nk-tile" aria-hidden="true"
          ><CloudDownload class="size-4" /></span
        >
        <div class="grid gap-1">
          <h3 class="text-[0.9375rem] font-semibold text-foreground">
            {vault.t(I18N_KEYS.LoginVaultPickerImport)}
          </h3>
          <p class="text-sm text-pretty text-muted-foreground">
            {vault.t(I18N_KEYS.LoginVaultWorkflowImportDescription)}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          class="justify-self-start"
          data-testid="login-import-vault-btn"
          disabled={isBusy}
          onclick={onImportVault}
        >
          <CloudDownload class="size-4" />
          {vault.t(I18N_KEYS.LoginVaultPickerImport)}
        </Button>
      </section>
    {/if}
  </div>
</section>
