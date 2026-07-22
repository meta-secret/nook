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
  import {
    copySentinelRequest,
    runSentinelDashboardAction,
  } from '$lib/components/login/sentinel-dashboard-actions'
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

  type OnboardingStage = 'identity' | 'name' | 'policy' | 'roster' | 'build'

  type Participant = {
    participantId: string
    label: string
    fingerprint: string
  }

  type Delivery = {
    participantId: string
    fingerprint?: string
    payload: string
    sharePayload?: string
  }

  let {
    vault,
    name = $bindable(''),
    participantCount = $bindable(3),
    threshold = $bindable(2),
    status,
    request,
    participantResponse = '',
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
    participantResponse?: string
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
    onAddParticipant: (
      payload: string,
      participantLabel: string,
    ) => void | Promise<void>
    onFinalize: () => void | Promise<void>
    onCompleteDelivery: () => void | Promise<void>
  } = $props()

  let response = $state('')
  let loadedParticipantResponse = $state('')
  let participantLabel = $state('')
  let actionBusy = $state(false)
  let copied = $state(false)
  let selected = $state(0)
  let participantInputError = $state('')
  let deliveriesAcknowledged = $state(false)
  let onboardingStage = $state<OnboardingStage>('identity')

  const participantChoices = [3, 4, 5]

  const memberDeliveries = $derived(
    deliveries.filter((delivery) => delivery.participantId !== vault.deviceId),
  )
  const initiatorKeyReady = $derived(
    Boolean(participants[0]?.fingerprint || initiatorFingerprint),
  )
  const rosterCount = $derived(
    initiatorKeyReady ? Math.max(1, participants.length) : 0,
  )
  const availableRosterSlots = $derived(
    Math.max(0, participantCount - rosterCount),
  )
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
      : onboardingStage === 'name' || onboardingStage === 'policy'
        ? 1
        : onboardingStage === 'roster'
          ? 2
          : 3,
  )

  $effect(() => {
    const incomingResponse = participantResponse.trim()
    if (
      incomingResponse &&
      incomingResponse !== loadedParticipantResponse &&
      status === 'collecting'
    ) {
      response = incomingResponse
      loadedParticipantResponse = incomingResponse
      participantInputError = ''
    }
  })

  $effect(() => {
    if (status === 'collecting') {
      onboardingStage = 'roster'
    } else if (status !== 'idle') {
      onboardingStage = 'build'
    } else if (initiatorKeyReady && onboardingStage === 'identity') {
      onboardingStage = 'name'
    } else if (!initiatorKeyReady) {
      onboardingStage = 'identity'
    }
  })

  function changeParticipantCount(value: string | undefined) {
    if (!value) return
    participantCount = Number(value)
  }

  function changeThreshold(value: string | undefined) {
    if (!value) return
    threshold = Number(value)
  }

  function continueToPolicy() {
    if (!initiatorKeyReady || !name.trim() || isBusy || actionBusy) return
    onboardingStage = 'policy'
  }

  async function continueToRoster() {
    if (!initiatorKeyReady || !policyValid || isBusy || actionBusy) return
    actionBusy = true
    try {
      const started = await onStart({
        label: name.trim(),
        participantCount,
        threshold,
      })
      if (started !== false) onboardingStage = 'roster'
    } catch {
      // The vault action publishes the core error through the shared error UI.
    } finally {
      actionBusy = false
    }
  }

  async function addParticipant() {
    const payload = response.trim()
    if (
      !payload ||
      status !== 'collecting' ||
      availableRosterSlots === 0 ||
      isBusy ||
      actionBusy
    )
      return
    actionBusy = true
    try {
      await onAddParticipant(payload, participantLabel.trim())
      response = ''
      participantLabel = ''
      participantInputError = ''
      selected = participants.length
    } catch {
      participantInputError = vault.t(
        'login.sentinel_genesis_participant_import_failed',
      )
      vault.errorMsg = participantInputError
    } finally {
      actionBusy = false
    }
  }

</script>

