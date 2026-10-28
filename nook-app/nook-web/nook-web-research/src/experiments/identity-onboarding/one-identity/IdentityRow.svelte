<!-- One identity on a sync provider, with the one action that fits how it
stands with you: unlock it with your passkey, then use or merge it if it is
yours, or ask to join it if it is not. Its sigil is grey until it is yours. -->
<script lang="ts">
  import { Check, KeyRound, LoaderCircle, Play, Send } from '@lucide/svelte'
  import Sigil from './Sigil.svelte'
  import type { IdentityFlow } from './flow.svelte'
  import { Standing, Step, type Identity } from './model'
  import { ui } from './ui'

  let {
    flow,
    identity,
    importing,
  }: {
    flow: IdentityFlow
    identity: Identity
    /** Onboarding: a yours identity is used, not merged. */
    importing: boolean
  } = $props()

  let tapping = $state(false)
  const standing = $derived(flow.standing(identity))

  async function unlock(): Promise<void> {
    tapping = true
    await new Promise((resolve) => setTimeout(resolve, 700))
    tapping = false
    flow.unlock(identity)
  }

  function take(): void {
    if (!importing) {
      flow.merge(identity)
      return
    }
    flow.adopt(identity)
    flow.go(Step.Home)
  }

  function ask(): void {
    flow.askToJoin(identity)
    if (importing) flow.go(Step.Waiting)
  }
</script>

<li class={ui.row}>
  <Sigil words={identity.words} size={44} locked={standing !== Standing.Yours} />
  <div class="min-w-0 flex-1">
    {#if standing === Standing.Yours}
      <p class="truncate text-[15px] font-semibold">{identity.name}</p>
    {/if}
    <p class="truncate {ui.words}">{identity.words}</p>
    <p class="mt-0.5 font-mono text-[11px] text-[#5d6268]">
      {identity.keys.length} {identity.keys.length === 1 ? 'device' : 'devices'}
    </p>
  </div>
  {#if tapping}
    <LoaderCircle class="mx-3 size-4 animate-spin text-[#8fa3c0]" aria-label="Waiting for your passkey" />
  {:else if standing === Standing.Unknown}
    <button type="button" class={ui.action} onclick={unlock}>
      <KeyRound class="size-3.5" aria-hidden="true" /> Unlock
    </button>
  {:else if standing === Standing.Yours}
    <button type="button" class={ui.actionOk} onclick={take}>
      <Check class="size-3.5" aria-hidden="true" /> {importing ? 'Use' : 'Merge'}
    </button>
  {:else if standing === Standing.Locked}
    <button type="button" class={ui.action} onclick={ask}>
      <Send class="size-3.5" aria-hidden="true" /> Ask to join
    </button>
  {:else}
    <button type="button" class={ui.sim} onclick={() => flow.approved(identity)}>
      <Play class="size-3" aria-hidden="true" /> simulate: approved
    </button>
  {/if}
</li>
