<script lang="ts">
  import { Check, Fingerprint, Timer } from '@lucide/svelte'
  import ScenarioBar from '../../nook-auth/_shared/ScenarioBar.svelte'
  import {
    VaultAuthWorkflowState,
    type Presence,
  } from './vault-auth-workflow-state.svelte'

  export type SentinelUi = 'card-stack' | 'terminal'

  interface Props {
    onSentinel: (ui: SentinelUi, vaultName: string) => void
  }

  let { onSentinel }: Props = $props()
  const workflow = new VaultAuthWorkflowState()
  let vaultName = $state('')
  const presence = $derived(workflow.presence)
  const step = $derived(workflow.step)
  const path = $derived(workflow.path)
  const steps = $derived(workflow.steps)
  const setPresence = (next: Presence) => {
    workflow.setPresence(next)
    vaultName = ''
  }
  const continueAfterName = () => workflow.continueAfterName(vaultName)
  const chooseSimple = () => workflow.choose('simple')
  const chooseSentinel = () => workflow.choose('sentinel')
  const goBack = () => workflow.goBack()
</script>

<div class="min-h-screen bg-[#f8f8f6] text-[#111]">
  <ScenarioBar {presence} onPresence={setPresence} light />

  <section
    class="mx-auto grid min-h-screen max-w-5xl gap-12 px-6 py-24 lg:grid-cols-[1fr_1.1fr] lg:items-center"
  >
    <div>
      <p
        class="inline-flex items-center gap-2 font-mono text-xs tracking-[0.18em] text-[#777] uppercase"
      >
        <Timer class="size-3.5" /> Vault Auth Workflow · Key later
      </p>
      <h1 class="mt-4 text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">
        Passkey is a tool,<br />not the lobby.
      </h1>
      <p class="mt-5 max-w-md leading-7 text-[#555]">
        Name the vault first. Then choose Simple or Sentinel — Simple creates
        locally; Sentinel picks an interface before any passkey.
      </p>
    </div>

    <div class="rounded-3xl border border-black/10 bg-white p-8 shadow-sm">
      <ol class="space-y-4">
        {#each steps as label, index (`${path}-${label}`)}
          <li class="flex items-start gap-4">
            <span
              class={`mt-0.5 grid size-7 place-items-center rounded-full text-xs font-bold ${index < step ? 'bg-[#12805a] text-white' : index === step ? 'bg-black text-white' : 'bg-[#eee] text-[#888]'}`}
            >
              {#if index < step}<Check class="size-3.5" />{:else}{index +
                  1}{/if}
            </span>
            <div class="flex-1">
              <p
                class={`text-lg ${index === step ? 'font-semibold' : 'text-[#666]'}`}
              >
                {label}
              </p>

              {#if presence === 'empty' && index === step && step === 0}
                <input
                  class="mt-3 w-full border-b border-black/20 bg-transparent py-2 text-base outline-none"
                  placeholder="Vault name"
                  bind:value={vaultName}
                />
                <button
                  class="mt-3 rounded-full bg-black px-4 py-2 text-sm text-white disabled:opacity-40"
                  disabled={!vaultName.trim()}
                  onclick={continueAfterName}
                >
                  Continue
                </button>
              {:else if presence === 'empty' && index === step && step === 1}
                <div class="mt-3 flex flex-wrap gap-2">
                  <button
                    class="rounded-full border border-black/15 px-4 py-2 text-sm"
                    onclick={chooseSimple}
                  >
                    Simple vault
                  </button>
                  <button
                    class="rounded-full bg-black px-4 py-2 text-sm text-white"
                    onclick={chooseSentinel}
                  >
                    Build Sentinel vault
                  </button>
                </div>
              {:else if presence === 'empty' && path === 'simple' && index === step && step === 2}
                <p class="mt-2 text-sm text-[#666]">
                  Create “{vaultName.trim()}” locally — no passkey prologue.
                </p>
                <button
                  class="mt-3 rounded-full bg-black px-4 py-2 text-sm text-white"
                >
                  Create simple vault
                </button>
              {:else if presence === 'empty' && path === 'sentinel' && index === step && step === 2}
                <div class="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  <button
                    class="rounded-full bg-black px-4 py-2 text-sm text-white"
                    onclick={() => onSentinel('card-stack', vaultName.trim())}
                  >
                    Sentinel card stack · default
                  </button>
                  <button
                    class="rounded-full border border-black/15 px-4 py-2 text-sm"
                    onclick={() => onSentinel('terminal', vaultName.trim())}
                  >
                    Vault terminal
                  </button>
                </div>
                <p class="mt-3 text-sm text-[#777]">
                  Opens the full setup UI for “{vaultName.trim()}”. Passkey
                  comes later at device init.
                </p>
              {:else if presence === 'existing' && index === step && step === 0}
                <button
                  class="mt-3 rounded-full bg-black px-4 py-2 text-sm text-white"
                  onclick={() => (workflow.step = 1)}
                >
                  Continue to unlock
                </button>
              {:else if index === step && index === steps.length - 1 && !(presence === 'empty' && path === 'simple' && step === 2)}
                <button
                  class="mt-3 inline-flex items-center gap-2 rounded-full bg-black px-4 py-2 text-sm text-white"
                >
                  <Fingerprint class="size-4" /> Now use passkey
                </button>
              {/if}
            </div>
          </li>
        {/each}
      </ol>

      <div class="mt-8 flex gap-3">
        <button
          class="rounded-full border border-black/15 px-4 py-2 text-sm disabled:opacity-40"
          disabled={step === 0}
          onclick={goBack}
        >
          Back
        </button>
      </div>
    </div>
  </section>
</div>
