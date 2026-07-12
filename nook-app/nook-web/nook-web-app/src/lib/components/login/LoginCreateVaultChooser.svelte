<script lang="ts">
  import {
    Check,
    Cloud,
    Copy,
    KeyRound,
    Layers3,
    RefreshCw,
    Shield,
    ShieldCheck,
    Terminal,
    UserPlus,
    Users,
  } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import EnrollmentQrCode from '$lib/components/EnrollmentQrCode.svelte'
  import SentinelCardStackDashboard from '$lib/components/login/SentinelCardStackDashboard.svelte'
  import SentinelTerminalDashboard from '$lib/components/login/SentinelTerminalDashboard.svelte'
  import SentinelUnlockParticipantHelper from '$lib/components/login/SentinelUnlockParticipantHelper.svelte'
  import type { StartSentinelGenesisArgs, VaultState } from '$lib/vault.svelte'

  type SentinelGenesisStatus =
    | 'idle'
    | 'collecting'
    | 'ready'
    | 'finalizing'
    | 'delivering'
    | 'complete'

  type SentinelGenesisDelivery = {
    participantId: string
    fingerprint?: string
    payload: string
  }

  type SentinelGenesisParticipantSummary = {
    participantId: string
    label: string
    fingerprint: string
  }

  type WizardStep =
    | 'name'
    | 'choose'
    | 'simple-create'
    | 'sentinel-dashboard'
    | 'sentinel-policy'
    | 'sentinel-ceremony'
    | 'join'

  type ChosenPath = 'undecided' | 'simple' | 'sentinel' | 'join'
  type SentinelDashboard = 'card-stack' | 'terminal'

  let {
    vault,
    isVerifying,
    isInitializing,
    onCreateDeviceVault,
    onConnectStorage,
    onStartSentinelGenesis,
    onAddSentinelGenesisParticipantResponse,
    onFinalizeSentinelGenesis,
    onCreateSentinelGenesisParticipantResponse,
    onCreateSentinelGenesisPublicKeyAnnouncement,
    onRememberSentinelGenesisRequest,
    onReceiveSentinelGenesisShare,
    onCompleteSentinelGenesisDelivery,
    sentinelGenesisStatus = 'idle',
    sentinelGenesisRequest = '',
    sentinelGenesisParticipantCount = 0,
    sentinelGenesisParticipants = [],
    sentinelGenesisDeliveries = [],
  }: {
    vault: VaultState
    isVerifying: boolean
    isInitializing: boolean
    onCreateDeviceVault: (label: string) => void | Promise<void>
    onConnectStorage: () => void
    onStartSentinelGenesis?: (
      args: StartSentinelGenesisArgs,
    ) => boolean | void | Promise<boolean | void>
    onAddSentinelGenesisParticipantResponse?: (
      payload: string,
    ) => void | Promise<void>
    onFinalizeSentinelGenesis?: () => void | Promise<void>
    onCreateSentinelGenesisParticipantResponse?: (
      requestPayload: string,
    ) => string | Promise<string>
    onCreateSentinelGenesisPublicKeyAnnouncement?: () =>
      | string
      | Promise<string>
    onRememberSentinelGenesisRequest?: (
      requestPayload: string,
    ) => void | Promise<void>
    onReceiveSentinelGenesisShare?: (
      sharePayload: string,
    ) => void | Promise<void>
    onCompleteSentinelGenesisDelivery?: () => void | Promise<void>
    sentinelGenesisStatus?: SentinelGenesisStatus
    sentinelGenesisRequest?: string
    sentinelGenesisParticipantCount?: number
    sentinelGenesisParticipants?: SentinelGenesisParticipantSummary[]
    sentinelGenesisDeliveries?: SentinelGenesisDelivery[]
  } = $props()

  const isBusy = $derived(isVerifying || isInitializing)
  let wizardStep = $state<WizardStep>('name')
  let chosenPath = $state<ChosenPath>('undecided')
  let vaultName = $state('')
  let sentinelName = $state('')
  let sentinelDashboard = $state<SentinelDashboard | null>(null)
  let sentinelParticipantCount = $state(3)
  let sentinelThreshold = $state(2)
  let participantResponse = $state('')
  let copyingRequest = $state(false)
  let copyingJoinResponse = $state(false)
  let sentinelActionBusy = $state(false)
  let participantRequest = $state('')
  let sessionParticipantRequest = $state('')
  let generatedParticipantResponse = $state('')
  let generatedParticipantFingerprint = $state('')
  let participantShare = $state('')
  let joinPublicKeysLoading = $state(false)

  $effect(() => {
    if (
      wizardStep === 'join' &&
      !generatedParticipantResponse &&
      !joinPublicKeysLoading &&
      onCreateSentinelGenesisPublicKeyAnnouncement
    ) {
      void loadJoinPublicKeys()
    }
  })

  async function loadJoinPublicKeys() {
    if (
      joinPublicKeysLoading ||
      generatedParticipantResponse ||
      !onCreateSentinelGenesisPublicKeyAnnouncement
    ) {
      return
    }
    joinPublicKeysLoading = true
    try {
      generatedParticipantResponse =
        await onCreateSentinelGenesisPublicKeyAnnouncement()
      const announcement = JSON.parse(generatedParticipantResponse) as {
        fingerprint?: string
      }
      generatedParticipantFingerprint = announcement.fingerprint ?? ''
    } catch (error) {
      generatedParticipantResponse = ''
      generatedParticipantFingerprint = ''
      vault.errorMsg =
        error instanceof Error
          ? error.message
          : vault.t('login.sentinel_genesis_response_failed')
    } finally {
      joinPublicKeysLoading = false
    }
  }

  $effect(() => {
    if (sentinelGenesisStatus === 'complete') {
      sentinelDashboard = null
      return
    }
    if (sentinelGenesisStatus !== 'idle') {
      sentinelDashboard ??= 'card-stack'
      wizardStep = 'sentinel-ceremony'
      chosenPath = 'sentinel'
    }
  })

  const trimmedVaultName = $derived(vaultName.trim())
  const vaultNameReady = $derived(trimmedVaultName.length > 0)
  const sentinelNameReady = $derived(sentinelName.trim().length > 0)
  const sentinelPolicyValid = $derived(
    Number.isInteger(sentinelParticipantCount) &&
      Number.isInteger(sentinelThreshold) &&
      sentinelParticipantCount >= 2 &&
      sentinelParticipantCount <= 16 &&
      sentinelThreshold >= 2 &&
      sentinelThreshold <= sentinelParticipantCount,
  )
  const sentinelReadyToFinalize = $derived(sentinelGenesisStatus === 'ready')
  const sentinelDashboardActive = $derived(
    sentinelDashboard !== null &&
      (wizardStep === 'sentinel-policy' || wizardStep === 'sentinel-ceremony'),
  )
  const showImportFooter = $derived(
    wizardStep === 'name' ||
      wizardStep === 'choose' ||
      wizardStep === 'simple-create' ||
      wizardStep === 'sentinel-dashboard',
  )
  const canGoBack = $derived(
    wizardStep === 'choose' ||
      wizardStep === 'simple-create' ||
      wizardStep === 'sentinel-dashboard' ||
      wizardStep === 'sentinel-policy' ||
      wizardStep === 'join',
  )

  const stepIndex = $derived.by(() => {
    switch (wizardStep) {
      case 'name':
        return 0
      case 'choose':
        return 1
      case 'simple-create':
      case 'sentinel-dashboard':
      case 'sentinel-policy':
      case 'join':
      case 'sentinel-ceremony':
        return 2
    }
  })

  const progressSteps = $derived.by(() => {
    const name = vault.t('login.landing_step_name')
    const choose = vault.t('login.landing_step_choose')
    if (chosenPath === 'simple') {
      return [name, choose, vault.t('login.landing_step_simple')]
    }
    if (chosenPath === 'sentinel') {
      return [name, choose, vault.t('login.landing_step_sentinel')]
    }
    if (chosenPath === 'join') {
      return [name, choose, vault.t('login.landing_step_join')]
    }
    return [name, choose, vault.t('login.landing_step_create_or_configure')]
  })

  function portal(node: HTMLElement, enabled: boolean) {
    const anchor = document.createComment('sentinel-dashboard-home')
    node.before(anchor)

    function update(active: boolean) {
      if (active) {
        document.body.appendChild(node)
      } else {
        anchor.parentNode?.insertBefore(node, anchor.nextSibling)
      }
    }

    update(enabled)
    return {
      update,
      destroy() {
        node.remove()
        anchor.remove()
      },
    }
  }

  function continueAfterName() {
    if (!vaultNameReady || isBusy) return
    wizardStep = 'choose'
  }

  function chooseSimplePath() {
    vault.draftVaultType = 'simple'
    chosenPath = 'simple'
    wizardStep = 'simple-create'
  }

  function chooseSentinelCreatePath() {
    vault.draftVaultType = 'sentinel'
    chosenPath = 'sentinel'
    if (!sentinelName.trim()) {
      sentinelName = trimmedVaultName
    }
    sentinelDashboard = null
    wizardStep = 'sentinel-dashboard'
  }

  function chooseSentinelDashboard(dashboard: SentinelDashboard) {
    sentinelDashboard = dashboard
    wizardStep = 'sentinel-policy'
  }

  function chooseJoinPath() {
    chosenPath = 'join'
    wizardStep = 'join'
  }

  function goBack() {
    if (wizardStep === 'sentinel-ceremony') return
    if (wizardStep === 'choose') {
      chosenPath = 'undecided'
      wizardStep = 'name'
      return
    }
    if (wizardStep === 'simple-create' || wizardStep === 'join') {
      chosenPath = 'undecided'
      wizardStep = 'choose'
    }
    if (wizardStep === 'sentinel-dashboard') {
      sentinelDashboard = null
      chosenPath = 'undecided'
      wizardStep = 'choose'
      return
    }
    if (wizardStep === 'sentinel-policy') {
      sentinelDashboard = null
      wizardStep = 'sentinel-dashboard'
    }
  }

  async function createSimpleVault() {
    if (!vaultNameReady || isBusy) return
    await onCreateDeviceVault(trimmedVaultName)
  }

  async function startSentinelGenesis() {
    if (
      !sentinelNameReady ||
      !sentinelPolicyValid ||
      isBusy ||
      sentinelActionBusy ||
      !onStartSentinelGenesis
    ) {
      return
    }
    sentinelActionBusy = true
    try {
      const started = await onStartSentinelGenesis({
        label: sentinelName.trim(),
        participantCount: sentinelParticipantCount,
        threshold: sentinelThreshold,
      })
      if (started !== false) {
        wizardStep = 'sentinel-ceremony'
      }
    } finally {
      sentinelActionBusy = false
    }
  }

  async function addParticipantResponse() {
    const payload = participantResponse.trim()
    if (
      !payload ||
      sentinelActionBusy ||
      !onAddSentinelGenesisParticipantResponse
    ) {
      return
    }
    sentinelActionBusy = true
    try {
      await onAddSentinelGenesisParticipantResponse(payload)
      participantResponse = ''
    } finally {
      sentinelActionBusy = false
    }
  }

  async function finalizeSentinelGenesis() {
    if (
      !sentinelReadyToFinalize ||
      sentinelActionBusy ||
      !onFinalizeSentinelGenesis
    ) {
      return
    }
    sentinelActionBusy = true
    try {
      await onFinalizeSentinelGenesis()
    } finally {
      sentinelActionBusy = false
    }
  }

  async function copyGenesisRequest() {
    if (!sentinelGenesisRequest) return
    try {
      await navigator.clipboard.writeText(sentinelGenesisRequest)
      copyingRequest = true
      setTimeout(() => {
        copyingRequest = false
      }, 1500)
    } catch {
      vault.errorMsg = vault.t('login.sentinel_genesis_copy_failed')
    }
  }

  async function copyJoinResponse() {
    if (!generatedParticipantResponse) return
    try {
      await navigator.clipboard.writeText(generatedParticipantResponse)
      copyingJoinResponse = true
      setTimeout(() => {
        copyingJoinResponse = false
      }, 1500)
    } catch {
      vault.errorMsg = vault.t('login.sentinel_genesis_copy_failed')
    }
  }

  async function createParticipantResponse() {
    const requestPayload = sessionParticipantRequest.trim()
    if (
      !requestPayload ||
      sentinelActionBusy ||
      !onCreateSentinelGenesisParticipantResponse
    ) {
      return
    }
    sentinelActionBusy = true
    try {
      generatedParticipantResponse =
        await onCreateSentinelGenesisParticipantResponse(requestPayload)
      const response = JSON.parse(generatedParticipantResponse) as {
        participant?: { fingerprint?: string }
      }
      generatedParticipantFingerprint = response.participant?.fingerprint ?? ''
    } catch (error) {
      generatedParticipantResponse = ''
      generatedParticipantFingerprint = ''
      vault.errorMsg =
        error instanceof Error
          ? error.message
          : vault.t('login.sentinel_genesis_response_failed')
    } finally {
      sentinelActionBusy = false
    }
  }

  function refreshJoinPublicKeys() {
    generatedParticipantResponse = ''
    generatedParticipantFingerprint = ''
    void loadJoinPublicKeys()
  }

  async function receiveParticipantShare() {
    const sharePayload = participantShare.trim()
    if (!sharePayload || sentinelActionBusy || !onReceiveSentinelGenesisShare)
      return
    sentinelActionBusy = true
    try {
      const requestPayload = participantRequest.trim()
      if (requestPayload && onRememberSentinelGenesisRequest) {
        await onRememberSentinelGenesisRequest(requestPayload)
      }
      await onReceiveSentinelGenesisShare(sharePayload)
      participantShare = ''
    } finally {
      sentinelActionBusy = false
    }
  }
