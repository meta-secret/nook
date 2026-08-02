<!--
DIRECTION: The chain read as a story of hand-offs. Three full-height acts —
passkey manager, this browser, your vaults — each stating what that actor is
trusted to do and what it is never trusted to do. A slim rail tracks the act you
are reading via IntersectionObserver and lets you jump between them.
-->
<script lang="ts">
  import { ArrowDown } from '@lucide/svelte'
  import ExperimentBack from '$lib/components/ExperimentBack.svelte'
  import ScenarioSwitch from '../_shared/ScenarioSwitch.svelte'
  import {
    type AccessScenario,
    CHAIN_STAGES,
    ChainStage,
    type Fact,
    FactKind,
    factText,
    isPrepared,
    known,
    notObserved,
    relationInto,
    ScenarioId,
    scenarioById,
    stageCaption,
    verifiedSummary,
    verifiedVaults,
  } from '../_shared/keys-management-state'
  import type { ExperimentProps } from '../../index'

  interface Act {
    stage: ChainStage
    numeral: string
    actor: string
    statement: string
    identifier: Fact
    identifierLabel: string
    trusted: string
    withheld: string
  }

  const NUMERALS = ['I', 'II', 'III']
  const ACCENT = '#ff6b3d'

  let { navigate }: ExperimentProps = $props()
  let scenarioId = $state(ScenarioId.Unlocked)
  let activeAct = $state(ChainStage.Passkey)
  const scenario = $derived(scenarioById(scenarioId))
  const prepared = $derived(isPrepared(scenario))
  const acts = $derived(
    CHAIN_STAGES.map((stage, index) => actFor(scenario, stage, index)),
  )

  function passkeyAct(access: AccessScenario, numeral: string): Act {
    const ready = isPrepared(access)
    return {
      stage: ChainStage.Passkey,
      numeral,
      actor: ready
        ? factText(access.passkey.savedIn)
        : 'No passkey manager yet',
      statement: ready
        ? 'Your passkey manager proves it is you, then keeps the passkey.'
        : 'Nobody has handed anything over yet.',
      identifier: access.passkey.fingerprint,
      identifierLabel: 'Fingerprint Nook keeps',
      trusted: ready
        ? `Trusted to hold the passkey and sign for it when you ask. ${access.passkey.backupState}.`
        : 'Trusted with nothing so far. You choose the manager when you prepare this browser.',
      withheld: ready
        ? 'Never trusted to hand the passkey itself to Nook. Nook stores only the short fingerprint above, enough to recognise the same passkey again.'
        : 'Nook will still never receive the passkey — only a fingerprint of it.',
    }
  }

  function deviceAct(access: AccessScenario, numeral: string): Act {
    const ready = isPrepared(access)
    return {
      stage: ChainStage.DeviceKey,
      numeral,
      actor: `${access.device.browser} · ${access.device.platform}`,
      statement: ready
        ? 'This browser turns that signature into a key only it holds.'
        : 'This browser holds no key, so it can decrypt nothing.',
      identifier: access.device.id,
      identifierLabel: 'Device key',
      trusted: ready
        ? `Trusted to derive the device key and decrypt vault data here. Prepared ${factText(access.device.preparedAt)}.`
        : 'Trusted to derive a device key the first time a passkey unlocks it here.',
      withheld: `Never trusted to move that key anywhere else. ${access.device.boundary}`,
    }
  }

  function vaultAct(access: AccessScenario, numeral: string): Act {
    const verified = verifiedVaults(access)
    const names = verified.map((vault) => vault.label).join(', ')
    return {
      stage: ChainStage.Vaults,
      numeral,
      actor: verified.length === 0 ? 'No vault opened from here' : names,
      statement:
        verified.length === 0
          ? 'No vault has been opened by this key, so none is proven reachable.'
          : 'The key opens the vaults it has already opened, and nothing else.',
      identifier:
        access.vaults.length === 0
          ? notObserved('Nothing opened from here yet')
          : known(verifiedSummary(access)),
      identifierLabel: 'Proven from this browser',
      trusted:
        verified.length === 0
          ? 'Trusted to stay closed. A vault admits a key only after that key has been verified against it.'
          : 'Trusted to open for this device key, because it already has. Backup passwords stay wrapped in this browser.',
      withheld:
        access.vaults.length === verified.length
          ? 'Never trusted to count as reachable on a browser that has not opened it.'
          : `Never trusted on faith: ${access.vaults.length - verified.length} vault listed here has never been opened by this key, so it stays unverified.`,
    }
  }

  function actFor(
    access: AccessScenario,
    stage: ChainStage,
    index: number,
  ): Act {
    const numeral = NUMERALS[index]
    if (stage === ChainStage.Passkey) return passkeyAct(access, numeral)
    if (stage === ChainStage.DeviceKey) return deviceAct(access, numeral)
    return vaultAct(access, numeral)
  }

  function jumpTo(stage: ChainStage) {
    const panel = document.getElementById(`act-${stage}`)
    if (!panel) return
    const reduced = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches
    panel.scrollIntoView({
      behavior: reduced ? 'auto' : 'smooth',
      block: 'start',
    })
  }

  $effect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const key = (entry.target as HTMLElement).dataset.act
          const match = CHAIN_STAGES.find((stage) => `${stage}` === key)
          if (match) activeAct = match
        }
      },
      { rootMargin: '-45% 0px -45% 0px', threshold: 0 },
    )
    document
      .querySelectorAll('[data-act]')
      .forEach((panel) => observer.observe(panel))
    return () => observer.disconnect()
  })
