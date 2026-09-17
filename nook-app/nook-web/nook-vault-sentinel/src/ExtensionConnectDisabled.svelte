<script lang="ts">
  import type { VaultState } from '$lib/vault.svelte'
  import type { ExtensionConnectRequest } from '$lib/extension/connect'
  import type { ExtensionConsentCloseOutcome } from '$lib/components/extension-connect-consent-outcome'

  let {
    vault,
    request,
    onClose,
  }: {
    vault: VaultState
    request: ExtensionConnectRequest
    onClose: (outcome: ExtensionConsentCloseOutcome) => void
  } = $props()

  const disabled = $derived(Boolean(vault && request && onClose))
</script>

<div aria-hidden="true" data-disabled={disabled} hidden></div>
