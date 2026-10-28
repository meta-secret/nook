<!-- First run decides who you are before anything else: a new identity, an
identity you already have, or this device joining from another one. A new
identity gets its passkey, then (optionally) the sync provider that keeps
it, and only then its first vault. -->
<script lang="ts">
  import {
    ArrowLeft,
    Check,
    KeyRound,
    MonitorSmartphone,
    Plus,
    UserRound,
  } from '@lucide/svelte'
  import BringIdentity from './BringIdentity.svelte'
  import IdentityCard from './IdentityCard.svelte'
  import {
    BringContext,
    FirstRunStep,
    PasskeyOutcome,
    Provider,
    personal,
    providerLabel,
    providers,
    type IdentityFixture,
  } from './flow'
  import { ui } from './ui'

  let { outcome }: { outcome: PasskeyOutcome } = $props()

  let step = $state<FirstRunStep>(FirstRunStep.Start)
  let identityName = $state('Personal')
  let vaultName = $state('Vault')
  let sync = $state<Provider | 'none'>('none')
  let opened = $state<IdentityFixture>(personal)
  let creatingPasskey = $state(false)

  const newSteps = [
    FirstRunStep.NameIdentity,
    FirstRunStep.Passkey,
    FirstRunStep.Sync,
    FirstRunStep.FirstVault,
  ]
  const stepTitles = ['Identity', 'Passkey', 'Sync', 'Vault']
  const newIndex = $derived(newSteps.indexOf(step))

  const created = $derived<IdentityFixture>({
    id: 'idn_new',
    name: identityName || 'Personal',
    words: 'spoon-river-calm',
    devices: 1,
    vaults: 1,
  })

  async function createPasskey(): Promise<void> {
    creatingPasskey = true
    await new Promise((resolve) => setTimeout(resolve, 900))
    creatingPasskey = false
    step = FirstRunStep.Sync
  }
</script>

