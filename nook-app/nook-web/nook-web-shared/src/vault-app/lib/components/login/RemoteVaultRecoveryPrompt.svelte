<!--
The question recovery asks before a setup wizard connects, while the
provider's vault needs an answer: recover it, start a fresh one, or neither.
Every remote setup wizard on the login screen shows it above Connect & sync.
-->
<script lang="ts">
  import RemoteVaultRecoveryPanel from '$lib/components/login/RemoteVaultRecoveryPanel.svelte'
  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
    isVerifying,
  }: {
    vault: VaultState
    isVerifying: boolean
  } = $props()

  function dismiss(): void {
    const cleared = vault.clearRemoteVaultRecovery()
    if (cleared.isErr()) vault.errorMsg = vault.t(cleared.error.translationKey)
  }
</script>

{#if vault.clientPolicy.remote_recovery_prompt_visible(vault.remoteVaultRecoveryState)}
  <RemoteVaultRecoveryPanel
    {vault}
    state={vault.remoteVaultRecoveryState}
    isBusy={isVerifying}
    onRecover={() => vault.confirmRecoverRemoteVault()}
    onCreateFresh={() => vault.confirmCreateFreshRemoteVault()}
    onDismiss={dismiss}
  />
{/if}
