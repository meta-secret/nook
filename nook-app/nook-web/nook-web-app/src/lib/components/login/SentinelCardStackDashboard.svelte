<script lang="ts">
  import {
    ArrowLeft,
    Check,
    Copy,
    Cpu,
    Plus,
    RefreshCw,
    ShieldCheck,
  } from '@lucide/svelte'
  import EnrollmentQrCode from '$lib/components/EnrollmentQrCode.svelte'
  import { Button } from '$lib/components/ui/button'
  import * as Select from '$lib/components/ui/select'
  import type { StartSentinelGenesisArgs, VaultState } from '$lib/vault.svelte'

  type SentinelGenesisStatus =
    | 'idle'
    | 'collecting'
    | 'ready'
    | 'finalizing'
    | 'delivering'
    | 'complete'

  type OnboardingStage = 'identity' | 'roster' | 'policy' | 'build'

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

  type QueuedParticipant = {
    payload: string
    label: string
    fingerprint: string
  }

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
    initiatorFingerprint,
    initiatorKeyLoading,
    onPrepareInitiator,
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
    status: SentinelGenesisStatus
    request: string
    participants: Participant[]
    deliveries: Delivery[]
    isBusy: boolean
    initiatorFingerprint: string
    initiatorKeyLoading: boolean
    onPrepareInitiator: () => void | Promise<void>
    onBack: () => void
    onStart: (
      args: StartSentinelGenesisArgs,
    ) => boolean | void | Promise<boolean | void>
    onAddParticipant: (payload: string) => void | Promise<void>
    onFinalize: () => void | Promise<void>
    onCompleteDelivery: () => void | Promise<void>
  } = $props()

  let response = $state('')
  let actionBusy = $state(false)
  let copied = $state(false)
  let selected = $state(0)
  let queuedParticipants = $state<QueuedParticipant[]>([])
  let deviceName = $state('')
  let participantInputError = $state('')
  let onboardingStage = $state<OnboardingStage>('identity')
  let buildRequested = $state(false)

  const initiatorKeyReady = $derived(
    Boolean(participants[0]?.fingerprint || initiatorFingerprint),
  )
  const rosterCount = $derived(
    initiatorKeyReady
      ? Math.max(1, participants.length) + queuedParticipants.length
      : 0,
  )
  const availableRosterSlots = $derived(Math.max(0, 16 - rosterCount))
  const policyValid = $derived(
    name.trim().length > 0 &&
      Number.isInteger(participantCount) &&
      participantCount >= 2 &&
      participantCount <= 16 &&
      Number.isInteger(threshold) &&
      threshold >= 2 &&
      threshold <= participantCount,
  )
  const onboardingStep = $derived(
    onboardingStage === 'identity'
      ? 0
      : onboardingStage === 'roster'
        ? 1
        : onboardingStage === 'policy'
          ? 2
          : 3,
  )

  $effect(() => {
    if (status !== 'idle') {
      onboardingStage = 'build'
    } else if (initiatorKeyReady && onboardingStage === 'identity') {
      onboardingStage = 'roster'
    } else if (!initiatorKeyReady) {
      onboardingStage = 'identity'
    }
  })

  function changeThreshold(value: string | undefined) {
    if (!value) return
    threshold = Number(value)
  }

  function changeParticipantPayload(event: Event) {
    response = (event.currentTarget as HTMLInputElement).value
    participantInputError = ''
    if (deviceName.trim()) return
    try {
      const announcement = JSON.parse(response) as { label?: string }
      deviceName = announcement.label?.trim() ?? ''
    } catch {
      // Keep the compact sketch input usable while an announcement is pasted.
    }
  }

  function parseParticipantPayload(payload: string): QueuedParticipant | null {
    try {
      const parsed = JSON.parse(payload) as {
        fingerprint?: string
        label?: string
        signature?: string
        participant?: {
          fingerprint?: string
          label?: string
        }
      }
      const fingerprint =
        parsed.fingerprint?.trim() ?? parsed.participant?.fingerprint?.trim()
      const signedLabel =
        parsed.label?.trim() ?? parsed.participant?.label?.trim() ?? ''
      if (!fingerprint || !parsed.signature?.trim()) return null
      return {
        payload,
        label: deviceName.trim() || signedLabel,
        fingerprint,
      }
    } catch {
      return null
    }
  }

  async function start() {
    if (!initiatorKeyReady || !policyValid || isBusy || actionBusy) return
    buildRequested = true
    onboardingStage = 'build'
    actionBusy = true
    try {
      const started = await onStart({
        label: name.trim(),
        participantCount,
        threshold,
      })
      if (started === false) {
        buildRequested = false
        onboardingStage = 'policy'
      }
    } catch (error) {
      buildRequested = false
      onboardingStage = 'policy'
      throw error
    } finally {
      actionBusy = false
    }
  }

  function continueToPolicy() {
    if (rosterCount < 2 || isBusy || actionBusy) return
    participantCount = rosterCount
    threshold = Math.min(Math.max(2, threshold), participantCount)
    onboardingStage = 'policy'
  }

  async function flushQueuedParticipants() {
    if (
      queuedParticipants.length === 0 ||
      status !== 'collecting' ||
      isBusy ||
      actionBusy
    )
      return
    actionBusy = true
    try {
      while (queuedParticipants.length > 0) {
        await onAddParticipant(queuedParticipants[0].payload)
        queuedParticipants.shift()
      }
    } finally {
      actionBusy = false
    }
  }

  async function addParticipant() {
    const payload = response.trim()
    if (!payload || isBusy || actionBusy) return
    const queued = parseParticipantPayload(payload)
    if (!queued) {
      participantInputError = vault.t(
        'login.sentinel_card_stack_public_key_placeholder',
      )
      return
    }
    queuedParticipants.push(queued)
    response = ''
    deviceName = ''
    participantInputError = ''
    selected = Math.max(0, participants.length + queuedParticipants.length - 1)
    if (status === 'collecting') await flushQueuedParticipants()
  }

  $effect(() => {
    if (
      status === 'collecting' &&
      queuedParticipants.length > 0 &&
      !isBusy &&
      !actionBusy
    ) {
      void flushQueuedParticipants()
    }
  })

  $effect(() => {
    if (
      buildRequested &&
      status === 'ready' &&
      queuedParticipants.length === 0 &&
      !isBusy &&
      !actionBusy
    ) {
      void finalize()
    }
  })

  async function finalize() {
    if (status !== 'ready' || isBusy || actionBusy) return
    actionBusy = true
    try {
      await onFinalize()
      buildRequested = false
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
  class="min-h-screen overflow-hidden bg-[#10141a] text-white [background-image:radial-gradient(circle_at_50%_-10%,#53606d_0,transparent_42%),radial-gradient(circle_at_15%_90%,#25303a_0,transparent_36%)]"
  data-testid="sentinel-card-stack-dashboard"
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
  <div
    class="pointer-events-none fixed inset-0 opacity-45 [background-image:radial-gradient(#a9b8c5_1px,transparent_1px)] [background-size:22px_22px]"
  ></div>

  <section class="relative mx-auto max-w-7xl px-6 py-24 sm:px-10">
    <ol
      class="mb-12 grid gap-2 rounded-xl border border-white/10 bg-black/20 p-2 backdrop-blur-sm sm:grid-cols-4"
      data-testid="sentinel-onboarding-progress"
    >
      {#each [vault.t('login.sentinel_onboarding_step_keys'), vault.t('login.sentinel_onboarding_step_devices'), vault.t('login.sentinel_onboarding_step_shares'), vault.t('login.sentinel_onboarding_step_build')] as label, index (label)}
        <li
          class={[
            'flex items-center gap-3 rounded-lg px-3 py-3 transition-colors',
            index === onboardingStep
              ? 'bg-[#79dfff]/10 text-white'
              : index < onboardingStep
                ? 'text-[#63eaa1]'
                : 'text-[#66737e]',
          ]}
          data-current={index === onboardingStep ? 'step' : undefined}
        >
          <span
            class={[
              'grid size-7 shrink-0 place-items-center rounded-full border font-mono text-[10px]',
              index < onboardingStep
                ? 'border-[#63eaa1] bg-[#63eaa1]/10'
                : index === onboardingStep
                  ? 'border-[#79dfff] bg-[#79dfff]/10 text-[#79dfff]'
                  : 'border-white/15',
            ]}
          >
            {#if index < onboardingStep}<Check
                class="size-3.5"
              />{:else}{String(index + 1).padStart(2, '0')}{/if}
          </span>
          <span class="text-[10px] font-semibold tracking-[0.12em] uppercase">
            {label}
          </span>
        </li>
      {/each}
    </ol>

    <header class="grid gap-8 md:grid-cols-[1fr_auto] md:items-end">
      <div>
        <p
          class="font-mono text-[10px] tracking-[0.24em] text-[#8a98a5] uppercase"
        >
          {vault.t('login.sentinel_card_stack_eyebrow')}
        </p>
        <div class="mt-4 flex flex-wrap items-end gap-7">
          <h1 class="text-4xl font-semibold tracking-[0.18em]">SENTINEL</h1>
          <div
            class="flex rounded-full bg-white/[0.06] p-1 text-xs text-[#aeb8c2]"
          >
            <span class="rounded-full bg-white/10 px-4 py-2 text-white">
              {vault.t('login.sentinel_card_stack_tab_vault')}
            </span>
            <span class="px-4 py-2">
              {vault.t('login.sentinel_card_stack_tab_policy')}
            </span>
            <span class="px-4 py-2">
              {vault.t('login.sentinel_card_stack_tab_keys')}
            </span>
          </div>
        </div>
      </div>
      <div
        class="min-w-64 rounded-xl bg-[#f4f6f7] p-4 text-[#27313a] shadow-2xl"
      >
        <p class="text-[9px] tracking-wider text-[#87919a] uppercase">
          {vault.t('login.sentinel_card_stack_order_details')}
        </p>
        <div class="mt-3 flex justify-between text-xs">
          <span>{vault.t('login.sentinel_card_stack_policy')}</span>
          <b>
            {onboardingStage === 'identity' || onboardingStage === 'roster'
              ? vault.t('login.sentinel_onboarding_not_set')
              : `${threshold}-of-${participantCount}`}
          </b>
        </div>
        <div class="mt-2 flex justify-between text-xs">
          <span>{vault.t('login.sentinel_onboarding_devices_ready')}</span>
          <b>{rosterCount}</b>
        </div>
      </div>
    </header>

    <div class="mt-12 grid gap-10 lg:grid-cols-[0.78fr_1.22fr]">
      <div>
        <p
          class="font-mono text-[10px] tracking-[0.18em] text-[#88949f] uppercase"
        >
          {vault.t('login.sentinel_card_stack_participant_cards')}
        </p>
        {#if onboardingStage === 'identity'}
          <div
            class="mt-5 border border-[#79dfff]/35 bg-[#79dfff]/5 p-5 shadow-[0_0_40px_rgb(82_198_238/0.08)]"
            data-testid="sentinel-onboarding-identity"
          >
            <p class="font-mono text-[9px] tracking-[0.18em] text-[#79dfff]">
              {vault.t('login.sentinel_onboarding_first_step')}
            </p>
            <h2 class="mt-3 text-xl font-semibold">
              {vault.t('login.sentinel_onboarding_create_keys_title')}
            </h2>
            <p class="mt-2 text-sm leading-6 text-[#aeb8c2]">
              {vault.t('login.sentinel_onboarding_create_keys_description')}
            </p>
          </div>
        {/if}
        <div class="mt-5 space-y-3">
          <button
            class={`grid w-full grid-cols-[auto_1fr_auto] items-center gap-5 border border-l-2 px-5 py-5 text-left transition ${selected === 0 ? 'border-[#6ed9ff] bg-[#3b4650] shadow-[0_0_30px_rgb(82_198_238/0.08)]' : 'border-white/5 border-l-[#657580] bg-[#303840]/85'}`}
            onclick={() => {
              selected = 0
              if (!initiatorKeyReady) void onPrepareInitiator()
            }}
          >
            <span
              class="grid size-10 place-items-center border border-[#71808b] bg-[#202830] text-[#79dfff]"
            >
              <Cpu class="size-5" />
            </span>
            <span class="min-w-0">
              <b class="block truncate text-sm">
                {vault.t('login.sentinel_card_stack_this_device')} ·
                {vault.t('login.sentinel_card_stack_participant')} 01
              </b>
              <span
                class="mt-1 block truncate font-mono text-[10px] text-[#a0abb5]"
              >
                {participants[0]?.fingerprint ||
                  initiatorFingerprint ||
                  vault.t('login.sentinel_card_stack_key_pending')}
                ·
                {initiatorKeyReady
                  ? vault.t('login.sentinel_card_stack_automatically_included')
                  : vault.t('login.sentinel_card_stack_initialize_device')}
              </span>
            </span>
            {#if initiatorKeyLoading}
              <RefreshCw class="size-4 animate-spin text-[#79dfff]" />
            {:else if initiatorKeyReady}
              <Check class="size-4 text-[#63eaa1]" />
            {:else}
              <span
                class="rounded-full border border-[#79dfff]/40 bg-[#79dfff]/10 px-3 py-2 font-mono text-[9px] tracking-wider text-[#79dfff] shadow-[0_0_24px_rgb(82_198_238/0.12)]"
              >
                {vault.t('login.sentinel_onboarding_create_keys_action')}
              </span>
            {/if}
          </button>

          {#each participants.slice(1) as participant, index (participant.participantId)}
            <button
              class={`grid w-full grid-cols-[auto_1fr_auto] items-center gap-5 border border-l-2 px-5 py-5 text-left transition ${selected === index + 1 ? 'border-[#6ed9ff] bg-[#3b4650] shadow-[0_0_30px_rgb(82_198_238/0.08)]' : 'border-white/5 border-l-[#657580] bg-[#303840]/85'}`}
              onclick={() => (selected = index + 1)}
            >
              <span
                class="grid size-10 place-items-center border border-[#71808b] bg-[#202830] font-mono text-[9px] text-[#b9c5ce]"
              >
                P-{String(index + 2).padStart(2, '0')}
              </span>
              <span class="min-w-0">
                <b class="block truncate text-sm">
                  {participant.label || participant.participantId} ·
                  {vault.t('login.sentinel_card_stack_participant')}
                  {String(index + 2).padStart(2, '0')}
                </b>
                <span
                  class="mt-1 block truncate font-mono text-[10px] text-[#a0abb5]"
                >
                  {participant.fingerprint}
                </span>
              </span>
              <Check class="size-4 text-[#63eaa1]" />
            </button>
          {/each}

          {#each queuedParticipants as participant, index (participant.fingerprint)}
            <button
              class={`grid w-full grid-cols-[auto_1fr_auto] items-center gap-5 border border-l-2 px-5 py-5 text-left transition ${selected === participants.length + index ? 'border-[#6ed9ff] bg-[#3b4650] shadow-[0_0_30px_rgb(82_198_238/0.08)]' : 'border-white/5 border-l-[#657580] bg-[#303840]/85'}`}
              data-testid="sentinel-genesis-queued-participant"
              onclick={() => (selected = participants.length + index)}
            >
              <span
                class="grid size-10 place-items-center border border-[#71808b] bg-[#202830] font-mono text-[9px] text-[#b9c5ce]"
              >
                P-{String(participants.length + index + 1).padStart(2, '0')}
              </span>
              <span class="min-w-0">
                <b class="block truncate text-sm">
                  {participant.label} ·
                  {vault.t('login.sentinel_card_stack_participant')}
                  {String(participants.length + index + 1).padStart(2, '0')}
                </b>
                <span
                  class="mt-1 block truncate font-mono text-[10px] text-[#a0abb5]"
                >
                  {participant.fingerprint} ·
                  {vault.t('login.sentinel_card_stack_key_pending')}
                </span>
              </span>
              <RefreshCw class="size-4 text-[#79dfff]" />
            </button>
          {/each}

          {#if onboardingStage === 'roster' && availableRosterSlots > 0}
            <div class="border border-dashed border-[#aeb8c2] p-5">
              <div class="flex items-center justify-between gap-4">
                <div>
                  <p class="text-sm text-[#d6dde3]">
                    {vault.t('login.sentinel_card_stack_add_participant')}
                  </p>
                  <p class="mt-1 font-mono text-[9px] text-[#75818c]">
                    {vault.t('login.sentinel_card_stack_slots_remaining', {
                      count: String(availableRosterSlots),
                    })}
                  </p>
                </div>
                <button
                  class="grid size-12 shrink-0 place-items-center rounded-full bg-white text-[#1f2830] disabled:opacity-30"
                  data-testid="sentinel-genesis-add-participant"
                  aria-label={vault.t('login.sentinel_genesis_add_participant')}
                  disabled={!response.trim() || isBusy || actionBusy}
                  onclick={() => void addParticipant()}
                >
                  {#if actionBusy}<RefreshCw
                      class="size-5 animate-spin"
                    />{:else}<Plus class="size-5" />{/if}
                </button>
              </div>
              <div class="mt-5 grid gap-4 sm:grid-cols-2">
                <label
                  class="text-[9px] tracking-wider text-[#8d99a4] uppercase"
                >
                  {vault.t('login.sentinel_card_stack_device_name_label')}
                  <input
                    class="mt-2 w-full border-b border-white/20 bg-transparent py-2 text-sm text-white outline-none placeholder:text-[#596670] focus:border-[#6ed9ff]"
                    data-testid="sentinel-genesis-participant-name-input"
                    placeholder={vault.t(
                      'login.sentinel_card_stack_device_name_placeholder',
                    )}
                    bind:value={deviceName}
                  />
                </label>
                <label
                  class="text-[9px] tracking-wider text-[#8d99a4] uppercase"
                >
                  {vault.t('login.sentinel_card_stack_public_key_label')}
                  <input
                    class="mt-2 w-full border-b border-white/20 bg-transparent py-2 font-mono text-xs text-white outline-none placeholder:text-[#596670] focus:border-[#6ed9ff]"
                    data-testid="sentinel-genesis-response-input"
                    placeholder={vault.t(
                      'login.sentinel_card_stack_public_key_placeholder',
                    )}
                    value={response}
                    oninput={changeParticipantPayload}
                    onkeydown={(event) =>
                      event.key === 'Enter' && void addParticipant()}
                  />
                </label>
              </div>
              {#if participantInputError}
                <p
                  class="mt-4 text-xs leading-5 text-[#ff9f9f]"
                  role="alert"
                  data-testid="sentinel-genesis-participant-error"
                >
                  {participantInputError}
                </p>
              {/if}
            </div>
          {/if}

          {#if onboardingStage === 'roster'}
            <div
              class="rounded-xl border border-white/10 bg-white/[0.035] p-5"
              data-testid="sentinel-onboarding-roster-next"
            >
              <p class="text-sm font-semibold">
                {vault.t('login.sentinel_onboarding_roster_title')}
              </p>
              <p class="mt-2 text-xs leading-5 text-[#8f9ca7]">
                {vault.t('login.sentinel_onboarding_roster_description')}
              </p>
              <button
                class="mt-5 w-full rounded-md bg-[#79dfff] px-5 py-3 text-xs font-bold tracking-wide text-[#10202a] uppercase transition hover:bg-[#9be7ff] disabled:cursor-not-allowed disabled:opacity-25"
                data-testid="sentinel-onboarding-continue-policy"
                disabled={rosterCount < 2 || isBusy || actionBusy}
                onclick={continueToPolicy}
              >
                {rosterCount < 2
                  ? vault.t('login.sentinel_onboarding_add_one_device')
                  : vault.t('login.sentinel_onboarding_continue_with_devices', {
                      count: String(rosterCount),
                    })}
              </button>
            </div>
          {:else if onboardingStage === 'policy'}
            <button
              type="button"
              class="w-full rounded-lg border border-white/10 bg-white/[0.035] px-5 py-4 text-left text-xs text-[#aeb8c2] transition hover:border-[#79dfff]/40 hover:text-white"
              data-testid="sentinel-onboarding-edit-roster"
              onclick={() => (onboardingStage = 'roster')}
            >
              ← {vault.t('login.sentinel_onboarding_edit_roster')}
            </button>
          {/if}
        </div>
      </div>

      <div>
        <p
          class="font-mono text-[10px] tracking-[0.18em] text-[#88949f] uppercase"
        >
          {vault.t('login.sentinel_card_stack_active_configuration')}
        </p>
        <div
          class="relative mt-5 min-h-[28rem] overflow-hidden border border-[#657580] border-l-4 border-l-[#6ed9ff] bg-[#242d35] p-7 shadow-[0_35px_80px_rgb(0_0_0/0.38)] [background-image:linear-gradient(rgb(255_255_255/0.025)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255/0.025)_1px,transparent_1px)] [background-size:32px_32px] sm:p-10"
          data-testid={status === 'idle' && onboardingStage === 'policy'
            ? 'sentinel-genesis-policy-step'
            : undefined}
        >
          <div class="relative flex items-start justify-between gap-4">
            <div class="flex items-center gap-3">
              <ShieldCheck class="text-[#79dfff]" />
              <span class="text-sm font-semibold tracking-wider">
                {vault.t('login.sentinel_card_stack_control_plane')}
              </span>
            </div>
            <span
              class="border border-[#657580] bg-[#192128] px-3 py-2 font-mono text-[9px] tracking-wider text-[#aab5be]"
            >
              {status === 'idle'
                ? vault.t('login.sentinel_card_stack_pre_genesis')
                : status.toUpperCase()}
            </span>
          </div>

          {#if status === 'idle'}
            {#if onboardingStage === 'policy'}
              <div
                class="relative mt-10 border border-[#79dfff]/20 bg-black/10 p-5"
                data-testid="sentinel-onboarding-policy"
              >
                <p
                  class="mb-5 font-mono text-[9px] tracking-[0.16em] text-[#79dfff]"
                >
                  {vault.t('login.sentinel_onboarding_final_step')}
                </p>
                <label
                  class="block text-[10px] tracking-[0.16em] text-[#b5c0c9] uppercase"
                >
                  {vault.t('login.sentinel_card_stack_module_identity')}
                  <input
                    class="mt-3 w-full border-b border-white/25 bg-transparent py-2 text-3xl font-light tracking-tight text-white outline-none placeholder:text-white/25 focus:border-[#79dfff]"
                    data-testid="sentinel-genesis-name-input"
                    placeholder={vault.t('login.vault_name_placeholder')}
                    bind:value={name}
                  />
                </label>
              </div>

              <div
                class="relative mt-6 flex flex-wrap items-end justify-between gap-8 border border-white/10 bg-black/10 p-5"
              >
                <div class="min-w-72">
                  <span
                    class="text-[10px] tracking-wider text-[#aab5be] uppercase"
                  >
                    {vault.t('login.sentinel_card_stack_threshold_policy')}
                  </span>
                  <span
                    class="mt-2 grid h-20 grid-cols-[1fr_auto_1fr] items-center gap-5 border-b border-white/70"
                  >
                    <Select.Root
                      type="single"
                      value={String(threshold)}
                      onValueChange={changeThreshold}
                    >
                      <Select.Trigger
                        class="h-auto w-full gap-3 rounded-none border-0 bg-transparent p-0 text-left text-white shadow-none focus-visible:ring-1 focus-visible:ring-[#79dfff] [&_svg]:text-[#aab5be]"
                        data-testid="sentinel-genesis-threshold"
                        data-value={threshold}
                        aria-label={vault.t('login.sentinel_genesis_threshold')}
                      >
                        <span>
                          <span class="block text-4xl font-light text-white">
                            {threshold}
                          </span>
                          <small
                            class="mt-1 block text-[8px] tracking-wider text-[#aab5be] uppercase"
                            >{vault.t(
                              'login.sentinel_card_stack_needed',
                            )}</small
                          >
                        </span>
                      </Select.Trigger>
                      <Select.Content
                        portalProps={{ disabled: true }}
                        class="border border-[#657580] bg-[#192128] p-1 text-[#d7e0e6] shadow-2xl ring-0"
                      >
                        {#each Array.from({ length: participantCount - 1 }, (_, index) => index + 2) as option (option)}
                          <Select.Item
                            value={String(option)}
                            class="rounded-none px-3 py-2 font-mono text-sm text-[#d7e0e6] data-highlighted:bg-[#33414b] data-highlighted:text-white"
                            data-testid={`sentinel-threshold-option-${option}`}
                          >
                            {option}
                          </Select.Item>
                        {/each}
                      </Select.Content>
                    </Select.Root>
                    <span class="text-3xl font-light text-white/35">/</span>
                    <span
                      class="block w-full text-left"
                      data-testid="sentinel-genesis-participant-count"
                      data-value={participantCount}
                    >
                      <span>
                        <span class="block text-4xl font-light text-white">
                          {participantCount}
                        </span>
                        <small
                          class="mt-1 block text-[8px] tracking-wider text-[#aab5be] uppercase"
                          >{vault.t('login.sentinel_card_stack_total')}</small
                        >
                      </span>
                    </span>
                  </span>
                </div>
                <div
                  class="border border-[#7b8993] bg-[#192128] px-5 py-3 font-mono text-xs text-[#d7e0e6]"
                >
                  {vault.t('login.sentinel_onboarding_threshold_summary', {
                    threshold: String(threshold),
                    count: String(participantCount),
                  })}
                </div>
              </div>
            {:else}
              <div
                class="relative mt-10 grid min-h-72 place-items-center border border-white/10 bg-black/10 p-8 text-center"
                data-testid="sentinel-onboarding-guidance"
              >
                <div class="max-w-md">
                  <span
                    class="mx-auto grid size-16 place-items-center rounded-full border border-[#79dfff]/30 bg-[#79dfff]/5 text-[#79dfff] shadow-[0_0_50px_rgb(82_198_238/0.1)]"
                  >
                    {#if onboardingStage === 'identity'}
                      <Cpu class="size-7" />
                    {:else}
                      <Plus class="size-7" />
                    {/if}
                  </span>
                  <h2 class="mt-6 text-2xl font-semibold">
                    {onboardingStage === 'identity'
                      ? vault.t('login.sentinel_onboarding_create_keys_title')
                      : vault.t('login.sentinel_onboarding_add_devices_title')}
                  </h2>
                  <p class="mt-3 text-sm leading-6 text-[#9eabb5]">
                    {onboardingStage === 'identity'
                      ? vault.t(
                          'login.sentinel_onboarding_create_keys_description',
                        )
                      : vault.t(
                          'login.sentinel_onboarding_add_devices_description',
                        )}
                  </p>
                </div>
              </div>
            {/if}
          {:else}
            <div
              class="relative mt-10 space-y-5"
              data-testid="sentinel-genesis-ceremony-step"
            >
              <div>
                <h2 class="text-xl font-semibold">
                  {vault.t('login.sentinel_genesis_collect_title')}
                </h2>
                <p class="mt-2 text-sm leading-6 text-[#aeb8c2]">
                  {vault.t('login.sentinel_genesis_collect_description')}
                </p>
              </div>
              <div
                class="border border-white/10 bg-black/10 p-5"
                data-testid="sentinel-genesis-request"
              >
                <div class="flex items-start justify-between gap-4">
                  <div>
                    <p class="text-sm font-semibold">
                      {vault.t('login.sentinel_genesis_request_title')}
                    </p>
                    <p class="mt-1 text-xs text-[#aeb8c2]">
                      {vault.t('login.sentinel_genesis_request_description')}
                    </p>
                  </div>
                  <span
                    class="font-mono text-xs text-[#aeb8c2]"
                    data-testid="sentinel-genesis-progress"
                  >
                    {rosterCount} / {participantCount}
                  </span>
                </div>
                {#if request}
                  <div class="mt-5 grid gap-4 sm:grid-cols-[150px_1fr]">
                    <EnrollmentQrCode
                      enrollmentLink={request}
                      loadingLabel={vault.t(
                        'login.sentinel_genesis_qr_loading',
                      )}
                    />
                    <div class="space-y-3">
                      <textarea
                        class="min-h-28 w-full border border-white/15 bg-[#192128] p-3 font-mono text-xs text-white"
                        readonly
                        data-testid="sentinel-genesis-request-output"
                        value={request}></textarea>
                      <Button
                        type="button"
                        variant="outline"
                        class="border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white"
                        data-testid="sentinel-genesis-copy-request"
                        onclick={() => void copyRequest()}
                      >
                        <Copy class="size-4" />
                        {copied
                          ? vault.t('common.copied')
                          : vault.t('common.copy')}
                      </Button>
                    </div>
                  </div>
                {/if}
              </div>
              <p
                class="border border-white/10 bg-black/10 p-4 text-xs leading-5 text-[#aeb8c2]"
              >
                {vault.t('login.sentinel_genesis_atomic_notice')}
              </p>
            </div>
          {/if}
        </div>

        <div class="mt-6 flex flex-wrap items-center justify-between gap-5">
          {#if onboardingStage === 'policy' || status !== 'idle'}
            <label class="flex items-center gap-3 text-xs text-[#a4afb9]">
              <span
                class="grid size-6 place-items-center rounded border border-white/20 bg-white/5"
                ><Check class="size-3" /></span
              >
              {vault.t('login.sentinel_card_stack_shares_return')}
            </label>
          {:else}
            <span></span>
          {/if}
          {#if status === 'idle' && onboardingStage === 'policy'}
            <button
              disabled={!policyValid || isBusy || actionBusy}
              class="rounded-md bg-[#46e56f] px-8 py-4 text-xs font-bold tracking-wide text-[#112218] uppercase shadow-[0_12px_30px_rgb(45_225_99/0.22)] transition hover:-translate-y-0.5 hover:bg-[#6bed8c] disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-25"
              data-testid="sentinel-genesis-start"
              onclick={() => void start()}
            >
              {vault.t('login.sentinel_onboarding_build_action')}
            </button>
          {:else if status === 'collecting' || status === 'ready' || status === 'finalizing'}
            <button
              disabled={status !== 'ready' || isBusy || actionBusy}
              class="rounded-md bg-[#46e56f] px-7 py-4 text-xs font-bold tracking-wide text-[#112218] uppercase shadow-[0_12px_30px_rgb(45_225_99/0.18)] disabled:opacity-25"
              data-testid="sentinel-genesis-finalize"
              onclick={() => void finalize()}
            >
              {#if actionBusy}<RefreshCw
                  class="mr-2 inline size-4 animate-spin"
                />{/if}
              {vault.t('login.sentinel_genesis_finalize')}
            </button>
          {/if}
        </div>

        {#if status === 'delivering' || deliveries.length > 0}
          <div class="mt-8 space-y-4" data-testid="sentinel-genesis-deliveries">
            <h2 class="text-lg font-semibold">
              {vault.t('login.sentinel_genesis_delivery_title')}
            </h2>
            <p class="text-sm text-[#aeb8c2]">
              {vault.t('login.sentinel_genesis_delivery_description')}
            </p>
            {#each deliveries as delivery, index (delivery.participantId)}
              <div
                class="grid gap-4 border border-white/10 bg-[#242d35] p-4 sm:grid-cols-[120px_1fr]"
                data-testid="sentinel-genesis-delivery"
              >
                <EnrollmentQrCode
                  enrollmentLink={delivery.payload}
                  loadingLabel={vault.t('login.sentinel_genesis_qr_loading')}
                />
                <div class="space-y-2">
                  <p class="text-sm font-semibold">
                    {vault.t('login.sentinel_genesis_delivery_participant')}
                    {index + 1}
                  </p>
                  <textarea
                    class="min-h-20 w-full border border-white/15 bg-[#192128] p-3 font-mono text-xs text-white"
                    readonly
                    data-testid="sentinel-genesis-delivery-output"
                    value={delivery.payload}></textarea>
                </div>
              </div>
            {/each}
            <div class="flex justify-end">
              <Button
                type="button"
                data-testid="sentinel-genesis-delivery-complete"
                onclick={() => void onCompleteDelivery()}
              >
                {vault.t('common.done')}
              </Button>
            </div>
          </div>
        {/if}
      </div>
    </div>

    <footer
      class="mt-14 border-t border-white/[0.08] pt-5 text-center font-mono text-[8px] tracking-[0.14em] text-[#65717b] uppercase"
    >
      {vault.t('login.sentinel_card_stack_footer')}
    </footer>
  </section>
</div>