{#if newIndex >= 0}
  <ol class="mb-10 grid grid-cols-4 gap-2" aria-label="New identity">
    {#each stepTitles as title, index (title)}
      <li class="space-y-2">
        <span class="block h-px {index <= newIndex ? 'bg-[#c9ccd0]' : 'bg-[#2c3035]'}"></span>
        <span class="{ui.label} {index <= newIndex ? 'text-[#c9ccd0]' : ''}">
          {#if index < newIndex}<Check class="mr-1 inline size-3" aria-hidden="true" />{/if}{title}
        </span>
      </li>
    {/each}
  </ol>
{/if}

{#if step === FirstRunStep.Start}
  <div class="space-y-8">
    <header class="space-y-2">
      <p class={ui.label}>Nook</p>
      <h1 class={ui.title}>Who are you on Nook?</h1>
      <p class={ui.body}>
        Everything in Nook belongs to an identity: its devices, its passkeys,
        and its vaults. Start with yours.
      </p>
    </header>
    <div class="space-y-px">
      <button type="button" class={ui.choice} onclick={() => (step = FirstRunStep.NameIdentity)}>
        <span class={ui.choiceIcon}><Plus class="size-4" aria-hidden="true" /></span>
        <span>
          <span class="block text-[15px] font-medium">Create a new identity</span>
          <span class="{ui.quiet} block">First time on Nook.</span>
        </span>
      </button>
      <button type="button" class={ui.choice} onclick={() => (step = FirstRunStep.Bring)}>
        <span class={ui.choiceIcon}><UserRound class="size-4" aria-hidden="true" /></span>
        <span>
          <span class="block text-[15px] font-medium">I already have an identity</span>
          <span class="{ui.quiet} block">Bring it here with your passkey.</span>
        </span>
      </button>
      <button type="button" class={ui.choice} onclick={() => (step = FirstRunStep.JoinCode)}>
        <span class={ui.choiceIcon}><MonitorSmartphone class="size-4" aria-hidden="true" /></span>
        <span>
          <span class="block text-[15px] font-medium">Add this device from another one</span>
          <span class="{ui.quiet} block">Use the code your other device shows.</span>
        </span>
      </button>
    </div>
  </div>
{:else if step === FirstRunStep.NameIdentity}
  <div class="space-y-6">
    <header class="space-y-2">
      <h1 class={ui.title}>Name your identity</h1>
      <p class={ui.body}>
        It's how your devices recognise you. You can rename it later.
      </p>
    </header>
    <input class={ui.input} bind:value={identityName} aria-label="Identity name" />
    <div class="flex gap-3">
      <button type="button" class={ui.primary} onclick={() => (step = FirstRunStep.Passkey)}>Continue</button>
      <button type="button" class={ui.secondary} onclick={() => (step = FirstRunStep.Start)}>Back</button>
    </div>
  </div>
{:else if step === FirstRunStep.Passkey}
  <div class="space-y-6">
    <header class="space-y-2">
      <h1 class={ui.title}>Protect {created.name} with a passkey</h1>
      <p class={ui.body}>
        The passkey is how you prove it's you — here, and on any browser you
        bring this identity to later.
      </p>
    </header>
    <IdentityCard identity={created} tag="New" />
    <button type="button" class={ui.primary} disabled={creatingPasskey} onclick={createPasskey}>
      <KeyRound class="size-4" aria-hidden="true" />
      {creatingPasskey ? 'Waiting for your passkey…' : 'Create passkey'}
    </button>
  </div>
{:else if step === FirstRunStep.Sync}
  <div class="space-y-6">
    <header class="space-y-2">
      <h1 class={ui.title}>Where should {created.name} be kept?</h1>
      <p class={ui.body}>
        A sync provider keeps an encrypted copy of your identity and its
        vaults, so your other devices — and this one, if its data is cleared —
        can bring it back.
      </p>
    </header>
    <div class="space-y-px" role="radiogroup" aria-label="Sync provider">
      {#each providers as entry (entry.id)}
        <label class="{ui.choice} cursor-pointer items-center">
          <input type="radio" name="sync" class="size-4 accent-[#8fa3c0]" checked={sync === entry.id} onchange={() => (sync = entry.id)} />
          <span class="text-[15px] font-medium">{entry.label}</span>
        </label>
      {/each}
      <label class="{ui.choice} cursor-pointer items-center">
        <input type="radio" name="sync" class="size-4 accent-[#8fa3c0]" checked={sync === 'none'} onchange={() => (sync = 'none')} />
        <span class="text-[15px] font-medium">Only this browser for now</span>
      </label>
    </div>
    <button type="button" class={ui.primary} onclick={() => (step = FirstRunStep.FirstVault)}>
      {sync === 'none' ? 'Continue' : `Connect ${providerLabel(sync)}`}
    </button>
  </div>
{:else if step === FirstRunStep.FirstVault}
  <div class="space-y-6">
    <header class="space-y-2">
      <h1 class={ui.title}>Name {created.name}'s first vault</h1>
      <p class={ui.body}>Vaults hold your logins and notes. You can add more later.</p>
    </header>
    <input class={ui.input} bind:value={vaultName} aria-label="Vault name" />
    <button type="button" class={ui.primary} onclick={() => (step = FirstRunStep.Ready)}>Create vault</button>
  </div>
{:else if step === FirstRunStep.Ready}
  <div class="space-y-6">
    <header class="space-y-2">
      <p class={ui.label}>Ready</p>
      <h1 class={ui.title}>{created.name} is ready</h1>
      <p class={ui.body}>
        {vaultName || 'Vault'} is open.
        {sync === 'none'
          ? 'It lives only in this browser until you add a sync provider under Identity.'
          : `${providerLabel(sync)} keeps an encrypted copy.`}
      </p>
    </header>
    <IdentityCard identity={created} tag="This browser" />
    <button type="button" class={ui.secondary} onclick={() => (step = FirstRunStep.Start)}>Start over</button>
  </div>
{:else if step === FirstRunStep.Bring}
  <BringIdentity
    context={BringContext.FirstRun}
    {outcome}
    onBack={() => (step = FirstRunStep.Start)}
    onDone={(identity) => {
      opened = identity
      step = FirstRunStep.Opened
    }}
  />
{:else if step === FirstRunStep.Opened}
  <div class="space-y-6">
    <header class="space-y-2">
      <p class={ui.label}>Signed in</p>
      <h1 class={ui.title}>{opened.name} is on this browser</h1>
      <p class={ui.body}>Its {opened.vaults} vaults are syncing. Open one from Identity.</p>
    </header>
    <IdentityCard identity={opened} tag="This browser" />
    <button type="button" class={ui.secondary} onclick={() => (step = FirstRunStep.Start)}>Start over</button>
  </div>
{:else}
  <div class="space-y-6">
    <button type="button" class="{ui.link} inline-flex items-center gap-1.5" onclick={() => (step = FirstRunStep.Start)}>
      <ArrowLeft class="size-3.5" aria-hidden="true" /> Back
    </button>
    <header class="space-y-2">
      <h1 class={ui.title}>Add this device</h1>
      <p class={ui.body}>
        On your other device, open Identity → Devices → Add device. Enter the
        link and passphrase it shows.
      </p>
    </header>
    <input class={ui.input} placeholder="nook://join/…" aria-label="Invite link" />
    <input class={ui.input} placeholder="Passphrase" aria-label="Passphrase" />
    <button type="button" class={ui.primary}>Join</button>
  </div>
{/if}
