<!--
DIRECTION: Keyboard-first. The access chain is not drawn, it is queried — a
command line prints structured monospace reports, and `access chain` prints the
whole custody path as ASCII art.
-->
<script lang="ts">
  import ExperimentBack from '$lib/components/ExperimentBack.svelte'
  import ScenarioSwitch from '../_shared/ScenarioSwitch.svelte'
  import {
    CHAIN_STAGES,
    ChainStage,
    deviceKeyEvidence,
    type EvidenceRow,
    factText,
    IdentityState,
    isPrepared,
    passkeyEvidence,
    passkeyRawEvidence,
    relationInto,
    ScenarioId,
    scenarioById,
    stageCaption,
    stageIdentifier,
    stageMeaning,
    stageTitle,
    vaultEvidence,
  } from '../_shared/keys-management-state'
  import type { ExperimentProps } from '../../index'

  interface TranscriptBlock {
    id: number
    prompt: string
    lines: string[]
  }

  const COMMANDS = [
    'access show passkey',
    'access show device-key',
    'access show vaults',
    'access chain',
    'clear',
  ]
  const inputId = 'access-terminal-input'
  const transcriptId = 'access-terminal-transcript'

  let { navigate }: ExperimentProps = $props()
  let scenarioId = $state(ScenarioId.Shared)
  let draft = $state('')
  let history = $state<string[]>([])
  let historyIndex = $state(0)
  let nextId = $state(1)
  const scenario = $derived(scenarioById(scenarioId))
  const prepared = $derived(isPrepared(scenario))
  let transcript = $state<TranscriptBlock[]>([banner()])

  function banner(): TranscriptBlock {
    return {
      id: 0,
      prompt: '',
      lines: [
        'nook access console · reads this browser only',
        `session: ${scenario.protectionLabel} · ${scenario.identityLabel}`,
        '',
        'commands:',
        ...COMMANDS.map((command) => `  ${command}`),
      ],
    }
  }

  function evidenceLines(rows: EvidenceRow[]): string[] {
    return rows.map((row) => `  ${row.label.padEnd(21)}${factText(row.fact)}`)
  }

  function headerLine(stage: ChainStage): string {
    const verb = `──${relationInto(stage)}──▶`
    if (stage === ChainStage.Passkey) return `you ${verb} passkey`
    if (stage === ChainStage.DeviceKey) return `passkey ${verb} device key`
    return `device key ${verb} vaults`
  }

  function stageReport(stage: ChainStage): string[] {
    const rows =
      stage === ChainStage.Passkey
        ? [...passkeyEvidence(scenario), ...passkeyRawEvidence(scenario)]
        : deviceKeyEvidence(scenario)
    return [
      headerLine(stage),
      `  ${'holds'.padEnd(21)}${factText(stageIdentifier(scenario, stage))}`,
      '',
      ...evidenceLines(rows),
      '',
      `note: ${stageMeaning(stage)}`,
    ]
  }

  function vaultReport(): string[] {
    const lines = [
      headerLine(ChainStage.Vaults),
      `  ${'reachable'.padEnd(21)}${factText(stageIdentifier(scenario, ChainStage.Vaults))}`,
    ]
    if (scenario.vaults.length === 0) {
      lines.push('', '  this browser has not opened any vault')
    } else {
      scenario.vaults.forEach((vault) => {
        lines.push('', `  ${vault.label}  [${vault.trust}]`)
        lines.push(...evidenceLines(vaultEvidence(vault)))
      })
    }
    lines.push('', `note: ${stageMeaning(ChainStage.Vaults)}`)
    return lines
  }

  function chainArt(): string[] {
    const bar = prepared ? '─' : '╌'
    const stem = prepared ? '│' : '╎'
    const lines: string[] = []
    CHAIN_STAGES.forEach((stage, index) => {
      if (index === 0) {
        lines.push(`  ┌${bar.repeat(13)}┐`)
      } else {
        lines.push(`        ${stem}`)
        lines.push(
          `        ${stem}  ${relationInto(stage)}${prepared ? '' : ' — not yet'}`,
        )
        lines.push(`  ┌${bar.repeat(5)}▼${bar.repeat(7)}┐`)
      }
      lines.push(
        `  │ ${stageCaption(stage).padEnd(11)} │  ${stageTitle(scenario, stage)}`,
      )
      lines.push(
        index === CHAIN_STAGES.length - 1
          ? `  └${bar.repeat(13)}┘`
          : `  └${bar.repeat(5)}┬${bar.repeat(7)}┘`,
      )
    })
    return lines
  }

  function outputFor(command: string): string[] {
    if (command === 'access show passkey')
      return stageReport(ChainStage.Passkey)
    if (command === 'access show device-key') {
      return stageReport(ChainStage.DeviceKey)
    }
    if (command === 'access show vaults') return vaultReport()
    if (command === 'access chain') return chainArt()
    return [`unknown command: ${command}`, `try: ${COMMANDS.join(' · ')}`]
  }

  function run(raw: string) {
    const command = raw.trim().toLowerCase().replace(/\s+/g, ' ')
    if (command.length === 0) return
    history = [...history, command]
    historyIndex = history.length
    draft = ''
    if (command === 'clear') {
      transcript = [banner()]
      nextId = 1
      return
    }
    transcript = [
      ...transcript,
      { id: nextId, prompt: command, lines: outputFor(command) },
    ]
    nextId += 1
  }

  function joinLines(lines: string[]): string {
    return lines.join('\n')
  }

  function historyAt(index: number): string {
    const [entry] = history.slice(index, index + 1)
    return entry ? entry : ''
  }

  function onKey(event: KeyboardEvent) {
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      historyIndex = Math.max(0, historyIndex - 1)
      draft = historyAt(historyIndex)
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      historyIndex = Math.min(history.length, historyIndex + 1)
      draft = historyIndex === history.length ? '' : historyAt(historyIndex)
    }
  }

  function focusInput() {
    const node = document.getElementById(inputId)
    if (node instanceof HTMLInputElement) node.focus()
  }

  $effect(() => {
    const count = transcript.length
    const frame = requestAnimationFrame(() => {
      const node = document.getElementById(transcriptId)
      if (node instanceof HTMLElement && count > 0) {
        node.scrollTop = node.scrollHeight
      }
    })
    return () => cancelAnimationFrame(frame)
  })
