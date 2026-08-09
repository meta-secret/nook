<script lang="ts">
  import { onMount, tick, untrack } from 'svelte'
  import {
    ArrowLeft,
    Check,
    CornerDownLeft,
    KeyRound,
    Terminal,
  } from '@lucide/svelte'
  import {
    VaultTerminalLineTone,
    VaultTerminalStep,
  } from './vault-terminal-state'

  interface ParticipantDevice {
    name: string
    publicKey: string
  }

  interface Line {
    text: string
    tone: VaultTerminalLineTone
  }

  interface Props {
    onBack: () => void
    initialName?: string
    backLabel?: string
    backPositionClass?: string
  }

  let {
    onBack,
    initialName = '',
    backLabel = 'Auth chooser',
    backPositionClass = 'left-36',
  }: Props = $props()
  const seededName = untrack(() => initialName.trim())
  let step = $state<VaultTerminalStep>(
    seededName ? VaultTerminalStep.Total : VaultTerminalStep.Name,
  )
  let promptValue = $state('')
  let name = $state(seededName)
  let total = $state(3)
  let threshold = $state(2)
  let participants = $state<ParticipantDevice[]>([])
  let pendingDeviceName = $state('')
  let choiceIndex = $state(1)
  let outputElement = $state<HTMLDivElement>()
  let inputElement = $state<HTMLInputElement>()
  let choiceElement = $state<HTMLElement>()

  const rosterCount = $derived(1 + participants.length)
  const choices = $derived.by(() => {
    if (step === VaultTerminalStep.Total) return [2, 3, 4, 5]
    if (step !== VaultTerminalStep.Threshold) return []
    return [...Array<number>(total - 1).keys()].map((index) => index + 2)
  })
  const workflowStage = $derived(
    step === VaultTerminalStep.Name
      ? 1
      : step === VaultTerminalStep.Total || step === VaultTerminalStep.Threshold
        ? 2
        : step === VaultTerminalStep.DeviceName ||
            step === VaultTerminalStep.PublicKey
          ? 3
          : step === VaultTerminalStep.Confirm
            ? 4
            : 5,
  )
  const promptLabel = $derived(
    step === VaultTerminalStep.Name
      ? 'Vault name'
      : step === VaultTerminalStep.DeviceName
        ? `Name participant device ${String(participants.length + 2).padStart(2, '0')}`
        : `Public key for ${pendingDeviceName}`,
  )

  const openingLines: Line[] = [
    {
      text: 'NOOK SENTINEL INIT v0.3.0',
      tone: VaultTerminalLineTone.Accent,
    },
    {
      text: 'Guided threshold-vault setup. No commands required.',
      tone: VaultTerminalLineTone.Muted,
    },
    {
      text: 'This device is already included as Participant 01.',
      tone: VaultTerminalLineTone.Success,
    },
    ...(seededName
      ? ([
          {
            text: `◆ Vault name  ${seededName}`,
            tone: VaultTerminalLineTone.Answer,
          },
          {
            text: 'Name carried from auth workflow. Continue with policy.',
            tone: VaultTerminalLineTone.Muted,
          },
        ] as Line[])
      : []),
  ]
  let lines = $state<Line[]>([...openingLines])

  function write({
    text,
    tone = VaultTerminalLineTone.Muted,
  }: {
    text: string
    tone?: Line['tone']
  }) {
    lines = [...lines, { text, tone }]
  }

  function shortKey(value: string) {
    return value.length > 28
      ? `${value.slice(0, 13)}…${value.slice(-10)}`
      : value
  }

  async function focusPrompt() {
    await tick()
    if (
      step === VaultTerminalStep.Name ||
      step === VaultTerminalStep.DeviceName ||
      step === VaultTerminalStep.PublicKey
    ) {
      inputElement?.focus()
    } else {
      choiceElement?.focus()
    }
    if (outputElement) outputElement.scrollTop = outputElement.scrollHeight
  }

  async function submitText() {
    const value = promptValue.trim()
    if (!value) return

    if (step === VaultTerminalStep.Name) {
      name = value
      const nookNamedArgument188: Parameters<typeof write>[0] = {
        text: `◆ Vault name  ${name}`,
        tone: VaultTerminalLineTone.Answer,
      }
      write(nookNamedArgument188)
      const nookNamedArgument189: Parameters<typeof write>[0] = {
        text: 'Draft created in volatile memory. No vault exists yet.',
        tone: VaultTerminalLineTone.Muted,
      }
      write(nookNamedArgument189)
      step = VaultTerminalStep.Total
      choiceIndex = 1
    } else if (step === VaultTerminalStep.DeviceName) {
      if (
        participants.some(
          (participant) =>
            participant.name.toLocaleLowerCase() === value.toLocaleLowerCase(),
        )
      ) {
        const nookNamedArgument190: Parameters<typeof write>[0] = {
          text: 'Name already used. Choose a distinct device label.',
          tone: VaultTerminalLineTone.Error,
        }
        write(nookNamedArgument190)
        promptValue = ''
        await focusPrompt()
        return
      }
      pendingDeviceName = value
      const nookNamedArgument191: Parameters<typeof write>[0] = {
        text: `◆ Participant ${String(participants.length + 2).padStart(2, '0')}  ${pendingDeviceName}`,
        tone: VaultTerminalLineTone.Answer,
      }
      write(nookNamedArgument191)
      step = VaultTerminalStep.PublicKey
    } else if (step === VaultTerminalStep.PublicKey) {
      if (
        value === 'pk_local_a9f2…91cc' ||
        participants.some((participant) => participant.publicKey === value)
      ) {
        const nookNamedArgument192: Parameters<typeof write>[0] = {
          text: 'Public key already belongs to another participant.',
          tone: VaultTerminalLineTone.Error,
        }
        write(nookNamedArgument192)
        promptValue = ''
        await focusPrompt()
        return
      }
      participants = [
        ...participants,
        { name: pendingDeviceName, publicKey: value },
      ]
      const nookNamedArgument193: Parameters<typeof write>[0] = {
        text: `✓ Key verified  ${shortKey(value)}`,
        tone: VaultTerminalLineTone.Success,
      }
      write(nookNamedArgument193)
      pendingDeviceName = ''
      if (participants.length < total - 1) {
        const nookNamedArgument194: Parameters<typeof write>[0] = {
          text: `${total - 1 - participants.length} participant device(s) remaining.`,
          tone: VaultTerminalLineTone.Muted,
        }
        write(nookNamedArgument194)
        step = VaultTerminalStep.DeviceName
      } else {
        const nookNamedArgument195: Parameters<typeof write>[0] = {
          text: `ROSTER COMPLETE  ${total}/${total} verified public keys`,
          tone: VaultTerminalLineTone.Accent,
        }
        write(nookNamedArgument195)
        step = VaultTerminalStep.Confirm
      }
    }

    promptValue = ''
    await focusPrompt()
  }

  async function confirmChoice() {
    const value = choices[choiceIndex]
    if (!value) return
    if (step === VaultTerminalStep.Total) {
      total = value
      const nookNamedArgument196: Parameters<typeof write>[0] = {
        text: `◆ Total participants  ${total}`,
        tone: VaultTerminalLineTone.Answer,
      }
      write(nookNamedArgument196)
      step = VaultTerminalStep.Threshold
      choiceIndex = 0
    } else if (step === VaultTerminalStep.Threshold) {
      threshold = value
      const nookNamedArgument197: Parameters<typeof write>[0] = {
        text: `◆ Unlock threshold  ${threshold}-of-${total}`,
        tone: VaultTerminalLineTone.Answer,
      }
      write(nookNamedArgument197)
      const nookNamedArgument198: Parameters<typeof write>[0] = {
        text: `Collect ${total - 1} external participant public key(s).`,
        tone: VaultTerminalLineTone.Muted,
      }
      write(nookNamedArgument198)
      step = VaultTerminalStep.DeviceName
    }
    await focusPrompt()
  }

  function moveChoice(event: KeyboardEvent) {
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault()
      choiceIndex = (choiceIndex - 1 + choices.length) % choices.length
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault()
      choiceIndex = (choiceIndex + 1) % choices.length
    } else if (event.key === 'Enter') {
      event.preventDefault()
      void confirmChoice()
    }
  }

  async function sealVault() {
    const nookNamedArgument199: Parameters<typeof write>[0] = {
      text: 'VERIFYING PARTICIPANT ROSTER .... OK',
      tone: VaultTerminalLineTone.Muted,
    }
    write(nookNamedArgument199)
    const nookNamedArgument200: Parameters<typeof write>[0] = {
      text: `SPLITTING ROOT ${threshold}-OF-${total} ........ OK`,
      tone: VaultTerminalLineTone.Muted,
    }
    write(nookNamedArgument200)
    const nookNamedArgument201: Parameters<typeof write>[0] = {
      text: 'ENCRYPTING MEMBER SHARES ....... OK',
      tone: VaultTerminalLineTone.Muted,
    }
    write(nookNamedArgument201)
    const nookNamedArgument202: Parameters<typeof write>[0] = {
      text: `VAULT SEALED  ${name}`,
      tone: VaultTerminalLineTone.Success,
    }
    write(nookNamedArgument202)
    step = VaultTerminalStep.Sealed
    await focusPrompt()
  }

  async function restart() {
    step = seededName ? VaultTerminalStep.Total : VaultTerminalStep.Name
    promptValue = ''
    name = seededName
    total = 3
    threshold = 2
    participants = []
    pendingDeviceName = ''
    choiceIndex = 1
    lines = [...openingLines]
    await focusPrompt()
  }

  onMount(() => {
    void focusPrompt()
  })
