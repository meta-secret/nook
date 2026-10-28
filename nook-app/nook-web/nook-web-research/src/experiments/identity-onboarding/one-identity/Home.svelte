<!-- Home is your identity: its sigil and name, the devices whose keys open
it, and where it is synced. A device asking to join shows at the top with its
code. Adding a device, turning on sync, and the other identities on the
provider open as sheets over home. -->
<script lang="ts">
  import {
    Check,
    ChevronRight,
    Cloud,
    CloudOff,
    Folder,
    GitBranch,
    HardDrive,
    KeyRound,
    Laptop,
    LoaderCircle,
    Monitor,
    Play,
    Plus,
    Smartphone,
    Usb,
    X,
  } from '@lucide/svelte'
  import { fly } from 'svelte/transition'
  import IdentityRow from './IdentityRow.svelte'
  import Sheet from './Sheet.svelte'
  import Sigil from './Sigil.svelte'
  import type { IdentityFlow } from './flow.svelte'
  import { KeyKind, ProviderKind, Standing, Step, linkCode, providers, type Provider } from './model'
  import { ui } from './ui'

  let { flow }: { flow: IdentityFlow } = $props()

  /** Adding a phone or computer: the sheet shows what to do on it. */
  let inviting = $state(false)
  let tapping = $state(false)

  const deviceIcons: Record<KeyKind, typeof Monitor> = {
    [KeyKind.Browser]: Monitor,
    [KeyKind.Laptop]: Laptop,
    [KeyKind.Phone]: Smartphone,
    [KeyKind.SecurityKey]: Usb,
  }
  const providerIcons: Record<ProviderKind, typeof Monitor> = {
    [ProviderKind.Drive]: HardDrive,
    [ProviderKind.ICloud]: Cloud,
    [ProviderKind.GitHub]: GitBranch,
    [ProviderKind.Folder]: Folder,
  }
  const ProviderIcon = $derived(providerIcons[flow.providerKind])
  const others = $derived(flow.others())

  function close(): void {
    inviting = false
    flow.go(Step.Home)
  }

  function sync(provider: Provider): void {
    flow.connect(provider)
    flow.go(flow.onProvider.length > 0 ? Step.More : Step.Home)
  }

  async function addSecurityKey(): Promise<void> {
    tapping = true
    await new Promise((resolve) => setTimeout(resolve, 700))
    tapping = false
    flow.addKey({ id: `key_security_${flow.keys.length}`, kind: KeyKind.SecurityKey, device: 'Security key', here: false })
    flow.go(Step.Home)
  }

  function deviceAsks(): void {
    inviting = false
    flow.deviceAsks()
    flow.go(Step.Home)
  }
</script>

