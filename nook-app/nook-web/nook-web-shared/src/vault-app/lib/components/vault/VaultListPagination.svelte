<!-- Previous / next page controls under the vault list. -->
<script lang="ts">
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { ChevronLeft, ChevronRight } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import type { VaultState } from '$lib/vault.svelte'

  let { vault }: { vault: VaultState } = $props()

  const currentPage = $derived(
    Math.floor(vault.secretPageOffset / vault.secretPageSize) + 1,
  )
  const pageCount = $derived(
    Math.max(1, Math.ceil(vault.secretTotal / vault.secretPageSize)),
  )
  const pageStatus = $derived.by(() => {
    const pageStatusArgs: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.VaultPageStatus,
      replacements: {
        page: String(currentPage),
        total: String(pageCount),
      },
    }
    return vault.t(pageStatusArgs)
  })

  function loadPage(requestedOffset: number): void {
    const pageRequest: Parameters<typeof vault.loadSecretPage>[0] = {
      query: vault.secretQuery,
      requestedOffset,
    }
    void vault.loadSecretPage(pageRequest).then((result) => {
      if (result.isErr()) vault.errorMsg = vault.t(result.error.translationKey)
    })
  }
</script>

<div
  class="nk-vault-pagination flex items-center justify-between gap-2"
  data-testid="secret-pagination"
>
  <Button
    size="sm"
    variant="outline"
    data-testid="secret-page-previous"
    disabled={vault.secretPageOffset === 0}
    onclick={() =>
      loadPage(Math.max(0, vault.secretPageOffset - vault.secretPageSize))}
  >
    <ChevronLeft class="size-3.5" />
    {vault.t(I18N_KEYS.VaultPreviousPage)}
  </Button>
  <span class="nk-label">{pageStatus}</span>
  <Button
    size="sm"
    variant="outline"
    data-testid="secret-page-next"
    disabled={vault.secretPageOffset + vault.secretPageSize >=
      vault.secretTotal}
    onclick={() => loadPage(vault.secretPageOffset + vault.secretPageSize)}
  >
    {vault.t(I18N_KEYS.VaultNextPage)}
    <ChevronRight class="size-3.5" />
  </Button>
</div>
