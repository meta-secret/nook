<!-- Step two: the passkey this browser uses, a new one or one made before.
Picking one waits on the simulated passkey prompt, shows it done, and moves
on. -->
<script lang="ts">
  import { Fingerprint, KeyRound } from '@lucide/svelte'
  import Heading from './Heading.svelte'
  import Option from './Option.svelte'
  import type { SetupFlow } from './flow.svelte'
  import { PasskeyChoice, Step } from './model'
  import {
    type OptionProgress,
    type OptionState,
    optionState,
  } from './option-state'

  let { flow }: { flow: SetupFlow } = $props()

  let working = $state(false)
  /** The option being worked on while the passkey prompt is open. */
  let picked = $state<PasskeyChoice>(PasskeyChoice.New)

  const tile =
    'grid size-11 shrink-0 place-items-center bg-[#23272b] text-[#c9ccd0]'
  const options = [
    {
      choice: PasskeyChoice.New,
      icon: KeyRound,
      title: 'Create a new passkey',
      hint: 'Saved to your password manager',
    },
    {
      choice: PasskeyChoice.Existing,
      icon: Fingerprint,
      title: 'Use an existing passkey',
      hint: 'One you made for Nook before',
    },
  ]

  function stateOf(choice: PasskeyChoice): OptionState {
    const progress: OptionProgress = {
      working: working && picked === choice,
      done: !working && flow.passkey && flow.choice === choice,
    }
    return optionState(progress)
  }

  async function pick(choice: PasskeyChoice): Promise<void> {
    picked = choice
    working = true
    await new Promise((resolve) => setTimeout(resolve, 900))
    working = false
    flow.usePasskey(choice)
    await new Promise((resolve) => setTimeout(resolve, 450))
    flow.go(Step.Provider)
  }
</script>

<Heading
  eyebrow="Step 1 of 3 · Passkey"
  title="Your passkey"
  sub="It opens your identity on this browser."
/>
<div class="flex flex-col gap-px">
  {#each options as option (option.choice)}
    <Option
      title={option.title}
      hint={option.hint}
      state={stateOf(option.choice)}
      disabled={working && picked !== option.choice}
      onPick={() => pick(option.choice)}
    >
      {#snippet lead()}
        <span class={tile}
          ><option.icon class="size-5" aria-hidden="true" /></span
        >
      {/snippet}
    </Option>
  {/each}
</div>
{#if working}
  <p class="mt-5 font-mono text-[12px] text-[#8fa3c0]">
    Waiting for your passkey…
  </p>
{/if}
