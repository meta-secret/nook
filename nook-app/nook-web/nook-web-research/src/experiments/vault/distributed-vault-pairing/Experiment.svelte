<script lang="ts">
  import {
    Check,
    Cpu,
    ExternalLink,
    HardDrive,
    Laptop,
    Link2,
    Plus,
    Smartphone,
  } from '@lucide/svelte'
  import type { ExperimentProps } from '../../index'

  interface PeerNode {
    id: number
    name: string
    paired: boolean
  }

  let { navigate: _navigate }: ExperimentProps = $props()
  let vaultName = $state('Alpha Vault Safe')
  let total = $state(3)
  let threshold = $state(2)
  let rootGenerated = $state(false)
  let peers = $state<PeerNode[]>(buildPeers(3))

  const pairedCount = $derived(
    (rootGenerated ? 1 : 0) + peers.filter(({ paired }) => paired).length,
  )
  // Genesis needs all N public keys; the K threshold applies when unlocking.
  const meshReady = $derived(pairedCount === total)

  function buildPeers(count: number): PeerNode[] {
    return Array.from({ length: count - 1 }, (_, index) => ({
      id: index + 2,
      name:
        index === 0
          ? 'Mobile Safe Token'
          : index === 1
            ? 'Laptop Guardian'
            : `Guardian Device ${String.fromCharCode(66 + index)}`,
      paired: false,
    }))
  }

  function changeTotal(event: Event) {
    total = Number((event.currentTarget as HTMLSelectElement).value)
    threshold = Math.min(threshold, total)
    rootGenerated = false
    peers = buildPeers(total)
  }

  function changeThreshold(event: Event) {
    threshold = Number((event.currentTarget as HTMLSelectElement).value)
  }

  function pairPeer(id: number) {
    peers = peers.map((peer) =>
      peer.id === id ? { ...peer, paired: true } : peer,
    )
  }
</script>

<svelte:head>
  <title>Distributed vault pairing · Nook research</title>
</svelte:head>

