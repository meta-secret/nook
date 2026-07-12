<script lang="ts">
  import { Fingerprint, Terminal } from '@lucide/svelte'
  import ExperimentBack from '$lib/components/ExperimentBack.svelte'
  import type { ExperimentProps } from '../../index'
  import ScenarioBar, {
    type Presence,
  } from '../_shared/ScenarioBar.svelte'

  let { navigate }: ExperimentProps = $props()
  let presence = $state<Presence>('empty')
  let boot = $state<'menu' | 'sentinel' | 'passkey'>('menu')
  let lines = $state<string[]>([
    'nook auth console · presence scan',
    'passkey deferred until device init',
  ])

  function setPresence(next: Presence) {
    presence = next
    boot = 'menu'
    lines = [
      'nook auth console · presence scan',
      presence === 'existing'
        ? 'result: vault://local/personal sealed'
        : 'result: empty — no local vault',
    ]
  }

  function push(line: string) {
    lines = [...lines, line]
  }
</script>

<main class="min-h-screen bg-[#070807] text-[#c6f7b0]">
  <ExperimentBack {navigate} />
  <ScenarioBar {presence} onPresence={setPresence} />

  <section class="mx-auto flex min-h-screen max-w-4xl flex-col justify-center px-6 py-24">
    <div class="mb-6 flex items-center gap-2 font-mono text-xs tracking-[0.18em] text-[#6f9a68] uppercase">
      <Terminal class="size-3.5" /> Auth 07 · Sentinel console entry
    </div>

    <div class="overflow-hidden rounded-2xl border border-[#1f3a22] bg-[#0b100c] shadow-[0_0_80px_rgb(40_120_60/0.15)]">
      <div class="border-b border-[#1f3a22] px-4 py-3 font-mono text-xs text-[#6f9a68]">
        vault-terminal handoff · sentinel mode
      </div>
      <div class="min-h-[22rem] space-y-2 p-5 font-mono text-sm leading-7">
        {#each lines as line, index (index)}
          <p>> {line}</p>
        {/each}
        {#if boot === 'menu'}
          <div class="mt-6 space-y-2 text-[#9dffb0]">
            {#if presence === 'existing'}
              <button
                class="block hover:underline"
                onclick={() => {
                  push('selected: unlock existing vault')
                  push('passkey required · reason: open sealed vault')
                  boot = 'passkey'
                }}
              >
                [1] unlock existing vault
              </button>
            {:else}
              <button
                class="block hover:underline"
                onclick={() => {
                  push('selected: create simple vault')
                  push('no passkey required yet')
                }}
              >
                [1] create simple vault
              </button>
              <button
                class="block hover:underline"
                onclick={() => {
                  push('selected: build sentinel vault')
                  push('enter policy shell — passkey still deferred')
                  boot = 'sentinel'
                }}
              >
                [2] build sentinel vault → terminal UI
              </button>
            {/if}
          </div>
        {:else if boot === 'sentinel'}
          <p class="text-[#6f9a68]">sentinel policy draft</p>
          <p>N=3 T=2 · initiator = this device (unbound)</p>
          <button
            class="mt-4 inline-flex items-center gap-2 rounded border border-[#3d7a45] px-3 py-2 text-[#9dffb0]"
            onclick={() => {
              push('action: initialize this device')
              push('passkey prompt armed')
              boot = 'passkey'
            }}
          >
            initialize device
          </button>
        {:else}
          <p class="text-[#9dffb0]">passkey ceremony ready</p>
          <button class="mt-3 inline-flex items-center gap-2 text-[#c6f7b0]">
            <Fingerprint class="size-4" /> continue with passkey
          </button>
        {/if}
      </div>
    </div>
    <p class="mt-4 max-w-2xl text-sm leading-6 text-[#6f9a68]">
      Bridges Open Nook into the existing <code class="text-[#9dffb0]">vault-terminal</code> Sentinel
      research direction without leading with authentication.
    </p>
  </section>
</main>
