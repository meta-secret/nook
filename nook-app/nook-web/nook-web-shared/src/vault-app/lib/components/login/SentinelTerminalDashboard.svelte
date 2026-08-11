<script lang="ts">
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import {
    ArrowLeft,
    Check,
    Copy,
    KeyRound,
    RefreshCw,
    Terminal,
  } from '@lucide/svelte'
  import { tick } from 'svelte'
  import EnrollmentQrCode from '$lib/components/EnrollmentQrCode.svelte'
  import {
    copySentinelRequest,
    runSentinelDashboardAction,
  } from '$lib/components/login/sentinel-dashboard-actions'
  import {
    SentinelTerminalLineTone,
    SentinelTerminalPolicyStep,
  } from '$lib/components/login/sentinel-dashboard-state'
  import type { VaultState } from '$lib/vault.svelte'
  import {
    SentinelGenesisPhase,
    sentinel_genesis_phase_translation_key,
    type NookSentinelGenesisDelivery,
    type NookSentinelGenesisParticipantStatus,
    type StartSentinelGenesisArgs,
  } from '$app-wasm'

  type Line = { text: string; tone: SentinelTerminalLineTone }

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
    status: SentinelGenesisPhase
    request: string
    participants: NookSentinelGenesisParticipantStatus[]
    deliveries: NookSentinelGenesisDelivery[]
    isBusy: boolean
    onBack: () => void
    onStart: (args: StartSentinelGenesisArgs) => Promise<boolean>
    onAddParticipant: (payload: string) => void | Promise<void>
    onFinalize: () => void | Promise<void>
    onCompleteDelivery: () => void | Promise<void>
  } = $props()

  let policyStep = $state<SentinelTerminalPolicyStep>(
    SentinelTerminalPolicyStep.Total,
  )
  let response = $state('')
  let actionBusy = $state(false)
  let copied = $state(false)
  let outputElement = $state<HTMLDivElement>()

  const memberDeliveries = $derived(
    deliveries.filter((delivery) => delivery.deviceId !== vault.deviceId),
  )
  const participantChoices = [...Array(15).keys()].map((index) => index + 2)
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
    status === SentinelGenesisPhase.DeliveringShares ||
      status === SentinelGenesisPhase.Complete
      ? 5
      : status === SentinelGenesisPhase.ReadyToFinalize
        ? 4
        : status === SentinelGenesisPhase.CollectingParticipants
          ? 3
          : policyStep === SentinelTerminalPolicyStep.Total ||
              policyStep === SentinelTerminalPolicyStep.Threshold
            ? 2
            : 3,
  )
  const policyLines = $derived<Line[]>([
    {
      text: 'NOOK SENTINEL INIT v0.3.0',
      tone: SentinelTerminalLineTone.Accent,
    },
    {
      text: vault.t(I18N_KEYS.LoginSentinelTerminalGuided),
      tone: SentinelTerminalLineTone.Muted,
    },
    {
      text: vault.t(I18N_KEYS.LoginSentinelTerminalDeviceIncluded),
      tone: SentinelTerminalLineTone.Success,
    },
    {
      text: `◆ ${vault.t(I18N_KEYS.LoginVaultNameLabel)}  ${name}`,
      tone: SentinelTerminalLineTone.Answer,
    },
    {
      text:
        status === SentinelGenesisPhase.Inactive
          ? vault.t(I18N_KEYS.LoginSentinelTerminalDraftNotice)
          : `${vault.t(I18N_KEYS.LoginSentinelTerminalStatus)}  ${vault.t(sentinel_genesis_phase_translation_key(status)).toUpperCase()}`,
      tone: SentinelTerminalLineTone.Muted,
    },
  ])

  async function scrollOutput() {
    await tick()
    if (outputElement) outputElement.scrollTop = outputElement.scrollHeight
  }

  function chooseTotal(value: number) {
    participantCount = value
    threshold = Math.min(threshold, value)
    policyStep = SentinelTerminalPolicyStep.Threshold
    void scrollOutput()
  }

  function chooseThreshold(value: number) {
    threshold = value
    policyStep = SentinelTerminalPolicyStep.Confirm
    void scrollOutput()
  }

  async function start() {
    if (!policyValid || isBusy || actionBusy) return
    actionBusy = true
    try {
      const onStartArgs: Parameters<typeof onStart>[0] = {
        label: name.trim(),
        participantCount,
        threshold,
      };
      await onStart(onStartArgs)
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
</script>

<div
  class="min-h-screen bg-[#090b09] p-4 pt-20 font-mono text-[#b7ff95] sm:p-10 sm:pt-24"
  data-testid="sentinel-terminal-dashboard"
  data-sentinel-dashboard-focus
  tabindex="-1"
>
  {#if status === SentinelGenesisPhase.Inactive}
    <button
      class="fixed top-5 left-5 z-50 flex h-10 items-center gap-2 rounded-full border border-white/15 bg-black/40 px-4 text-xs font-semibold text-white backdrop-blur-md sm:left-10"
      data-testid="sentinel-dashboard-back"
      onclick={onBack}
    >
      <ArrowLeft class="size-4" aria-hidden="true" />
      {vault.t(I18N_KEYS.LoginSentinelDashboardChange)}
    </button>
  {/if}

  <section
    {...status === SentinelGenesisPhase.Inactive
      ? { 'data-testid': 'sentinel-genesis-policy-step' }
      : {}}
    class="mx-auto max-w-6xl overflow-hidden rounded-xl border border-[#41613b] bg-[#030503] shadow-[0_0_80px_rgb(93_255_103/0.08)]"
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
              class:mt-3={line.tone === SentinelTerminalLineTone.Answer}
              class:text-[#d4ffc7]={line.tone ===
                SentinelTerminalLineTone.Answer}
              class:text-[#83e273]={line.tone ===
                SentinelTerminalLineTone.Success}
              class:text-[#d9c365]={line.tone ===
                SentinelTerminalLineTone.Accent}
              class:text-[#6f9f65]={line.tone ===
                SentinelTerminalLineTone.Muted}
              class="whitespace-pre-wrap"
            >
              {line.text}
            </p>
          {/each}

          {#if status === SentinelGenesisPhase.Inactive && policyStep === SentinelTerminalPolicyStep.Confirm}
            <div class="mt-7 border border-[#4f7a46] bg-[#081008] p-5">
              <p class="text-[#d9c365]">REVIEW GENESIS</p>
              <p class="mt-3">{name} · {threshold}-of-{participantCount}</p>
              <p class="text-[#6f9f65]">
                {vault.t(I18N_KEYS.LoginSentinelTerminalParticipantOne)}
              </p>
            </div>
          {:else if status !== SentinelGenesisPhase.Inactive}
            <div
              class="mt-7 space-y-5 border border-[#4f7a46] bg-[#081008] p-5"
              data-testid="sentinel-genesis-ceremony-step"
            >
              <div class="flex items-center justify-between gap-4">
                <p class="text-[#d9c365]">
                  {vault.t(I18N_KEYS.LoginSentinelGenesisRequestTitle)}
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
                onclick={() =>
                  void (() => { const copySentinelRequestArgs: Parameters<typeof copySentinelRequest>[0] = { request, onCopied: () => {
                      copied = true
                      setTimeout(() => (copied = false), 1500)
                    }, onFailure: () =>
                      (vault.errorMsg = vault.t(
                        I18N_KEYS.LoginSentinelGenesisCopyFailed,
                      )) }; return copySentinelRequest(
                    copySentinelRequestArgs,
                  ); })()}
              >
                <Copy class="size-4" />
                {copied ? vault.t(I18N_KEYS.CommonCopied) : vault.t(I18N_KEYS.CommonCopy)}
              </button>
              {#if status === SentinelGenesisPhase.CollectingParticipants}
                <label class="block text-[#83e273]">
                  ? {vault.t(I18N_KEYS.LoginSentinelGenesisResponseLabel)} ›
                  <textarea
                    class="mt-2 min-h-24 w-full border border-[#22321f] bg-[#030503] p-3 text-xs text-[#d4ffc7] outline-none focus:border-[#83e273]"
                    data-testid="sentinel-genesis-response-input"
                    bind:value={response}
                    placeholder={vault.t(
                      I18N_KEYS.LoginSentinelGenesisResponsePlaceholder,
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
                  {vault.t(I18N_KEYS.LoginSentinelGenesisAddParticipant)}
                </button>
              {/if}
            </div>
          {/if}

          <div class="mt-7">
            {#if status === SentinelGenesisPhase.Inactive && policyStep === SentinelTerminalPolicyStep.Total}
              <p>
                <span class="text-[#83e273]">?</span>
                {vault.t(I18N_KEYS.LoginSentinelTerminalTotalQuestion)}
              </p>
              <div class="mt-3 flex flex-wrap gap-2">
                {#each participantChoices as choice (choice)}
                  <button
                    {...choice === participantCount
                      ? {
                          'data-testid': 'sentinel-genesis-participant-count',
                        }
                      : {}}
                    class={`border px-4 py-2 text-xs ${choice === participantCount ? 'border-[#83e273] bg-[#11200f] text-[#d4ffc7]' : 'border-[#22321f] text-[#5e8955]'}`}
                    data-participant-count={choice}
                    onclick={() => chooseTotal(choice)}
                    >❯ {choice}
                    {vault.t(I18N_KEYS.LoginSentinelTerminalDevices)}</button
                  >
                {/each}
              </div>
            {:else if status === SentinelGenesisPhase.Inactive && policyStep === SentinelTerminalPolicyStep.Threshold}
              <p>
                <span class="text-[#83e273]">?</span>
                {vault.t(I18N_KEYS.LoginSentinelTerminalThresholdQuestion)}
              </p>
              <div class="mt-3 flex flex-wrap gap-2">
                {#each [...Array(participantCount - 1).keys()].map((index) => index + 2) as choice (choice)}
                  <button
                    {...choice === threshold
                      ? { 'data-testid': 'sentinel-genesis-threshold' }
                      : {}}
                    class={`border px-4 py-2 text-xs ${choice === threshold ? 'border-[#83e273] bg-[#11200f] text-[#d4ffc7]' : 'border-[#22321f] text-[#5e8955]'}`}
                    onclick={() => chooseThreshold(choice)}
                    >❯ {choice} of {participantCount}</button
                  >
                {/each}
              </div>
            {:else if status === SentinelGenesisPhase.Inactive}
              <div class="flex flex-wrap items-center justify-between gap-4">
                <p>
                  <span class="text-[#83e273]">?</span>
                  {vault.t(I18N_KEYS.LoginSentinelTerminalStartQuestion)}
                </p>
                <button
                  class="flex items-center gap-2 border border-[#83e273] bg-[#11200f] px-5 py-3 text-xs text-[#d4ffc7] disabled:opacity-30"
                  data-testid="sentinel-genesis-start"
                  disabled={!policyValid || isBusy || actionBusy}
                  onclick={() => void start()}
                >
                  <KeyRound class="size-4" />
                  {vault.t(I18N_KEYS.LoginSentinelGenesisStart)}
                </button>
              </div>
            {:else if status === SentinelGenesisPhase.ReadyToFinalize}
              <button
                class="flex items-center gap-2 border border-[#83e273] bg-[#11200f] px-5 py-3 text-xs text-[#d4ffc7] disabled:opacity-30"
                data-testid="sentinel-genesis-finalize"
                disabled={status !== SentinelGenesisPhase.ReadyToFinalize ||
                  isBusy ||
                  actionBusy}
                onclick={() =>
                  void (() => { const runSentinelDashboardActionArgs: Parameters<typeof runSentinelDashboardAction>[0] = { allowed: status === SentinelGenesisPhase.ReadyToFinalize &&
                      !isBusy &&
                      !actionBusy, setBusy: (value) => (actionBusy = value), action: onFinalize }; return runSentinelDashboardAction(
                    runSentinelDashboardActionArgs,
                  ); })()}
              >
                <KeyRound class="size-4" />
                {vault.t(I18N_KEYS.LoginSentinelGenesisFinalize)}
              </button>
            {/if}
          </div>

          {#if status === SentinelGenesisPhase.DeliveringShares || deliveries.length > 0}
            <div
              class="mt-7 border border-[#83e273] bg-[#0c190b] p-5 text-[#a5f58f]"
              data-testid="sentinel-genesis-deliveries"
            >
              <p class="flex items-center gap-2 font-bold">
                <Check class="size-4" />
                {vault.t(I18N_KEYS.LoginSentinelGenesisDeliveryTitle)}
              </p>
              <p class="mt-2 text-xs text-[#6ca85e]">
                {vault.t(I18N_KEYS.LoginSentinelGenesisDeliveryDescription)}
              </p>
              {#each memberDeliveries as delivery, index (delivery.deviceId)}
                <div class="mt-4 grid gap-3 sm:grid-cols-[110px_1fr]">
                  <EnrollmentQrCode
                    enrollmentLink={delivery.payload}
                    loadingLabel={vault.t(I18N_KEYS.LoginSentinelGenesisQrLoading)}
                    dense
                  />
                  <div>
                    <p class="text-xs">
                      {vault.t(I18N_KEYS.LoginSentinelGenesisDeliveryParticipant)}
                      {index + 2}
                    </p>
                    <textarea
                      class="mt-2 min-h-20 w-full border border-[#22321f] bg-[#030503] p-3 text-xs"
                      readonly
                      data-testid="sentinel-genesis-delivery-output"
                      value={delivery.payload}></textarea>
                  </div>
                </div>
              {/each}
              <p class="mt-5 font-bold">
                {vault.t(I18N_KEYS.LoginSentinelOnboardingVaultReadyTitle)}
              </p>
              <p class="mt-2 text-xs text-[#6ca85e]">
                {vault.t(I18N_KEYS.LoginSentinelOnboardingVaultReadyDescription)}
              </p>
              <button
                class="mt-5 border border-[#83e273] px-5 py-3 text-xs disabled:opacity-30"
                data-testid="sentinel-genesis-delivery-complete"
                disabled={memberDeliveries.length === 0}
                onclick={() => void onCompleteDelivery()}
              >
                {vault.t(I18N_KEYS.LoginSentinelOnboardingFinishAction)}
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
              class={`mt-1 ${status === SentinelGenesisPhase.DeliveringShares || status === SentinelGenesisPhase.Complete ? 'text-[#83e273]' : 'text-[#d9c365]'}`}
            >
              {status === SentinelGenesisPhase.DeliveringShares ||
              status === SentinelGenesisPhase.Complete
                ? 'SEALED'
                : 'DOES NOT EXIST'}
            </dd>
          </div>
        </dl>
        <div class="mt-8 border-t border-[#22321f] pt-5">
          <p class="text-[#456440]">WORKFLOW</p>
          <ol class="mt-4 space-y-4">
            {#each ['Name draft', 'Set N / K', vault.t(I18N_KEYS.LoginSentinelGenesisCollectTitle), 'Seal vault'] as item, index (item)}
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
          {vault.t(I18N_KEYS.LoginSentinelTerminalFooter)}
        </p>
      </aside>
    </div>
  </section>
</div>
