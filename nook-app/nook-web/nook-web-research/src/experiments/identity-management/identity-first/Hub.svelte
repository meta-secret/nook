<!-- The Identities hub: the identities on this browser. Using another one
brings it here with its passkey; merging moves an identity's vaults into the
one in use, and leaves that identity as it is for its other devices. -->
<script lang="ts">
  import { ArrowLeft, Combine, KeyRound, Plus } from '@lucide/svelte'
  import BringIdentity from './BringIdentity.svelte'
  import IdentityCard from './IdentityCard.svelte'
  import { BringContext, HubStep, PasskeyOutcome, personal, type IdentityFixture } from './flow'
  import { ui } from './ui'

  let { outcome }: { outcome: PasskeyOutcome } = $props()

  let step = $state<HubStep>(HubStep.List)
  let here = $state<IdentityFixture[]>([])
  let merging = $state<IdentityFixture>(personal)
  let mergedVaults = $state(0)
  let tapping = $state(false)

  async function merge(): Promise<void> {
    tapping = true
    await new Promise((resolve) => setTimeout(resolve, 900))
    tapping = false
    mergedVaults += merging.vaults
    here = here.filter((identity) => identity.id !== merging.id)
    step = HubStep.List
  }
</script>

{#if step === HubStep.List}
  <div class="space-y-6">
    <header class="space-y-2">
      <p class={ui.label}>Identities</p>
      <h1 class={ui.title}>On this browser</h1>
    </header>
    <div class="space-y-px">
      <IdentityCard identity={{ ...personal, vaults: personal.vaults + mergedVaults }} tag="In use" />
      {#each here as identity (identity.id)}
        <IdentityCard {identity} tag="This browser">
          <div class="flex flex-wrap gap-x-5 gap-y-2 pl-14">
            <button type="button" class={ui.link}>Switch to {identity.name}</button>
            <button
              type="button"
              class="{ui.link} inline-flex items-center gap-1.5"
              onclick={() => { merging = identity; step = HubStep.ConfirmMerge }}
            >
              <Combine class="size-3.5" aria-hidden="true" /> Merge into {personal.name}
            </button>
          </div>
        </IdentityCard>
      {/each}
    </div>
    <button type="button" class={ui.secondary} onclick={() => (step = HubStep.Bring)}>
      <Plus class="size-4" aria-hidden="true" /> Use another identity
    </button>
  </div>
{:else if step === HubStep.Bring}
  <BringIdentity
    context={BringContext.Hub}
    {outcome}
    onBack={() => (step = HubStep.List)}
    onDone={(identity) => {
      here = [...here.filter((entry) => entry.id !== identity.id), identity]
      step = HubStep.List
    }}
  />
{:else}
  <div class="space-y-6">
    <button type="button" class="{ui.link} inline-flex items-center gap-1.5" onclick={() => (step = HubStep.List)}>
      <ArrowLeft class="size-3.5" aria-hidden="true" /> Back
    </button>
    <header class="space-y-2">
      <p class={ui.label}>Merge</p>
      <h1 class={ui.title}>Merge {merging.name} into {personal.name}?</h1>
      <p class={ui.body}>
        {merging.name}'s {merging.vaults} vaults become vaults of
        {personal.name} and sync with it. {merging.name} itself stays as it is
        for its other devices; this browser stops listing it.
      </p>
    </header>
    <button type="button" class={ui.primary} disabled={tapping} onclick={merge}>
      <KeyRound class="size-4" aria-hidden="true" />
      {tapping ? 'Waiting for your passkey…' : `Merge with ${merging.name}'s passkey`}
    </button>
  </div>
{/if}
