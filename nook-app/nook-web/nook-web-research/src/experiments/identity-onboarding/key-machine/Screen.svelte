<!-- The screen for the machine's current state: a scene of where the
identities are, a headline of a few words, and the state's transitions as
cards. Identities on a provider show by their three words until a passkey or
a join opens them. -->
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

  /** The first remote identity is the one your passkey opens, when the
   * simulator says so. */
  function opensFor(identity: IdentityFixture): boolean {
    const [first] = remoteIdentities
    return flow.passkeyFit === PasskeyFit.Opens && identity.id === first?.id
  }

  function revealed(identity: IdentityFixture): boolean {
    return flow.remoteChecked && opensFor(identity)
  }

  function local(status: TokenStatus): Token {
    return { id: 'local', label: flow.local().name, keys: 1, status }
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
    remoteIdentities.filter((identity) => !flow.separate.some((kept) => kept.id === identity.id)),
  )

  /** The provider's identities as the remote step draws them. */
  const found = $derived<readonly Token[]>([
    local(TokenStatus.Synced),
    ...flow.separate.map((identity) => remote(identity, TokenStatus.Synced)),
    ...undecided.map((identity) =>
      remote(identity, revealed(identity) ? TokenStatus.Opened : TokenStatus.Sealed),
    ),
  ])

  const sealedAll = $derived<readonly Token[]>(
    remoteIdentities.map((identity) => remote(identity, TokenStatus.Sealed)),
  )

  function chosenName(): string {
    return flow.chosen.name || flow.chosen.words
  }

  function connect(provider: string): void {
    flow.provider = provider
    flow.synced = true
    flow.remoteChecked = false
    flow.go(
      flow.providerHolds === ProviderHolds.Nothing ? KeyState.Synced : KeyState.RemoteIdentities,
    )
  }

  function useInstead(): void {
    flow.hasLocal = false
    flow.separate = []
    flow.go(KeyState.UsingRemote)
  }

  function keepBoth(): void {
    flow.separate = [...flow.separate, flow.chosen]
    flow.go(KeyState.Synced)
  }
</script>

