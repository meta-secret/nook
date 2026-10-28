<!-- Connecting a sync provider while an identity is in use mounts that
identity there, nothing else. Other identities in the same folder are not
this step's business: one quiet line says they exist and where they are
managed. -->
<script lang="ts">
  import { ArrowLeft, Check, FolderClosed } from '@lucide/svelte'
  import IdentityCard from './IdentityCard.svelte'
  import { ConnectStep, Provider, folderIdentities, personal, providerLabel, providers } from './flow'
  import { ui } from './ui'

  let step = $state<ConnectStep>(ConnectStep.Provider)
  let provider = $state<Provider>(Provider.GoogleDrive)
  let connecting = $state(false)

  const others = folderIdentities.length - 1
  const account = $derived(providers.find((entry) => entry.id === provider)?.account ?? '')

  async function connect(): Promise<void> {
    connecting = true
    await new Promise((resolve) => setTimeout(resolve, 900))
    connecting = false
    step = ConnectStep.Connected
  }
</script>

{#if step === ConnectStep.Provider}
  <div class="space-y-6">
    <header class="space-y-2">
      <p class={ui.label}>{personal.name} · Sync</p>
      <h1 class={ui.title}>Keep {personal.name} in a sync provider</h1>
      <p class={ui.body}>
        The provider keeps an encrypted copy of {personal.name} and its
        vaults. Your other devices sync through it.
      </p>
    </header>
    <div class="space-y-px">
      {#each providers as entry (entry.id)}
        <button type="button" class={ui.choice} onclick={() => { provider = entry.id; step = ConnectStep.Review }}>
          <span class="self-center text-[15px] font-medium">{entry.label}</span>
        </button>
      {/each}
    </div>
  </div>
{:else if step === ConnectStep.Review}
  <div class="space-y-6">
    <button type="button" class="{ui.link} inline-flex items-center gap-1.5" onclick={() => (step = ConnectStep.Provider)}>
      <ArrowLeft class="size-3.5" aria-hidden="true" /> Back
    </button>
    <header class="space-y-2">
      <p class={ui.label}>{providerLabel(provider)} · {account}</p>
      <h1 class={ui.title}>{personal.name} will sync here</h1>
    </header>
    <IdentityCard identity={personal} tag="In use" />
    <div class="{ui.plate} flex items-center gap-3 font-mono text-[13px] text-[#a4a8ae]">
      <FolderClosed class="size-4 shrink-0" aria-hidden="true" />
      meta-secret-nook / {personal.words}
    </div>
    {#if others > 0}
      <p class={ui.quiet}>
        This folder also keeps {others} other identities. They stay as they
        are; to use one on this browser, go to Identities.
      </p>
    {/if}
    <button type="button" class={ui.primary} disabled={connecting} onclick={connect}>
      {connecting ? 'Connecting…' : 'Connect and sync'}
    </button>
  </div>
{:else}
  <div class="space-y-6">
    <header class="space-y-2">
      <p class={ui.label}>Connected</p>
      <h1 class={ui.title}>{personal.name} syncs to {providerLabel(provider)}</h1>
      <p class={ui.body}>All {personal.vaults} vaults are kept there, encrypted.</p>
    </header>
    <p class="{ui.tagOk} inline-flex items-center gap-1.5"><Check class="size-3.5" aria-hidden="true" /> Up to date</p>
    <button type="button" class={ui.secondary} onclick={() => (step = ConnectStep.Provider)}>Start over</button>
  </div>
{/if}
