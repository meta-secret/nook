<script lang="ts">
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { Button } from '$lib/components/ui/button'
  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
    onClose,
  }: {
    vault: VaultState
    onClose: () => void
  } = $props()
</script>

<section
  class="mx-auto max-w-2xl rounded-xl border border-destructive/30 bg-card p-4 shadow-sm sm:p-5"
  data-testid="extension-connect-invalid"
>
  <h1 class="text-lg font-semibold text-foreground">
    {vault.t(I18N_KEYS.ExtensionConnectInvalidTitle)}
  </h1>
  <p class="mt-2 text-sm leading-relaxed text-muted-foreground">
    {vault.t(I18N_KEYS.ExtensionConnectInvalidDescription)}
  </p>
  <Button
    type="button"
    variant="outline"
    class="mt-4"
    onclick={onClose}
  >
    {vault.t(I18N_KEYS.ExtensionConnectReturnToNook)}
  </Button>
</section>
