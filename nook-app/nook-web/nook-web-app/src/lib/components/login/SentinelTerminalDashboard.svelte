<script lang="ts">
  import {
    ArrowLeft,
    Check,
    Copy,
    KeyRound,
    RefreshCw,
    Terminal,
  } from '@lucide/svelte'
  import { tick } from 'svelte'
  import type { StartSentinelGenesisArgs, VaultState } from '$lib/vault.svelte'

  type Status =
    | 'idle'
    | 'collecting'
    | 'ready'
    | 'finalizing'
    | 'delivering'
    | 'complete'

  type Participant = {
    participantId: string
    label: string
    fingerprint: string
  }

  type Delivery = {
    participantId: string
    fingerprint?: string
    payload: string
  }

  type PolicyStep = 'total' | 'threshold' | 'confirm'
  type Tone = 'muted' | 'success' | 'answer' | 'accent'
  type Line = { text: string; tone: Tone }

  let {
    vault,
    name = $bindable(''),
    participantCount = $bindable(3),
    threshold = $bindable(2),
    status,
    request,
    participants,
    deliveries,
    isBusy,
    onBack,
    onStart,
    onAddParticipant,
    onFinalize,
    onCompleteDelivery,
  }: {
    vault: VaultState
    name: string
    participantCount: number
    threshold: number
    status: Status
    request: string
    participants: Participant[]
    deliveries: Delivery[]
    isBusy: boolean
    onBack: () => void
    onStart: (
      args: StartSentinelGenesisArgs,
    ) => boolean | void | Promise<boolean | void>
    onAddParticipant: (payload: string) => void | Promise<void>
    onFinalize: () => void | Promise<void>
    onCompleteDelivery: () => void | Promise<void>
  } = $props()

  let policyStep = $state<PolicyStep>('total')
  let response = $state('')
  let actionBusy = $state(false)
  let copied = $state(false)
  let outputElement = $state<HTMLDivElement>()

  const participantChoices = Array.from({ length: 15 }, (_, index) => index + 2)
  const policyValid = $derived(
    name.trim().length > 0 &&
      Number.isInteger(participantCount) &&
      participantCount >= 2 &&
      participantCount <= 16 &&
      Number.isInteger(threshold) &&
      threshold >= 2 &&
      threshold <= participantCount,
  )
  const rosterCount = $derived(Math.max(1, participants.length))
  const workflowStage = $derived(
    status === 'delivering' || status === 'complete'
      ? 5
      : status === 'ready' || status === 'finalizing'
        ? 4
        : status === 'collecting'
          ? 3
          : policyStep === 'total' || policyStep === 'threshold'
            ? 2
            : 3,
  )
  const policyLines = $derived<Line[]>([
    { text: 'NOOK SENTINEL INIT v0.3.0', tone: 'accent' },
    {
      text: vault.t('login.sentinel_terminal_guided'),
      tone: 'muted',
    },
    {
      text: vault.t('login.sentinel_terminal_device_included'),
      tone: 'success',
    },
    { text: `◆ ${vault.t('login.vault_name_label')}  ${name}`, tone: 'answer' },
    {
      text:
        status === 'idle'
          ? vault.t('login.sentinel_terminal_draft_notice')
          : `${vault.t('login.sentinel_terminal_status')}  ${status.toUpperCase()}`,
      tone: 'muted',
    },
  ])

  async function scrollOutput() {
    await tick()
    if (outputElement) outputElement.scrollTop = outputElement.scrollHeight
  }

  function chooseTotal(value: number) {
    participantCount = value
    threshold = Math.min(threshold, value)
    policyStep = 'threshold'
    void scrollOutput()
  }

  function chooseThreshold(value: number) {
    threshold = value
    policyStep = 'confirm'
    void scrollOutput()
  }

  async function start() {
    if (!policyValid || isBusy || actionBusy) return
    actionBusy = true
    try {
      await onStart({
        label: name.trim(),
        participantCount,
        threshold,
      })
    } finally {
      actionBusy = false
    }
  }

  async function addParticipant() {
    if (!response.trim() || isBusy || actionBusy) return
    actionBusy = true
    try {
      await onAddParticipant(response.trim())
      response = ''
    } finally {
      actionBusy = false
    }
  }

  async function finalize() {
    if (status !== 'ready' || isBusy || actionBusy) return
    actionBusy = true
    try {
      await onFinalize()
    } finally {
      actionBusy = false
    }
  }

  async function copyRequest() {
    if (!request) return
    try {
      await navigator.clipboard.writeText(request)
      copied = true
      setTimeout(() => (copied = false), 1500)
    } catch {
      vault.errorMsg = vault.t('login.sentinel_genesis_copy_failed')
    }
  }
