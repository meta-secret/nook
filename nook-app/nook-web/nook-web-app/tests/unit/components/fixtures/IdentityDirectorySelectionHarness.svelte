<script lang="ts">
  import { NookIdentityLocalAccessKind } from '$app-wasm'
  import type { VaultState } from '../../../../../nook-web-shared/src/vault-app/lib/vault.svelte'
  import type { DashboardView } from '../../../../../nook-web-shared/src/vault-app/lib/components/devices-access-dashboard-state'
  import { AccessChainStage } from '../../../../../nook-web-shared/src/vault-app/lib/components/devices-access/access-chain'
  import IdentityDirectoryRail from '../../../../../nook-web-shared/src/vault-app/lib/components/devices-access/IdentityDirectoryRail.svelte'
  import type { IdentityDirectoryEntry } from '../../../../../nook-web-shared/src/vault-app/lib/components/devices-access/identity-directory-view'
  import IdentityKeyInventory from '../../../../../nook-web-shared/src/vault-app/lib/components/devices-access/IdentityKeyInventory.svelte'

  let {
    vault,
    view,
    identities,
    initialIdentityId,
  }: {
    vault: VaultState
    view: DashboardView
    identities: readonly IdentityDirectoryEntry[]
    initialIdentityId: string
  } = $props()

  let selectedIdentityId = $state(initialIdentityId)
  let selectedStage = $state(AccessChainStage.Unlock)
  const identity = $derived(
    identities.find((entry) => entry.identityId === selectedIdentityId),
  )

  function chooseIdentity(identityId: string): void {
    selectedIdentityId = identityId
    selectedStage = AccessChainStage.Unlock
  }
</script>

<IdentityDirectoryRail
  {vault}
  {view}
  {identities}
  {selectedIdentityId}
  onSelectIdentity={chooseIdentity}
/>

{#if identity}
  <IdentityKeyInventory
    {vault}
    {view}
    {identity}
    {selectedStage}
    onSelectStage={(stage) => (selectedStage = stage)}
  />
  {#if identity.localAccess === NookIdentityLocalAccessKind.OtherInstallation}
    <div data-testid="other-installation-evidence"></div>
  {/if}
{/if}
