<script lang="ts">
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
      >{vault.t('provider_picker.this_device')}</span
    >
    <button
      type="button"
      class="ml-auto text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
      data-testid="cancel-provider-setup"
      onclick={onCancelSetup}
    >
      {vault.t('provider_setup.change_provider')}
    </button>
  </div>

  <p class="text-xs text-muted-foreground text-pretty">
    {vault.t('provider_setup.local_storage_desc')}
  </p>
</div>
