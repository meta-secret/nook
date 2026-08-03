<!--
DIRECTION: Internet Identity's architecture in Handoff story's clothes. The
architecture: the first question is never which key wraps which key, it is who
you are signing in as — so an identity (here, a passkey) comes first, access
methods second, and the vaults they open third. The clothes: near-black, one
warm accent, no cards at all. A slim rail on the left holds the three acts and
marks the one you are in; each act opens with a statement in editorial type and
resolves into hairline-ruled rows where the identifiers sit in mono.
-->
<script lang="ts">
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
  import {
    ACCENT,
    CAPS,
    INSET,
    Pane,
    PANES,
    paneCaption,
    paneNumeral,
  } from './console-ui'
  import IdentityHome from './IdentityHome.svelte'
  import VaultLinks from './VaultLinks.svelte'

  let { navigate }: ExperimentProps = $props()
  let graphId = $state(GraphId.Tangle)
  let selected = $state<NodeRef>(defaultNode(graphById(GraphId.Tangle)))
  let pane = $state(Pane.Home)
  let adding = $state(false)

  const graph = $derived(graphById(graphId))
  const highlight = $derived(highlightFor(graph, selected))
</script>

<main class="min-h-[100svh] bg-[#08090a] text-[#f4f3f0]">
  <ExperimentBack {navigate} />
  <GraphSwitch
    {graph}
    onGraph={(next) => {
      graphId = next
      selected = defaultNode(graphById(next))
      pane = Pane.Home
    }}
  />

  <nav
    class="fixed top-1/2 left-3 z-40 -translate-y-1/2 sm:left-6"
    aria-label="Console"
  >
    <ol class="space-y-5">
      {#each PANES as option (option)}
        {@const active = pane === option}
        <li>
          <button
            type="button"
            class="group flex items-center gap-3 py-2 pr-2 text-left"
            aria-current={active ? 'page' : 'false'}
            onclick={() => (pane = option)}
          >
            <span
              class={`block w-px transition-all duration-300 motion-reduce:transition-none ${active ? 'h-10' : 'h-5'}`}
              style={`background:${active ? ACCENT : '#4a4a48'}`}
              aria-hidden="true"
            ></span>
            <span
              class={`hidden ${CAPS} transition sm:block motion-reduce:transition-none ${active ? 'text-[#f4f3f0]' : 'text-[#6d6d6a] group-hover:text-[#a5a5a1]'}`}
              aria-hidden="true"
            >
              {paneNumeral(option)} · {paneCaption(option)}
            </span>
            <span class="sr-only">{paneCaption(option)}</span>
          </button>
        </li>
      {/each}
    </ol>
  </nav>

  <section
    class="flex min-h-[100svh] flex-col justify-center pt-36 pb-24 {INSET} sm:py-28"
  >
    <p class={CAPS} style={`color:${ACCENT}`}>
      Act {paneNumeral(pane)} · {paneCaption(pane)}
    </p>

    <div class="mt-6">
      {#if pane === Pane.Home}
        <IdentityHome
          {graph}
          {selected}
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

  {#if adding}
    <AddIdentityDialog onClose={() => (adding = false)} />
  {/if}
</main>
