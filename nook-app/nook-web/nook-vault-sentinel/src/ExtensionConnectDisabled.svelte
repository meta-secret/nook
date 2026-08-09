<script lang="ts">
  import type { VaultState } from '$lib/vault.svelte'
  import type { ExtensionConnectRequest } from '$lib/extension/connect'

  let {
    vault,
    request,
    onClose,
  }: {
    vault: VaultState
    request: ExtensionConnectRequest
    onClose: (approved?: boolean) => void
  } = $props()

  const disabled = $derived(Boolean(vault && request && onClose))
</script>

<div aria-hidden="true" data-disabled={disabled} hidden></div>
