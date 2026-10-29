<!--
The overview of an identity unlocked while none of its vaults is open, beside
its card on the hub. Its pages open in place of the hub; Vaults has none to
list, so it offers New vault on the card instead.
-->
<script lang="ts">
  import { untrack } from 'svelte'
  import type { NookIdentityHealth } from '$app-wasm'
  import type { VaultState } from '$lib/vault.svelte'
  import { IdentityPages } from '$lib/vault/identity-pages'
  import { WorkspaceSection } from '$lib/vault/state/ui.svelte'
  import IdentityOverviewPanel from './IdentityOverviewPanel.svelte'

  let {
    vault,
    health,
    onNewVault,
  }: {
    vault: VaultState
    health: NookIdentityHealth
    onNewVault: () => void
  } = $props()

  const pages = new IdentityPages(untrack(() => vault))

  function open(section: WorkspaceSection): void {
    if (section !== WorkspaceSection.Vaults) {
      pages.show(section)
      return
    }
    pages.show(WorkspaceSection.Identities)
    onNewVault()
  }
</script>

<IdentityOverviewPanel
  {vault}
  {health}
  onOpen={open}
  onAddSyncProvider={() => pages.addSyncProvider()}
  onClose={() => pages.show(WorkspaceSection.Identities)}
/>