</script>

<div
  class="min-h-screen bg-[#090b09] p-4 pt-20 font-mono text-[#b7ff95] sm:p-10 sm:pt-24"
  data-testid="sentinel-terminal-dashboard"
  data-sentinel-dashboard-focus
  tabindex="-1"
>
  {#if status === 'idle'}
    <button
      class="fixed top-5 left-5 z-50 flex h-10 items-center gap-2 rounded-full border border-white/15 bg-black/40 px-4 text-xs font-semibold text-white backdrop-blur-md sm:left-10"
      data-testid="sentinel-dashboard-back"
      onclick={onBack}
    >
      <ArrowLeft class="size-4" aria-hidden="true" />
      {vault.t('login.sentinel_dashboard_change')}
    </button>
  {/if}

  <section
    class="mx-auto max-w-6xl overflow-hidden rounded-xl border border-[#41613b] bg-[#030503] shadow-[0_0_80px_rgb(93_255_103/0.08)]"
    data-testid={status === 'idle' ? 'sentinel-genesis-policy-step' : undefined}
  >
    <header
      class="flex items-center justify-between border-b border-[#2d4229] bg-[#101510] px-5 py-3 text-xs"
    >
      <div class="flex gap-2">
        <span class="size-3 rounded-full bg-[#ff5f57]"></span>
        <span class="size-3 rounded-full bg-[#febc2e]"></span>
        <span class="size-3 rounded-full bg-[#28c840]"></span>
      </div>
      <span>nook://sentinel/genesis — guided setup</span>
      <span>SLIP_0039</span>
    </header>

    <div class="grid min-h-[44rem] lg:grid-cols-[1fr_18rem]">
      <div class="flex min-w-0 flex-col border-[#22321f] lg:border-r">
        <div
          class="flex items-center gap-3 border-b border-[#22321f] px-6 py-5 text-[#6ca85e]"
        >
          <Terminal class="size-5" />
          <span>INTERACTIVE GENESIS / SESSION 0x7F21</span>
        </div>
        <div
          bind:this={outputElement}
          class="min-h-[39rem] flex-1 overflow-y-auto p-6 text-sm leading-7 sm:p-8"
          aria-live="polite"
        >
          {#each policyLines as line, index (index)}
            <p
              class:mt-3={line.tone === 'answer'}
              class:text-[#d4ffc7]={line.tone === 'answer'}
              class:text-[#83e273]={line.tone === 'success'}
              class:text-[#d9c365]={line.tone === 'accent'}
              class:text-[#6f9f65]={line.tone === 'muted'}
              class="whitespace-pre-wrap"
            >
              {line.text}
            </p>
          {/each}

          {#if status === 'idle' && policyStep === 'confirm'}
            <div class="mt-7 border border-[#4f7a46] bg-[#081008] p-5">
              <p class="text-[#d9c365]">REVIEW GENESIS</p>
              <p class="mt-3">{name} · {threshold}-of-{participantCount}</p>
              <p class="text-[#6f9f65]">
                {vault.t('login.sentinel_terminal_participant_one')}
              </p>
            </div>
          {:else if status !== 'idle'}
            <div
              class="mt-7 space-y-5 border border-[#4f7a46] bg-[#081008] p-5"
              data-testid="sentinel-genesis-ceremony-step"
            >
              <div class="flex items-center justify-between gap-4">
                <p class="text-[#d9c365]">
                  {vault.t('login.sentinel_genesis_request_title')}
                </p>
                <span data-testid="sentinel-genesis-progress">
                  {rosterCount}/{participantCount}
                </span>
              </div>
              <textarea
                class="min-h-28 w-full border border-[#22321f] bg-[#030503] p-3 text-xs text-[#d4ffc7]"
                readonly
                data-testid="sentinel-genesis-request-output"
                value={request}></textarea>
              <button
                class="inline-flex items-center gap-2 border border-[#4f7a46] px-4 py-2 text-xs"
                data-testid="sentinel-genesis-copy-request"
                onclick={() => void copyRequest()}
              >
                <Copy class="size-4" />
                {copied ? vault.t('common.copied') : vault.t('common.copy')}
              </button>
              {#if status === 'collecting'}
                <label class="block text-[#83e273]">
                  ? {vault.t('login.sentinel_genesis_response_label')} ›
                  <textarea
                    class="mt-2 min-h-24 w-full border border-[#22321f] bg-[#030503] p-3 text-xs text-[#d4ffc7] outline-none focus:border-[#83e273]"
                    data-testid="sentinel-genesis-response-input"
                    bind:value={response}
                    placeholder={vault.t(
                      'login.sentinel_genesis_response_placeholder',
                    )}></textarea>
                </label>
                <button
                  class="inline-flex items-center gap-2 border border-[#4f7a46] bg-[#11200f] px-5 py-3 text-xs text-[#d4ffc7] disabled:opacity-30"
                  data-testid="sentinel-genesis-add-participant"
                  disabled={!response.trim() || isBusy || actionBusy}
                  onclick={() => void addParticipant()}
                >
                  {#if actionBusy}<RefreshCw
                      class="size-4 animate-spin"
                    />{:else}<KeyRound class="size-4" />{/if}
                  {vault.t('login.sentinel_genesis_add_participant')}
                </button>
              {/if}
            </div>
          {/if}

          <div class="mt-7">
            {#if status === 'idle' && policyStep === 'total'}
              <p>
                <span class="text-[#83e273]">?</span>
                {vault.t('login.sentinel_terminal_total_question')}
              </p>
              <div class="mt-3 flex flex-wrap gap-2">
                {#each participantChoices as choice (choice)}
                  <button
                    class={`border px-4 py-2 text-xs ${choice === participantCount ? 'border-[#83e273] bg-[#11200f] text-[#d4ffc7]' : 'border-[#22321f] text-[#5e8955]'}`}
                    data-participant-count={choice}
                    data-testid={choice === participantCount
                      ? 'sentinel-genesis-participant-count'
                      : undefined}
                    onclick={() => chooseTotal(choice)}
                    >❯ {choice}
                    {vault.t('login.sentinel_terminal_devices')}</button
                  >
                {/each}
              </div>
            {:else if status === 'idle' && policyStep === 'threshold'}
              <p>
                <span class="text-[#83e273]">?</span>
                {vault.t('login.sentinel_terminal_threshold_question')}
              </p>
              <div class="mt-3 flex flex-wrap gap-2">
                {#each Array.from({ length: participantCount - 1 }, (_, index) => index + 2) as choice (choice)}
                  <button
                    class={`border px-4 py-2 text-xs ${choice === threshold ? 'border-[#83e273] bg-[#11200f] text-[#d4ffc7]' : 'border-[#22321f] text-[#5e8955]'}`}
                    data-testid={choice === threshold
                      ? 'sentinel-genesis-threshold'
                      : undefined}
                    onclick={() => chooseThreshold(choice)}
                    >❯ {choice} of {participantCount}</button
                  >
                {/each}
              </div>
            {:else if status === 'idle'}
              <div class="flex flex-wrap items-center justify-between gap-4">
                <p>
                  <span class="text-[#83e273]">?</span>
                  {vault.t('login.sentinel_terminal_start_question')}
                </p>
                <button
                  class="flex items-center gap-2 border border-[#83e273] bg-[#11200f] px-5 py-3 text-xs text-[#d4ffc7] disabled:opacity-30"
                  data-testid="sentinel-genesis-start"
                  disabled={!policyValid || isBusy || actionBusy}
                  onclick={() => void start()}
                >
                  <KeyRound class="size-4" />
                  {vault.t('login.sentinel_genesis_start')}
                </button>
              </div>
            {:else if status === 'ready' || status === 'finalizing'}
              <button
                class="flex items-center gap-2 border border-[#83e273] bg-[#11200f] px-5 py-3 text-xs text-[#d4ffc7] disabled:opacity-30"
                data-testid="sentinel-genesis-finalize"
                disabled={status !== 'ready' || isBusy || actionBusy}
                onclick={() => void finalize()}
              >
                <KeyRound class="size-4" />
                {vault.t('login.sentinel_genesis_finalize')}
              </button>
            {/if}
          </div>

          {#if status === 'delivering' || deliveries.length > 0}
            <div
              class="mt-7 border border-[#83e273] bg-[#0c190b] p-5 text-[#a5f58f]"
              data-testid="sentinel-genesis-deliveries"
            >
              <p class="flex items-center gap-2 font-bold">
                <Check class="size-4" />
                {vault.t('login.sentinel_genesis_delivery_title')}
              </p>
              {#each deliveries as delivery, index (delivery.participantId)}
                <div class="mt-4">
                  <p class="text-xs">
                    {vault.t('login.sentinel_genesis_delivery_participant')}
                    {index + 1}
                  </p>
                  <textarea
                    class="mt-2 min-h-20 w-full border border-[#22321f] bg-[#030503] p-3 text-xs"
                    readonly
                    data-testid="sentinel-genesis-delivery-output"
                    value={delivery.payload}></textarea>
                </div>
              {/each}
              <button
                class="mt-5 border border-[#83e273] px-5 py-3 text-xs"
                data-testid="sentinel-genesis-delivery-complete"
                onclick={() => void onCompleteDelivery()}
              >
                {vault.t('common.done')}
              </button>
            </div>
          {/if}
        </div>
      </div>

      <aside class="flex flex-col bg-[#080b08] p-5 text-xs">
        <p class="text-[#456440]">SESSION STATE</p>
        <dl class="mt-5 space-y-4">
          <div>
            <dt class="text-[#456440]">DRAFT</dt>
            <dd class="mt-1 break-words text-[#a5f58f]">{name}</dd>
          </div>
          <div>
            <dt class="text-[#456440]">POLICY</dt>
            <dd class="mt-1 text-[#a5f58f]">
              {threshold}-OF-{participantCount}
            </dd>
          </div>
          <div>
            <dt class="text-[#456440]">ROSTER</dt>
            <dd class="mt-1 text-[#a5f58f]">
              {rosterCount}/{participantCount} VERIFIED
            </dd>
          </div>
          <div>
            <dt class="text-[#456440]">VAULT</dt>
            <dd
              class={`mt-1 ${status === 'delivering' || status === 'complete' ? 'text-[#83e273]' : 'text-[#d9c365]'}`}
            >
              {status === 'delivering' || status === 'complete'
                ? 'SEALED'
                : 'DOES NOT EXIST'}
            </dd>
          </div>
        </dl>
        <div class="mt-8 border-t border-[#22321f] pt-5">
          <p class="text-[#456440]">WORKFLOW</p>
          <ol class="mt-4 space-y-4">
            {#each ['Name draft', 'Set N / K', 'Collect public keys', 'Seal vault'] as item, index (item)}
              <li
                class={`flex items-center gap-3 ${index + 1 < workflowStage ? 'text-[#83e273]' : index + 1 === workflowStage ? 'text-[#d9c365]' : 'text-[#385334]'}`}
              >
                <span
                  class="grid size-5 place-items-center border border-current"
                  >{index + 1 < workflowStage ? '✓' : index + 1}</span
                >
                {item}
              </li>
            {/each}
          </ol>
        </div>
        <p class="mt-auto pt-8 text-[9px] leading-4 text-[#385334]">
          {vault.t('login.sentinel_terminal_footer')}
        </p>
      </aside>
    </div>
  </section>
</div>
