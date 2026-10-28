<!-- The screen for the machine's current state. Every button is one of the
state's transitions; nothing here is about vaults. -->
<script lang="ts">
  import { KeyRound, Send } from '@lucide/svelte'
  import KeyIdentity from './KeyIdentity.svelte'
  import type { KeyFlow } from './key-flow.svelte'
  import {
    KeyState,
    PasskeyFit,
    ProviderHolds,
    providerNames,
    remoteIdentities,
    thisBrowserPasskey,
    type IdentityFixture,
  } from './machine'
  import { ui } from '../identity-first/ui'

  let { flow }: { flow: KeyFlow } = $props()

  let waiting = $state(false)

  /** A simulated passkey tap or provider round trip. */
  async function pause(): Promise<void> {
    waiting = true
    await new Promise((resolve) => setTimeout(resolve, 800))
    waiting = false
  }

  async function createPasskey(): Promise<void> {
    await pause()
    flow.hasLocal = true
    flow.go(KeyState.LocalIdentity)
  }

  async function connect(provider: string): Promise<void> {
    flow.provider = provider
    await pause()
    flow.synced = true
    flow.go(
      flow.providerHolds === ProviderHolds.Nothing
        ? KeyState.Synced
        : KeyState.RemoteIdentities,
    )
  }

  async function findByPasskey(): Promise<void> {
    await pause()
    flow.go(
      flow.passkeyFit === PasskeyFit.Opens
        ? KeyState.UsingRemote
        : KeyState.ImportChoose,
    )
  }

  /** The local identity holds nothing but this browser's key, so using the
   * remote one instead removes it and loses nothing. */
  async function useInstead(): Promise<void> {
    await pause()
    flow.hasLocal = false
    flow.separate = []
    flow.go(KeyState.UsingRemote)
  }

  async function approve(): Promise<void> {
    await pause()
    flow.go(KeyState.Joined)
  }

  /** The remote identities still to decide about. */
  const undecided = $derived(
    remoteIdentities.filter(
      (identity) => !flow.separate.some((kept) => kept.id === identity.id),
    ),
  )

  function opensFor(identity: IdentityFixture): boolean {
    return flow.passkeyFit === PasskeyFit.Opens && identity.id === remoteIdentities[0]?.id
  }
</script>

