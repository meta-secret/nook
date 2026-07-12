<script lang="ts">
  import {
    ArrowLeft,
    Check,
    ChevronDown,
    Copy,
    Cpu,
    Plus,
    RefreshCw,
    ShieldCheck,
  } from '@lucide/svelte'
  import EnrollmentQrCode from '$lib/components/EnrollmentQrCode.svelte'
  import { Button } from '$lib/components/ui/button'
  import type { StartSentinelGenesisArgs, VaultState } from '$lib/vault.svelte'

  type SentinelGenesisStatus =
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
    status: SentinelGenesisStatus
    request: string
    participants: Participant[]
    deliveries: Delivery[]
    isBusy: boolean
    onBack: () => void
    onStart: (args: StartSentinelGenesisArgs) => void | Promise<void>
    onAddParticipant: (payload: string) => void | Promise<void>
    onFinalize: () => void | Promise<void>
    onCompleteDelivery: () => void | Promise<void>
  } = $props()

  let response = $state('')
  let actionBusy = $state(false)
  let copied = $state(false)
  let selected = $state(0)

  const rosterCount = $derived(Math.max(1, participants.length))
  const missing = $derived(Math.max(0, participantCount - rosterCount))
  const policyValid = $derived(
    name.trim().length > 0 &&
      Number.isInteger(participantCount) &&
      participantCount >= 2 &&
      participantCount <= 16 &&
      Number.isInteger(threshold) &&
      threshold >= 2 &&
      threshold <= participantCount,
  )

  function changeTotal(event: Event) {
    participantCount = Number((event.currentTarget as HTMLSelectElement).value)
    threshold = Math.min(threshold, participantCount)
  }

  function changeThreshold(event: Event) {
    threshold = Number((event.currentTarget as HTMLSelectElement).value)
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
    const payload = response.trim()
    if (!payload || isBusy || actionBusy) return
    actionBusy = true
    try {
      await onAddParticipant(payload)
      response = ''
      selected = Math.max(0, participants.length)
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
  class="min-h-screen overflow-hidden bg-[#10141a] text-white [background-image:radial-gradient(circle_at_50%_-10%,#53606d_0,transparent_42%),radial-gradient(circle_at_15%_90%,#25303a_0,transparent_36%)]"
  data-testid="sentinel-card-stack-dashboard"
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
    class="pointer-events-none fixed inset-0 opacity-25 [background-image:radial-gradient(#a9b8c5_0.7px,transparent_0.7px)] [background-size:22px_22px]"
  ></div>

  <section class="relative mx-auto max-w-7xl px-6 py-24 sm:px-10">
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
          <b>{threshold}-of-{participantCount}</b>
        </div>
        <div class="mt-2 flex justify-between text-xs">
          <span>{vault.t('login.sentinel_card_stack_keys_received')}</span>
          <b>{rosterCount}/{participantCount}</b>
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
        <div class="mt-5 space-y-3">
          <button
            class={`grid w-full grid-cols-[auto_1fr_auto] items-center gap-5 border border-l-2 px-5 py-5 text-left transition ${selected === 0 ? 'border-[#6ed9ff] bg-[#3b4650] shadow-[0_0_30px_rgb(82_198_238/0.08)]' : 'border-white/5 border-l-[#657580] bg-[#303840]/85'}`}
            onclick={() => (selected = 0)}
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
                {participants[0]?.fingerprint ??
                  vault.t('login.sentinel_card_stack_key_pending')}
                ·
                {vault.t('login.sentinel_card_stack_automatically_included')}
              </span>
            </span>
            <Check class="size-4 text-[#63eaa1]" />
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

          {#if missing > 0}
            <div class="border border-dashed border-[#aeb8c2] p-5">
              <div class="flex items-center justify-between gap-4">
                <div>
                  <p class="text-sm text-[#d6dde3]">
                    {vault.t('login.sentinel_card_stack_add_participant')}
                  </p>
                  <p class="mt-1 font-mono text-[9px] text-[#75818c]">
                    {vault.t('login.sentinel_card_stack_slots_remaining', {
                      count: String(missing),
                    })}
                  </p>
                </div>
                <button
                  class="grid size-12 shrink-0 place-items-center rounded-full bg-white text-[#1f2830] disabled:opacity-30"
                  data-testid="sentinel-genesis-add-participant"
                  aria-label={vault.t('login.sentinel_genesis_add_participant')}
                  disabled={status === 'idle' || !response.trim() || actionBusy}
                  onclick={() => void addParticipant()}
                >
                  {#if actionBusy}<RefreshCw
                      class="size-5 animate-spin"
                    />{:else}<Plus class="size-5" />{/if}
                </button>
              </div>
              {#if status === 'idle'}
                <p class="mt-5 text-xs leading-5 text-[#8d99a4]">
                  {vault.t('login.sentinel_card_stack_start_hint')}
                </p>
              {:else}
                <label
                  class="mt-5 block text-[9px] tracking-wider text-[#8d99a4] uppercase"
                >
                  {vault.t('login.sentinel_genesis_response_label')}
                  <textarea
                    class="mt-2 min-h-24 w-full border border-white/15 bg-[#192128] p-3 font-mono text-xs text-white outline-none placeholder:text-[#596670] focus:border-[#6ed9ff]"
                    data-testid="sentinel-genesis-response-input"
                    placeholder={vault.t(
                      'login.sentinel_genesis_response_placeholder',
                    )}
                    bind:value={response}></textarea>
                </label>
              {/if}
            </div>
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
          data-testid={status === 'idle'
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
            <div class="relative mt-10 border border-white/10 bg-black/10 p-5">
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
                  <label class="relative cursor-pointer">
                    <select
                      class="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
                      data-testid="sentinel-genesis-threshold"
                      value={threshold}
                      onchange={changeThreshold}
                      aria-label={vault.t('login.sentinel_genesis_threshold')}
                    >
                      {#each Array.from({ length: participantCount - 1 }, (_, index) => index + 2) as option (option)}
                        <option value={option}>{option}</option>
                      {/each}
                    </select>
                    <span class="block text-4xl font-light text-white">
                      {threshold}
                    </span>
                    <ChevronDown
                      class="pointer-events-none absolute top-3 right-1 size-4 text-[#aab5be]"
                    />
                    <small
                      class="mt-1 block text-[8px] tracking-wider text-[#aab5be] uppercase"
                      >{vault.t('login.sentinel_card_stack_needed')}</small
                    >
                  </label>
                  <span class="text-3xl font-light text-white/35">/</span>
                  <label class="relative cursor-pointer">
                    <select
                      class="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
                      data-testid="sentinel-genesis-participant-count"
                      value={participantCount}
                      onchange={changeTotal}
                      aria-label={vault.t(
                        'login.sentinel_genesis_participant_count',
                      )}
                    >
                      {#each Array.from({ length: 15 }, (_, index) => index + 2) as option (option)}
                        <option value={option}>{option}</option>
                      {/each}
                    </select>
                    <span class="block text-4xl font-light text-white">
                      {participantCount}
                    </span>
                    <ChevronDown
                      class="pointer-events-none absolute top-3 right-1 size-4 text-[#aab5be]"
                    />
                    <small
                      class="mt-1 block text-[8px] tracking-wider text-[#aab5be] uppercase"
                      >{vault.t('login.sentinel_card_stack_total')}</small
                    >
                  </label>
                </span>
              </div>
              <div
                class="border border-[#7b8993] bg-[#192128] px-5 py-3 font-mono text-xs text-[#d7e0e6]"
              >
                {vault.t('login.sentinel_card_stack_keys_missing', {
                  count: String(missing),
                })}
              </div>
            </div>
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
          <label class="flex items-center gap-3 text-xs text-[#a4afb9]">
            <span
              class="grid size-6 place-items-center rounded border border-white/20 bg-white/5"
              ><Check class="size-3" /></span
            >
            {vault.t('login.sentinel_card_stack_shares_return')}
          </label>
          {#if status === 'idle'}
            <button
              disabled={!policyValid || isBusy || actionBusy}
              class="rounded-md bg-[#46e56f] px-7 py-4 text-xs font-bold tracking-wide text-[#112218] uppercase shadow-[0_12px_30px_rgb(45_225_99/0.18)] disabled:opacity-25"
              data-testid="sentinel-genesis-start"
              onclick={() => void start()}
            >
              {vault.t('login.sentinel_genesis_start')}
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
