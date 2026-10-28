<!-- The screen for the machine's current state: a scene of where the
identities are, a headline of a few words, and the state's transitions as
cards. Each identity found on a provider is its own card: you unlock it with
your passkey, and it either turns out to be yours or you ask to join it. The
identity on this browser never changes: one of yours merges into it, and it
only gains keys. -->
<script lang="ts">
  import ActionCard from './ActionCard.svelte'
  import Scene from './Scene.svelte'
  import type { KeyFlow } from './key-flow.svelte'
  import {
    KeyState,
    PasskeyFit,
    ProviderHolds,
    SceneLink,
    TokenStatus,
    providerNames,
    remoteIdentities,
    type IdentityFixture,
    type Token,
  } from './machine'
  import { ui } from '../identity-first/ui'

  let { flow }: { flow: KeyFlow } = $props()

  const grid = 'grid gap-3 sm:grid-cols-2'

  /** The first remote identity is the one your passkey unlocks, when the
   * simulator says so. */
  function opensFor(identity: IdentityFixture): boolean {
    const [first] = remoteIdentities
    return flow.passkeyFit === PasskeyFit.Opens && identity.id === first?.id
  }

  /** Your passkey unlocked it, or a device approved your join request. */
  function revealed(identity: IdentityFixture): boolean {
    return (flow.tried.includes(identity.id) && opensFor(identity)) || flow.approved.includes(identity.id)
  }

  function nameOf(identity: IdentityFixture): string {
    return identity.name || identity.words
  }

  function keyCount(): string {
    const count = flow.localKeys().length
    return count === 1 ? '1 key' : `${count} keys`
  }

  function local(status: TokenStatus): Token {
    return { id: 'local', label: flow.local().name, keys: flow.localKeys().length, status }
  }

  function remote(identity: IdentityFixture, status: TokenStatus): Token {
    const named =
      status === TokenStatus.Opened ||
      status === TokenStatus.Here ||
      status === TokenStatus.Synced
    const joinedHere = status === TokenStatus.Here || status === TokenStatus.Synced
    return {
      id: identity.id,
      label: named && identity.name ? identity.name : identity.words,
      keys: identity.keys.length + (joinedHere ? 1 : 0),
      status,
    }
  }

  const undecided = $derived(
    remoteIdentities.filter((identity) => !flow.merged.some((done) => done.id === identity.id)),
  )

  function onProvider(identity: IdentityFixture): Token {
    return remote(identity, revealed(identity) ? TokenStatus.Opened : TokenStatus.Sealed)
  }

  /** The provider as the remote step draws it: yours once saved, then the
   * identities still to decide. */
  const providerTokens = $derived<readonly Token[]>([
    ...(flow.saved ? [local(TokenStatus.Synced)] : []),
    ...undecided.map(onProvider),
  ])

  function connect(provider: string): void {
    flow.provider = provider
    flow.tried = []
    if (flow.providerHolds === ProviderHolds.Nothing) {
      save()
      return
    }
    flow.saved = false
    flow.go(KeyState.RemoteIdentities)
  }

  function save(): void {
    flow.saved = true
    flow.go(KeyState.Synced)
  }

  function unlock(identity: IdentityFixture): void {
    flow.tried = [...flow.tried, identity.id]
  }

  /** Fold one of your identities into the one on this browser, in place:
   * its token leaves the provider, and yours is saved there with its keys. */
  function merge(identity: IdentityFixture): void {
    flow.merged = [...flow.merged, identity]
    flow.saved = true
  }

  function use(identity: IdentityFixture): void {
    flow.chosen = identity
    flow.go(KeyState.UsingRemote)
  }

  function askToJoin(identity: IdentityFixture): void {
    flow.chosen = identity
    flow.go(KeyState.JoinPending)
  }

  function approve(): void {
    if (!flow.hasLocal) {
      flow.go(KeyState.UsingRemote)
      return
    }
    flow.approved = [...flow.approved, flow.chosen.id]
    flow.go(KeyState.RemoteIdentities)
  }
</script>

