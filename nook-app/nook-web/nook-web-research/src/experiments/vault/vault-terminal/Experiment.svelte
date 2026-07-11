<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { Check, CornerDownLeft, KeyRound, Terminal } from '@lucide/svelte'
  import ExperimentBack from '$lib/components/ExperimentBack.svelte'
  import type { ExperimentProps } from '../../index'

  type WizardStep =
    | 'name'
    | 'total'
    | 'threshold'
    | 'device-name'
    | 'public-key'
    | 'confirm'
    | 'sealed'

  interface ParticipantDevice {
    name: string
    publicKey: string
  }

  interface Line {
    text: string
    tone: 'muted' | 'success' | 'error' | 'answer' | 'accent'
  }

  let { navigate }: ExperimentProps = $props()
  let step = $state<WizardStep>('name')
  let promptValue = $state('')
  let name = $state('')
  let total = $state(3)
  let threshold = $state(2)
  let participants = $state<ParticipantDevice[]>([])
  let pendingDeviceName = $state('')
  let choiceIndex = $state(1)
  let outputElement = $state<HTMLDivElement>()
  let inputElement = $state<HTMLInputElement>()
  let choiceElement = $state<HTMLElement>()

  const rosterCount = $derived(1 + participants.length)
  const choices = $derived(
    step === 'total'
      ? [2, 3, 4, 5]
      : step === 'threshold'
        ? Array.from({ length: total - 1 }, (_, index) => index + 2)
        : [],
  )
  const workflowStage = $derived(
    step === 'name'
      ? 1
      : step === 'total' || step === 'threshold'
        ? 2
        : step === 'device-name' || step === 'public-key'
          ? 3
          : step === 'confirm'
            ? 4
            : 5,
  )
  const promptLabel = $derived(
    step === 'name'
      ? 'Vault name'
      : step === 'device-name'
        ? `Name participant device ${String(participants.length + 2).padStart(2, '0')}`
        : `Public key for ${pendingDeviceName}`,
  )

  const openingLines: Line[] = [
    { text: 'NOOK NEXUS INIT v0.3.0', tone: 'accent' },
    {
      text: 'Guided threshold-vault setup. No commands required.',
      tone: 'muted',
    },
    {
      text: 'This device is already included as Participant 01.',
      tone: 'success',
    },
  ]
  let lines = $state<Line[]>([...openingLines])

  function write(text: string, tone: Line['tone'] = 'muted') {
    lines = [...lines, { text, tone }]
  }

  function shortKey(value: string) {
    return value.length > 28
      ? `${value.slice(0, 13)}…${value.slice(-10)}`
      : value
  }

  async function focusPrompt() {
    await tick()
    if (step === 'name' || step === 'device-name' || step === 'public-key') {
      inputElement?.focus()
    } else {
      choiceElement?.focus()
    }
    if (outputElement) outputElement.scrollTop = outputElement.scrollHeight
  }

  async function submitText() {
    const value = promptValue.trim()
    if (!value) return

    if (step === 'name') {
      name = value
      write(`◆ Vault name  ${name}`, 'answer')
      write('Draft created in volatile memory. No vault exists yet.', 'muted')
      step = 'total'
      choiceIndex = 1
    } else if (step === 'device-name') {
      if (
        participants.some(
          (participant) =>
            participant.name.toLocaleLowerCase() === value.toLocaleLowerCase(),
        )
      ) {
        write('Name already used. Choose a distinct device label.', 'error')
        promptValue = ''
        await focusPrompt()
        return
      }
      pendingDeviceName = value
      write(
        `◆ Participant ${String(participants.length + 2).padStart(2, '0')}  ${pendingDeviceName}`,
        'answer',
      )
      step = 'public-key'
    } else if (step === 'public-key') {
      if (
        value === 'pk_local_a9f2…91cc' ||
        participants.some((participant) => participant.publicKey === value)
      ) {
        write('Public key already belongs to another participant.', 'error')
        promptValue = ''
        await focusPrompt()
        return
      }
      participants = [
        ...participants,
        { name: pendingDeviceName, publicKey: value },
      ]
      write(`✓ Key verified  ${shortKey(value)}`, 'success')
      pendingDeviceName = ''
      if (participants.length < total - 1) {
        write(
          `${total - 1 - participants.length} participant device(s) remaining.`,
          'muted',
        )
        step = 'device-name'
      } else {
        write(
          `ROSTER COMPLETE  ${total}/${total} verified public keys`,
          'accent',
        )
        step = 'confirm'
      }
    }

    promptValue = ''
    await focusPrompt()
  }

  async function confirmChoice() {
    const value = choices[choiceIndex]
    if (value === undefined) return
    if (step === 'total') {
      total = value
      write(`◆ Total participants  ${total}`, 'answer')
      step = 'threshold'
      choiceIndex = 0
    } else if (step === 'threshold') {
      threshold = value
      write(`◆ Unlock threshold  ${threshold}-of-${total}`, 'answer')
      write(`Collect ${total - 1} external participant public key(s).`, 'muted')
      step = 'device-name'
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
    write('VERIFYING PARTICIPANT ROSTER .... OK', 'muted')
    write(`SPLITTING ROOT ${threshold}-OF-${total} ........ OK`, 'muted')
    write('ENCRYPTING MEMBER SHARES ....... OK', 'muted')
    write(`VAULT SEALED  ${name}`, 'success')
    step = 'sealed'
    await focusPrompt()
  }

  async function restart() {
    step = 'name'
    promptValue = ''
    name = ''
    total = 3
    threshold = 2
    participants = []
    pendingDeviceName = ''
    choiceIndex = 1
    lines = [...openingLines]
    await focusPrompt()
  }

  onMount(() => {
    inputElement?.focus()
  })
</script>

<main
  class="min-h-screen bg-[#090b09] p-4 pt-20 font-mono text-[#b7ff95] sm:p-10 sm:pt-24"
>
  <ExperimentBack {navigate} />
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
      <span>nook://nexus/genesis — guided setup</span><span>SLIP_0039</span>
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
              class:mt-3={line.tone === 'answer'}
              class:text-[#d4ffc7]={line.tone === 'answer'}
              class:text-[#83e273]={line.tone === 'success'}
              class:text-[#ff8d75]={line.tone === 'error'}
              class:text-[#d9c365]={line.tone === 'accent'}
              class:text-[#6f9f65]={line.tone === 'muted'}
              class="whitespace-pre-wrap"
            >
              {line.text}
            </p>{/each}
          {#if step === 'confirm'}<div
              class="mt-7 border border-[#4f7a46] bg-[#081008] p-5"
            >
              <p class="text-[#d9c365]">REVIEW GENESIS</p>
              <p class="mt-3">{name} · {threshold}-of-{total}</p>
              <p class="text-[#6f9f65]">Participant 01 · This device</p>
              {#each participants as participant, index}<p
                  class="text-[#6f9f65]"
                >
                  Participant {String(index + 2).padStart(2, '0')} · {participant.name}
                  · {shortKey(participant.publicKey)}
                </p>{/each}
            </div>{/if}
          {#if step === 'sealed'}<div
              class="mt-7 border border-[#83e273] bg-[#0c190b] p-5 text-[#a5f58f]"
            >
              <p class="flex items-center gap-2 font-bold">
                <Check class="size-4" /> NEXUS VAULT SEALED
              </p>
              <p class="mt-2 text-xs">
                {name} · {threshold}-of-{total} · {total} encrypted share packages
                ready
              </p>
            </div>{/if}
          <div class="mt-7">
            {#if step === 'name' || step === 'device-name' || step === 'public-key'}
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
                    placeholder={step === 'public-key'
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
            {:else if step === 'total' || step === 'threshold'}
              <div
                bind:this={choiceElement}
                tabindex="0"
                role="listbox"
                aria-label={step === 'total'
                  ? 'Total participant devices'
                  : 'Unlock threshold'}
                class="outline-none"
                onkeydown={moveChoice}
              >
                <p>
                  <span class="text-[#83e273]">?</span>
                  {step === 'total'
                    ? 'How many total participant devices?'
                    : 'How many shares are needed to unlock?'}
                </p>
                <div class="mt-3 flex flex-wrap gap-2">
                  {#each choices as choice, index}<button
                      role="option"
                      aria-selected={choiceIndex === index}
                      class={`border px-4 py-2 text-xs ${choiceIndex === index ? 'border-[#83e273] bg-[#11200f] text-[#d4ffc7]' : 'border-[#22321f] text-[#5e8955]'}`}
                      onclick={() => {
                        choiceIndex = index
                        void confirmChoice()
                      }}
                      ><span class="mr-2"
                        >{choiceIndex === index ? '❯' : ' '}</span
                      >{choice}{step === 'total'
                        ? ' devices'
                        : ` of ${total}`}</button
                    >{/each}
                </div>
                <p class="mt-3 text-[9px] text-[#385334]">
                  ↑↓ navigate · enter select
                </p>
              </div>
            {:else if step === 'confirm'}
              <div class="flex flex-wrap items-center justify-between gap-4">
                <p>
                  <span class="text-[#83e273]">?</span> Seal this Nexus vault?
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
                  onclick={restart}>Create another Nexus</button
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
              class={`mt-1 ${step === 'sealed' ? 'text-[#83e273]' : 'text-[#d9c365]'}`}
            >
              {step === 'sealed' ? 'SEALED' : 'DOES NOT EXIST'}
            </dd>
          </div>
        </dl>
        <div class="mt-8 border-t border-[#22321f] pt-5">
          <p class="text-[#456440]">WORKFLOW</p>
          <ol class="mt-4 space-y-4">
            {#each ['Name draft', 'Set N / K', 'Collect public keys', 'Seal vault'] as item, index}<li
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
</main>