</script>

<main class="min-h-[100svh] bg-[#08090a] text-[#f4f3f0]">
  <ExperimentBack {navigate} />
  <ScenarioSwitch {scenario} onScenario={(next) => (scenarioId = next)} />

  <nav
    class="fixed top-1/2 left-3 z-40 -translate-y-1/2 sm:left-6"
    aria-label="Acts"
  >
    <ol class="space-y-5">
      {#each acts as act (act.stage)}
        {@const active = activeAct === act.stage}
        <li>
          <button
            type="button"
            class="group flex items-center gap-3 py-2 pr-2 text-left"
            aria-current={active ? 'step' : false}
            onclick={() => jumpTo(act.stage)}
          >
            <span
              class={`block w-px transition-all duration-300 motion-reduce:transition-none ${active ? 'h-10' : 'h-5'}`}
              style={`background:${active ? ACCENT : '#4a4a48'}`}
              aria-hidden="true"
            ></span>
            <span
              class={`hidden font-mono text-[10px] tracking-[0.2em] uppercase transition sm:block motion-reduce:transition-none ${active ? 'text-[#f4f3f0]' : 'text-[#6d6d6a] group-hover:text-[#a5a5a1]'}`}
            >
              {act.numeral} · {stageCaption(act.stage)}
            </span>
          </button>
        </li>
      {/each}
    </ol>
  </nav>

  {#each acts as act, index (act.stage)}
    {@const last = index === acts.length - 1}
    <section
      id={`act-${act.stage}`}
      data-act={act.stage}
      class={`flex min-h-[100svh] flex-col justify-center border-t py-24 pr-6 pl-14 sm:pr-20 sm:pl-48 lg:pr-32 lg:pl-56 ${index === 0 ? 'border-transparent' : 'border-[#1e1f21]'}`}
    >
      <p
        class="font-mono text-[10px] tracking-[0.32em] uppercase"
        style={`color:${ACCENT}`}
      >
        Act {act.numeral} · {stageCaption(act.stage)}
      </p>

      <h2
        class="mt-6 max-w-4xl text-[2rem] leading-[1.12] font-medium tracking-[-0.03em] break-words sm:text-5xl lg:text-6xl"
      >
        {act.statement}
      </h2>

      <div
        class={`mt-10 max-w-xl border-l-2 pl-5 ${prepared ? 'border-[#3a3b3d]' : 'border-dashed border-[#3a3b3d]'}`}
      >
        <p class="text-lg leading-7 break-words sm:text-xl">{act.actor}</p>
        <p
          class="mt-4 font-mono text-[10px] tracking-[0.2em] text-[#6d6d6a] uppercase"
        >
          {act.identifierLabel}
        </p>
        {#if act.identifier.kind === FactKind.Known}
          <p class="mt-1.5 font-mono text-sm break-all text-[#c9c8c4]">
            {act.identifier.value}
          </p>
        {:else}
          <p class="mt-1.5 text-sm text-[#6d6d6a] italic">
            {act.identifier.reason}
          </p>
        {/if}
      </div>

      <dl class="mt-12 grid max-w-4xl gap-8 sm:grid-cols-2">
        <div>
          <dt
            class="font-mono text-[10px] tracking-[0.2em] uppercase"
            style={`color:${ACCENT}`}
          >
            Trusted to
          </dt>
          <dd class="mt-3 text-base leading-7 text-[#dcdbd7]">{act.trusted}</dd>
        </div>
        <div>
          <dt
            class="font-mono text-[10px] tracking-[0.2em] text-[#6d6d6a] uppercase"
          >
            Never trusted to
          </dt>
          <dd class="mt-3 text-base leading-7 text-[#9d9c98]">
            {act.withheld}
          </dd>
        </div>
      </dl>

      {#if last}
        <p class="mt-14 max-w-xl text-sm leading-6 text-[#6d6d6a]">
          Three hand-offs, three separate custodians. No single one of them can
          read your data alone.
        </p>
      {:else}
        {@const nextAct = acts[index + 1]}
        <button
          type="button"
          class="mt-14 flex items-center gap-3 self-start font-mono text-[11px] tracking-[0.18em] text-[#6d6d6a] uppercase transition hover:text-[#f4f3f0] motion-reduce:transition-none"
          onclick={() => jumpTo(nextAct.stage)}
        >
          <ArrowDown class="size-4" aria-hidden="true" />
          {relationInto(nextAct.stage)} · {stageCaption(nextAct.stage)}
        </button>
      {/if}

      {#if !prepared && index === 0}
        <button
          class="mt-10 self-start rounded-full px-6 py-3 text-sm font-medium text-[#08090a] transition hover:opacity-90 motion-reduce:transition-none"
          style={`background:${ACCENT}`}
        >
          Prepare this browser
        </button>
      {/if}
    </section>
  {/each}
</main>
