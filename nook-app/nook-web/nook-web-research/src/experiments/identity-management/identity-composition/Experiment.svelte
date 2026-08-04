<!--
THESIS: Keep the accepted dark chain-strength composition intact, but give its
two domains separate owners. Identities renders identity composition; Vault ↔
identities renders authorization grants and never descends into key paths.
-->
<script lang="ts">
  import ExperimentBack from '$lib/components/ExperimentBack.svelte'
  import type { ExperimentProps } from '../../index'
  import { identities } from '../_shared/identity-model'
  import Identities from './Identities.svelte'
  import VaultIdentities from './VaultIdentities.svelte'

  let { navigate }: ExperimentProps = $props()
  let activeIdentityId = $state('identity-nora')

  function selectIdentity(identityId: string): void {
    activeIdentityId = identityId
  }
</script>

<main class="min-h-[100svh] bg-[#090a0c] text-[#f4f4f5]">
  <ExperimentBack {navigate} />

  <div
    class="fixed top-[4.25rem] right-3 z-50 flex items-center gap-1 rounded-full border border-white/15 bg-black/55 p-1 text-[11px] font-semibold tracking-wide text-white backdrop-blur-md sm:top-5 sm:right-5"
    role="group"
    aria-label="Select identity"
  >
    {#each identities as identity (identity.id)}
      <button
        type="button"
        class={`rounded-full px-3 py-1.5 transition motion-reduce:transition-none ${identity.id === activeIdentityId ? 'bg-white text-black' : 'opacity-60 hover:opacity-100'}`}
        aria-pressed={identity.id === activeIdentityId}
        onclick={() => selectIdentity(identity.id)}
      >
        {identity.label}
      </button>
    {/each}
  </div>

  <section class="mx-auto max-w-3xl px-5 pt-28 pb-20 sm:px-8 sm:pt-24">
    <Identities {activeIdentityId} onselectidentity={selectIdentity} />
    <VaultIdentities {activeIdentityId} onselectidentity={selectIdentity} />
  </section>
</main>