<div class="space-y-6">
  {#if flow.current === KeyState.Empty}
    <Scene browser={[]} />
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
    <h1 class={ui.title}>{flow.local().name} · 1 key</h1>
    <ActionCard title="Add sync" onPick={() => flow.go(KeyState.ConnectProvider)} />
  {:else if flow.current === KeyState.ConnectProvider}
    <Scene browser={[local(TokenStatus.Here)]} />
    <h1 class={ui.title}>Sync with</h1>
    <div class={grid}>
      {#each providerNames as name (name)}
        <ActionCard title={name} onPick={() => connect(name)} />
      {/each}
    </div>
  {:else if flow.current === KeyState.Synced}
    <Scene
      browser={[local(TokenStatus.Here), ...flow.separate.map((identity) => remote(identity, TokenStatus.Here))]}
      provider={flow.provider}
      remote={[local(TokenStatus.Synced), ...flow.separate.map((identity) => remote(identity, TokenStatus.Synced))]}
      link={SceneLink.Sync}
    />
    <h1 class={ui.title}>Synced</h1>
    {#if undecided.length > 0}
      <ActionCard
        title="{undecided.length} more in {flow.provider}"
        tag="Sealed"
        onPick={() => flow.go(KeyState.RemoteIdentities)}
      />
    {/if}
  {:else if flow.current === KeyState.RemoteIdentities}
    <Scene
      browser={[local(TokenStatus.Here)]}
      provider={flow.provider}
      remote={found}
      link={flow.remoteChecked ? SceneLink.Passkey : SceneLink.Sync}
    />
    <h1 class={ui.title}>{undecided.length} more found</h1>
    <div class={grid}>
      {#if !flow.remoteChecked}
        <ActionCard
          title="Check with passkey"
          passkey
          onPick={() => {
            flow.remoteChecked = true
          }}
        />
      {/if}
      {#each undecided as identity (identity.id)}
        {#if revealed(identity)}
          <ActionCard
            title="Use {identity.name}"
            tag="Yours"
            tagTone="ok"
            onPick={() => {
              flow.chosen = identity
              flow.go(KeyState.UseInstead)
            }}
          />
        {:else if flow.remoteChecked}
          <ActionCard
            title="Ask to join {identity.words}"
            onPick={() => {
              flow.chosen = identity
              flow.go(KeyState.JoinPending)
            }}
          />
        {/if}
      {/each}
      <ActionCard title="Skip" onPick={() => flow.go(KeyState.Synced)} />
    </div>
  {:else if flow.current === KeyState.UseInstead}
    <Scene
      browser={[local(TokenStatus.Removed), remote(flow.chosen, TokenStatus.Here)]}
      provider={flow.provider}
      remote={[remote(flow.chosen, TokenStatus.Opened)]}
      link={SceneLink.Passkey}
    />
    <h1 class={ui.title}>Use {flow.chosen.name}?</h1>
    <div class={grid}>
      <ActionCard title="Use {flow.chosen.name}" tag="Yours" tagTone="ok" passkey onPick={useInstead} />
      <ActionCard title="Keep {flow.local().name}" onPick={() => flow.go(KeyState.Synced)} />
    </div>
  {:else if flow.current === KeyState.JoinPending}
    <Scene
      browser={flow.hasLocal ? [local(TokenStatus.Here)] : []}
      provider={flow.provider}
      remote={[remote(flow.chosen, TokenStatus.Pending)]}
      link={SceneLink.Request}
    />
    <h1 class={ui.title}>Waiting for approval</h1>
    <ActionCard title="Simulate: approve on the other device" onPick={() => flow.go(KeyState.Joined)} />
  {:else if flow.current === KeyState.Joined}
    <Scene
      browser={[...(flow.hasLocal ? [local(TokenStatus.Here)] : []), remote(flow.chosen, TokenStatus.Here)]}
      provider={flow.provider}
      remote={[remote(flow.chosen, TokenStatus.Synced)]}
      link={SceneLink.Sync}
    />
    <h1 class={ui.title}>Joined {chosenName()}</h1>
    <div class={grid}>
      {#if flow.hasLocal}
        <ActionCard title="Use {chosenName()} instead" tag="Yours" tagTone="ok" onPick={useInstead} />
        <ActionCard title="Keep both" onPick={keepBoth} />
      {:else}
        <ActionCard title="Use {chosenName()}" tag="Yours" tagTone="ok" onPick={() => flow.go(KeyState.UsingRemote)} />
      {/if}
    </div>
  {:else if flow.current === KeyState.ImportProvider}
    <Scene browser={[]} />
    <h1 class={ui.title}>Import from</h1>
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
    <Scene browser={[]} provider={flow.provider} remote={sealedAll} />
    <h1 class={ui.title}>Which is yours?</h1>
    <ActionCard
      title="Check with passkey"
      passkey
      onPick={() =>
        flow.go(flow.passkeyFit === PasskeyFit.Opens ? KeyState.UsingRemote : KeyState.ImportChoose)}
    />
  {:else if flow.current === KeyState.ImportChoose}
    <Scene browser={[]} provider={flow.provider} remote={sealedAll} />
    <h1 class={ui.title}>None opened · ask to join</h1>
    <div class={grid}>
      {#each remoteIdentities as identity (identity.id)}
        <ActionCard
          title={identity.words}
          onPick={() => {
            flow.chosen = identity
            flow.go(KeyState.JoinPending)
          }}
        />
      {/each}
    </div>
  {:else}
    <Scene
      browser={[remote(flow.chosen, TokenStatus.Here)]}
      provider={flow.provider}
      remote={[remote(flow.chosen, TokenStatus.Synced)]}
      link={SceneLink.Sync}
    />
    <h1 class={ui.title}>{chosenName()} is here</h1>
  {/if}
</div>