</script>

<main class="min-h-[100svh] bg-[#14110c] text-[#e8dcc4]">
  <ExperimentBack {navigate} />
  <ScenarioSwitch
    {scenario}
    onScenario={(next) => {
      scenarioId = next
      history = []
      historyIndex = 0
      nextId = 1
      transcript = [banner()]
    }}
  />

  <section class="mx-auto max-w-3xl px-4 py-20 sm:px-6">
    <p class="font-mono text-[11px] tracking-[0.28em] text-[#8a7c66] uppercase">
      Devices &amp; access
    </p>

    <div
      class="mt-6 overflow-hidden rounded-lg border border-[#3a3020] bg-[#0f0d09] shadow-[0_24px_60px_rgb(0_0_0/0.45)]"
    >
      <div
        class="flex items-center gap-3 border-b border-[#3a3020] bg-[#191510] px-4 py-2.5"
      >
        <span class="flex gap-1.5" aria-hidden="true">
          <span class="size-2.5 rounded-full bg-[#4a3f2c]"></span>
          <span class="size-2.5 rounded-full bg-[#4a3f2c]"></span>
          <span class="size-2.5 rounded-full bg-[#4a3f2c]"></span>
        </span>
        <span class="font-mono text-[11px] text-[#8a7c66]">
          access@this-browser
        </span>
        <span class="ml-auto flex items-center gap-2 font-mono text-[10px]">
          <span
            class={`size-1.5 rounded-full ${scenario.identity === IdentityState.Unlocked ? 'bg-[#e0a458]' : 'bg-[#5d5340]'}`}
            aria-hidden="true"
          ></span>
          <span class="tracking-[0.16em] uppercase"
            >{scenario.identityLabel}</span
          >
        </span>
      </div>

      <div
        id={transcriptId}
        role="log"
        aria-live="polite"
        aria-label="Access command output"
        class="h-[24rem] overflow-y-auto px-4 py-4 sm:h-[28rem]"
      >
        {#each transcript as block (block.id)}
          <div class="mb-4">
            {#if block.prompt.length > 0}
              <p class="font-mono text-[11px] text-[#e0a458] sm:text-xs">
                access ▸ {block.prompt}
              </p>
            {/if}
            <pre
              class="mt-1 font-mono text-[11px] leading-5 break-words whitespace-pre-wrap text-[#cbbfa7] sm:text-xs">{joinLines(
                block.lines,
              )}</pre>
          </div>
        {/each}
      </div>

      <div class="border-t border-[#3a3020] bg-[#12100b] px-4 py-3">
        <div
          class="flex flex-wrap gap-1.5"
          role="group"
          aria-label="Suggested commands"
        >
          {#each COMMANDS as command (command)}
            <button
              type="button"
              class="rounded border border-[#3a3020] px-2 py-1 font-mono text-[10px] text-[#a8977a] transition hover:border-[#e0a458] hover:text-[#e8dcc4]"
              onclick={() => {
                run(command)
                focusInput()
              }}
            >
              {command}
            </button>
          {/each}
        </div>

        <form
          class="mt-3 flex items-center gap-2 border-t border-[#241e15] pt-3"
          onsubmit={(event) => {
            event.preventDefault()
            run(draft)
          }}
        >
          <label for={inputId} class="sr-only">Access command</label>
          <span class="font-mono text-xs text-[#e0a458]" aria-hidden="true">
            access ▸
          </span>
          <input
            id={inputId}
            bind:value={draft}
            onkeydown={onKey}
            autocomplete="off"
            spellcheck="false"
            placeholder="type a command, ↑ ↓ for history"
            class="min-w-0 flex-1 bg-transparent font-mono text-xs text-[#e8dcc4] outline-none placeholder:text-[#6b6047]"
          />
          <button
            type="submit"
            class="rounded border border-[#3a3020] px-3 py-1 font-mono text-[10px] tracking-[0.16em] text-[#a8977a] uppercase transition hover:border-[#e0a458] hover:text-[#e8dcc4]"
          >
            Run
          </button>
        </form>
      </div>
    </div>

    <p class="mt-5 max-w-xl font-mono text-[11px] leading-5 text-[#7d7159]">
      Every report is read locally. The passkey itself never reaches this
      console — only the fingerprint Nook stored to recognize it again.
    </p>
  </section>
</main>
