<!-- What the current step asks for, under the ring. Start and picking a
provider have nothing to draw yet; every other step shows the ring, and after
onboarding each action opens a panel beneath it and closes back to it. Every
identity found on a provider is its own card carrying its token. -->
<script lang="ts">
  import Card from './Card.svelte'
  import Ring from './Ring.svelte'
  import Token from './Token.svelte'
  import type { KeyRingFlow } from './flow.svelte'
  import { KeyKind, Standing, Step, linkCode, providers, type Identity } from './model'
  import { Tone } from './tone'
  import { ui } from './ui'

  let { flow }: { flow: KeyRingFlow } = $props()

  /** Adding a device: the panel shows what to do on it. */
  let inviting = $state(false)

  const panel = 'space-y-4 border-t border-[#24272b] pt-6'
  const chip = 'border border-[#2c3035] px-2 py-1'

  function signIn(provider: string): void {
    flow.connect(provider)
    flow.go(Step.Found)
  }

  function adopt(identity: Identity): void {
    flow.adopt(identity)
    flow.go(Step.Ring)
  }

  function addProvider(provider: string): void {
    flow.connect(provider)
    flow.go(flow.onProvider.length > 0 ? Step.Provider : Step.Ring)
  }

  function addSecurityKey(): void {
    flow.addKey({ id: `key_security_${flow.keys.length}`, kind: KeyKind.Passkey, device: 'Security key', here: false })
    flow.go(Step.Ring)
  }

  function deviceAsks(): void {
    inviting = false
    flow.deviceAsks()
    flow.go(Step.Ring)
  }

  function save(): void {
    flow.saved = true
    flow.go(Step.Ring)
  }
</script>

{#snippet found(identity: Identity, importing: boolean)}
  {@const standing = flow.standing(identity)}
  {#if standing === Standing.Yours}
    <Card
      title={importing ? 'Use it' : `Merge into ${flow.name}`}
      tag="Yours"
      tone={Tone.Ok}
      onPick={() => {
        if (importing) adopt(identity)
        else flow.merge(identity)
      }}
    >
      <Token {identity} {standing} />
    </Card>
  {:else if standing === Standing.Locked}
    <Card
      title="Ask to join"
      tag="Locked"
      onPick={() => {
        flow.askToJoin(identity)
        if (importing) flow.go(Step.Waiting)
      }}
    >
      <Token {identity} {standing} />
    </Card>
  {:else if standing === Standing.Asked}
    <Card title="Simulate: approved" tag="Asked" tone={Tone.Warn} onPick={() => flow.approved()}>
      <Token {identity} {standing} />
    </Card>
  {:else}
    <Card title="Unlock" passkey onPick={() => flow.unlock(identity)}>
      <Token {identity} {standing} />
    </Card>
  {/if}
{/snippet}

{#snippet panelHead(title: string)}
  <div class="flex items-baseline justify-between gap-4">
    <h2 class={ui.panelTitle}>{title}</h2>
    <button type="button" class={ui.link} onclick={() => flow.go(Step.Ring)}>Close</button>
  </div>
{/snippet}

<div class="space-y-6">
  {#if flow.step === Step.Start}
    <h1 class={ui.title}>Start</h1>
    <div class={ui.grid}>
      <Card title="Create identity" onPick={() => flow.go(Step.Create)} />
      <Card title="Import from sync provider" onPick={() => flow.go(Step.Import)} />
    </div>
  {:else if flow.step === Step.Import}
    <h1 class={ui.title}>Import from</h1>
    <div class={ui.grid}>
      {#each providers as provider (provider)}
        <Card title={provider} onPick={() => signIn(provider)} />
      {/each}
    </div>
  {:else}
    <Ring {flow} />

    {#if flow.step === Step.Create}
      <h1 class={ui.title}>Name it</h1>
      <input class={ui.input} bind:value={flow.name} aria-label="Identity name" />
      <Card
        title="Create passkey"
        passkey
        onPick={() => {
          flow.create()
          flow.go(Step.Ring)
        }}
      />
    {:else if flow.step === Step.Found}
      {#if flow.onProvider.length > 0}
        <h1 class={ui.title}>Which is yours?</h1>
        <div class={ui.grid}>
          {#each flow.onProvider as identity (identity.id)}
            {@render found(identity, true)}
          {/each}
        </div>
      {:else}
        <h1 class={ui.title}>Nothing to import</h1>
        <Card title="Create identity" onPick={() => flow.go(Step.Create)} />
      {/if}
    {:else if flow.step === Step.Waiting}
      <h1 class={ui.title}>Approve on your other device</h1>
      <div class="flex items-baseline gap-4">
        <span class="font-mono text-[34px] tracking-[0.2em] text-[#e9e8e4]">{linkCode}</span>
        <span class={ui.label}>same code there</span>
      </div>
      <Card
        title="Simulate: approved"
        onPick={() => {
          flow.approved()
          adopt(flow.joining)
        }}
      />
    {:else if flow.step === Step.AddKey}
      <section class={panel}>
        {#if inviting}
          {@render panelHead('On the other device')}
          <ol class="flex flex-wrap items-center gap-2 font-mono text-[12px] text-[#a4a8ae]">
            <li class={chip}>Open Nook</li>
            <li aria-hidden="true">→</li>
            <li class={chip}>Import from {flow.provider}</li>
            <li aria-hidden="true">→</li>
            <li class={chip}>Ask to join {flow.words}</li>
          </ol>
          <Card title="Simulate: the device asks" onPick={deviceAsks} />
        {:else}
          {@render panelHead('Add key')}
          <div class={ui.grid}>
            <Card title="Security key" passkey onPick={addSecurityKey} />
            <Card
              title="Another device"
              tag={flow.provider ? '' : 'Needs sync'}
              tone={Tone.Warn}
              disabled={!flow.provider}
              onPick={() => {
                inviting = true
              }}
            />
          </div>
        {/if}
      </section>
    {:else if flow.step === Step.AddProvider}
      <section class={panel}>
        {@render panelHead('Sync with')}
        <div class={ui.grid}>
          {#each providers as provider (provider)}
            <Card title={provider} onPick={() => addProvider(provider)} />
          {/each}
        </div>
      </section>
    {:else if flow.step === Step.Provider}
      <section class={panel}>
        {@render panelHead(flow.provider)}
        <div class={ui.grid}>
          {#if !flow.saved}
            <Card title="Save {flow.name}" onPick={save} />
          {/if}
          {#each flow.others() as identity (identity.id)}
            {@render found(identity, false)}
          {/each}
          {#if flow.saved && flow.others().length === 0}
            <Card title="Done" onPick={() => flow.go(Step.Ring)} />
          {/if}
        </div>
      </section>
    {/if}
  {/if}
</div>
