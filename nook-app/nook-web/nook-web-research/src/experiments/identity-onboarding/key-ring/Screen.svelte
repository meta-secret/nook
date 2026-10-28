<!-- Onboarding is a few short screens that end on the key ring; after that
the ring stays on screen and every action opens a panel beneath it. Each
identity found on a provider is its own card with its token, so you always see
which one you unlock, use, merge, or ask to join. -->
<script lang="ts">
  import ActionCard from '../key-machine/ActionCard.svelte'
  import IdentityToken from '../key-machine/IdentityToken.svelte'
  import Scene from '../key-machine/Scene.svelte'
  import {
    SceneLink,
    TokenStatus,
    providerNames,
    type IdentityFixture,
    type Token,
  } from '../key-machine/machine'
  import KeyRing from './KeyRing.svelte'
  import type { RingFlow } from './ring-flow.svelte'
  import { RingState, Standing, linkCode } from './ring'
  import { ui } from '../identity-first/ui'

  let { flow }: { flow: RingFlow } = $props()

  const grid = 'grid gap-3 sm:grid-cols-2'
  const panelTitle = 'text-[20px] leading-tight font-semibold tracking-tight'

  /** The other device is being set up to ask; the panel shows its steps. */
  let inviting = $state(false)

  function tokenOf(identity: IdentityFixture): Token {
    const standing = flow.standing(identity)
    const status =
      standing === Standing.Yours
        ? TokenStatus.Opened
        : standing === Standing.Asked
          ? TokenStatus.Pending
          : TokenStatus.Sealed
    return {
      id: identity.id,
      label: status === TokenStatus.Opened && identity.name ? identity.name : identity.words,
      keys: identity.keys.length,
      status,
    }
  }

  function ghost(): Token {
    return { id: 'self', label: flow.name, keys: 1, status: TokenStatus.Ghost }
  }

  function pickProvider(name: string): void {
    flow.connect(name)
    flow.go(RingState.Found)
  }

  function adopt(identity: IdentityFixture): void {
    flow.adopt(identity)
    flow.go(RingState.Home)
  }

  function ask(identity: IdentityFixture, merging: boolean): void {
    flow.askToJoin(identity)
    if (!merging) flow.go(RingState.Linking)
  }

  function addProvider(name: string): void {
    flow.connect(name)
    flow.go(flow.onProvider.length > 0 ? RingState.Merge : RingState.Home)
  }

  function addSecurityKey(): void {
    flow.addKey({
      id: `passkey_security_${flow.keys.length}`,
      kind: 'passkey',
      label: 'Security key · passkey',
      here: false,
    })
    flow.go(RingState.Home)
  }

  function deviceAsks(): void {
    inviting = false
    flow.deviceAsks()
    flow.go(RingState.Home)
  }

  function save(): void {
    flow.saved = true
    flow.go(RingState.Home)
  }
</script>