<main class="reference-canvas min-h-screen bg-[#050505] text-[#e2e2e2]">
  <div
    class="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 pt-8 pb-12 sm:pt-9"
  >
    <section
      class="reference-panel flex w-full flex-col gap-5 rounded-2xl border p-6 shadow-lg"
    >
      <header
        class="reference-divider flex flex-col items-start justify-between gap-2 border-b pb-4 sm:flex-row sm:items-center"
      >
        <div>
          <h1
            class="text-sm font-semibold tracking-[0.05em] text-slate-200 uppercase"
          >
            Vault Safe Setup
          </h1>
          <p class="mt-0.5 text-xs text-white/40">
            Configure your vault identifier and signature threshold (n-of-k)
          </p>
        </div>
        <span
          class="reference-blue-pill rounded-full border px-4 py-1.5 font-mono text-[11px] font-semibold tracking-[0.04em] text-blue-400"
        >
          {threshold}-of-{total} Threshold Active
        </span>
      </header>

      <div class="grid grid-cols-1 gap-5 md:grid-cols-3">
        <label class="space-y-2">
          <span
            class="block text-[11px] font-bold tracking-[0.1em] text-white/40 uppercase"
            >Vault Name / Safe Label</span
          >
          <input
            class="reference-field w-full rounded-xl border bg-[#050505] px-4 py-3 text-sm font-medium text-slate-200 outline-none transition-all"
            aria-label="Vault Name / Safe Label"
            bind:value={vaultName}
            placeholder="E.g. Alpha Vault Safe"
          />
        </label>

        <label class="space-y-2">
          <span
            class="block text-[11px] font-bold tracking-[0.1em] text-white/40 uppercase"
            >Total Node Count (n)</span
          >
          <select
            class="reference-field w-full rounded-xl border bg-[#050505] px-4 py-3 text-sm font-medium text-slate-200 outline-none transition-all"
            value={total}
            onchange={changeTotal}
          >
            {#each [2, 3, 4, 5] as count (count)}
              <option value={count}
                >{count} Devices ({count - 1}
                {count === 2 ? 'peer' : 'peers'})</option
              >
            {/each}
          </select>
        </label>

        <label class="space-y-2">
          <span
            class="block text-[11px] font-bold tracking-[0.1em] text-white/40 uppercase"
            >Required Signatures (k)</span
          >
          <select
            class="reference-field w-full rounded-xl border bg-[#050505] px-4 py-3 text-sm font-medium text-slate-200 outline-none transition-all"
            value={threshold}
            onchange={changeThreshold}
          >
            {#each Array.from({ length: total }, (_, index) => index + 1) as count (count)}
              <option value={count}
                >{count}
                {count === 1 ? 'Signature' : 'Signatures'} Required</option
              >
            {/each}
          </select>
        </label>
      </div>
    </section>

    <section
      class="reference-panel reference-panel-dots relative w-full overflow-hidden rounded-2xl border p-6 shadow-lg"
    >
      <header
        class="reference-divider relative z-10 mb-5 flex flex-col items-start justify-between gap-2 border-b pb-4 sm:flex-row sm:items-center"
      >
        <div>
          <h2 class="text-sm font-semibold text-slate-100">
            Cryptographic Device Onboarding
          </h2>
          <p class="mt-0.5 text-xs text-white/40">
            Pair nodes to establish your multi-signature threshold configuration
          </p>
        </div>
        <span
          class="reference-blue-pill rounded-full border px-3 py-1 font-mono text-[10px] tracking-[0.1em] text-blue-400 uppercase"
        >
          Node Mesh Network
        </span>
      </header>

      <div
        class="relative z-10 flex flex-col items-stretch justify-between gap-6 md:flex-row"
      >
        <article
          class:node-ready={rootGenerated}
          class="node-card flex w-full flex-col items-center justify-center rounded-xl border p-5 text-center transition-all duration-300 md:w-1/3"
        >
          <div class="node-icon relative grid size-[66px] place-items-center">
            <span
              class="absolute inset-0 rounded-full border border-white/10 bg-[#050505]"
            ></span>
            {#if rootGenerated}
              <Cpu
                class="relative z-10 size-7 text-blue-400"
                strokeWidth={1.7}
                aria-hidden="true"
              />
            {:else}
              <HardDrive
                class="relative z-10 size-7 text-white/30"
                strokeWidth={1.7}
                aria-hidden="true"
              />
            {/if}
          </div>
          <h3 class="mt-3 text-sm font-medium text-slate-200">
            Quantum Station (Node A)
          </h3>
          <p class="mt-0.5 text-[11px] text-white/40">
            Initiator / Vault Creator
          </p>
          <button
            class="root-button mt-3.5 flex items-center justify-center gap-1.5 rounded px-4 py-2 text-xs font-semibold text-white shadow-lg transition-all"
            onclick={() => (rootGenerated = true)}
          >
            {#if rootGenerated}
              <Check class="size-3.5" aria-hidden="true" /> Root Identity Generated
            {:else}
              <Cpu class="size-3.5" aria-hidden="true" /> Generate Root Identity
            {/if}
          </button>
        </article>

        <div
          class="relative flex w-full flex-col items-center justify-center py-4 md:w-1/4"
        >
          <div
            class="pointer-events-none absolute top-1/2 hidden w-full -translate-y-8 items-center justify-between px-6 md:flex"
          >
            <span class="h-px flex-1 bg-white/10"></span>
            <span class="h-px flex-1 bg-white/10"></span>
          </div>
          <div
            class:mesh-ready={meshReady}
            class="mesh-node relative z-10 flex size-24 items-center justify-center rounded-full border bg-[#0a0a0a] p-4 shadow-lg"
          >
            <span
              class="mesh-node-core grid size-16 place-items-center rounded-full border bg-blue-500/10 text-blue-400"
            >
              <Link2 class="size-9" strokeWidth={1.8} aria-hidden="true" />
            </span>
          </div>
          <div class="mt-3 text-center">
            <span
              class:mesh-status-ready={meshReady}
              class="mesh-status inline-flex rounded-full border px-3 py-1 font-mono text-[10px] font-bold tracking-[0.08em] text-white/40 uppercase"
            >
              {meshReady ? 'Secure Mesh Established' : 'Waiting for Peer Keys'}
            </span>
          </div>
        </div>

        <div
          class="flex w-full flex-col flex-wrap justify-center gap-4 sm:flex-row md:w-5/12"
        >
          {#each peers as peer, index (peer.id)}
            {@const PeerIcon = index % 2 === 0 ? Smartphone : Laptop}
            <article
              class:node-ready={peer.paired}
              class="node-card flex min-h-[190px] min-w-[140px] flex-1 flex-col items-center justify-center rounded-xl border p-4 text-center"
            >
              <div class="relative grid size-12 place-items-center">
                <span
                  class="absolute inset-0 rounded-full border border-white/10 bg-[#050505]"
                ></span>
                <PeerIcon
                  class={`relative z-10 size-5 ${peer.paired ? 'text-blue-400' : 'text-white/25'}`}
                  strokeWidth={1.7}
                  aria-hidden="true"
                />
              </div>
              <h3 class="mt-2 text-xs leading-4 font-semibold text-slate-200">
                {peer.name} (Node {String.fromCharCode(64 + peer.id)})
              </h3>
              <button
                class="peer-button mt-3 flex min-h-11 items-center gap-1 rounded border px-3 py-1.5 text-[10px] font-bold tracking-[0.1em] text-white uppercase transition-all"
                onclick={() => pairPeer(peer.id)}
              >
                {#if peer.paired}
                  <Check class="size-3.5" aria-hidden="true" /> Token Onboarded
                {:else}
                  <Plus class="size-3.5" aria-hidden="true" /> Onboard Token
                {/if}
              </button>
            </article>
          {/each}
        </div>
      </div>
    </section>

    <footer class="flex justify-center px-4 text-center">
      <a
        class="reference-link inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.08em] text-white/35 uppercase transition-colors hover:text-blue-400"
        href="https://distributed-vault-pairing-562478245230.us-west1.run.app/"
        target="_blank"
        rel="noreferrer"
      >
        Original visual reference
        <ExternalLink class="size-3" aria-hidden="true" />
      </a>
    </footer>
  </div>
</main>

<style>
  .reference-canvas {
    background-image: radial-gradient(
      circle at 2px 2px,
      rgb(255 255 255 / 0.04) 1px,
      transparent 0
    );
    background-size: 40px 40px;
    font-family: ui-sans-serif, system-ui, sans-serif;
  }

  .reference-panel {
    border-color: rgb(255 255 255 / 0.1);
    background-color: #0f0f0f;
    box-shadow:
      0 10px 15px -3px rgb(0 0 0 / 0.1),
      0 4px 6px -4px rgb(0 0 0 / 0.1);
  }

  .reference-panel-dots::before {
    position: absolute;
    inset: 0;
    content: '';
    pointer-events: none;
    opacity: 0.4;
    background-image: radial-gradient(
      circle at 2px 2px,
      rgb(255 255 255 / 0.04) 1px,
      transparent 0
    );
    background-size: 40px 40px;
  }

  .reference-divider {
    border-color: rgb(255 255 255 / 0.05);
  }

  .reference-blue-pill {
    border-color: rgb(59 130 246 / 0.3);
    background-color: rgb(59 130 246 / 0.1);
  }

  .reference-field {
    border-color: rgb(255 255 255 / 0.1);
  }

  .reference-field:focus {
    border-color: rgb(59 130 246 / 0.5);
  }

  .node-card {
    border-color: rgb(255 255 255 / 0.05);
    background-color: rgb(10 10 10 / 0.6);
  }

  .node-ready {
    border-color: rgb(59 130 246 / 0.25);
    background-color: rgb(30 58 138 / 0.08);
  }

  .root-button {
    background-color: #2563eb;
    box-shadow:
      0 10px 15px -3px rgb(37 99 235 / 0.15),
      0 4px 6px -4px rgb(37 99 235 / 0.15);
  }

  .root-button:hover {
    background-color: #3b82f6;
  }

  .mesh-node {
    border-color: rgb(255 255 255 / 0.1);
  }

  .mesh-node.mesh-ready {
    border-color: rgb(59 130 246 / 0.35);
    box-shadow: 0 0 28px rgb(37 99 235 / 0.12);
  }

  .mesh-node-core {
    border-color: rgb(59 130 246 / 0.3);
  }

  .mesh-status {
    border-color: rgb(255 255 255 / 0.15);
    background-color: rgb(255 255 255 / 0.05);
  }

  .mesh-status-ready {
    border-color: rgb(59 130 246 / 0.3);
    background-color: rgb(59 130 246 / 0.1);
    color: #60a5fa;
  }

  .peer-button {
    border-color: rgb(255 255 255 / 0.1);
    background-color: rgb(255 255 255 / 0.05);
  }

  .peer-button:hover {
    background-color: rgb(255 255 255 / 0.1);
  }

  .reference-link {
    text-decoration: none;
  }
</style>