<div class="flex-1 overflow-y-auto px-5 pb-8">
  <header class="flex items-center gap-4 pt-2 pb-6">
    <Sigil words={flow.words} size={72} reveal />
    <div class="min-w-0">
      <h1 class="truncate text-[24px] font-semibold tracking-tight">{flow.name}</h1>
      <p class={ui.words}>{flow.words}</p>
    </div>
  </header>

  {#each flow.requests as key (key.id)}
    <div class="{ui.notice} mb-px" in:fly={{ y: -8, duration: 220 }}>
      <Smartphone class="size-4 shrink-0 text-[#d2b07a]" aria-hidden="true" />
      <div class="min-w-0 flex-1">
        <p class="truncate text-[15px] font-medium">{key.device} wants in</p>
        <p class="font-mono text-[12px] tracking-[0.12em] text-[#d2b07a]">{linkCode}</p>
      </div>
      <button type="button" class={ui.actionOk} onclick={() => flow.answer(key, true)}>Approve</button>
      <button type="button" class="grid size-8 shrink-0 place-items-center text-[#80858c] transition hover:text-[#e9e8e4]" aria-label="Deny {key.device}" onclick={() => flow.answer(key, false)}>
        <X class="size-4" aria-hidden="true" />
      </button>
    </div>
  {/each}

  <section class="mt-5">
    <p class="{ui.label} mb-2">Devices</p>
    <ul class="flex flex-col gap-px">
      {#each flow.keys as key (key.id)}
        {@const Icon = deviceIcons[key.kind]}
        <li class={ui.row} in:fly={{ y: -6, duration: 220 }}>
          <Icon class="size-4 shrink-0 text-[#a4a8ae]" aria-hidden="true" />
          <span class="flex-1 truncate text-[15px]">{key.device}</span>
          {#if key.here}<span class={ui.label}>this one</span>{/if}
        </li>
      {/each}
      <li>
        <button type="button" class="{ui.row} {ui.rowButton} text-[#a4a8ae]" onclick={() => flow.go(Step.AddDevice)}>
          <Plus class="size-4 shrink-0" aria-hidden="true" />
          <span class="flex-1 text-[15px]">Add device</span>
        </button>
      </li>
    </ul>
  </section>

  <section class="mt-6">
    <p class="{ui.label} mb-2">Sync</p>
    {#if !flow.provider}
      <div class={ui.notice}>
        <CloudOff class="size-4 shrink-0 text-[#d2b07a]" aria-hidden="true" />
        <span class="flex-1 text-[15px]">Only on this browser</span>
        <button type="button" class={ui.action} onclick={() => flow.go(Step.Sync)}>Turn on</button>
      </div>
    {:else}
      <ul class="flex flex-col gap-px">
        <li class={ui.row}>
          <ProviderIcon class="size-4 shrink-0 text-[#a4a8ae]" aria-hidden="true" />
          <span class="flex-1 truncate text-[15px]">{flow.provider}</span>
          {#if flow.saved}
            <span class="inline-flex items-center gap-1.5 text-[13px] text-[#9cc3a4]"><Check class="size-3.5" aria-hidden="true" /> Synced</span>
          {:else}
            <button type="button" class={ui.action} onclick={() => (flow.saved = true)}>Save {flow.name} here</button>
          {/if}
        </li>
        {#if others.length > 0}
          <li>
            <button type="button" class="{ui.row} {ui.rowButton}" onclick={() => flow.go(Step.More)}>
              <span class="flex gap-1">
                {#each others as identity (identity.id)}
                  <Sigil words={identity.words} size={26} locked={flow.standing(identity) !== Standing.Yours} />
                {/each}
              </span>
              <span class="flex-1 text-[15px]">{others.length} more here</span>
              <ChevronRight class="size-4 text-[#5d6268]" aria-hidden="true" />
            </button>
          </li>
        {/if}
      </ul>
    {/if}
  </section>
</div>

{#if flow.step === Step.Sync}
  <Sheet title="Sync with" onClose={close}>
    <div class="grid grid-cols-2 gap-px">
      {#each providers as provider (provider.kind)}
        {@const Icon = providerIcons[provider.kind]}
        <button type="button" class={ui.tile} onclick={() => sync(provider)}>
          <Icon class="size-5 text-[#a4a8ae]" aria-hidden="true" />
          {provider.name}
        </button>
      {/each}
    </div>
  </Sheet>
{:else if flow.step === Step.More}
  <Sheet title="In {flow.provider}" onClose={close}>
    {#if others.length > 0}
      <ul class="flex flex-col gap-px">
        {#each others as identity (identity.id)}
          <IdentityRow {flow} {identity} importing={false} />
        {/each}
      </ul>
    {:else}
      <p class="text-[14px] text-[#80858c]">Nothing else here.</p>
    {/if}
    {#if !flow.saved}
      <button type="button" class="{ui.primary} mt-6" onclick={() => (flow.saved = true)}>Save {flow.name} here</button>
    {/if}
  </Sheet>
{:else if flow.step === Step.AddDevice}
  <Sheet title="Add device" onClose={close}>
    {#if inviting}
      <ol class="flex flex-col gap-px">
        <li class={ui.row}><span class="font-mono text-[12px] text-[#5d6268]">1</span><span class="text-[15px]">Open Nook on it</span></li>
        <li class={ui.row}><span class="font-mono text-[12px] text-[#5d6268]">2</span><span class="text-[15px]">Import from {flow.provider}</span></li>
        <li class={ui.row}>
          <span class="font-mono text-[12px] text-[#5d6268]">3</span>
          <span class="flex-1 text-[15px]">Pick this one</span>
          <Sigil words={flow.words} size={32} />
        </li>
      </ol>
      <button type="button" class="{ui.sim} mt-6" onclick={deviceAsks}>
        <Play class="size-3" aria-hidden="true" /> simulate: the device asks
      </button>
    {:else}
      <ul class="flex flex-col gap-px">
        <li>
          <button
            type="button"
            class="{ui.row} {ui.rowButton} disabled:cursor-not-allowed disabled:text-[#5d6268] disabled:hover:bg-[#1a1d20]"
            disabled={!flow.provider}
            onclick={() => (inviting = true)}
          >
            <Smartphone class="size-4 shrink-0 text-[#a4a8ae]" aria-hidden="true" />
            <span class="flex-1 text-[15px]">Phone or computer</span>
            {#if flow.provider}
              <ChevronRight class="size-4 text-[#5d6268]" aria-hidden="true" />
            {:else}
              <span class="font-mono text-[11px] tracking-wide text-[#d2b07a] uppercase">needs sync</span>
            {/if}
          </button>
        </li>
        <li>
          <button type="button" class="{ui.row} {ui.rowButton}" disabled={tapping} onclick={addSecurityKey}>
            <Usb class="size-4 shrink-0 text-[#a4a8ae]" aria-hidden="true" />
            <span class="flex-1 text-[15px]">Security key</span>
            {#if tapping}
              <LoaderCircle class="size-4 animate-spin text-[#8fa3c0]" aria-label="Waiting for your passkey" />
            {:else}
              <KeyRound class="size-4 text-[#5d6268]" aria-hidden="true" />
            {/if}
          </button>
        </li>
      </ul>
    {/if}
  </Sheet>
{/if}
