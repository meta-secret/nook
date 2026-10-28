<!-- Bring an identity you already have to this browser: say where it is
kept, sign in, tap your passkey once. The passkey itself says which identity
is yours; nobody picks from a list. If it opens none of them, the user can
try another passkey or ask their other device to let this browser in. -->
<script lang="ts">
  import {
    ArrowLeft,
    Cloud,
    FolderClosed,
    GitBranch,
    HardDrive,
    KeyRound,
    Send,
  } from '@lucide/svelte'
  import IdentityCard from './IdentityCard.svelte'
  import {
    BringContext,
    BringStep,
    PasskeyOutcome,
    Provider,
    folderIdentities,
    personal,
    providerLabel,
    providers,
    work,
    type IdentityFixture,
  } from './flow'
  import { ui } from './ui'

  let {
    context,
    outcome,
    onDone,
    onBack,
  }: {
    context: BringContext
    outcome: PasskeyOutcome
    onDone: (identity: IdentityFixture) => void
    onBack: () => void
  } = $props()

  let step = $state<BringStep>(BringStep.Provider)
  let provider = $state<Provider>(Provider.GoogleDrive)
  let tapping = $state(false)
  let asked = $state<IdentityFixture>(personal)

  /** In the hub, the identity in use is already here; the passkey finds the
   * other one. */
  const found = $derived(context === BringContext.Hub ? work : personal)
  const account = $derived(
    providers.find((entry) => entry.id === provider)?.account ?? '',
  )

  function icon(id: Provider) {
    switch (id) {
      case Provider.GoogleDrive:
        return Cloud
      case Provider.ICloud:
        return HardDrive
      case Provider.GitHub:
        return GitBranch
      case Provider.Folder:
        return FolderClosed
    }
  }

  async function tapPasskey(): Promise<void> {
    tapping = true
    await new Promise((resolve) => setTimeout(resolve, 900))
    tapping = false
    step =
      outcome === PasskeyOutcome.Matches ? BringStep.Matched : BringStep.NoMatch
  }
</script>

<div class="space-y-6">
  <button type="button" class="{ui.link} inline-flex items-center gap-1.5" onclick={onBack}>
    <ArrowLeft class="size-3.5" aria-hidden="true" /> Back
  </button>

  {#if step === BringStep.Provider}
    <header class="space-y-2">
      <p class={ui.label}>Your identity</p>
      <h1 class={ui.title}>Where is it kept?</h1>
      <p class={ui.body}>
        Pick the sync provider your other devices use. Nothing is changed
        there.
      </p>
    </header>
    <div class="space-y-px">
      {#each providers as entry (entry.id)}
        {@const Icon = icon(entry.id)}
        <button
          type="button"
          class={ui.choice}
          onclick={() => {
            provider = entry.id
            step = BringStep.SignedIn
          }}
        >
          <span class={ui.choiceIcon}><Icon class="size-4" aria-hidden="true" /></span>
          <span class="self-center text-[15px] font-medium">{entry.label}</span>
        </button>
      {/each}
    </div>
  {:else if step === BringStep.SignedIn}
    <header class="space-y-2">
      <p class={ui.label}>{providerLabel(provider)} · {account}</p>
      <h1 class={ui.title}>Use your passkey</h1>
      <p class={ui.body}>
        This folder keeps {folderIdentities.length} identities. Your passkey
        tells which one is yours; it is checked here and nothing is sent.
      </p>
    </header>
    <button type="button" class={ui.primary} disabled={tapping} onclick={tapPasskey}>
      <KeyRound class="size-4" aria-hidden="true" />
      {tapping ? 'Waiting for your passkey…' : 'Use my passkey'}
    </button>
  {:else if step === BringStep.Matched}
    <header class="space-y-2">
      <p class={ui.label}>Found it</p>
      <h1 class={ui.title}>
        {context === BringContext.Hub ? `Add ${found.name}?` : `Welcome back`}
      </h1>
      <p class={ui.body}>
        Your passkey belongs to this identity. Its vaults sync to this browser
        from {providerLabel(provider)}.
      </p>
    </header>
    <IdentityCard identity={found} tag="Your passkey" />
    <button type="button" class={ui.primary} onclick={() => onDone(found)}>
      {context === BringContext.Hub ? `Add ${found.name} to this browser` : `Open ${found.name}`}
    </button>
  {:else if step === BringStep.NoMatch}
    <header class="space-y-2">
      <p class={ui.label}>Not here</p>
      <h1 class={ui.title}>This passkey isn't one of them</h1>
      <p class={ui.body}>
        None of the {folderIdentities.length} identities in this folder belong
        to the passkey you used. Another passkey may, or your other device can
        let this browser in.
      </p>
    </header>
    <div class="flex flex-wrap gap-3">
      <button type="button" class={ui.primary} onclick={() => (step = BringStep.SignedIn)}>
        Try another passkey
      </button>
      <button type="button" class={ui.secondary} onclick={() => (step = BringStep.AskDevice)}>
        Ask my other device
      </button>
    </div>
  {:else if step === BringStep.AskDevice}
    <header class="space-y-2">
      <p class={ui.label}>Ask your other device</p>
      <h1 class={ui.title}>Which one is yours?</h1>
      <p class={ui.body}>
        Your other device shows its identity's three words under Identities.
        Pick the same words here.
      </p>
    </header>
    <div class="space-y-px" role="radiogroup" aria-label="Your identity">
      {#each folderIdentities as identity (identity.id)}
        <label class="{ui.choice} cursor-pointer items-center">
          <input
            type="radio"
            name="asked-identity"
            class="size-4 accent-[#8fa3c0]"
            checked={asked.id === identity.id}
            onchange={() => (asked = identity)}
          />
          <span class="font-mono text-[15px]">{identity.words}</span>
          <span class="ml-auto font-mono text-[12px] text-[#80858c]">
            {identity.devices} {identity.devices === 1 ? 'device' : 'devices'}
          </span>
        </label>
      {/each}
    </div>
    <button type="button" class={ui.primary} onclick={() => (step = BringStep.Asked)}>
      <Send class="size-4" aria-hidden="true" /> Ask to join {asked.words}
    </button>
  {:else}
    <header class="space-y-2">
      <p class={ui.label}>Request sent</p>
      <h1 class={ui.title}>Approve it on your other device</h1>
      <p class={ui.body}>
        Open Nook there and go to Devices; the request from this browser waits
        at the top. Once you approve it, {asked.words} opens here.
      </p>
    </header>
    <p class={ui.quiet}>You can close this page; Nook finishes joining the next time you open it.</p>
  {/if}
</div>