{#snippet foundCard(identity: IdentityFixture, merging: boolean)}
  {@const standing = flow.standing(identity)}
  {#if standing === Standing.Yours}
    <ActionCard
      title={merging ? `Merge into ${flow.name}` : 'Use it'}
      tag="Yours"
      tagTone="ok"
      onPick={() => {
        if (merging) flow.merge(identity)
        else adopt(identity)
      }}
    >
      <IdentityToken token={tokenOf(identity)} />
    </ActionCard>
  {:else if standing === Standing.Locked}
    <ActionCard title="Ask to join" tag="Locked" onPick={() => ask(identity, merging)}>
      <IdentityToken token={tokenOf(identity)} />
    </ActionCard>
  {:else if standing === Standing.Asked}
    <ActionCard title="Simulate: approved" tag="Asked" tagTone="warn" onPick={() => flow.approved()}>
      <IdentityToken token={tokenOf(identity)} />
    </ActionCard>
  {:else}
    <ActionCard title="Unlock" passkey onPick={() => flow.unlock(identity)}>
      <IdentityToken token={tokenOf(identity)} />
    </ActionCard>
  {/if}
{/snippet}

{#snippet panelHead(title: string)}
  <div class="flex items-baseline justify-between gap-4">
    <h2 class={panelTitle}>{title}</h2>
    <button type="button" class={ui.link} onclick={() => flow.go(RingState.Home)}>Close</button>
  </div>
{/snippet}

<div class="space-y-6">
  {#if flow.current === RingState.Start}
    <h1 class={ui.title}>Start</h1>
    <div class={grid}>
      <ActionCard
        title="Create identity"
        onPick={() => {
          flow.provider = ''
          flow.go(RingState.Create)
        }}
      />
      <ActionCard title="Import from sync provider" onPick={() => flow.go(RingState.Import)} />
    </div>
  {:else if flow.current === RingState.Import}
    <h1 class={ui.title}>Import from</h1>
    <div class={grid}>
      {#each providerNames as name (name)}
        <ActionCard title={name} onPick={() => pickProvider(name)} />
      {/each}
    </div>
  {:else if flow.current === RingState.Create}
    <Scene
      browser={[ghost()]}
      provider={flow.provider}
      remote={flow.provider ? [ghost()] : []}
      link={flow.provider ? SceneLink.Sync : SceneLink.None}
    />
    <h1 class={ui.title}>Name it</h1>
    <input class={ui.input} bind:value={flow.name} aria-label="Identity name" />
    <ActionCard
      title="Create passkey"
      passkey
      onPick={() => {
        flow.create()
        flow.go(RingState.Home)
      }}
    />
  {:else if flow.current === RingState.Found}
    <Scene browser={[]} provider={flow.provider} remote={flow.onProvider.map(tokenOf)} />
    {#if flow.onProvider.length > 0}
      <h1 class={ui.title}>Which is yours?</h1>
      <div class={grid}>
        {#each flow.onProvider as identity (identity.id)}
          {@render foundCard(identity, false)}
        {/each}
      </div>
    {:else}
      <h1 class={ui.title}>Nothing to import</h1>
      <ActionCard title="Create identity" onPick={() => flow.go(RingState.Create)} />
    {/if}
  {:else if flow.current === RingState.Linking}
    <Scene browser={[]} provider={flow.provider} remote={[tokenOf(flow.joining)]} link={SceneLink.Request} />
    <h1 class={ui.title}>Approve on your other device</h1>
    <div class="flex items-baseline gap-4">
      <span class="font-mono text-[34px] tracking-[0.2em] text-[#e9e8e4]">{linkCode}</span>
      <span class={ui.label}>same code there</span>
    </div>
    <ActionCard
      title="Simulate: approved"
      onPick={() => {
        flow.approved()
        adopt(flow.joining)
      }}
    />
  {:else}
    <KeyRing {flow} />

    {#if flow.current === RingState.AddKey}
      <section class="space-y-4 border-t border-[#24272b] pt-6">
        {#if inviting}
          {@render panelHead('On the other device')}
          <ol class="flex flex-wrap items-center gap-2 font-mono text-[12px] text-[#a4a8ae]">
            <li class="border border-[#2c3035] px-2 py-1">Open Nook</li>
            <li aria-hidden="true">→</li>
            <li class="border border-[#2c3035] px-2 py-1">Sync with {flow.provider}</li>
            <li aria-hidden="true">→</li>
            <li class="border border-[#2c3035] px-2 py-1">Ask to join {flow.words}</li>
          </ol>
          <ActionCard title="Simulate: the device asks" onPick={deviceAsks} />
        {:else}
          {@render panelHead('Add key')}
          <div class={grid}>
            <ActionCard title="Security key" passkey onPick={addSecurityKey} />
            <ActionCard
              title="Another device"
              tag={flow.provider ? '' : 'Needs sync'}
              tagTone="warn"
              disabled={!flow.provider}
              onPick={() => {
                inviting = true
              }}
            />
          </div>
        {/if}
      </section>
    {:else if flow.current === RingState.AddProvider}
      <section class="space-y-4 border-t border-[#24272b] pt-6">
        {@render panelHead('Sync with')}
        <div class={grid}>
          {#each providerNames as name (name)}
            <ActionCard title={name} onPick={() => addProvider(name)} />
          {/each}
        </div>
      </section>
    {:else if flow.current === RingState.Merge}
      <section class="space-y-4 border-t border-[#24272b] pt-6">
        {@render panelHead(
          flow.others().length > 0 ? `${flow.others().length} more in ${flow.provider}` : 'All merged',
        )}
        <div class={grid}>
          {#each flow.others() as identity (identity.id)}
            {@render foundCard(identity, true)}
          {/each}
          <ActionCard title={flow.saved ? 'Done' : `Save ${flow.name}`} onPick={save} />
        </div>
      </section>
    {/if}
  {/if}
</div>
