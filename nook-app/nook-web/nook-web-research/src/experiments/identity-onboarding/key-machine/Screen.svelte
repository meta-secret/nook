<!-- The screen for the machine's current state. Every choice is a card the
user clicks; a card is exactly one transition of the state. Nothing here is
about vaults: an identity is the keys that open it. Identities found on a
sync provider show by their three words until a passkey or a join opens
them; only then does their name appear. -->
<script lang="ts">
  import ActionCard from './ActionCard.svelte'
  import KeyIdentity from './KeyIdentity.svelte'
  import KeyList from './KeyList.svelte'
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

  const grid = 'mt-6 grid gap-3 sm:grid-cols-2'
  const list = 'mt-6 grid gap-3'

  /** In the prototype the first remote identity is the one your passkey
   * opens, when the simulator says so. */
  function opensFor(identity: IdentityFixture): boolean {
    const [first] = remoteIdentities
    return flow.passkeyFit === PasskeyFit.Opens && identity.id === first?.id
  }

  /** A remote identity's name is sealed until a key opens it. */
  function revealed(identity: IdentityFixture): boolean {
    return flow.remoteChecked && opensFor(identity)
  }

  function nameOf(identity: IdentityFixture): string {
    return revealed(identity) && identity.name ? identity.name : identity.words
  }

  function keyCount(identity: IdentityFixture): string {
    const count = identity.keys.length
    return `${count} ${count === 1 ? 'key' : 'keys'}`
  }

  /** The remote identities still to decide about. */
  const undecided = $derived(
    remoteIdentities.filter(
      (identity) => !flow.separate.some((kept) => kept.id === identity.id),
    ),
  )
  const opened = $derived(undecided.filter((identity) => revealed(identity)))

  function connect(provider: string): void {
    flow.provider = provider
    flow.synced = true
    flow.remoteChecked = false
    flow.go(
      flow.providerHolds === ProviderHolds.Nothing
        ? KeyState.Synced
        : KeyState.RemoteIdentities,
    )
  }

  /** The local identity holds nothing but this browser's key, so using the
   * remote one instead removes it and loses nothing. */
  function useInstead(): void {
    flow.hasLocal = false
    flow.separate = []
    flow.go(KeyState.UsingRemote)
  }

  function keepBoth(): void {
    flow.separate = [...flow.separate, flow.chosen]
    flow.go(KeyState.Synced)
  }

  /** Once joined, this browser holds a key of the identity and can read
   * its sealed name. */
  function joinedName(): string {
    return flow.chosen.name || flow.chosen.words
  }
</script>