<div
  class="min-h-screen overflow-hidden bg-[#10141a] text-white [background-image:radial-gradient(circle_at_50%_-10%,#53606d_0,transparent_42%),radial-gradient(circle_at_15%_90%,#25303a_0,transparent_36%)]"
  data-testid="sentinel-card-stack-dashboard"
  data-sentinel-dashboard-focus
  tabindex="-1"
>
  <div
    class="pointer-events-none fixed inset-0 opacity-45 [background-image:radial-gradient(#a9b8c5_1px,transparent_1px)] [background-size:22px_22px]"
  ></div>

  <section class="relative mx-auto max-w-7xl px-6 pt-8 pb-12 sm:px-10 sm:pt-10">
    <header
      class="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between"
      data-testid="sentinel-dashboard-heading"
    >
      <div data-testid="sentinel-dashboard-brand">
        <p
          class="font-mono text-[10px] tracking-[0.24em] text-[#8a98a5] uppercase"
        >
          {vault.t('login.sentinel_card_stack_eyebrow')}
        </p>
        <h1 class="mt-1 text-3xl font-semibold tracking-[0.18em]">SENTINEL</h1>
      </div>

      {#if status === 'idle'}
        <button
          class="flex h-10 shrink-0 items-center gap-2 rounded-full border border-white/15 bg-black/40 px-4 text-xs font-semibold text-white backdrop-blur-md"
          data-testid="sentinel-dashboard-back"
          onclick={onBack}
        >
          <ArrowLeft class="size-4" aria-hidden="true" />
          {vault.t('login.sentinel_dashboard_change')}
        </button>
      {/if}
    </header>

    <ol
      class="mt-5 mb-8 grid gap-2 rounded-xl border border-white/10 bg-black/20 p-2 backdrop-blur-sm sm:grid-cols-4"
      data-testid="sentinel-onboarding-progress"
    >
      {#each [vault.t('login.sentinel_onboarding_step_keys'), vault.t('login.sentinel_onboarding_step_shares'), vault.t('login.sentinel_onboarding_step_devices'), vault.t('login.sentinel_onboarding_step_build')] as label, index (label)}
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

    <div class="grid gap-10 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
      <div data-testid="sentinel-onboarding-actions-column">
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
            data-testid="sentinel-onboarding-create-keys"
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

          {#if initiatorKeyReady && onboardingStage !== 'identity' && onboardingStage !== 'name'}
            <button
              type="button"
              class="grid w-full grid-cols-[auto_1fr_auto] items-center gap-5 border border-l-2 border-white/10 border-l-[#63eaa1] bg-[#303840]/85 px-5 py-4 text-left transition hover:border-[#6ed9ff]/60 hover:bg-[#37424b] disabled:cursor-default disabled:hover:border-white/10 disabled:hover:border-l-[#63eaa1] disabled:hover:bg-[#303840]/85"
              data-testid="sentinel-onboarding-name-summary-card"
              aria-label={vault.t('login.vault_name_label')}
              disabled={status !== 'idle' || isBusy || actionBusy}
              onclick={() => (onboardingStage = 'name')}
            >
              <span
                class="grid size-10 place-items-center border border-[#71808b] bg-[#202830] font-mono text-[10px] text-[#79dfff]"
              >
                02
              </span>
              <span class="min-w-0">
                <span
                  class="block font-mono text-[9px] tracking-[0.16em] text-[#9ba7b1] uppercase"
                >
                  {vault.t('login.vault_name_label')}
                </span>
                <b class="mt-1 block truncate text-sm text-white">{name}</b>
              </span>
              <Check class="size-4 text-[#63eaa1]" />
            </button>
          {/if}

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

          {#if status === 'collecting' && availableRosterSlots > 0}
            <div class="border border-dashed border-[#aeb8c2] p-4">
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
                  class="grid size-10 shrink-0 place-items-center rounded-full bg-white text-[#1f2830] disabled:opacity-30"
                  data-testid="sentinel-genesis-add-participant"
                  aria-label={vault.t('login.sentinel_genesis_add_participant')}
                  disabled={!participantLabel.trim() ||
                    !response.trim() ||
                    isBusy ||
                    actionBusy}
                  onclick={() => void addParticipant()}
                >
                  {#if actionBusy}<RefreshCw
                      class="size-5 animate-spin"
                    />{:else}<Plus class="size-5" />{/if}
                </button>
              </div>
              <div
                class="mt-4 grid gap-4"
                data-testid="sentinel-genesis-participant-fields"
              >
                <label
                  class="text-[9px] tracking-wider text-[#8d99a4] uppercase"
                >
                  {vault.t('login.sentinel_card_stack_device_name_label')}
                  <input
                    class="mt-2 h-11 w-full border border-white/20 bg-[#192128] px-3 text-sm text-white outline-none placeholder:text-[#596670] focus:border-[#6ed9ff]"
                    data-testid="sentinel-genesis-participant-name"
                    maxlength="80"
                    placeholder={vault.t(
                      'login.sentinel_card_stack_device_name_placeholder',
                    )}
                    bind:value={participantLabel}
                  />
                </label>
                {#if response}
                  <div
                    class="border border-[#63eaa1]/40 bg-[#63eaa1]/5 px-3 py-3"
                    data-testid="sentinel-genesis-authentication-ready"
                    aria-live="polite"
                  >
                    <p
                      class="flex items-center gap-2 text-[10px] font-semibold tracking-wider text-[#63eaa1] uppercase"
                    >
                      <Check class="size-4" />
                      {vault.t(
                        'login.sentinel_card_stack_authentication_ready',
                      )}
                    </p>
                    <p class="mt-2 text-xs leading-5 text-[#aeb8c2]">
                      {vault.t(
                        'login.sentinel_card_stack_authentication_ready_help',
                      )}
                    </p>
                  </div>
                {:else}
                  <div
                    class="border border-white/15 bg-white/[0.025] px-3 py-3"
                    data-testid="sentinel-genesis-authentication-instructions"
                  >
                    <p
                      class="text-[10px] font-semibold tracking-wider text-[#8d99a4] uppercase"
                    >
                      {vault.t(
                        'login.sentinel_card_stack_authentication_label',
                      )}
                    </p>
                    <p class="mt-2 text-xs leading-5 text-[#aeb8c2]">
                      {vault.t('login.sentinel_card_stack_authentication_help')}
                    </p>
                  </div>
                {/if}
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
              class="flex flex-wrap items-center justify-between gap-3 border border-white/10 bg-white/[0.035] px-4 py-3"
              data-testid="sentinel-onboarding-roster-next"
            >
              <p class="text-xs font-semibold text-[#d6dde3]">
                {vault.t('login.sentinel_onboarding_roster_title')}
              </p>
              <p
                class="font-mono text-[9px] tracking-wider text-[#8f9ca7] uppercase"
                data-testid="sentinel-onboarding-devices-remaining"
              >
                {vault.t('login.sentinel_onboarding_devices_remaining', {
                  count: String(availableRosterSlots),
                })}
              </p>
            </div>
          {/if}
        </div>

        {#if status === 'idle' && onboardingStage === 'name'}
          <section
            class="mt-5 border border-[#6ed9ff] bg-[#3b4650] px-5 py-5 shadow-[0_0_30px_rgb(82_198_238/0.08)]"
            data-testid="sentinel-genesis-name-step"
          >
            <div class="flex flex-wrap items-end gap-5">
              <label class="min-w-56 flex-1">
                <span
                  class="block font-mono text-[9px] tracking-[0.16em] text-[#79dfff]"
                >
                  {vault.t('login.landing_step_name')}
                </span>
                <span
                  class="mt-3 block text-[10px] tracking-[0.14em] text-[#b5c0c9] uppercase"
                >
                  {vault.t('login.vault_name_label')}
                </span>
                <input
                  class="mt-1 w-full border-b border-white/35 bg-transparent py-2 text-xl font-medium text-white outline-none placeholder:text-white/25 focus:border-[#79dfff]"
                  data-testid="sentinel-genesis-name-input"
                  placeholder={vault.t('login.vault_name_placeholder')}
                  bind:value={name}
                />
              </label>
              <button
                type="button"
                disabled={!name.trim() || isBusy || actionBusy}
                class="rounded-full border border-[#79dfff]/45 bg-[#79dfff]/10 px-5 py-3 font-mono text-[9px] tracking-wider text-[#79dfff] uppercase transition hover:bg-[#79dfff]/20 disabled:cursor-not-allowed disabled:opacity-30"
                data-testid="sentinel-onboarding-continue-policy"
                onclick={continueToPolicy}
              >
                {vault.t('login.create_wizard_continue')}
              </button>
            </div>
          </section>
        {:else if status === 'idle' && onboardingStage === 'policy'}
          <section
            class="mt-5 border border-[#6ed9ff] bg-[#3b4650] px-5 py-5 shadow-[0_0_30px_rgb(82_198_238/0.08)]"
            data-testid="sentinel-genesis-policy-step"
          >
            <p class="font-mono text-[9px] tracking-[0.16em] text-[#79dfff]">
              {vault.t('login.sentinel_onboarding_policy_step')}
            </p>
            <div class="mt-4" data-testid="sentinel-onboarding-policy">
              <div class="max-w-sm">
                <span
                  class="text-[10px] tracking-wider text-[#aab5be] uppercase"
                >
                  {vault.t('login.sentinel_card_stack_threshold_policy')}
                </span>
                <span
                  class="mt-2 grid h-16 grid-cols-[1fr_auto_1fr] items-center gap-4 border-b border-white/70"
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
                        <span class="block text-3xl font-light text-white">
                          {threshold}
                        </span>
                        <small
                          class="mt-1 block text-[8px] tracking-wider text-[#aab5be] uppercase"
                          >{vault.t('login.sentinel_card_stack_needed')}</small
                        >
                      </span>
                    </Select.Trigger>
                    <Select.Content
                      portalProps={{ disabled: true }}
                      side="top"
                      class="max-h-80 border border-[#657580] bg-[#192128] p-1 text-[#d7e0e6] shadow-2xl ring-0"
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
                  <span class="text-2xl font-light text-white/35">/</span>
                  <Select.Root
                    type="single"
                    value={String(participantCount)}
                    onValueChange={changeParticipantCount}
                  >
                    <Select.Trigger
                      class="h-auto w-full gap-3 rounded-none border-0 bg-transparent p-0 text-left text-white shadow-none focus-visible:ring-1 focus-visible:ring-[#79dfff] [&_svg]:text-[#aab5be]"
                      data-testid="sentinel-genesis-participant-count"
                      data-value={participantCount}
                      aria-label={vault.t(
                        'login.sentinel_genesis_participant_count',
                      )}
                    >
                      <span>
                        <span class="block text-3xl font-light text-white">
                          {participantCount}
                        </span>
                        <small
                          class="mt-1 block text-[8px] tracking-wider text-[#aab5be] uppercase"
                          >{vault.t('login.sentinel_card_stack_total')}</small
                        >
                      </span>
                    </Select.Trigger>
                    <Select.Content
                      portalProps={{ disabled: true }}
                      side="top"
                      class="max-h-80 border border-[#657580] bg-[#192128] p-1 text-[#d7e0e6] shadow-2xl ring-0"
                    >
                      {#each participantChoices as option (option)}
                        <Select.Item
                          value={String(option)}
                          class="rounded-none px-3 py-2 font-mono text-sm text-[#d7e0e6] data-highlighted:bg-[#33414b] data-highlighted:text-white"
                          data-testid={`sentinel-participant-count-option-${option}`}
                        >
                          {option}
                        </Select.Item>
                      {/each}
                    </Select.Content>
                  </Select.Root>
                </span>
              </div>
            </div>

            <div class="mt-5 flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                class="px-2 py-2 text-[10px] font-semibold tracking-wider text-[#aeb8c2] uppercase hover:text-white"
                data-testid="sentinel-onboarding-policy-back"
                onclick={() => (onboardingStage = 'name')}
              >
                {vault.t('common.back')}
              </button>
              <button
                disabled={!policyValid || isBusy || actionBusy}
                class="rounded-full bg-[#46e56f] px-5 py-3 text-[10px] font-bold tracking-wide text-[#112218] uppercase shadow-[0_8px_24px_rgb(45_225_99/0.18)] transition hover:bg-[#6bed8c] disabled:cursor-not-allowed disabled:opacity-25"
                data-testid="sentinel-onboarding-continue-devices"
                onclick={() => void continueToRoster()}
              >
                {vault.t('login.sentinel_onboarding_continue_with_devices', {
                  count: String(participantCount),
                })}
              </button>
            </div>
          </section>
        {:else if status === 'collecting' || status === 'ready' || status === 'finalizing'}
          <div class="mt-6 flex justify-end">
            <button
              disabled={status !== 'ready' || isBusy || actionBusy}
              class="rounded-md bg-[#46e56f] px-7 py-4 text-xs font-bold tracking-wide text-[#112218] uppercase shadow-[0_12px_30px_rgb(45_225_99/0.18)] disabled:opacity-25"
              data-testid="sentinel-genesis-finalize"
              onclick={() =>
                void runSentinelDashboardAction(
                  status === 'ready' && !isBusy && !actionBusy,
                  (value) => (actionBusy = value),
                  onFinalize,
                )}
            >
              {#if actionBusy}<RefreshCw
                  class="mr-2 inline size-4 animate-spin"
                />{/if}
              {vault.t('login.sentinel_genesis_finalize')}
            </button>
          </div>
        {/if}

        {#if status === 'delivering' || deliveries.length > 0}
          <div
            class="mt-8 rounded-lg border border-[#79dfff]/25 bg-[#79dfff]/5 p-6"
            data-testid="sentinel-onboarding-delivery-actions"
          >
            <p
              class="font-mono text-[10px] tracking-[0.16em] text-[#79dfff] uppercase"
            >
              {vault.t('login.sentinel_onboarding_vault_ready_step')}
            </p>
            <h2 class="mt-2 text-xl font-semibold">
              {vault.t('login.sentinel_onboarding_vault_ready_title')}
            </h2>
            <p class="mt-2 text-sm leading-relaxed text-[#aeb8c2]">
              {vault.t('login.sentinel_onboarding_vault_ready_description')}
            </p>
            <label
              class="mt-5 flex cursor-pointer items-start gap-3 border border-white/10 bg-black/10 p-3 text-xs leading-5 text-[#d7e0e6]"
            >
              <input
                type="checkbox"
                class="mt-0.5 size-4 accent-[#46e56f]"
                bind:checked={deliveriesAcknowledged}
                data-testid="sentinel-genesis-delivery-acknowledgement"
              />
              <span>
                {vault.t('login.sentinel_onboarding_delivery_acknowledgement')}
              </span>
            </label>
            <Button
              type="button"
              class="mt-5"
              data-testid="sentinel-genesis-delivery-complete"
              disabled={memberDeliveries.length === 0 ||
                !deliveriesAcknowledged}
              onclick={() => void onCompleteDelivery()}
            >
              {vault.t('login.sentinel_onboarding_finish_action')}
            </Button>
          </div>
        {/if}
      </div>

      <div data-testid="sentinel-onboarding-summary-column">
        <p
          class="font-mono text-[10px] tracking-[0.18em] text-[#88949f] uppercase"
        >
          {vault.t('login.sentinel_card_stack_active_configuration')}
        </p>
        <div
          class="relative mt-5 overflow-hidden border border-[#657580] border-l-4 border-l-[#6ed9ff] bg-[#242d35] p-5 shadow-[0_35px_80px_rgb(0_0_0/0.38)] [background-image:linear-gradient(rgb(255_255_255/0.025)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255/0.025)_1px,transparent_1px)] [background-size:32px_32px] sm:p-6"
          data-testid="sentinel-onboarding-vault-summary"
          data-layout="compact"
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

          <dl
            class="relative mt-5 grid gap-3 sm:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_auto]"
            data-testid="sentinel-onboarding-summary-details"
          >
            <div class="min-w-0 border border-white/10 bg-black/10 px-3 py-2">
              <dt
                class="font-mono text-[9px] tracking-[0.14em] text-[#7f8c97] uppercase"
              >
                {vault.t('login.sentinel_card_stack_module_identity')}
              </dt>
              <dd
                class="mt-1 truncate text-sm leading-tight font-semibold text-[#d7e0e6]"
                data-testid="sentinel-onboarding-summary-name"
              >
                {name.trim() || vault.t('login.sentinel_onboarding_not_set')}
              </dd>
            </div>
            <div class="min-w-0 border border-white/10 bg-black/10 px-3 py-2">
              <dt
                class="font-mono text-[9px] tracking-[0.14em] text-[#7f8c97] uppercase"
              >
                {vault.t('login.sentinel_card_stack_policy')}
              </dt>
              <dd
                class="mt-1 font-mono text-sm leading-tight text-[#d7e0e6]"
                data-testid="sentinel-onboarding-summary-policy"
              >
                {onboardingStage === 'identity' || onboardingStage === 'name'
                  ? vault.t('login.sentinel_onboarding_not_set')
                  : vault.t('login.sentinel_onboarding_threshold_summary', {
                      threshold: String(threshold),
                      count: String(participantCount),
                    })}
              </dd>
            </div>
            <div
              class="border border-white/10 bg-black/10 px-3 py-2 sm:min-w-28"
            >
              <dt
                class="font-mono text-[9px] tracking-[0.14em] text-[#7f8c97] uppercase"
              >
                {vault.t('login.sentinel_onboarding_devices_ready')}
              </dt>
              <dd
                class="mt-1 font-mono text-sm leading-tight text-[#d7e0e6]"
                data-testid="sentinel-onboarding-summary-devices"
              >
                {rosterCount} / {participantCount}
              </dd>
            </div>
          </dl>

          {#if status !== 'idle' && status !== 'delivering' && status !== 'complete'}
            <div
              class="relative mt-6 space-y-4"
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
                class="border border-white/10 bg-black/10 p-4"
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
                  <div class="mt-4 grid gap-4 sm:grid-cols-[150px_1fr]">
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
                        onclick={() =>
                          void copySentinelRequest(
                            request,
                            () => {
                              copied = true
                              setTimeout(() => (copied = false), 1500)
                            },
                            () =>
                              (vault.errorMsg = vault.t(
                                'login.sentinel_genesis_copy_failed',
                              )),
                          )}
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
                class="border border-white/10 bg-black/10 p-3 text-xs leading-5 text-[#aeb8c2]"
              >
                {vault.t('login.sentinel_genesis_atomic_notice')}
              </p>
            </div>
          {/if}
        </div>

        {#if onboardingStage !== 'identity' || status !== 'idle'}
          <div class="mt-6 flex items-center gap-3 text-xs text-[#a4afb9]">
            <span
              class="grid size-6 place-items-center rounded border border-white/20 bg-white/5"
              ><Check class="size-3" /></span
            >
            <span>
              {vault.t('login.sentinel_card_stack_shares_return')}
            </span>
          </div>
        {/if}

        {#if status === 'delivering' || deliveries.length > 0}
          <div class="mt-8 space-y-4" data-testid="sentinel-genesis-deliveries">
            <h2 class="text-lg font-semibold">
              {vault.t('login.sentinel_genesis_delivery_title')}
            </h2>
            <p class="text-sm text-[#aeb8c2]">
              {vault.t('login.sentinel_genesis_delivery_description')}
            </p>
            {#each memberDeliveries as delivery, index (delivery.participantId)}
              <div
                class="grid gap-4 border border-white/10 bg-[#242d35] p-4 sm:grid-cols-[120px_1fr]"
                data-testid="sentinel-genesis-delivery"
              >
                <EnrollmentQrCode
                  enrollmentLink={delivery.payload}
                  loadingLabel={vault.t('login.sentinel_genesis_qr_loading')}
                  dense
                />
                <div class="space-y-2">
                  <p class="text-sm font-semibold">
                    {vault.t('login.sentinel_genesis_delivery_participant')}
                    {index + 2}
                  </p>
                  <textarea
                    class="min-h-20 w-full border border-white/15 bg-[#192128] p-3 font-mono text-xs text-white"
                    readonly
                    data-testid="sentinel-genesis-delivery-output"
                    value={delivery.payload}></textarea>
                </div>
              </div>
            {/each}
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
