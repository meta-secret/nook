<!-- Step four: Nook reads its folder in Google Drive and lists the
identities there. The passkey from step two decides each one: a member
continues and syncs, anyone else asks to join. A new identity can be created
in the same folder instead. -->
<script lang="ts">
  import { Folder, LoaderCircle, Plus } from '@lucide/svelte'
  import Avatar from './Avatar.svelte'
  import Heading from './Heading.svelte'
  import Option from './Option.svelte'
  import type { SetupFlow } from './flow.svelte'
  import { Step, folder, type Identity } from './model'

  let { flow }: { flow: SetupFlow } = $props()

  let scanning = $state(true)
  $effect(() => {
    const timer = setTimeout(() => {
      scanning = false
    }, 1300)
    return () => clearTimeout(timer)
  })

  const found = $derived(flow.found())
  const title = $derived(
    scanning
      ? 'Looking in Google Drive'
      : found.length > 0
        ? 'Choose an identity'
        : 'No identities yet',
  )

  function pick(identity: Identity): void {
    if (flow.isMember(identity)) {
      flow.finish(identity, false)
      return
    }
    flow.identity = identity
    flow.go(Step.Join)
  }
</script>

<Heading eyebrow="Step 3 of 3 · Identity" {title}>
  <p
    class="mt-3 inline-flex items-center gap-2 font-mono text-[12px] text-[#80858c]"
  >
    <Folder class="size-3.5" aria-hidden="true" />
    {folder.join(' › ')}
    {#if scanning}<LoaderCircle
        class="size-3.5 animate-spin text-[#8fa3c0]"
        aria-label="Reading"
      />{/if}
  </p>
</Heading>

{#if scanning}
  <div class="flex flex-col gap-px" aria-hidden="true">
    <div class="h-[78px] animate-pulse bg-[#16191c]"></div>
    <div
      class="h-[78px] animate-pulse bg-[#16191c] [animation-delay:150ms]"
    ></div>
  </div>
{:else}
  {#if found.length > 0}
    <div class="flex flex-col gap-px">
      {#each found as identity (identity.id)}
        {@const member = flow.isMember(identity)}
        <Option
          title={member ? identity.name : identity.words}
          hint="{identity.devices} devices"
          action={member ? 'Continue' : 'Request to join'}
          onPick={() => pick(identity)}
        >
          {#snippet lead()}
            <Avatar words={identity.words} name={member ? identity.name : ''} />
          {/snippet}
          {#snippet badge()}
            <span
              class="inline-flex shrink-0 items-center gap-1.5 font-mono text-[10px] tracking-[0.12em] uppercase {member
                ? 'text-[#9cc3a4]'
                : 'text-[#80858c]'}"
            >
              <span
                class="size-1.5 {member ? 'bg-[#9cc3a4]' : 'bg-[#4a5058]'}"
                aria-hidden="true"
              ></span>
              {member ? 'member' : 'not a member'}
            </span>
          {/snippet}
        </Option>
      {/each}
    </div>
    <p
      class="my-6 flex items-center gap-3 font-mono text-[11px] tracking-[0.18em] text-[#5d6268] uppercase"
    >
      <span class="h-px flex-1 bg-[#23272b]"></span>or<span
        class="h-px flex-1 bg-[#23272b]"
      ></span>
    </p>
  {/if}
  <Option
    title="Create a new identity"
    hint="In {folder.join(' › ')}"
    onPick={() => flow.go(Step.Name)}
  >
    {#snippet lead()}
      <span
        class="grid size-11 shrink-0 place-items-center bg-[#23272b] text-[#c9ccd0]"
        ><Plus class="size-5" aria-hidden="true" /></span
      >
    {/snippet}
  </Option>
{/if}