{#if flow.current === KeyState.Empty}
  <header class="space-y-2">
    <p class={ui.label}>This browser</p>
    <h1 class={ui.title}>No identity here yet</h1>
    <p class={ui.body}>An identity is the set of keys that open it.</p>
  </header>
  <div class={grid}>
    <ActionCard
      title="Create an identity"
      body="First time on Nook. A new passkey on this browser becomes its first key."
      onPick={() => flow.go(KeyState.CreateIdentity)}
    />
    <ActionCard
      title="Import from a sync provider"
      body="You used Nook before. Your passkey finds your identity where your other devices keep it."
      onPick={() => flow.go(KeyState.ImportProvider)}
    />
  </div>
{:else if flow.current === KeyState.CreateIdentity}
  <header class="space-y-2">
    <h1 class={ui.title}>Create an identity</h1>
    <p class={ui.body}>Name it; a new passkey becomes its first key.</p>
  </header>
  <div class="mt-6 space-y-3">
    <input class={ui.input} bind:value={flow.localName} aria-label="Identity name" />
    <ActionCard
      title="Create passkey for {flow.localName || 'Personal'}"
      body="Your browser or password manager asks where to save it."
      passkey
      onPick={() => {
        flow.hasLocal = true
        flow.go(KeyState.LocalIdentity)
      }}
    />
  </div>
{:else if flow.current === KeyState.LocalIdentity}
  <header class="space-y-2">
    <p class={ui.label}>Only on this browser</p>
    <h1 class={ui.title}>{flow.local().name} has one key</h1>
    <p class={ui.body}>
      Your new passkey on this browser is its only key. A sync provider keeps
      it for your other devices.
    </p>
  </header>
  <div class={list}>
    <KeyIdentity identity={flow.local()} tag="This browser" />
    <ActionCard
      title="Add a sync provider"
      body="Google Drive, iCloud, GitHub, or a folder."
      onPick={() => flow.go(KeyState.ConnectProvider)}
    />
  </div>
{:else if flow.current === KeyState.ConnectProvider}
  <header class="space-y-2">
    <h1 class={ui.title}>Where should {flow.local().name} be kept?</h1>
    <p class={ui.body}>The provider keeps an encrypted copy of the identity and its keys.</p>
  </header>
  <div class={grid}>
    {#each providerNames as name (name)}
      <ActionCard title={name} onPick={() => connect(name)} />
    {/each}
  </div>
{:else if flow.current === KeyState.Synced}
  <header class="space-y-2">
    <p class={ui.label}>Synced · {flow.provider}</p>
    <h1 class={ui.title}>{flow.local().name} is kept in {flow.provider}</h1>
    <p class={ui.body}>Every key below opens it on any device.</p>
  </header>
  <div class={list}>
    <KeyIdentity identity={flow.local()} tag="In use" />
    {#each flow.separate as identity (identity.id)}
      <KeyIdentity
        identity={{ ...identity, keys: [...identity.keys, thisBrowserPasskey] }}
        tag="Also on this browser"
      />
    {/each}
    {#if undecided.length > 0}
      <ActionCard
        title="{flow.provider} also keeps {undecided.length} other {undecided.length === 1 ? 'identity' : 'identities'}"
        body="Saved there by other devices or earlier sessions. See whether one is yours."
        onPick={() => flow.go(KeyState.RemoteIdentities)}
      />
    {/if}
  </div>
{:else if flow.current === KeyState.RemoteIdentities}
  <header class="space-y-2">
    <p class={ui.label}>{flow.provider} · meta-secret-nook</p>
    <h1 class={ui.title}>{flow.provider} already keeps identities</h1>
    <p class={ui.body}>
      {flow.local().name} now syncs here. The same folder holds
      {undecided.length} {undecided.length === 1 ? 'identity' : 'identities'}
      saved earlier — by your other devices, a past session on this computer,
      or someone sharing the folder. Their names are sealed; each shows the
      three words its devices show.
    </p>
  </header>
  {#if flow.remoteChecked}
    <p class="mt-4 {opened.length > 0 ? ui.tagOk : ui.tag}">
      {opened.length > 0
        ? `Your passkey opens ${opened.length === 1 ? 'one of them' : `${opened.length} of them`}`
        : 'Your passkey opens none of them'}
    </p>
  {/if}
  <div class={list}>
    {#each undecided as identity (identity.id)}
      {#if revealed(identity)}
        <ActionCard
          title={nameOf(identity)}
          body="Your passkey opens {identity.words}: it's your identity {identity.name}, saved here before. Use it on this browser instead of {flow.local().name}."
          tag="Yours"
          tagTone="ok"
          onPick={() => {
            flow.chosen = identity
            flow.go(KeyState.UseInstead)
          }}
        >
          <KeyList {identity} />
        </ActionCard>
      {:else}
        <ActionCard
          title={identity.words}
          body="Saved in {flow.provider} · {keyCount(identity)}. Sealed to you: send a join request to its devices."
          tag="Sealed"
          onPick={() => {
            flow.chosen = identity
            flow.go(KeyState.JoinPending)
          }}
        />
      {/if}
    {/each}
    {#if !flow.remoteChecked}
      <ActionCard
        title="Is one of them yours? Check with my passkey"
        body="Pick the passkey you used for Nook before. It is checked here; nothing is sent."
        passkey
        onPick={() => {
          flow.remoteChecked = true
        }}
      />
    {/if}
    <ActionCard
      title="Skip for now"
      body="Nothing changes for them; only {flow.local().name} syncs. Come back from Identities anytime."
      onPick={() => flow.go(KeyState.Synced)}
    />
  </div>
{:else if flow.current === KeyState.UseInstead}
  <header class="space-y-2">
    <p class={ui.label}>Found in {flow.provider}</p>
    <h1 class={ui.title}>Which identity should this browser use?</h1>
    <p class={ui.body}>
      Your passkey opens {flow.chosen.name}, saved in {flow.provider} before.
      {flow.local().name} was created a moment ago and holds only this
      browser's new key, so picking {flow.chosen.name} removes it and loses
      nothing.
    </p>
  </header>
  <div class={grid}>
    <ActionCard
      title={flow.chosen.name}
      body="Your identity from before. This browser becomes one of its keys."
      tag="Yours"
      tagTone="ok"
      passkey
      onPick={useInstead}
    >
      <KeyList identity={flow.joined()} />
    </ActionCard>
    <ActionCard
      title="Keep {flow.local().name}"
      body="The new identity stays; {flow.chosen.name} stays in the folder."
      tag="Created just now"
      onPick={() => flow.go(KeyState.Synced)}
    >
      <KeyList identity={flow.local()} />
    </ActionCard>
  </div>
{:else if flow.current === KeyState.JoinPending}
  <header class="space-y-2">
    <p class={ui.label}>Join request sent</p>
    <h1 class={ui.title}>Waiting for {flow.chosen.words}</h1>
    <p class={ui.body}>
      Its {flow.chosen.keys.length} {flow.chosen.keys.length === 1 ? 'device sees' : 'devices see'}
      the request from this browser. Approve it on one of them.
    </p>
  </header>
  <div class={list}>
    <ActionCard
      title="Simulate: approve on the other device"
      body="In Nook this happens on the other device, under Devices."
      onPick={() => flow.go(KeyState.Joined)}
    />
  </div>
{:else if flow.current === KeyState.Joined}
  <header class="space-y-2">
    <p class={ui.label}>Joined</p>
    <h1 class={ui.title}>This browser is a key of {flow.chosen.words}</h1>
    <p class={ui.body}>
      Its devices let you in, so its name opens too: it's
      <span class="text-[#e9e8e4]">{joinedName()}</span>.
    </p>
  </header>
  {#if flow.hasLocal}
    <div class={grid}>
      <ActionCard
        title="Use {joinedName()} instead"
        body="{flow.local().name} was created just now and holds only this browser's key, so it is removed."
        tag="Yours now"
        tagTone="ok"
        onPick={useInstead}
      >
        <KeyList identity={flow.joined()} />
      </ActionCard>
      <ActionCard
        title="Keep both on this browser"
        body="{flow.local().name} stays in use; {joinedName()} opens here too."
        onPick={keepBoth}
      >
        <KeyList identity={flow.local()} />
      </ActionCard>
    </div>
  {:else}
    <div class={list}>
      <ActionCard
        title="Use {joinedName()}"
        body="This browser's passkey is now one of its keys."
        tag="Yours"
        tagTone="ok"
        onPick={() => flow.go(KeyState.UsingRemote)}
      >
        <KeyList identity={flow.joined()} />
      </ActionCard>
    </div>
  {/if}
{:else if flow.current === KeyState.ImportProvider}
  <header class="space-y-2">
    <p class={ui.label}>Import</p>
    <h1 class={ui.title}>Where is your identity kept?</h1>
    <p class={ui.body}>The sync provider your other devices use.</p>
  </header>
  <div class={grid}>
    {#each providerNames as name (name)}
      <ActionCard
        title={name}
        onPick={() => {
          flow.provider = name
          flow.go(KeyState.ImportPasskey)
        }}
      />
    {/each}
  </div>
{:else if flow.current === KeyState.ImportPasskey}
  <header class="space-y-2">
    <p class={ui.label}>{flow.provider} · meta-secret-nook</p>
    <h1 class={ui.title}>Find yours with your passkey</h1>
    <p class={ui.body}>
      {flow.provider} keeps {remoteIdentities.length} identities. Your passkey
      is one of the keys of yours; it is checked here and nothing is sent.
    </p>
  </header>
  <div class={list}>
    <ActionCard
      title="Use my passkey"
      body="Pick the passkey you use for Nook."
      passkey
      onPick={() =>
        flow.go(
          flow.passkeyFit === PasskeyFit.Opens
            ? KeyState.UsingRemote
            : KeyState.ImportChoose,
        )}
    />
  </div>
{:else if flow.current === KeyState.ImportChoose}
  <header class="space-y-2">
    <p class={ui.label}>Not one of its keys</p>
    <h1 class={ui.title}>Which one is yours?</h1>
    <p class={ui.body}>
      Your passkey isn't a key of any identity here. Click yours — your other
      device shows the same three words under Identities — and its devices
      can let this browser in.
    </p>
  </header>
  <div class={list}>
    {#each remoteIdentities as identity (identity.id)}
      <ActionCard
        title={identity.words}
        body="Saved in {flow.provider} · {keyCount(identity)}. Send a join request to its devices."
        onPick={() => {
          flow.chosen = identity
          flow.go(KeyState.JoinPending)
        }}
      />
    {/each}
  </div>
{:else}
  <header class="space-y-2">
    <p class={ui.label}>Using · {flow.provider}</p>
    <h1 class={ui.title}>{joinedName()} is on this browser</h1>
    <p class={ui.body}>This browser's passkey is now one of its keys.</p>
  </header>
  <div class="mt-6">
    <KeyIdentity identity={flow.joined()} tag="In use" />
  </div>
{/if}
