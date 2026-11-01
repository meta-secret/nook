<!--
The row above the S3 form: what is being set up, and the quiet way back to
the other providers. It waits while a connection attempt runs.
-->
<script lang="ts">
  import { Archive } from '@lucide/svelte'
  import { I18N_KEYS } from '../../../generated/i18n-keys'
  import { S3ConnectionProgress } from '$lib/components/s3-connection-form'
  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
    progress,
    onChangeProvider,
  }: {
    vault: VaultState
    progress: S3ConnectionProgress
    onChangeProvider: () => void
  } = $props()
</script>

<div class="flex items-center gap-2 text-sm">
  <Archive class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
  <span class="font-medium text-foreground"
    >{vault.t(I18N_KEYS.ProviderPickerS3)}</span
  >
  <button
    type="button"
    class="ml-auto text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground disabled:opacity-60"
    data-testid="cancel-provider-setup"
    disabled={progress !== S3ConnectionProgress.Idle}
    onclick={onChangeProvider}
  >
    {vault.t(I18N_KEYS.ProviderSetupChangeProvider)}
  </button>
</div>