</script>

<div
  class={[
    'animate-in fade-in duration-300',
    sentinelDashboardActive
      ? 'fixed inset-0 z-40 w-full overflow-y-auto bg-[#10141a] text-white'
      : 'w-full',
    sentinelDashboard === 'terminal' && sentinelDashboardActive
      ? 'sentinel-terminal bg-[#090b09] font-mono text-[#b7ff95]'
      : '',
    sentinelDashboard === 'card-stack' && sentinelDashboardActive
      ? 'sentinel-card-stack'
      : '',
  ]}
  data-testid="login-create-vault-chooser"
  data-sentinel-dashboard={sentinelDashboardActive
    ? sentinelDashboard
    : undefined}
  use:portal={sentinelDashboardActive}
>
  {#if sentinelDashboardActive && sentinelDashboard === 'card-stack'}
    <SentinelCardStackDashboard
      {vault}
      bind:name={sentinelName}
      bind:participantCount={sentinelParticipantCount}
      bind:threshold={sentinelThreshold}
      status={sentinelGenesisStatus}
      request={sentinelGenesisRequest}
      participants={sentinelGenesisParticipants}
      deliveries={sentinelGenesisDeliveries}
      isBusy={isBusy || sentinelActionBusy}
      onBack={goBack}
      onStart={() => startSentinelGenesis()}
      onAddParticipant={(payload) =>
        onAddSentinelGenesisParticipantResponse?.(payload)}
      onFinalize={() => onFinalizeSentinelGenesis?.()}
      onCompleteDelivery={() => onCompleteSentinelGenesisDelivery?.()}
    />
  {:else if sentinelDashboardActive && sentinelDashboard === 'terminal'}
    <SentinelTerminalDashboard
      {vault}
      bind:name={sentinelName}
      bind:participantCount={sentinelParticipantCount}
      bind:threshold={sentinelThreshold}
      status={sentinelGenesisStatus}
      request={sentinelGenesisRequest}
      participants={sentinelGenesisParticipants}
      deliveries={sentinelGenesisDeliveries}
      isBusy={isBusy || sentinelActionBusy}
      onBack={goBack}
      onStart={() => startSentinelGenesis()}
      onAddParticipant={(payload) =>
        onAddSentinelGenesisParticipantResponse?.(payload)}
      onFinalize={() => onFinalizeSentinelGenesis?.()}
      onCompleteDelivery={() => onCompleteSentinelGenesisDelivery?.()}
    />
  {:else}
    <section
      class={[
        'mx-auto w-full',
        sentinelDashboardActive
          ? 'relative min-h-screen max-w-7xl px-5 py-20 sm:px-10'
          : 'grid max-w-6xl items-start gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-12',
      ]}
    >
      <div class={sentinelDashboardActive ? 'hidden' : 'space-y-5'}>
        <p
          class="font-mono text-[11px] tracking-[0.2em] text-muted-foreground uppercase"
        >
          {vault.t('login.landing_eyebrow')}
        </p>
        <h1
          class="text-4xl leading-[0.95] font-semibold tracking-tight text-foreground sm:text-5xl lg:text-6xl"
        >
          {vault.t('login.landing_headline')}
        </h1>
        <p
          class="max-w-md text-base leading-7 text-muted-foreground text-pretty"
        >
          {vault.t('login.landing_supporting')}
        </p>

        <div
          class="relative mt-8 grid min-h-[10rem] place-items-center lg:hidden"
        >
          <div
            class="relative grid size-28 place-items-center rounded-full bg-gradient-to-br from-muted via-muted/80 to-border shadow-lg shadow-black/10"
          >
            <div
              class="grid size-12 place-items-center rounded-full bg-foreground text-background"
            >
              <Shield class="size-5" />
            </div>
          </div>
        </div>
      </div>

      <div class={sentinelDashboardActive ? 'relative w-full' : ''}>
        <div
          class={sentinelDashboardActive
            ? 'hidden'
            : 'relative mb-8 hidden min-h-[12rem] place-items-center lg:grid'}
        >
          <div
            class="absolute size-56 rounded-full border border-border/60"
          ></div>
          <div class="absolute size-40 rounded-full border border-border"></div>
          <div
            class="relative grid size-28 place-items-center rounded-full bg-gradient-to-br from-muted via-muted/80 to-border shadow-xl shadow-black/15"
          >
            <div
              class="grid size-12 place-items-center rounded-full bg-foreground text-background"
            >
              <Shield class="size-5" />
            </div>
          </div>
        </div>

        <div
          class={[
            'relative',
            sentinelDashboardActive && sentinelDashboard === 'card-stack'
              ? 'sentinel-card-stack-panel rounded-none border border-[#657580] border-l-4 border-l-[#6ed9ff] bg-[#242d35] p-6 sm:p-10'
              : sentinelDashboardActive
                ? 'rounded-none border border-[#294323] bg-black/40 p-5 shadow-[0_0_80px_rgb(94_255_112/0.05)] sm:p-8'
                : 'rounded-xl border border-border bg-card/80 p-6 shadow-lg shadow-black/10 backdrop-blur-sm sm:p-8',
          ]}
        >
          {#if sentinelDashboardActive}
            <header
              class="mb-8 flex flex-col gap-6 border-b border-current/15 pb-7 sm:flex-row sm:items-end sm:justify-between"
              data-testid="sentinel-dashboard-header"
            >
              <div>
                <p
                  class="text-[10px] tracking-[0.22em] text-current/60 uppercase"
                >
                  {vault.t('login.sentinel_dashboard_workspace_eyebrow')}
                </p>
                <h2
                  class="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl"
                >
                  {sentinelDashboard === 'terminal'
                    ? vault.t('login.sentinel_dashboard_terminal_title')
                    : vault.t('login.sentinel_dashboard_card_stack_title')}
                </h2>
                <p class="mt-2 max-w-2xl text-sm leading-6 text-current/65">
                  {vault.t('login.sentinel_dashboard_workspace_description', {
                    name: sentinelName,
                  })}
                </p>
              </div>
              {#if wizardStep === 'sentinel-policy'}
                <Button
                  type="button"
                  variant="outline"
                  class="shrink-0 border-current/25 bg-transparent text-current hover:bg-current/10 hover:text-current"
                  data-testid="sentinel-dashboard-back"
                  disabled={isBusy || sentinelActionBusy}
                  onclick={goBack}
                >
                  {vault.t('login.sentinel_dashboard_change')}
                </Button>
              {/if}
            </header>
          {:else}
            <ol class="space-y-4">
              {#each progressSteps as label, index (`${chosenPath}-${label}`)}
                <li class="flex items-start gap-4">
                  <span
                    class={[
                      'mt-0.5 grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold',
                      index < stepIndex
                        ? 'bg-emerald-700 text-white'
                        : index === stepIndex
                          ? 'bg-foreground text-background'
                          : 'bg-muted text-muted-foreground',
                    ]}
                  >
                    {#if index < stepIndex}
                      <Check class="size-3.5" />
                    {:else}
                      {index + 1}
                    {/if}
                  </span>
                  <div class="min-w-0 flex-1">
                    <p
                      class={[
                        'text-lg',
                        index === stepIndex
                          ? 'font-semibold text-foreground'
                          : 'text-muted-foreground',
                      ]}
                    >
                      {label}
                    </p>

                    {#if index === stepIndex && wizardStep === 'name'}
                      <section
                        class="mt-3 space-y-3"
                        data-testid="landing-auth-step-name"
                      >
                        <input
                          id="login-vault-name"
                          type="text"
                          class="w-full border-b border-border bg-transparent py-2 text-base text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-foreground/50"
                          placeholder={vault.t('login.vault_name_placeholder')}
                          maxlength="64"
                          autocomplete="off"
                          data-testid="login-vault-name-input"
                          bind:value={vaultName}
                          disabled={isBusy}
                          onkeydown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault()
                              continueAfterName()
                            }
                          }}
                        />
                        <Button
                          type="button"
                          data-testid="landing-auth-name-continue"
                          disabled={isBusy || !vaultNameReady}
                          onclick={continueAfterName}
                        >
                          {vault.t('login.create_wizard_continue')}
                        </Button>
                      </section>
                    {:else if index === stepIndex && wizardStep === 'choose'}
                      <section
                        class="mt-3 space-y-3"
                        data-testid="landing-auth-step-choose"
                      >
                        <div
                          class="space-y-2"
                          data-testid="get-started-path-chooser"
                        >
                          <div
                            class="flex flex-wrap gap-2"
                            data-testid="get-started-path-list"
                          >
                            <button
                              type="button"
                              class="inline-flex items-center gap-2 rounded-md border border-border bg-background px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted/40 disabled:opacity-60"
                              data-testid="get-started-path-simple"
                              disabled={isBusy}
                              onclick={chooseSimplePath}
                            >
                              <KeyRound class="size-4 shrink-0" />
                              {vault.t('login.get_started_path_simple_title')}
                            </button>
                            <button
                              type="button"
                              class="inline-flex items-center gap-2 rounded-md bg-foreground px-4 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-60"
                              data-testid="get-started-path-sentinel"
                              disabled={isBusy}
                              onclick={chooseSentinelCreatePath}
                            >
                              <Users class="size-4 shrink-0" />
                              {vault.t('login.get_started_path_sentinel_title')}
                            </button>
                            <button
                              type="button"
                              class="inline-flex items-center gap-2 rounded-md border border-border bg-background px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted/40 disabled:opacity-60"
                              data-testid="get-started-path-join"
                              disabled={isBusy}
                              onclick={chooseJoinPath}
                            >
                              <UserPlus class="size-4 shrink-0" />
                              {vault.t('login.get_started_path_join_title')}
                            </button>
                          </div>
                          <p class="text-sm text-pretty text-muted-foreground">
                            {vault.t('login.get_started_paths_description')}
                          </p>
                        </div>
                      </section>
                    {:else if index === stepIndex && wizardStep === 'simple-create'}
                      <section
                        class="mt-3 space-y-3"
                        data-testid="landing-auth-step-simple"
                      >
                        <div
                          class="space-y-3"
                          data-testid="create-vault-wizard-create"
                        >
                          <p class="text-sm text-pretty text-muted-foreground">
                            {vault.t('login.landing_create_simple_locally', {
                              name: trimmedVaultName,
                            })}
                          </p>
                          <Button
                            type="button"
                            data-testid="login-create-device-vault-btn"
                            disabled={isBusy || !vaultNameReady}
                            onclick={() => void createSimpleVault()}
                          >
                            {#if isVerifying}
                              <RefreshCw class="size-4 animate-spin" />
                              {vault.t('login.creating_vault')}
                            {:else if isInitializing}
                              <RefreshCw class="size-4 animate-spin" />
                              {vault.t('onboarding.loading_engine')}
                            {:else}
                              <ShieldCheck class="size-4" />
                              {vault.t('login.landing_create_simple_btn')}
                            {/if}
                          </Button>
                        </div>
                      </section>
                    {:else if index === stepIndex && wizardStep === 'sentinel-dashboard'}
                      <section
                        class="mt-4 space-y-4"
                        data-testid="sentinel-dashboard-choice"
                      >
                        <p
                          class="text-sm leading-6 text-pretty text-muted-foreground"
                        >
                          {vault.t(
                            'login.sentinel_dashboard_choice_description',
                            {
                              name: trimmedVaultName,
                            },
                          )}
                        </p>
                        <div class="grid gap-3 sm:grid-cols-2">
                          <button
                            type="button"
                            class="group rounded-xl border border-border bg-background p-4 text-left transition hover:border-foreground/40 hover:shadow-md disabled:opacity-60"
                            data-testid="sentinel-dashboard-card-stack"
                            disabled={isBusy}
                            onclick={() =>
                              chooseSentinelDashboard('card-stack')}
                          >
                            <span
                              class="mb-4 grid size-10 place-items-center rounded-lg bg-foreground text-background"
                            >
                              <Layers3 class="size-5" />
                            </span>
                            <span
                              class="block text-sm font-semibold text-foreground"
                            >
                              {vault.t(
                                'login.sentinel_dashboard_card_stack_title',
                              )}
                            </span>
                            <span
                              class="mt-1 block text-xs leading-5 text-muted-foreground"
                            >
                              {vault.t(
                                'login.sentinel_dashboard_card_stack_description',
                              )}
                            </span>
                          </button>
                          <button
                            type="button"
                            class="group rounded-xl border border-border bg-[#090b09] p-4 text-left text-[#b7ff95] transition hover:border-[#b7ff95]/60 hover:shadow-md disabled:opacity-60"
                            data-testid="sentinel-dashboard-terminal"
                            disabled={isBusy}
                            onclick={() => chooseSentinelDashboard('terminal')}
                          >
                            <span
                              class="mb-4 grid size-10 place-items-center rounded-lg border border-[#b7ff95]/30 bg-[#b7ff95]/10"
                            >
                              <Terminal class="size-5" />
                            </span>
                            <span class="block font-mono text-sm font-semibold">
                              {vault.t(
                                'login.sentinel_dashboard_terminal_title',
                              )}
                            </span>
                            <span
                              class="mt-1 block font-mono text-xs leading-5 text-[#b7ff95]/60"
                            >
                              {vault.t(
                                'login.sentinel_dashboard_terminal_description',
                              )}
                            </span>
                          </button>
                        </div>
                      </section>
                    {/if}
                  </div>
                </li>
              {/each}
            </ol>
          {/if}

          {#if wizardStep === 'sentinel-policy'}
            <section
              class="mt-6 space-y-4 border-t border-border pt-6"
              data-testid="sentinel-genesis-policy-step"
            >
              <div class="space-y-1">
                <h3 class="text-lg font-semibold text-foreground">
                  {vault.t('login.sentinel_genesis_policy_title')}
                </h3>
                <p class="text-sm text-pretty text-muted-foreground">
                  {vault.t('login.sentinel_genesis_policy_description')}
                </p>
              </div>

              <div class="space-y-1.5">
                <label
                  class="text-xs font-medium text-foreground"
                  for="sentinel-vault-name"
                >
                  {vault.t('login.vault_name_label')}
                </label>
                <input
                  id="sentinel-vault-name"
                  type="text"
                  class="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                  placeholder={vault.t('login.vault_name_placeholder')}
                  maxlength="64"
                  autocomplete="off"
                  data-testid="sentinel-genesis-name-input"
                  bind:value={sentinelName}
                  disabled={isBusy || sentinelActionBusy}
                />
              </div>

              <div class="grid gap-4 sm:grid-cols-2">
                <div class="space-y-1.5">
                  <label
                    class="text-xs font-medium text-foreground"
                    for="sentinel-participant-count"
                  >
                    {vault.t('login.sentinel_genesis_participant_count')}
                  </label>
                  <input
                    id="sentinel-participant-count"
                    type="number"
                    min="2"
                    max="16"
                    step="1"
                    class="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                    data-testid="sentinel-genesis-participant-count"
                    bind:value={sentinelParticipantCount}
                    disabled={isBusy || sentinelActionBusy}
                  />
                  <p class="text-xs text-pretty text-muted-foreground">
                    {vault.t('login.sentinel_genesis_participant_count_hint')}
                  </p>
                </div>
                <div class="space-y-1.5">
                  <label
                    class="text-xs font-medium text-foreground"
                    for="sentinel-threshold"
                  >
                    {vault.t('login.sentinel_genesis_threshold')}
                  </label>
                  <input
                    id="sentinel-threshold"
                    type="number"
                    min="2"
                    max={sentinelParticipantCount}
                    step="1"
                    class="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                    data-testid="sentinel-genesis-threshold"
                    bind:value={sentinelThreshold}
                    disabled={isBusy || sentinelActionBusy}
                  />
                  <p class="text-xs text-pretty text-muted-foreground">
                    {vault.t('login.sentinel_genesis_threshold_hint')}
                  </p>
                </div>
              </div>

              <div class="flex justify-end pt-1">
                <Button
                  type="button"
                  class="min-w-[180px]"
                  data-testid="sentinel-genesis-start"
                  disabled={isBusy ||
                    sentinelActionBusy ||
                    !sentinelNameReady ||
                    !sentinelPolicyValid ||
                    !onStartSentinelGenesis}
                  onclick={() => void startSentinelGenesis()}
                >
                  {#if sentinelActionBusy}
                    <RefreshCw class="size-4 animate-spin" />
                  {:else}
                    <Users class="size-4" />
                  {/if}
                  {vault.t('login.sentinel_genesis_start')}
                </Button>
              </div>
            </section>
          {:else if wizardStep === 'sentinel-ceremony'}
            <section
              class="mt-6 space-y-5 border-t border-border pt-6"
              data-testid="sentinel-genesis-ceremony-step"
            >
              <div class="space-y-1">
                <h3 class="text-lg font-semibold text-foreground">
                  {vault.t('login.sentinel_genesis_collect_title')}
                </h3>
                <p class="text-sm text-pretty text-muted-foreground">
                  {vault.t('login.sentinel_genesis_collect_description')}
                </p>
              </div>

              <div
                class="space-y-3 rounded-lg border border-border/60 bg-muted/10 p-4"
                data-testid="sentinel-genesis-request"
              >
                <div class="flex items-center justify-between gap-3">
                  <div>
                    <p class="text-sm font-semibold text-foreground">
                      {vault.t('login.sentinel_genesis_request_title')}
                    </p>
                    <p class="text-xs text-muted-foreground">
                      {vault.t('login.sentinel_genesis_request_description')}
                    </p>
                  </div>
                  <span
                    class="text-xs font-medium text-muted-foreground"
                    data-testid="sentinel-genesis-progress"
                  >
                    {sentinelGenesisParticipantCount} / {sentinelParticipantCount}
                  </span>
                </div>

                {#if sentinelGenesisRequest}
                  <div class="grid gap-3 sm:grid-cols-[160px_1fr]">
                    <EnrollmentQrCode
                      enrollmentLink={sentinelGenesisRequest}
                      loadingLabel={vault.t(
                        'login.sentinel_genesis_qr_loading',
                      )}
                    />
                    <div class="space-y-2">
                      <textarea
                        class="min-h-28 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
                        readonly
                        data-testid="sentinel-genesis-request-output"
                        value={sentinelGenesisRequest}></textarea>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        data-testid="sentinel-genesis-copy-request"
                        onclick={() => void copyGenesisRequest()}
                      >
                        <Copy class="size-4" />
                        {copyingRequest
                          ? vault.t('common.copied')
                          : vault.t('common.copy')}
                      </Button>
                    </div>
                  </div>
                {:else}
                  <p class="text-sm text-muted-foreground" role="status">
                    {vault.t('login.sentinel_genesis_request_preparing')}
                  </p>
                {/if}

                {#if sentinelGenesisParticipants.length > 0}
                  <div
                    class="space-y-2 border-t border-border pt-3"
                    data-testid="sentinel-genesis-verified-participants"
                  >
                    <p class="text-xs font-medium text-foreground">
                      {vault.t('login.sentinel_genesis_verified_participants')}
                    </p>
                    <ul class="space-y-1.5">
                      {#each sentinelGenesisParticipants as participant (participant.participantId)}
                        <li
                          class="flex flex-wrap items-baseline justify-between gap-x-3 text-xs"
                        >
                          <span class="text-foreground">
                            {participant.label || participant.participantId}
                          </span>
                          <code class="text-muted-foreground"
                            >{participant.fingerprint}</code
                          >
                        </li>
                      {/each}
                    </ul>
                  </div>
                {/if}
              </div>

              <div class="space-y-2">
                <label
                  class="text-xs font-medium text-foreground"
                  for="sentinel-participant-response"
                >
                  {vault.t('login.sentinel_genesis_response_label')}
                </label>
                <textarea
                  id="sentinel-participant-response"
                  class="min-h-24 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs focus:ring-2 focus:ring-ring focus:outline-none"
                  data-testid="sentinel-genesis-response-input"
                  placeholder={vault.t(
                    'login.sentinel_genesis_response_placeholder',
                  )}
                  bind:value={participantResponse}
                  disabled={isBusy ||
                    sentinelActionBusy ||
                    sentinelReadyToFinalize}></textarea>
                <Button
                  type="button"
                  variant="outline"
                  data-testid="sentinel-genesis-add-participant"
                  disabled={isBusy ||
                    sentinelActionBusy ||
                    !participantResponse.trim() ||
                    !onAddSentinelGenesisParticipantResponse}
                  onclick={() => void addParticipantResponse()}
                >
                  <Users class="size-4" />
                  {vault.t('login.sentinel_genesis_add_participant')}
                </Button>
              </div>

              <div
                class="rounded-md border border-border/60 p-3 text-xs text-pretty text-muted-foreground"
              >
                {vault.t('login.sentinel_genesis_atomic_notice')}
              </div>

              <Button
                type="button"
                class="w-full sm:w-auto sm:min-w-[220px]"
                data-testid="sentinel-genesis-finalize"
                disabled={isBusy ||
                  sentinelActionBusy ||
                  !sentinelReadyToFinalize ||
                  !onFinalizeSentinelGenesis}
                onclick={() => void finalizeSentinelGenesis()}
              >
                {#if sentinelActionBusy || sentinelGenesisStatus === 'finalizing'}
                  <RefreshCw class="size-4 animate-spin" />
                {:else}
                  <ShieldCheck class="size-4" />
                {/if}
                {vault.t('login.sentinel_genesis_finalize')}
              </Button>

              {#if sentinelGenesisStatus === 'delivering' || sentinelGenesisDeliveries.length > 0}
                <div
                  class="space-y-3 border-t border-border pt-5"
                  data-testid="sentinel-genesis-deliveries"
                >
                  <div class="space-y-1">
                    <h4 class="text-sm font-semibold text-foreground">
                      {vault.t('login.sentinel_genesis_delivery_title')}
                    </h4>
                    <p class="text-xs text-pretty text-muted-foreground">
                      {vault.t('login.sentinel_genesis_delivery_description')}
                    </p>
                  </div>

                  {#if sentinelGenesisDeliveries.length === 0}
                    <p class="text-sm text-muted-foreground" role="status">
                      {vault.t('login.sentinel_genesis_delivery_waiting')}
                    </p>
                  {:else}
                    <div class="space-y-3">
                      {#each sentinelGenesisDeliveries as delivery, index (delivery.participantId)}
                        <div
                          class="grid gap-3 rounded-lg border border-border/60 bg-muted/10 p-3 sm:grid-cols-[120px_1fr]"
                          data-testid="sentinel-genesis-delivery"
                        >
                          <EnrollmentQrCode
                            enrollmentLink={delivery.payload}
                            loadingLabel={vault.t(
                              'login.sentinel_genesis_qr_loading',
                            )}
                          />
                          <div class="min-w-0 space-y-2">
                            <p class="text-sm font-medium text-foreground">
                              {vault.t(
                                'login.sentinel_genesis_delivery_participant',
                              )}
                              {index + 1}
                            </p>
                            {#if delivery.fingerprint}
                              <p
                                class="break-all font-mono text-xs text-muted-foreground"
                              >
                                {delivery.fingerprint}
                              </p>
                            {/if}
                            <textarea
                              class="min-h-20 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
                              readonly
                              data-testid="sentinel-genesis-delivery-output"
                              value={delivery.payload}></textarea>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              data-testid="sentinel-genesis-copy-delivery"
                              onclick={() =>
                                void navigator.clipboard.writeText(
                                  delivery.payload,
                                )}
                            >
                              <Copy class="size-4" />
                              {vault.t('common.copy')}
                            </Button>
                          </div>
                        </div>
                      {/each}
                      <div class="flex justify-end pt-2">
                        <Button
                          type="button"
                          data-testid="sentinel-genesis-delivery-complete"
                          disabled={isBusy ||
                            sentinelActionBusy ||
                            !onCompleteSentinelGenesisDelivery}
                          onclick={() =>
                            void onCompleteSentinelGenesisDelivery?.()}
                        >
                          {vault.t('common.done')}
                        </Button>
                      </div>
                    </div>
                  {/if}
                </div>
              {/if}
            </section>
          {:else if wizardStep === 'join'}
            <section
              class="mt-6 space-y-4 border-t border-border pt-6"
              data-testid="sentinel-genesis-participant-step"
            >
              <div class="space-y-1">
                <h3 class="text-lg font-semibold text-foreground">
                  {vault.t('login.sentinel_genesis_join_title')}
                </h3>
                <p class="text-sm text-pretty text-muted-foreground">
                  {vault.t('login.sentinel_genesis_join_description')}
                </p>
              </div>

              {#if generatedParticipantResponse}
                <div
                  class="space-y-3 rounded-lg border border-border/60 bg-muted/10 p-4"
                  data-testid="sentinel-genesis-join-response"
                >
                  <div class="space-y-1">
                    <p class="text-sm font-semibold text-foreground">
                      {vault.t('login.sentinel_genesis_generated_response')}
                    </p>
                    <p class="text-xs text-pretty text-muted-foreground">
                      {vault.t('login.sentinel_genesis_join_qr_hint')}
                    </p>
                  </div>
                  <div class="grid gap-3 sm:grid-cols-[160px_1fr]">
                    <EnrollmentQrCode
                      enrollmentLink={generatedParticipantResponse}
                      loadingLabel={vault.t(
                        'login.sentinel_genesis_qr_loading',
                      )}
                    />
                    <div class="space-y-2">
                      <textarea
                        id="sentinel-generated-response"
                        class="min-h-20 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
                        readonly
                        data-testid="sentinel-genesis-generated-response"
                        value={generatedParticipantResponse}></textarea>
                      {#if generatedParticipantFingerprint}
                        <p
                          class="text-xs text-muted-foreground"
                          data-testid="sentinel-genesis-generated-fingerprint"
                        >
                          {vault.t('login.sentinel_genesis_fingerprint')}:
                          <code class="text-foreground"
                            >{generatedParticipantFingerprint}</code
                          >
                        </p>
                      {/if}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        data-testid="sentinel-genesis-copy-join-response"
                        onclick={() => void copyJoinResponse()}
                      >
                        <Copy class="size-4" />
                        {copyingJoinResponse
                          ? vault.t('common.copied')
                          : vault.t('common.copy')}
                      </Button>
                    </div>
                  </div>
                </div>
              {:else if joinPublicKeysLoading}
                <p
                  class="text-sm text-muted-foreground"
                  data-testid="sentinel-genesis-join-loading"
                >
                  {vault.t('login.sentinel_genesis_join_loading')}
                </p>
              {:else}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="sentinel-genesis-refresh-public-keys"
                  disabled={isBusy || sentinelActionBusy}
                  onclick={() => refreshJoinPublicKeys()}
                >
                  <RefreshCw class="size-4" />
                  {vault.t('login.sentinel_genesis_refresh_public_keys')}
                </Button>
              {/if}

              <details
                class="rounded-lg border border-border/60 bg-muted/10 p-4"
              >
                <summary
                  class="cursor-pointer text-sm font-medium text-foreground"
                  data-testid="sentinel-genesis-join-request-toggle"
                >
                  {vault.t('login.sentinel_genesis_join_request_optional')}
                </summary>
                <div class="mt-3 space-y-2">
                  <p class="text-xs text-pretty text-muted-foreground">
                    {vault.t(
                      'login.sentinel_genesis_join_request_optional_description',
                    )}
                  </p>
                  <label
                    class="text-xs font-medium text-foreground"
                    for="sentinel-participant-request"
                  >
                    {vault.t('login.sentinel_genesis_join_request_label')}
                  </label>
                  <textarea
                    id="sentinel-participant-request"
                    class="min-h-20 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
                    data-testid="sentinel-genesis-join-request-input"
                    placeholder={vault.t(
                      'login.sentinel_genesis_join_request_placeholder',
                    )}
                    bind:value={sessionParticipantRequest}
                    disabled={isBusy || sentinelActionBusy}></textarea>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-testid="sentinel-genesis-create-response"
                    disabled={isBusy ||
                      sentinelActionBusy ||
                      !sessionParticipantRequest.trim() ||
                      !onCreateSentinelGenesisParticipantResponse}
                    onclick={() => void createParticipantResponse()}
                  >
                    {#if sentinelActionBusy}
                      <RefreshCw class="size-4 animate-spin" />
                    {:else}
                      <ShieldCheck class="size-4" />
                    {/if}
                    {vault.t('login.sentinel_genesis_create_session_response')}
                  </Button>
                </div>
              </details>

              <div class="space-y-2 border-t border-border pt-4">
                <p class="text-xs font-medium text-foreground">
                  {vault.t('login.sentinel_genesis_join_share_title')}
                </p>
                <p class="text-xs text-pretty text-muted-foreground">
                  {vault.t('login.sentinel_genesis_join_share_description')}
                </p>
                <label
                  class="text-xs font-medium text-foreground"
                  for="sentinel-share-request"
                >
                  {vault.t('login.sentinel_genesis_join_share_request_label')}
                </label>
                <textarea
                  id="sentinel-share-request"
                  class="min-h-16 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
                  data-testid="sentinel-genesis-share-request-input"
                  placeholder={vault.t(
                    'login.sentinel_genesis_join_share_request_placeholder',
                  )}
                  bind:value={participantRequest}
                  disabled={isBusy || sentinelActionBusy}></textarea>
                <label
                  class="text-xs font-medium text-foreground"
                  for="sentinel-received-share"
                >
                  {vault.t('login.sentinel_genesis_receive_share_label')}
                </label>
                <textarea
                  id="sentinel-received-share"
                  class="min-h-20 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
                  data-testid="sentinel-genesis-receive-share-input"
                  placeholder={vault.t(
                    'login.sentinel_genesis_receive_share_placeholder',
                  )}
                  bind:value={participantShare}
                  disabled={isBusy || sentinelActionBusy}></textarea>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="sentinel-genesis-receive-share"
                  disabled={isBusy ||
                    sentinelActionBusy ||
                    !participantShare.trim() ||
                    !onReceiveSentinelGenesisShare}
                  onclick={() => void receiveParticipantShare()}
                >
                  <ShieldCheck class="size-4" />
                  {vault.t('login.sentinel_genesis_receive_share')}
                </Button>
              </div>
            </section>
          {/if}

          {#if canGoBack && !sentinelDashboardActive}
            <div class="mt-8">
              <Button
                type="button"
                variant="outline"
                data-testid="create-vault-wizard-back"
                disabled={isBusy || sentinelActionBusy}
                onclick={goBack}
              >
                {vault.t('common.back')}
              </Button>
            </div>
          {/if}

          {#if showImportFooter}
            <div class="pt-6" data-testid="login-path-cloud">
              <div
                class="flex items-center gap-3 text-muted-foreground before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border"
              >
                <span class="text-center text-xs">
                  {vault.t('login.import_existing_alternative')}
                </span>
              </div>
              <Button
                type="button"
                variant="ghost"
                class="mx-auto mt-2 flex text-foreground"
                data-testid="login-connect-storage-btn"
                disabled={isBusy}
                onclick={onConnectStorage}
              >
                <Cloud class="size-4" />
                {vault.t('login.path_cloud_btn')}
              </Button>
            </div>
          {/if}
        </div>
      </div>
    </section>

    {#if !sentinelDashboardActive}
      <div class="mx-auto mt-6 w-full max-w-6xl">
        <SentinelUnlockParticipantHelper {vault} disabled={isBusy} expanded />
      </div>
    {/if}
  {/if}
</div>

<style>
  .sentinel-card-stack {
    --background: #192128;
    --foreground: #f4f6f7;
    --card: #242d35;
    --card-foreground: #f4f6f7;
    --muted: #303840;
    --muted-foreground: #aeb8c2;
    --border: rgb(174 184 194 / 28%);
    background-image:
      radial-gradient(circle at 50% -10%, #53606d 0, transparent 42%),
      radial-gradient(circle at 15% 90%, #25303a 0, transparent 36%);
  }

  .sentinel-terminal {
    --background: #0c100c;
    --foreground: #b7ff95;
    --card: #090b09;
    --card-foreground: #b7ff95;
    --muted: #152014;
    --muted-foreground: rgb(183 255 149 / 62%);
    --border: rgb(183 255 149 / 24%);
  }

  .sentinel-card-stack-panel {
    box-shadow:
      12px 12px 0 -1px #192128,
      12px 12px 0 0 rgb(101 117 128 / 65%),
      24px 24px 0 -1px #151c22,
      24px 24px 0 0 rgb(101 117 128 / 35%),
      0 35px 80px rgb(0 0 0 / 38%);
  }

  .sentinel-terminal textarea,
  .sentinel-terminal input {
    font-family: inherit;
  }
</style>