</script>

<div
  class="min-h-screen bg-[#090b09] p-4 pt-20 font-mono text-[#b7ff95] sm:p-10 sm:pt-24"
>
  <button
    class={`fixed top-5 ${backPositionClass} z-50 flex h-10 items-center gap-2 rounded-full border border-white/15 bg-black/40 px-4 text-xs font-semibold text-white backdrop-blur-md`}
    onclick={onBack}
  >
    <ArrowLeft class="size-4" aria-hidden="true" />
    {backLabel}
  </button>
  <section
    class="mx-auto max-w-6xl overflow-hidden rounded-xl border border-[#41613b] bg-[#030503] shadow-[0_0_80px_rgb(93_255_103/0.08)]"
  >
    <header
      class="flex items-center justify-between border-b border-[#2d4229] bg-[#101510] px-5 py-3 text-xs"
    >
      <div class="flex gap-2">
        <span class="size-3 rounded-full bg-[#ff5f57]"></span><span
          class="size-3 rounded-full bg-[#febc2e]"
        ></span><span class="size-3 rounded-full bg-[#28c840]"></span>
      </div>
      <span>nook://sentinel/genesis — guided setup</span><span>SLIP_0039</span>
    </header>

    <div class="grid min-h-[44rem] lg:grid-cols-[1fr_18rem]">
      <div class="flex min-w-0 flex-col border-[#22321f] lg:border-r">
        <div
          class="flex items-center gap-3 border-b border-[#22321f] px-6 py-5 text-[#6ca85e]"
        >
          <Terminal class="size-5" /><span
            >INTERACTIVE GENESIS / SESSION 0x7F21</span
          >
        </div>
        <div
          bind:this={outputElement}
          class="min-h-[39rem] flex-1 overflow-y-auto p-6 text-sm leading-7 sm:p-8"
          aria-live="polite"
        >
          {#each lines as line, index (index)}<p
              class:mt-3={line.tone === VaultTerminalLineTone.Answer}
              class:text-[#d4ffc7]={line.tone === VaultTerminalLineTone.Answer}
              class:text-[#83e273]={line.tone === VaultTerminalLineTone.Success}
              class:text-[#ff8d75]={line.tone === VaultTerminalLineTone.Error}
              class:text-[#d9c365]={line.tone === VaultTerminalLineTone.Accent}
              class:text-[#6f9f65]={line.tone === VaultTerminalLineTone.Muted}
              class="whitespace-pre-wrap"
            >
              {line.text}
            </p>{/each}
          {#if step === VaultTerminalStep.Confirm}<div
              class="mt-7 border border-[#4f7a46] bg-[#081008] p-5"
            >
              <p class="text-[#d9c365]">REVIEW GENESIS</p>
              <p class="mt-3">{name} · {threshold}-of-{total}</p>
              <p class="text-[#6f9f65]">Participant 01 · This device</p>
              {#each participants as participant, index (participant.publicKey)}<p
                  class="text-[#6f9f65]"
                >
                  Participant {String(index + 2).padStart(2, '0')} · {participant.name}
                  · {shortKey(participant.publicKey)}
                </p>{/each}
            </div>{/if}
          {#if step === VaultTerminalStep.Sealed}<div
              class="mt-7 border border-[#83e273] bg-[#0c190b] p-5 text-[#a5f58f]"
            >
              <p class="flex items-center gap-2 font-bold">
                <Check class="size-4" /> SENTINEL VAULT SEALED
              </p>
              <p class="mt-2 text-xs">
                {name} · {threshold}-of-{total} · {total} encrypted share packages
                ready
              </p>
            </div>{/if}
          <div class="mt-7">
            {#if step === VaultTerminalStep.Name || step === VaultTerminalStep.DeviceName || step === VaultTerminalStep.PublicKey}
              <form
                onsubmit={(event) => {
                  event.preventDefault()
                  void submitText()
                }}
              >
                <label class="flex items-center gap-3"
                  ><span class="shrink-0 text-[#83e273]">?</span><span
                    class="shrink-0 text-[#a5f58f]">{promptLabel}</span
                  ><span class="text-[#456440]">›</span><input
                    bind:this={inputElement}
                    class="min-w-0 flex-1 bg-transparent text-[#d4ffc7] outline-none placeholder:text-[#385334]"
                    placeholder={step === VaultTerminalStep.PublicKey
                      ? 'paste signed public key'
                      : 'type your answer'}
                    autocomplete="off"
                    bind:value={promptValue}
                    onkeydown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        void submitText()
                      }
                    }}
                  /><button aria-label="Continue" class="text-[#7aaa6f]"
                    ><CornerDownLeft class="size-5" /></button
                  ></label
                >
              </form>
              <p class="mt-2 text-[9px] text-[#385334]">enter to continue</p>
            {:else if step === VaultTerminalStep.Total || step === VaultTerminalStep.Threshold}
              <div
                bind:this={choiceElement}
                tabindex="0"
                role="listbox"
                aria-label={step === VaultTerminalStep.Total
                  ? 'Total participant devices'
                  : 'Unlock threshold'}
                class="outline-none"
                onkeydown={moveChoice}
              >
                <p>
                  <span class="text-[#83e273]">?</span>
                  {step === VaultTerminalStep.Total
                    ? 'How many total participant devices?'
                    : 'How many shares are needed to unlock?'}
                </p>
                <div class="mt-3 flex flex-wrap gap-2">
                  {#each choices as choice, index (choice)}<button
                      role="option"
                      aria-selected={choiceIndex === index}
                      class={`border px-4 py-2 text-xs ${choiceIndex === index ? 'border-[#83e273] bg-[#11200f] text-[#d4ffc7]' : 'border-[#22321f] text-[#5e8955]'}`}
                      onclick={() => {
                        choiceIndex = index
                        void confirmChoice()
                      }}
                      ><span class="mr-2"
                        >{choiceIndex === index ? '❯' : ' '}</span
                      >{choice}{step === VaultTerminalStep.Total
                        ? ' devices'
                        : ` of ${total}`}</button
                    >{/each}
                </div>
                <p class="mt-3 text-[9px] text-[#385334]">
                  ↑↓ navigate · enter select
                </p>
              </div>
            {:else if step === VaultTerminalStep.Confirm}
              <div class="flex flex-wrap items-center justify-between gap-4">
                <p>
                  <span class="text-[#83e273]">?</span> Seal this Sentinel vault?
                </p>
                <button
                  bind:this={choiceElement}
                  class="flex items-center gap-2 border border-[#83e273] bg-[#11200f] px-5 py-3 text-xs text-[#d4ffc7]"
                  onclick={sealVault}
                  onkeydown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void sealVault()
                    }
                  }}><KeyRound class="size-4" /> Seal vault</button
                >
              </div>
            {:else}
              <div class="flex flex-wrap items-center justify-between gap-4">
                <p class="text-[#83e273]">Setup complete.</p>
                <button
                  bind:this={choiceElement}
                  class="border border-[#4f7a46] px-5 py-3 text-xs"
                  onclick={restart}>Create another Sentinel</button
                >
              </div>
            {/if}
          </div>
        </div>
      </div>

      <aside class="flex flex-col bg-[#080b08] p-5 text-xs">
        <p class="text-[#456440]">SESSION STATE</p>
        <dl class="mt-5 space-y-4">
          <div>
            <dt class="text-[#456440]">DRAFT</dt>
            <dd class="mt-1 break-words text-[#a5f58f]">
              {name || 'AWAITING NAME'}
            </dd>
          </div>
          <div>
            <dt class="text-[#456440]">POLICY</dt>
            <dd class="mt-1 text-[#a5f58f]">
              {workflowStage > 2 ? `${threshold}-OF-${total}` : 'PENDING'}
            </dd>
          </div>
          <div>
            <dt class="text-[#456440]">ROSTER</dt>
            <dd class="mt-1 text-[#a5f58f]">{rosterCount}/{total} VERIFIED</dd>
          </div>
          <div>
            <dt class="text-[#456440]">VAULT</dt>
            <dd
              class={`mt-1 ${step === VaultTerminalStep.Sealed ? 'text-[#83e273]' : 'text-[#d9c365]'}`}
            >
              {step === VaultTerminalStep.Sealed ? 'SEALED' : 'DOES NOT EXIST'}
            </dd>
          </div>
        </dl>
        <div class="mt-8 border-t border-[#22321f] pt-5">
          <p class="text-[#456440]">WORKFLOW</p>
          <ol class="mt-4 space-y-4">
            {#each ['Name draft', 'Set N / K', 'Collect public keys', 'Seal vault'] as item, index (item)}<li
                class={`flex items-center gap-3 ${index + 1 < workflowStage ? 'text-[#83e273]' : index + 1 === workflowStage ? 'text-[#d9c365]' : 'text-[#385334]'}`}
              >
                <span
                  class="grid size-5 place-items-center border border-current"
                  >{index + 1 < workflowStage ? '✓' : index + 1}</span
                >{item}
              </li>{/each}
          </ol>
        </div>
        <p class="mt-auto pt-8 text-[9px] leading-4 text-[#385334]">
          Participant devices stay outside this workflow. Only their names and
          signed public keys enter the roster.
        </p>
      </aside>
    </div>
  </section>
</div>
