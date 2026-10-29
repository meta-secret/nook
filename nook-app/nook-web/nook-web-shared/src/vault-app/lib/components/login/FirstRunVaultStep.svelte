<!--
Last step of setup for an identity kept on this browser: it exists now, and
a vault is the person's choice. Creating one names it here; Not now leaves
the identity without a vault, and its card offers New vault later.
-->
<script lang="ts">
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { Button } from '$lib/components/ui/button'
  import FirstRunProgress from './FirstRunProgress.svelte'
  import LoginVaultNameForm from './LoginVaultNameForm.svelte'
  import type { VaultState } from '$lib/vault.svelte'
  import { FirstRunActions } from '$lib/vault/first-run'
  import { FirstRunStage } from '$lib/vault/state/ui.svelte'

  let { vault }: { vault: VaultState } = $props()

  const actions = $derived(new FirstRunActions(vault))
</script>

<section
  class="mx-auto grid w-full max-w-md gap-6 py-6 sm:py-10"
  data-testid="first-run-vault-step"
>
  <FirstRunProgress {vault} current={FirstRunStage.Vault} />

  <div class="space-y-2">
    <h1
      class="text-[1.75rem] leading-tight font-semibold tracking-[-0.02em] text-foreground"
    >
      {vault.t(I18N_KEYS.FirstRunVaultTitle)}
    </h1>
    <p class="text-sm text-pretty text-muted-foreground">
      {vault.t(I18N_KEYS.FirstRunVaultBody)}
    </p>
  </div>

  <LoginVaultNameForm
    {vault}
    isVerifying={vault.isVerifying}
    isInitializing={vault.isInitializing}
    submitLabel={vault.t(I18N_KEYS.FirstRunVaultCreate)}
    onCreate={(name: string) => actions.createFirstVault(name)}
  />

  <div>
    <Button
      type="button"
      variant="ghost"
      data-testid="first-run-vault-skip"
      disabled={vault.isVerifying}
      onclick={() => actions.skipFirstVault()}
    >
      {vault.t(I18N_KEYS.FirstRunVaultSkip)}
    </Button>
  </div>
</section>
