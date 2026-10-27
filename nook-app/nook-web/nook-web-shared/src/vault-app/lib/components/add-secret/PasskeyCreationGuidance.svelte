<script lang="ts">
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { KeyRound } from '@lucide/svelte'
  import BackButton from '$lib/components/workspace/BackButton.svelte'
  import { Button } from '$lib/components/ui/button'
  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
    onBack,
    onDone,
  }: {
    vault: VaultState
    onBack: () => void
    onDone: () => void
  } = $props()
</script>

<div class="space-y-4" data-testid="passkey-creation-guidance">
  <div
    class="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border/40 pb-3"
  >
    <div class="flex min-w-0 items-center gap-3">
      <BackButton
        label={vault.t(I18N_KEYS.AddSecretChangeType)}
        testId="change-secret-type-btn"
        {onBack}
      />
      <h3 class="truncate text-sm font-semibold text-foreground">
        {vault.t(I18N_KEYS.AddSecretTitleNewPasskey)}
      </h3>
    </div>
    <Button
      type="button"
      variant="outline"
      size="sm"
      class="sm:min-w-[5rem]"
      data-testid="add-secret-cancel-btn"
      onclick={onDone}
    >
      {vault.t(I18N_KEYS.CommonDone)}
    </Button>
  </div>

  <div class="nk-frame-sheet p-5">
    <div class="nk-tile nk-tile-lg mb-4 text-foreground">
      <KeyRound class="size-6" />
    </div>
    <h4 class="text-base font-semibold text-foreground">
      {vault.t(I18N_KEYS.AddSecretPasskeyCreationTitle)}
    </h4>
    <p class="mt-2 text-sm leading-relaxed text-muted-foreground text-pretty">
      {vault.t(I18N_KEYS.AddSecretPasskeyCreationDescription)}
    </p>
    <p class="mt-3 text-xs leading-relaxed text-muted-foreground text-pretty">
      {vault.t(I18N_KEYS.AddSecretPasskeyCreationHint)}
    </p>
  </div>
</div>
