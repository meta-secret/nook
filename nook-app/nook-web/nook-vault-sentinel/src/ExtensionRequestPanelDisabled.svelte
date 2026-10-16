<script lang="ts">
  import type { VaultState } from '$lib/vault.svelte'
  import type { ExtensionConnectRequest } from '$lib/extension/connect'
  import type { IdentityCardView } from '$lib/components/identities/identity-card-model'

  let {
    vault,
    request,
    card,
    busy = false,
    onConnect,
  }: {
    vault: VaultState
    request: ExtensionConnectRequest
    card: IdentityCardView
    busy?: boolean
    onConnect: (storeId: string) => void
  } = $props()

  const disabled = $derived(Boolean(vault && request && card && onConnect))
</script>

<div aria-hidden="true" data-disabled={disabled} data-busy={busy} hidden></div>
