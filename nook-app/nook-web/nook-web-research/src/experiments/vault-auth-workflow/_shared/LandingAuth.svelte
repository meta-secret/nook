<script lang="ts">
  import { Check, Fingerprint, Shield } from '@lucide/svelte'
  import ScenarioBar, {
    type Presence,
  } from '../../nook-auth/_shared/ScenarioBar.svelte'
  import type { SentinelUi } from './KeyLaterAuth.svelte'

  interface Props {
    onSentinel: (ui: SentinelUi, vaultName: string) => void
  }

  let { onSentinel }: Props = $props()
  let presence = $state<Presence>('empty')
  let step = $state(0)
  let path = $state<'undecided' | 'simple' | 'sentinel'>('undecided')
  let vaultName = $state('')

  const emptySteps = $derived(
    path === 'simple'
      ? ['Name vault', 'Choose Simple or Sentinel', 'Create locally']
      : path === 'sentinel'
        ? [
            'Name vault',
            'Choose Simple or Sentinel',
            'Choose Sentinel interface',
            'Initialize this device (passkey)',
          ]
        : ['Name vault', 'Choose Simple or Sentinel', 'Create or configure'],
  )
  const existingSteps = [
    'Unlock existing vault',
    'Confirm vault identity',
    'Unlock with passkey',
  ]
  const steps = $derived(presence === 'empty' ? emptySteps : existingSteps)

  function setPresence(next: Presence) {
    presence = next
    step = 0
    path = 'undecided'
    vaultName = ''
  }

  function continueAfterName() {
    if (!vaultName.trim()) return
    step = 1
  }

  function chooseSimple() {
    path = 'simple'
    step = 2
  }

  function chooseSentinel() {
    path = 'sentinel'
    step = 2
  }

  function goBack() {
    if (presence === 'empty' && step === 1) {
      path = 'undecided'
      step = 0
      return
    }
    if (presence === 'empty' && step === 2) {
      path = 'undecided'
      step = 1
      return
    }
    if (step > 0) step -= 1
  }
</script>

<div class="min-h-screen bg-white text-black">
  <ScenarioBar {presence} onPresence={setPresence} light />

  <section
    class="mx-auto grid min-h-screen max-w-6xl items-center gap-12 px-6 py-24 lg:grid-cols-[1.05fr_0.95fr]"
  >
    <div>
      <p class="font-mono text-[11px] tracking-[0.2em] text-[#7a7a7a] uppercase">
        Vault Auth Workflow · Landing handoff
      </p>
      <h1
        class="mt-5 text-5xl leading-[0.95] font-semibold tracking-[-0.05em] sm:text-6xl"
      >
        {presence === 'existing'
          ? 'Keys you already keep.'
          : 'Keys, not accounts.'}
      </h1>
      <p class="mt-6 max-w-md text-base leading-7 text-[#555]">
        {presence === 'existing'
          ? 'Open Nook found a sealed vault on this device. Unlock continues the landing promise.'
          : 'Name the vault first. Then choose Simple or Sentinel — same workflow as Key later, in the landing voice.'}
      </p>

      <div class="relative mt-12 grid min-h-[16rem] place-items-center lg:hidden">
        <div
          class="relative grid size-32 place-items-center rounded-full bg-[radial-gradient(circle_at_30%_25%,#fff,#c9ced4_60%,#8b929a)] shadow-[0_20px_50px_rgb(0_0_0/0.14)]"
        >
          <div
            class="grid size-14 place-items-center rounded-full bg-black text-[#8dffcf]"
          >
            <Shield class="size-6" />
          </div>
        </div>
      </div>
    </div>

    <div>
      <div class="hidden lg:relative lg:mb-8 lg:grid lg:min-h-[12rem] lg:place-items-center">
        <div class="absolute size-56 rounded-full border border-black/8"></div>
        <div class="absolute size-40 rounded-full border border-black/12"></div>
        <div
          class="relative grid size-28 place-items-center rounded-full bg-[radial-gradient(circle_at_30%_25%,#fff,#c9ced4_60%,#8b929a)] shadow-[0_24px_60px_rgb(0_0_0/0.16)]"
        >
          <div
            class="grid size-12 place-items-center rounded-full bg-black text-[#8dffcf]"
          >
            <Shield class="size-5" />
          </div>
        </div>
      </div>

      <div class="rounded-xl border border-black/10 bg-[#f7f7f5] p-6 sm:p-8">
        <ol class="space-y-4">
          {#each steps as label, index (`${path}-${label}`)}
            <li class="flex items-start gap-4">
              <span
                class={`mt-0.5 grid size-7 place-items-center rounded-full text-xs font-bold ${index < step ? 'bg-[#12805a] text-white' : index === step ? 'bg-black text-white' : 'bg-black/10 text-[#888]'}`}
              >
                {#if index < step}<Check class="size-3.5" />{:else}{index + 1}{/if}
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
                    class="mt-3 rounded-md bg-black px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40"
                    disabled={!vaultName.trim()}
                    onclick={continueAfterName}
                  >
                    Continue
                  </button>
                {:else if presence === 'empty' && index === step && step === 1}
                  <div class="mt-3 flex flex-wrap gap-2">
                    <button
                      class="rounded-md border border-black/15 bg-white px-4 py-2.5 text-sm font-medium"
                      onclick={chooseSimple}
                    >
                      Simple vault
                    </button>
                    <button
                      class="rounded-md bg-black px-4 py-2.5 text-sm font-medium text-white"
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
                    class="mt-3 rounded-md bg-black px-4 py-2.5 text-sm font-medium text-white"
                  >
                    Create simple vault
                  </button>
                {:else if presence === 'empty' && path === 'sentinel' && index === step && step === 2}
                  <div class="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                    <button
                      class="rounded-md bg-black px-4 py-2.5 text-sm font-medium text-white"
                      onclick={() => onSentinel('card-stack', vaultName.trim())}
                    >
                      Sentinel card stack · default
                    </button>
                    <button
                      class="rounded-md border border-black/15 bg-white px-4 py-2.5 text-sm font-medium"
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
                    class="mt-3 rounded-md bg-black px-4 py-2.5 text-sm font-medium text-white"
                    onclick={() => (step = 1)}
                  >
                    Continue to unlock
                  </button>
                {:else if index === step && index === steps.length - 1 && !(presence === 'empty' && path === 'simple' && step === 2)}
                  <button
                    class="mt-3 inline-flex items-center gap-2 rounded-md bg-black px-4 py-2.5 text-sm font-medium text-white"
                  >
                    <Fingerprint class="size-4" /> Now use passkey
                  </button>
                {/if}
              </div>
            </li>
          {/each}
        </ol>

        <div class="mt-8">
          <button
            class="rounded-md border border-black/15 bg-white px-4 py-2 text-sm disabled:opacity-40"
            disabled={step === 0}
            onclick={goBack}
          >
            Back
          </button>
        </div>
      </div>
    </div>
  </section>
</div>
