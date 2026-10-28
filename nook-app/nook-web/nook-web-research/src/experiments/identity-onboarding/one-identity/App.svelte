<!-- The app as it would ship, in a popup-sized window. Onboarding asks one
thing per screen: create an identity with a passkey, or import one from a sync
provider by unlocking it or asking to join it. Then home. -->
<script lang="ts">
  import {
    ChevronLeft,
    Cloud,
    Folder,
    GitBranch,
    HardDrive,
    KeyRound,
    LoaderCircle,
    Monitor,
    Play,
  } from '@lucide/svelte'
  import Home from './Home.svelte'
  import IdentityRow from './IdentityRow.svelte'
  import Sigil from './Sigil.svelte'
  import type { IdentityFlow } from './flow.svelte'
  import { ProviderKind, Step, linkCode, providers, type Provider } from './model'
  import { ui } from './ui'

  let { flow }: { flow: IdentityFlow } = $props()

  let waiting = $state(false)

  const providerIcons: Record<ProviderKind, typeof Monitor> = {
    [ProviderKind.Drive]: HardDrive,
    [ProviderKind.ICloud]: Cloud,
    [ProviderKind.GitHub]: GitBranch,
    [ProviderKind.Folder]: Folder,
  }
  const homeSteps: readonly Step[] = [Step.Home, Step.Sync, Step.More, Step.AddDevice]
  const atHome = $derived(homeSteps.includes(flow.step))

  async function create(): Promise<void> {
    waiting = true
    await new Promise((resolve) => setTimeout(resolve, 900))
    waiting = false
    flow.create()
    flow.go(Step.Home)
  }

  function signIn(provider: Provider): void {
    flow.connect(provider)
    flow.go(Step.Found)
  }

  function joined(): void {
    flow.approved(flow.joining)
    flow.adopt(flow.joining)
    flow.go(Step.Home)
  }
</script>

<div class={ui.window}>
  <header class="relative flex h-14 shrink-0 items-center px-3">
    {#if !atHome && flow.step !== Step.Welcome}
      <button type="button" class="grid size-9 place-items-center text-[#a4a8ae] transition hover:text-[#e9e8e4]" aria-label="Back" onclick={() => flow.back()}>
        <ChevronLeft class="size-5" aria-hidden="true" />
      </button>
    {/if}
    <span class="pointer-events-none absolute inset-x-0 text-center font-mono text-[11px] tracking-[0.34em] text-[#5d6268]">NOOK</span>
  </header>

  {#if atHome}
    <Home {flow} />
  {:else if flow.step === Step.Welcome}
    <div class="flex flex-1 flex-col px-7 pb-8">
      <div class="flex flex-1 flex-col items-center justify-center gap-8 text-center">
        <Sigil size={120} />
        <h1 class={ui.title}>One identity.<br />Every device.</h1>
      </div>
      <button type="button" class={ui.primary} onclick={() => flow.go(Step.Create)}>
        <KeyRound class="size-4" aria-hidden="true" /> Create identity
      </button>
      <button type="button" class={ui.quiet} onclick={() => flow.go(Step.Import)}>Import from sync provider</button>
    </div>
  {:else if flow.step === Step.Create}
    <div class="flex flex-1 flex-col px-7 pb-8">
      <div class="flex flex-1 flex-col items-center justify-center gap-10">
        <Sigil size={120} breathing={waiting} />
        <input class={ui.field} bind:value={flow.name} aria-label="Name" placeholder="Name" />
      </div>
      <button type="button" class={ui.primary} disabled={waiting} onclick={create}>
        {#if waiting}
          <LoaderCircle class="size-4 animate-spin" aria-hidden="true" /> Waiting for passkey
        {:else}
          <KeyRound class="size-4" aria-hidden="true" /> Create with passkey
        {/if}
      </button>
    </div>
  {:else if flow.step === Step.Import}
    <div class="flex flex-1 flex-col px-5 pb-8">
      <h1 class="{ui.title} px-2 pt-6 pb-8">Import from</h1>
      <div class="grid grid-cols-2 gap-px">
        {#each providers as provider (provider.kind)}
          {@const Icon = providerIcons[provider.kind]}
          <button type="button" class={ui.tile} onclick={() => signIn(provider)}>
            <Icon class="size-5 text-[#a4a8ae]" aria-hidden="true" />
            {provider.name}
          </button>
        {/each}
      </div>
    </div>
  {:else if flow.step === Step.Found}
    {@const Icon = providerIcons[flow.providerKind]}
    <div class="flex flex-1 flex-col overflow-y-auto px-5 pb-8">
      <div class="px-2 pt-6 pb-6">
        <h1 class={ui.title}>{flow.onProvider.length > 0 ? 'Which is yours?' : 'Nothing here'}</h1>
        <p class="mt-2 inline-flex items-center gap-2 text-[13px] text-[#80858c]">
          <Icon class="size-3.5" aria-hidden="true" /> {flow.provider}
        </p>
      </div>
      {#if flow.onProvider.length > 0}
        <ul class="flex flex-col gap-px">
          {#each flow.onProvider as identity (identity.id)}
            <IdentityRow {flow} {identity} importing />
          {/each}
        </ul>
      {:else}
        <div class="flex-1"></div>
        <button type="button" class={ui.primary} onclick={() => flow.go(Step.Create)}>
          <KeyRound class="size-4" aria-hidden="true" /> Create identity
        </button>
      {/if}
    </div>
  {:else}
    <div class="flex flex-1 flex-col px-7 pb-8">
      <div class="flex flex-1 flex-col items-center justify-center gap-5 text-center">
        <Sigil words={flow.joining.words} size={120} locked />
        <p class={ui.words}>{flow.joining.words}</p>
        <h1 class={ui.title}>Approve on your other device</h1>
        <p class="font-mono text-[30px] tracking-[0.18em] text-[#e9e8e4]">{linkCode}</p>
      </div>
      <button type="button" class="{ui.sim} self-center" onclick={joined}>
        <Play class="size-3" aria-hidden="true" /> simulate: approved
      </button>
    </div>
  {/if}
</div>
