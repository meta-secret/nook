<script lang="ts">
  import { Button } from '$lib/components/ui/button'
  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
    onClose,
  }: {
    vault: VaultState
    onClose: () => unknown
  } = $props()
</script>

<section
  class="mx-auto max-w-2xl rounded-xl border border-destructive/30 bg-card p-4 shadow-sm sm:p-5"
  data-testid="extension-connect-invalid"
>
  <h1 class="text-lg font-semibold text-foreground">
    {vault.t('extension.connect.invalid_title')}
  </h1>
  <p class="mt-2 text-sm leading-relaxed text-muted-foreground">
    {vault.t('extension.connect.invalid_description')}
  </p>
  <Button
    type="button"
    variant="outline"
    class="mt-4"
    onclick={onClose}
  >
    {vault.t('extension.connect.return_to_nook')}
  </Button>
</section>
