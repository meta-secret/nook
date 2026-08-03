<!--
DIRECTION: Internet Identity's architecture, borrowed whole. There, the first
question is never "which key wraps which key" — it is "who am I signing in as",
answered by a list of identities, with everything else behind Access. Here an
identity is a passkey, so the same three rooms fall out: Home picks the identity
this browser can continue with, Access shows every passkey as a card titled by
the manager that holds it, and Vaults hangs the vaults off those identities. The
device key is never a room of its own — it belongs to Access, as the thing this
browser holds, listed apart from devices you cannot touch from here.
-->
<script lang="ts">
  import { Fingerprint, House, KeyRound, Vault } from '@lucide/svelte'
  import ExperimentBack from '$lib/components/ExperimentBack.svelte'
  import GraphSwitch from '../_shared/GraphSwitch.svelte'
  import {
    defaultNode,
    GraphId,
    graphById,
    highlightFor,
    type NodeRef,
  } from '../_shared/key-graph'
  import type { ExperimentProps } from '../../index'
  import AccessMethods from './AccessMethods.svelte'
  import AddIdentityDialog from './AddIdentityDialog.svelte'
  import { Pane } from './console-ui'
  import IdentityHome from './IdentityHome.svelte'
  import VaultLinks from './VaultLinks.svelte'

  let { navigate }: ExperimentProps = $props()
  let graphId = $state(GraphId.Tangle)
  let selected = $state<NodeRef>(defaultNode(graphById(GraphId.Tangle)))
  let pane = $state(Pane.Home)
  let adding = $state(false)

  const graph = $derived(graphById(graphId))
  const highlight = $derived(highlightFor(graph, selected))

  function navClass(active: boolean): string {
    return `flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition motion-reduce:transition-none ${
      active ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white'
    }`
  }
</script>

<main class="min-h-[100svh] bg-[#0b0b0c] text-white">
  <ExperimentBack {navigate} />
  <GraphSwitch
    {graph}
    onGraph={(next) => {
      graphId = next
      selected = defaultNode(graphById(next))
      pane = Pane.Home
    }}
  />

  <div class="flex min-h-[100svh] flex-col md:flex-row">
    <nav
      class="shrink-0 border-b border-white/8 px-5 pt-32 pb-4 md:w-56 md:border-r md:border-b-0 md:px-4 md:pt-24 md:pb-8"
      aria-label="Identity console"
    >
      <p class="mb-6 flex items-center gap-2 px-1 text-[14px] md:mb-8">
        <Fingerprint class="size-5 shrink-0" aria-hidden="true" />
        Nook Identity
      </p>
      <ul class="flex gap-1 md:flex-col">
        <li>
          <button
            type="button"
            aria-current={pane === Pane.Home ? 'page' : undefined}
            class={navClass(pane === Pane.Home)}
            onclick={() => (pane = Pane.Home)}
          >
            <House class="size-4 shrink-0" aria-hidden="true" />
            Home
          </button>
        </li>
        <li>
          <button
            type="button"
            aria-current={pane === Pane.Access ? 'page' : undefined}
            class={navClass(pane === Pane.Access)}
            onclick={() => (pane = Pane.Access)}
          >
            <KeyRound class="size-4 shrink-0" aria-hidden="true" />
            Access
          </button>
        </li>
        <li>
          <button
            type="button"
            aria-current={pane === Pane.Vaults ? 'page' : undefined}
            class={navClass(pane === Pane.Vaults)}
            onclick={() => (pane = Pane.Vaults)}
          >
            <Vault class="size-4 shrink-0" aria-hidden="true" />
            Vaults
          </button>
        </li>
      </ul>
    </nav>

    <section class="min-w-0 flex-1 px-5 pt-8 pb-20 md:px-10 md:pt-24">
      <div class="mx-auto max-w-4xl">
        {#if pane === Pane.Home}
          <IdentityHome
            {graph}
            onPick={(node) => (selected = node)}
            onAdd={() => (adding = true)}
          />
        {:else if pane === Pane.Access}
          <AccessMethods
            {graph}
            {selected}
            {highlight}
            onPick={(node) => (selected = node)}
            onAdd={() => (adding = true)}
          />
        {:else}
          <VaultLinks
            {graph}
            {selected}
            {highlight}
            onPick={(node) => (selected = node)}
          />
        {/if}
      </div>
    </section>
  </div>

  {#if adding}
    <AddIdentityDialog onClose={() => (adding = false)} />
  {/if}
</main>