{#snippet foundCard(identity: IdentityFixture)}
  {#if revealed(identity)}
    {#if flow.hasLocal}
      <ActionCard
        title="Merge {nameOf(identity)} into {flow.local().name}"
        tag="Yours"
        tagTone="ok"
        onPick={() => merge(identity)}
      />
    {:else}
      <ActionCard title="Use {nameOf(identity)}" tag="Yours" tagTone="ok" onPick={() => use(identity)} />
    {/if}
  {:else if flow.tried.includes(identity.id)}
    <ActionCard title="Ask to join {identity.words}" tag="Locked" onPick={() => askToJoin(identity)} />
  {:else}
    <ActionCard title="Unlock {identity.words}" passkey onPick={() => unlock(identity)} />
  {/if}
{/snippet}

<div class="space-y-6">
  {#if flow.current === KeyState.Empty}
    <h1 class={ui.title}>Start</h1>
    <div class={grid}>
      <ActionCard title="Create identity" onPick={() => flow.go(KeyState.CreateIdentity)} />
      <ActionCard title="Import identity" onPick={() => flow.go(KeyState.ImportProvider)} />
    </div>
  {:else if flow.current === KeyState.CreateIdentity}
    <Scene browser={[local(TokenStatus.Ghost)]} />
    <h1 class={ui.title}>Name it</h1>
    <input class={ui.input} bind:value={flow.localName} aria-label="Identity name" />
    <ActionCard
      title="Create passkey"
      passkey
      onPick={() => {
        flow.hasLocal = true
        flow.go(KeyState.LocalIdentity)
      }}
    />
  {:else if flow.current === KeyState.LocalIdentity}
    <Scene browser={[local(TokenStatus.Here)]} />
    <h1 class={ui.title}>{flow.local().name} · {keyCount()}</h1>
    <ActionCard
      title="Add sync provider"
      tag="Only here"
      tagTone="warn"
      onPick={() => flow.go(KeyState.ConnectProvider)}
    />
  {:else if flow.current === KeyState.ConnectProvider}
    <Scene browser={[local(TokenStatus.Here)]} />
    <h1 class={ui.title}>Sync provider</h1>
    <div class={grid}>
      {#each providerNames as name (name)}
        <ActionCard title={name} onPick={() => connect(name)} />
      {/each}
    </div>
  {:else if flow.current === KeyState.Synced}
    <Scene
      browser={[local(TokenStatus.Here)]}
      provider={flow.provider}
      remote={[local(TokenStatus.Synced)]}
      link={SceneLink.Sync}
    />
    <h1 class={ui.title}>Synced</h1>
    {#if flow.providerHolds === ProviderHolds.Identities && undecided.length > 0}
      <ActionCard
        title="{undecided.length} more in {flow.provider}"
        tag="Locked"
        onPick={() => flow.go(KeyState.RemoteIdentities)}
      />
    {/if}
  {:else if flow.current === KeyState.RemoteIdentities}
    <Scene
      browser={[local(TokenStatus.Here)]}
      provider={flow.provider}
      remote={providerTokens}
      link={flow.saved ? SceneLink.Sync : SceneLink.None}
    />
    <h1 class={ui.title}>
      {undecided.length > 0 ? `${undecided.length} found` : `${flow.local().name} · ${keyCount()}`}
    </h1>
    <div class={grid}>
      {#each undecided as identity (identity.id)}
        {@render foundCard(identity)}
      {/each}
      <ActionCard title={flow.saved ? 'Done' : `Save ${flow.local().name}`} onPick={save} />
    </div>
  {:else if flow.current === KeyState.JoinPending}
    <Scene
      browser={flow.hasLocal ? [local(TokenStatus.Here)] : []}
      provider={flow.provider}
      remote={[remote(flow.chosen, TokenStatus.Pending)]}
      link={SceneLink.Request}
    />
    <h1 class={ui.title}>Waiting for approval</h1>
    <ActionCard title="Simulate: approve on the other device" onPick={approve} />
  {:else if flow.current === KeyState.ImportProvider}
    <h1 class={ui.title}>Import from</h1>
    <div class={grid}>
      {#each providerNames as name (name)}
        <ActionCard
          title={name}
          onPick={() => {
            flow.provider = name
            flow.tried = []
            flow.go(KeyState.ImportPick)
          }}
        />
      {/each}
    </div>
  {:else if flow.current === KeyState.ImportPick}
    <Scene browser={[]} provider={flow.provider} remote={remoteIdentities.map(onProvider)} />
    <h1 class={ui.title}>Which is yours?</h1>
    <div class={grid}>
      {#each remoteIdentities as identity (identity.id)}
        {@render foundCard(identity)}
      {/each}
    </div>
  {:else}
    <Scene
      browser={[remote(flow.chosen, TokenStatus.Here)]}
      provider={flow.provider}
      remote={[remote(flow.chosen, TokenStatus.Synced)]}
      link={SceneLink.Sync}
    />
    <h1 class={ui.title}>{nameOf(flow.chosen)} is here</h1>
  {/if}
</div>