{#if flow.current === KeyState.Empty}
  <header class="space-y-2">
    <p class={ui.label}>This browser</p>
    <h1 class={ui.title}>No identity here yet</h1>
    <p class={ui.body}>
      An identity is the set of keys that open it. Create one with a passkey
      on this browser, or bring the one you already have from your sync
      provider.
    </p>
  </header>
  <div class="mt-8 space-y-px">
    <button type="button" class={ui.choice} onclick={() => flow.go(KeyState.CreateIdentity)}>
      <span>
        <span class="block text-[15px] font-medium">Create an identity</span>
        <span class="{ui.quiet} block">A new passkey becomes its first key.</span>
      </span>
    </button>
    <button type="button" class={ui.choice} onclick={() => flow.go(KeyState.ImportProvider)}>
      <span>
        <span class="block text-[15px] font-medium">Import from a sync provider</span>
        <span class="{ui.quiet} block">Your passkey finds the identity you already have.</span>
      </span>
    </button>
  </div>
{:else if flow.current === KeyState.CreateIdentity}
  <header class="space-y-2">
    <h1 class={ui.title}>Create an identity</h1>
    <p class={ui.body}>Name it, then create the passkey that will be its first key.</p>
  </header>
  <div class="mt-6 space-y-4">
    <input class={ui.input} bind:value={flow.localName} aria-label="Identity name" />
    <button type="button" class={ui.primary} disabled={waiting} onclick={createPasskey}>
      <KeyRound class="size-4" aria-hidden="true" />
      {waiting ? 'Waiting for your passkey…' : 'Create passkey'}
    </button>
  </div>
{:else if flow.current === KeyState.LocalIdentity}
  <header class="space-y-2">
    <p class={ui.label}>Only on this browser</p>
    <h1 class={ui.title}>{flow.local().name} has one key</h1>
    <p class={ui.body}>
      Your passkey on this browser is its only key. Add a sync provider so
      your other devices, and other identities you already have, can meet it.
    </p>
  </header>
  <div class="mt-6 space-y-4">
    <KeyIdentity identity={flow.local()} tag="This browser" />
    <button type="button" class={ui.primary} onclick={() => flow.go(KeyState.ConnectProvider)}>Add sync provider</button>
  </div>
{:else if flow.current === KeyState.ConnectProvider}
  <header class="space-y-2">
    <h1 class={ui.title}>Where should {flow.local().name} be kept?</h1>
    <p class={ui.body}>The provider keeps an encrypted copy of the identity and its keys.</p>
  </header>
  <div class="mt-6 space-y-px">
    {#each providerNames as name (name)}
      <button type="button" class={ui.choice} disabled={waiting} onclick={() => connect(name)}>
        <span class="text-[15px] font-medium">{waiting && flow.provider === name ? 'Signing in…' : name}</span>
      </button>
    {/each}
  </div>
{:else if flow.current === KeyState.Synced}
  <header class="space-y-2">
    <p class={ui.label}>Synced · {flow.provider}</p>
    <h1 class={ui.title}>{flow.local().name} is kept in {flow.provider}</h1>
    <p class={ui.body}>Every key below opens it on any device.</p>
  </header>
  <div class="mt-6 space-y-px">
    <KeyIdentity identity={flow.local()} tag="In use" />
    {#each flow.separate as identity (identity.id)}
      <KeyIdentity identity={{ ...identity, keys: [...identity.keys, thisBrowserPasskey] }} tag="Also on this browser" />
    {/each}
  </div>
  {#if undecided.length > 0}
    <button type="button" class="{ui.link} mt-4" onclick={() => flow.go(KeyState.RemoteIdentities)}>
      {flow.provider} keeps {undecided.length} other {undecided.length === 1 ? 'identity' : 'identities'}
    </button>
  {/if}
{:else if flow.current === KeyState.RemoteIdentities}
  <header class="space-y-2">
    <p class={ui.label}>{flow.provider}</p>
    <h1 class={ui.title}>Other identities are kept here</h1>
    <p class={ui.body}>
      {flow.local().name} now syncs to {flow.provider}. The same folder keeps
      {undecided.length} other {undecided.length === 1 ? 'identity' : 'identities'}.
      Pick one to act on:
    </p>
    <ul class="{ui.quiet} list-disc space-y-1 pl-5">
      <li><span class="text-[#d6d5d1]">Use it instead</span> — if your passkey is one of its keys, it is already yours. {flow.local().name} holds nothing but this browser's key, so it is removed and nothing is lost.</li>
      <li><span class="text-[#d6d5d1]">Send join request</span> — if it's sealed to you. Once a device approves, use it instead of {flow.local().name} or keep both on this browser.</li>
      <li><span class="text-[#d6d5d1]">Skip for now</span> — nothing changes for them; only {flow.local().name} syncs. Come back from Identities anytime.</li>
    </ul>
  </header>
  <div class="mt-6 space-y-px" role="radiogroup" aria-label="Remote identity">
    {#each undecided as identity (identity.id)}
      <label class="{ui.choice} cursor-pointer">
        <input
          type="radio"
          name="remote"
          class="mt-1 size-4 accent-[#8fa3c0]"
          checked={flow.chosen.id === identity.id}
          onchange={() => (flow.chosen = identity)}
        />
        <span class="min-w-0 flex-1">
          <span class="flex flex-wrap items-baseline justify-between gap-x-3">
            <span class="text-[15px] font-medium">{identity.name || identity.words}</span>
            <span class={opensFor(identity) ? ui.tagOk : ui.tag}>
              {opensFor(identity) ? 'Your passkey opens it' : 'Sealed to you'}
            </span>
          </span>
          <span class="{ui.quiet} block">{identity.keys.length} {identity.keys.length === 1 ? 'key' : 'keys'}</span>
        </span>
      </label>
    {/each}
  </div>
  <div class="mt-6 flex flex-wrap items-center gap-3">
    {#if opensFor(flow.chosen)}
      <button type="button" class={ui.primary} onclick={() => flow.go(KeyState.UseInstead)}>
        Use {flow.chosen.name || flow.chosen.words} instead
      </button>
    {:else}
      <button type="button" class={ui.primary} onclick={() => flow.go(KeyState.JoinPending)}>
        <Send class="size-4" aria-hidden="true" /> Send join request
      </button>
    {/if}
    <button type="button" class={ui.link} onclick={() => flow.go(KeyState.Synced)}>Skip for now</button>
  </div>
{:else if flow.current === KeyState.UseInstead}
  <header class="space-y-2">
    <p class={ui.label}>Use it instead</p>
    <h1 class={ui.title}>Use {flow.chosen.name || flow.chosen.words} instead of {flow.local().name}?</h1>
    <p class={ui.body}>
      {flow.local().name} holds nothing but this browser's key, so it is
      removed and nothing is lost. This browser opens
      {flow.chosen.name || flow.chosen.words} with the same passkey.
    </p>
  </header>
  <div class="mt-6 grid gap-px sm:grid-cols-2">
    <KeyIdentity identity={flow.local()} tag="Removed" opens={false} />
    <KeyIdentity identity={flow.joined()} tag="Yours" />
  </div>
  <button type="button" class="{ui.primary} mt-6" disabled={waiting} onclick={useInstead}>
    <KeyRound class="size-4" aria-hidden="true" />
    {waiting ? 'Waiting for your passkey…' : `Use ${flow.chosen.name || flow.chosen.words}`}
  </button>
{:else if flow.current === KeyState.JoinPending}
  <header class="space-y-2">
    <p class={ui.label}>Join request</p>
    <h1 class={ui.title}>Waiting for {flow.chosen.name || flow.chosen.words}</h1>
    <p class={ui.body}>
      Its {flow.chosen.keys.length} {flow.chosen.keys.length === 1 ? 'device sees' : 'devices see'}
      the request from this browser. Approve it on one of them.
    </p>
  </header>
  <div class="mt-6 space-y-4">
    <KeyIdentity identity={flow.chosen} tag="Sealed to you" opens={false} />
    <button type="button" class={ui.secondary} disabled={waiting} onclick={approve}>
      {waiting ? 'Approving…' : 'Simulate: approve on the other device'}
    </button>
  </div>
{:else if flow.current === KeyState.Joined}
  <header class="space-y-2">
    <p class={ui.label}>Joined</p>
    <h1 class={ui.title}>This browser is a key of {flow.chosen.name || flow.chosen.words}</h1>
    {#if flow.hasLocal}
      <p class={ui.body}>
        It opens on this browser now. Use it instead of {flow.local().name},
        which holds only this browser's key, or keep both here.
      </p>
    {/if}
  </header>
  <div class="mt-6 space-y-4">
    <KeyIdentity identity={flow.joined()} tag="This browser" />
    {#if flow.hasLocal}
      <div class="flex flex-wrap items-center gap-3">
        <button type="button" class={ui.primary} onclick={() => flow.go(KeyState.UseInstead)}>
          Use {flow.chosen.name || flow.chosen.words} instead
        </button>
        <button
          type="button"
          class={ui.link}
          onclick={() => {
            flow.separate = [...flow.separate, flow.chosen]
            flow.go(KeyState.Synced)
          }}
        >
          Keep both on this browser
        </button>
      </div>
    {:else}
      <button type="button" class={ui.primary} onclick={() => flow.go(KeyState.UsingRemote)}>
        Use {flow.chosen.name || flow.chosen.words}
      </button>
    {/if}
  </div>
{:else if flow.current === KeyState.ImportProvider}
  <header class="space-y-2">
    <p class={ui.label}>Import</p>
    <h1 class={ui.title}>Where is your identity kept?</h1>
  </header>
  <div class="mt-6 space-y-px">
    {#each providerNames as name (name)}
      <button
        type="button"
        class={ui.choice}
        onclick={() => {
          flow.provider = name
          flow.go(KeyState.ImportPasskey)
        }}
      >
        <span class="text-[15px] font-medium">{name}</span>
      </button>
    {/each}
  </div>
{:else if flow.current === KeyState.ImportPasskey}
  <header class="space-y-2">
    <p class={ui.label}>{flow.provider}</p>
    <h1 class={ui.title}>Find yours with your passkey</h1>
    <p class={ui.body}>
      {flow.provider} keeps {remoteIdentities.length} identities. Your passkey
      is one of the keys of yours; it is checked here and nothing is sent.
    </p>
  </header>
  <button type="button" class="{ui.primary} mt-6" disabled={waiting} onclick={findByPasskey}>
    <KeyRound class="size-4" aria-hidden="true" />
    {waiting ? 'Waiting for your passkey…' : 'Use my passkey'}
  </button>
{:else if flow.current === KeyState.ImportChoose}
  <header class="space-y-2">
    <p class={ui.label}>Not one of its keys</p>
    <h1 class={ui.title}>Which one is yours?</h1>
    <p class={ui.body}>
      Your passkey isn't a key of any identity here. Pick yours by the three
      words your other device shows; it can let this browser in.
    </p>
  </header>
  <div class="mt-6 space-y-px" role="radiogroup" aria-label="Your identity">
    {#each remoteIdentities as identity (identity.id)}
      <label class="{ui.choice} cursor-pointer items-center">
        <input
          type="radio"
          name="mine"
          class="size-4 accent-[#8fa3c0]"
          checked={flow.chosen.id === identity.id}
          onchange={() => (flow.chosen = identity)}
        />
        <span class="font-mono text-[15px]">{identity.words}</span>
      </label>
    {/each}
  </div>
  <button type="button" class="{ui.primary} mt-6" onclick={() => flow.go(KeyState.JoinPending)}>
    <Send class="size-4" aria-hidden="true" /> Send join request
  </button>
{:else}
  <header class="space-y-2">
    <p class={ui.label}>Using · {flow.provider}</p>
    <h1 class={ui.title}>{flow.chosen.name || flow.chosen.words} is on this browser</h1>
    <p class={ui.body}>This browser's passkey is now one of its keys.</p>
  </header>
  <div class="mt-6">
    <KeyIdentity identity={flow.joined()} tag="In use" />
  </div>
{/if}
