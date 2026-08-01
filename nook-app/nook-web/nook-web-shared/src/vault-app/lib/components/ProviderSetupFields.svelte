<script lang="ts">
  import { I18N_KEYS } from '../../../generated/i18n-keys'
  import { HardDrive } from '@lucide/svelte'
  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
    onCancelSetup,
  }: {
    vault: VaultState
    onCancelSetup: () => void
  } = $props()
</script>

<div class="space-y-5">
  <div class="flex items-center gap-2 text-sm">
    <HardDrive class="size-4 shrink-0 text-muted-foreground" />
    <span class="font-medium text-foreground"
      >{vault.t(I18N_KEYS.ProviderPickerThisDevice)}</span
    >
    <button
      type="button"
      class="ml-auto text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
      data-testid="cancel-provider-setup"
      onclick={onCancelSetup}
    >
      {vault.t(I18N_KEYS.ProviderSetupChangeProvider)}
    </button>
  </div>

  <p class="text-xs text-muted-foreground text-pretty">
    {vault.t(I18N_KEYS.ProviderSetupLocalStorageDesc)}
  </p>
</div>
