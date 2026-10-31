<!--
A join that waits for this browser's first protected key. The device
protection gate runs over the page; once a key is unlocked, the join asks
with it. Dismissing the gate leaves the join and asks nothing.
-->
<script lang="ts">
  import { untrack } from 'svelte'
  import PasskeyAuthOverlay from '$lib/components/PasskeyAuthOverlay.svelte'
  import type { VaultState } from '$lib/vault.svelte'
  import {
    IdentityJoinWaitKind,
    type WaitingIdentityJoin,
  } from '$lib/vault/identity-join-wait'
  import {
    IdentityJoinActions,
    IdentityJoinAsked,
  } from '$lib/vault/identity-plan-actions'

  let {
    vault,
    onRequested,
  }: {
    vault: VaultState
    /** The request reached the identity's log: list again. */
    onRequested: () => void | Promise<void>
  } = $props()

  const waitsForDevice = $derived(
    vault.identityJoin.kind === IdentityJoinWaitKind.Device &&
      !vault.deviceProtectionReady,
  )

  async function resume(wait: WaitingIdentityJoin): Promise<void> {
    const resumed = await new IdentityJoinActions(vault).resume(wait)
    if (resumed.isErr()) {
      vault.errorMsg = resumed.error.message(vault)
      return
    }
    switch (resumed.value) {
      case IdentityJoinAsked.Requested:
      case IdentityJoinAsked.Joined:
        await onRequested()
        return
      case IdentityJoinAsked.WaitsForDevice:
      case IdentityJoinAsked.WaitsForNewKey:
        return
    }
  }

  $effect(() => {
    const wait = vault.identityJoin
    switch (wait.kind) {
      case IdentityJoinWaitKind.Idle:
      case IdentityJoinWaitKind.NewKey:
        return
      case IdentityJoinWaitKind.Device:
        if (!vault.deviceProtectionReady || vault.isVerifying) return
        untrack(() => void resume(wait))
    }
  })
</script>

{#if waitsForDevice}
  <PasskeyAuthOverlay
    {vault}
    onDismiss={() => new IdentityJoinActions(vault).cancel()}
  />
{/if}
