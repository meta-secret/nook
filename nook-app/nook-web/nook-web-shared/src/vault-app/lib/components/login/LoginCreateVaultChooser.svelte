<script lang="ts">
  import { tick } from 'svelte'
  import {
    ArrowRight,
    Check,
    Cloud,
    Copy,
    KeyRound,
    Layers3,
    RefreshCw,
    ShieldCheck,
    Terminal,
    Users,
  } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import EnrollmentQrCode from '$lib/components/EnrollmentQrCode.svelte'
  import SentinelCardStackDashboard from '$lib/components/login/SentinelCardStackDashboard.svelte'
  import SentinelTerminalDashboard from '$lib/components/login/SentinelTerminalDashboard.svelte'
  import SentinelUnlockParticipantHelper from '$lib/components/login/SentinelUnlockParticipantHelper.svelte'
  import VaultSecurityOrbit from '$lib/components/login/VaultSecurityOrbit.svelte'
  import type { StartSentinelGenesisArgs, VaultState } from '$lib/vault.svelte'
  import type { AppKind } from '$lib/app-kind'
  import {
    buildSentinelGenesisParticipantResponseLink,
    buildSentinelGenesisRequestLink,
  } from '$lib/sentinel-genesis-link'
  import { sentinelGenesisParticipantFingerprint } from '$app-wasm'

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
    appKind,
    isVerifying,
    isInitializing,
    usesExtensionDeviceIdentity = false,
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
    sentinelGenesisParticipants = [],
    sentinelGenesisDeliveries = [],
    sentinelInvitationRequest = '',
    sentinelParticipantResponse = '',
    sentinelOnboardingPackage = '',
    onAcceptSentinelOnboardingPackage,
  }: {
    vault: VaultState
    appKind: AppKind
    isVerifying: boolean
    isInitializing: boolean
    usesExtensionDeviceIdentity?: boolean
    onCreateDeviceVault: (label: string) => void | Promise<void>
    onConnectStorage: () => void
    onStartSentinelGenesis?: (
      args: StartSentinelGenesisArgs,
    ) => boolean | void | Promise<boolean | void>
    onAddSentinelGenesisParticipantResponse?: (
      payload: string,
      participantLabel?: string,
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
    sentinelGenesisParticipants?: SentinelGenesisParticipantSummary[]
    sentinelGenesisDeliveries?: SentinelGenesisDelivery[]
    sentinelInvitationRequest?: string
    sentinelParticipantResponse?: string
    sentinelOnboardingPackage?: string
    onAcceptSentinelOnboardingPackage?: (
      packageJson: string,
    ) => void | Promise<void>
  } = $props()

  const isBusy = $derived(isVerifying || isInitializing)
  let wizardStep = $state<WizardStep>('choose')
  let chosenPath = $state<ChosenPath>('undecided')
  let vaultName = $state('')
  let sentinelName = $state('')
  let sentinelDashboard = $state<SentinelDashboard | undefined>(undefined)
  let sentinelParticipantCount = $state(3)
  let sentinelThreshold = $state(2)
  let copyingJoinResponse = $state(false)
  let sentinelActionBusy = $state(false)
  let participantRequest = $state('')
  let sessionParticipantRequest = $state('')
  let generatedParticipantResponse = $state('')
  let generatedParticipantFingerprint = $state('')
  let participantShare = $state('')
  let joinPublicKeysLoading = $state(false)
  let joinPasskeyRequested = $state(false)
  let initiatorFingerprint = $state('')
  let initiatorKeyLoading = $state(false)
  let initiatorPasskeyRequested = $state(false)
  let importedParticipantResponse = $state('')

  $effect(() => {
    if (sentinelOnboardingPackage.trim() && wizardStep === 'choose') {
      chosenPath = 'join'
      wizardStep = 'join'
    }
  })

  $effect(() => {
    const invitation = sentinelInvitationRequest.trim()
    if (!invitation || wizardStep !== 'choose') return
    participantRequest = invitation
    chosenPath = 'join'
    joinPasskeyRequested = false
    wizardStep = 'join'
  })

  $effect(() => {
    const response = sentinelParticipantResponse.trim()
    if (
      !response ||
      response === importedParticipantResponse ||
      sentinelGenesisStatus !== 'collecting' ||
      sentinelDashboard !== 'terminal' ||
      !onAddSentinelGenesisParticipantResponse
    ) {
      return
    }
    importedParticipantResponse = response
    void onAddSentinelGenesisParticipantResponse(response)
  })

  $effect(() => {
    const deviceProtectionReady = vault.deviceProtectionReady
    const invitationPending = sentinelInvitationRequest.trim().length > 0
    const shouldResumeInvitation =
      invitationPending && joinPasskeyRequested && deviceProtectionReady
    if (
      wizardStep === 'join' &&
      !sentinelOnboardingPackage.trim() &&
      !generatedParticipantResponse &&
      !joinPublicKeysLoading &&
      !isBusy &&
      shouldResumeInvitation &&
      onCreateSentinelGenesisParticipantResponse
    ) {
      void loadJoinPublicKeys()
    }
  })

  async function loadJoinPublicKeys() {
    const requestPayload = participantRequest.trim()
    if (
      joinPublicKeysLoading ||
      generatedParticipantResponse ||
      !requestPayload ||
      !onCreateSentinelGenesisParticipantResponse
    ) {
      return
    }
    joinPublicKeysLoading = true
    try {
      generatedParticipantResponse =
        await onCreateSentinelGenesisParticipantResponse(requestPayload)
      if (!generatedParticipantResponse && !vault.deviceProtectionReady) {
        joinPasskeyRequested = true
        return
      }
      joinPasskeyRequested = false
      generatedParticipantFingerprint = sentinelGenesisParticipantFingerprint(
        generatedParticipantResponse,
      )
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
      sentinelDashboard = undefined
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
  const sentinelDashboardActive = $derived(
    sentinelDashboard !== undefined &&
      (wizardStep === 'sentinel-policy' || wizardStep === 'sentinel-ceremony'),
  )
  const sentinelGenesisInvitationLink = $derived(
    buildSentinelGenesisRequestLink(sentinelGenesisRequest),
  )
  const generatedParticipantResponseLink = $derived(
    buildSentinelGenesisParticipantResponseLink(generatedParticipantResponse),
  )
  const landingSupporting = $derived(
    appKind === 'simple'
      ? vault.t('login.landing_supporting_simple')
      : appKind === 'sentinel'
        ? vault.t('login.landing_supporting_sentinel')
        : vault.t('login.landing_supporting'),
  )
  const existingVaultDescription = $derived(
    appKind === 'simple'
      ? vault.t('login.path_cloud_description_simple')
      : appKind === 'sentinel'
        ? vault.t('login.path_cloud_description_sentinel')
        : vault.t('login.path_cloud_description'),
  )

  $effect(() => {
    const deviceProtectionReady = vault.deviceProtectionReady
    if (
      initiatorPasskeyRequested &&
      deviceProtectionReady &&
      sentinelDashboardActive &&
      sentinelGenesisStatus === 'idle' &&
      !initiatorFingerprint &&
      !initiatorKeyLoading &&
      !isBusy
    ) {
      void prepareInitiatorDeviceKeys()
    }
  })
  const canGoBack = $derived(
    wizardStep === 'simple-create' ||
      wizardStep === 'sentinel-dashboard' ||
      wizardStep === 'sentinel-policy' ||
      wizardStep === 'join',
  )

  const stepIndex = $derived.by(() => {
    switch (wizardStep) {
      case 'choose':
        return 0
      case 'simple-create':
      case 'sentinel-dashboard':
      case 'sentinel-policy':
      case 'join':
      case 'sentinel-ceremony':
        return 1
    }
  })

  const progressSteps = $derived.by(() => {
    const choose = vault.t('login.landing_step_choose')
    if (chosenPath === 'simple') {
      return [choose, vault.t('login.landing_step_simple')]
    }
    if (chosenPath === 'sentinel') {
      return [choose, vault.t('login.landing_step_sentinel')]
    }
    if (chosenPath === 'join') {
      return [choose, vault.t('login.landing_step_join')]
    }
    return [choose]
  })

  function portal(node: HTMLElement, enabled: boolean) {
    const anchor = document.createComment('sentinel-dashboard-home')
    const focusableSelector = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',')
    const siblingInertState: Array<[HTMLElement, boolean]> = []
    let active = false
    let previousFocus: HTMLElement | null = null
    let returnFocusTestId = 'sentinel-dashboard-card-stack'
    node.before(anchor)

    function focusableElements() {
      return Array.from(
        node.querySelectorAll<HTMLElement>(focusableSelector),
      ).filter((element) => element.offsetParent !== null)
    }

    function trapFocus(event: KeyboardEvent) {
      if (event.key !== 'Tab') return
      const elements = focusableElements()
      if (elements.length === 0) {
        event.preventDefault()
        return
      }
      const first = elements[0]
      const last = elements[elements.length - 1]
      const focused = document.activeElement
      if (event.shiftKey && (focused === first || !node.contains(focused))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && focused === last) {
        event.preventDefault()
        first.focus()
      }
    }

    function setBackgroundInert(inert: boolean) {
      for (const sibling of Array.from(document.body.children)) {
        if (!(sibling instanceof HTMLElement) || sibling === node) continue
        if (inert) {
          siblingInertState.push([sibling, sibling.inert])
          sibling.inert = true
        }
      }
      if (!inert) {
        for (const [sibling, wasInert] of siblingInertState) {
          sibling.inert = wasInert
        }
        siblingInertState.length = 0
      }
    }

    function activate() {
      returnFocusTestId =
        sentinelDashboard === 'terminal'
          ? 'sentinel-dashboard-terminal'
          : 'sentinel-dashboard-card-stack'
      previousFocus =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null
      document.body.appendChild(node)
      setBackgroundInert(true)
      node.addEventListener('keydown', trapFocus)
      requestAnimationFrame(() => {
        node
          .querySelector<HTMLElement>('[data-sentinel-dashboard-focus]')
          ?.focus()
      })
      active = true
    }

    function deactivate() {
      node.removeEventListener('keydown', trapFocus)
      setBackgroundInert(false)
      anchor.parentNode?.insertBefore(node, anchor.nextSibling)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (previousFocus?.isConnected) {
            previousFocus.focus()
          } else {
            node
              .querySelector<HTMLElement>(
                `[data-testid="${returnFocusTestId}"]`,
              )
              ?.focus()
          }
          previousFocus = null
        })
      })
      active = false
    }

    function update(nextActive: boolean) {
      if (nextActive === active) return
      if (nextActive) {
        activate()
      } else {
        deactivate()
      }
    }

    update(enabled)
    return {
      update,
      destroy() {
        if (active) {
          node.removeEventListener('keydown', trapFocus)
          setBackgroundInert(false)
          previousFocus?.focus()
        }
        node.remove()
        anchor.remove()
      },
    }
  }

  function chooseSimplePath() {
    vault.draftVaultType = 'simple'
    chosenPath = 'simple'
    wizardStep = 'simple-create'
  }

  function chooseSentinelCreatePath() {
    vault.draftVaultType = 'sentinel'
    chosenPath = 'sentinel'
    initiatorFingerprint = ''
    initiatorPasskeyRequested = false
    sentinelDashboard = undefined
    wizardStep = 'sentinel-dashboard'
  }

  function chooseSentinelDashboard(dashboard: SentinelDashboard) {
    sentinelDashboard = dashboard
    wizardStep = 'sentinel-policy'
  }

  async function prepareInitiatorDeviceKeys() {
    if (
      initiatorKeyLoading ||
      initiatorFingerprint ||
      !onCreateSentinelGenesisPublicKeyAnnouncement
    )
      return
    initiatorKeyLoading = true
    try {
      const payload = await onCreateSentinelGenesisPublicKeyAnnouncement()
      if (!payload && !vault.deviceProtectionReady) {
        initiatorPasskeyRequested = true
        return
      }
      initiatorFingerprint = sentinelGenesisParticipantFingerprint(payload)
      initiatorPasskeyRequested = false
    } catch {
      initiatorFingerprint = ''
    } finally {
      initiatorKeyLoading = false
    }
  }

  function restoreDashboardChoiceFocus(dashboard: SentinelDashboard) {
    void tick().then(() => {
      requestAnimationFrame(() => {
        document
          .querySelector<HTMLElement>(
            `[data-testid="sentinel-dashboard-${dashboard}"]`,
          )
          ?.focus()
      })
    })
  }

  function goBack() {
    if (wizardStep === 'sentinel-ceremony') return
    if (wizardStep === 'simple-create' || wizardStep === 'join') {
      chosenPath = 'undecided'
      wizardStep = 'choose'
      return
    }
    if (wizardStep === 'sentinel-dashboard') {
      sentinelDashboard = undefined
      chosenPath = 'undecided'
      wizardStep = 'choose'
      return
    }
    if (wizardStep === 'sentinel-policy') {
      const dashboard = sentinelDashboard
      sentinelDashboard = undefined
      wizardStep = 'sentinel-dashboard'
      if (dashboard) restoreDashboardChoiceFocus(dashboard)
    }
  }

  async function createSimpleVault() {
    if (!vaultNameReady || isBusy) return
    await onCreateDeviceVault(trimmedVaultName)
  }

  async function startSentinelGenesis(): Promise<boolean> {
    if (
      !sentinelNameReady ||
      !sentinelPolicyValid ||
      isBusy ||
      sentinelActionBusy ||
      !onStartSentinelGenesis
    ) {
      return false
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
        return true
      }
      return false
    } finally {
      sentinelActionBusy = false
    }
  }

  async function copyJoinResponse() {
    if (!generatedParticipantResponseLink) return
    try {
      await navigator.clipboard.writeText(generatedParticipantResponseLink)
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
      request={sentinelGenesisInvitationLink}
      participantResponse={sentinelParticipantResponse}
      participants={sentinelGenesisParticipants}
      deliveries={sentinelGenesisDeliveries}
      isBusy={isBusy || sentinelActionBusy}
      {initiatorFingerprint}
      initiatorKeyLoading={initiatorKeyLoading || isBusy}
      onPrepareInitiator={() => prepareInitiatorDeviceKeys()}
      onBack={goBack}
      onStart={() => startSentinelGenesis()}
      onAddParticipant={(payload, participantLabel) =>
        onAddSentinelGenesisParticipantResponse?.(payload, participantLabel)}
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
      request={sentinelGenesisInvitationLink}
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
          {landingSupporting}
        </p>

        <div
          class="relative mt-8 grid min-h-[10rem] place-items-center lg:hidden"
        >
          <VaultSecurityOrbit compact />
        </div>
      </div>

      <div class={sentinelDashboardActive ? 'relative w-full' : ''}>
        <div
          class={sentinelDashboardActive
            ? 'hidden'
            : 'relative mb-8 hidden min-h-[12rem] place-items-center lg:grid'}
        >
          <VaultSecurityOrbit />
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

                    {#if index === stepIndex && wizardStep === 'choose'}
                      <section
                        class="mt-3 space-y-3"
                        data-testid="landing-auth-step-choose"
                      >
                        <div
                          class="space-y-3"
                          data-testid="get-started-path-chooser"
                        >
                          <div
                            class="grid gap-2"
                            data-testid="get-started-path-list"
                          >
                            {#if appKind !== 'sentinel'}
                              <button
                                type="button"
                                class="group grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-lg border border-border bg-background px-4 py-3 text-left text-foreground transition-[border-color,background-color,box-shadow] hover:border-foreground/25 hover:bg-muted/30 hover:shadow-sm disabled:opacity-60"
                                data-testid="get-started-path-simple"
                                disabled={isBusy}
                                onclick={chooseSimplePath}
                              >
                                <span
                                  class="grid size-9 place-items-center rounded-full border border-border bg-muted/30"
                                >
                                  <KeyRound class="size-4" />
                                </span>
                                <span class="min-w-0">
                                  <span class="block text-sm font-semibold">
                                    {vault.t(
                                      'login.get_started_path_simple_title',
                                    )}
                                  </span>
                                  <span
                                    class="mt-1 block text-xs leading-snug text-muted-foreground"
                                  >
                                    {vault.t(
                                      'login.get_started_path_simple_description',
                                    )}
                                  </span>
                                </span>
                                <ArrowRight
                                  class="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                                />
                              </button>
                            {/if}
                            {#if appKind !== 'simple'}
                              <button
                                type="button"
                                class="group grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-lg border border-border bg-background px-4 py-3 text-left text-foreground transition-[border-color,background-color,box-shadow] hover:border-foreground/25 hover:bg-muted/30 hover:shadow-sm disabled:opacity-60"
                                data-testid="get-started-path-sentinel"
                                disabled={isBusy}
                                onclick={chooseSentinelCreatePath}
                              >
                                <span
                                  class="grid size-9 place-items-center rounded-full bg-foreground text-background"
                                >
                                  <Users class="size-4" />
                                </span>
                                <span class="min-w-0">
                                  <span class="block text-sm font-semibold">
                                    {vault.t(
                                      'login.get_started_path_sentinel_title',
                                    )}
                                  </span>
                                  <span
                                    class="mt-1 block text-xs leading-snug text-muted-foreground"
                                  >
                                    {vault.t(
                                      'login.get_started_path_sentinel_description',
                                    )}
                                  </span>
                                </span>
                                <ArrowRight
                                  class="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                                />
                              </button>
                            {/if}
                          </div>

                          <div class="pt-3" data-testid="login-path-cloud">
                            <div
                              class="mb-3 flex items-center gap-3 text-muted-foreground before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border"
                            >
                              <span class="text-center text-xs">
                                {vault.t('login.existing_vault_alternative')}
                              </span>
                            </div>
                            <button
                              type="button"
                              class="group grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 rounded-lg border border-border bg-background px-4 py-3 text-left text-foreground transition-[border-color,background-color,box-shadow] hover:border-foreground/25 hover:bg-muted/30 hover:shadow-sm disabled:opacity-60"
                              data-testid="login-connect-storage-btn"
                              disabled={isBusy}
                              onclick={onConnectStorage}
                            >
                              <span
                                class="grid size-9 place-items-center rounded-full border border-border bg-muted/30"
                              >
                                <Cloud class="size-4" />
                              </span>
                              <span class="min-w-0">
                                <span class="block text-sm font-semibold">
                                  {vault.t('login.path_cloud_title')}
                                </span>
                                <span
                                  class="mt-1 block text-xs leading-snug text-muted-foreground"
                                >
                                  {existingVaultDescription}
                                </span>
                              </span>
                              <ArrowRight
                                class="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                              />
                            </button>
                          </div>
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
                          <input
                            id="login-vault-name"
                            type="text"
                            class="w-full border-b border-border bg-transparent py-2 text-base text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-foreground/50"
                            placeholder={vault.t(
                              'login.vault_name_placeholder',
                            )}
                            maxlength="64"
                            autocomplete="off"
                            data-testid="login-vault-name-input"
                            bind:value={vaultName}
                            disabled={isBusy}
                            onkeydown={(event) => {
                              if (event.key === 'Enter' && vaultNameReady) {
                                event.preventDefault()
                                void createSimpleVault()
                              }
                            }}
                          />
                          {#if vaultNameReady}
                            <p
                              class="text-sm text-pretty text-muted-foreground"
                            >
                              {vault.t(
                                usesExtensionDeviceIdentity
                                  ? 'login.landing_create_simple_with_extension'
                                  : 'login.landing_create_simple_locally',
                                { name: trimmedVaultName },
                              )}
                            </p>
                          {/if}
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

          {#if wizardStep === 'join'}
            <section
              class="mt-6 space-y-4 border-t border-border pt-6"
              data-testid="sentinel-genesis-participant-step"
            >
              <div class="space-y-1">
                <h3 class="text-lg font-semibold text-foreground">
                  {sentinelOnboardingPackage.trim()
                    ? vault.t('login.sentinel_onboarding_member_title')
                    : vault.t('login.sentinel_genesis_join_title')}
                </h3>
                <p class="text-sm text-pretty text-muted-foreground">
                  {sentinelOnboardingPackage.trim()
                    ? vault.t('login.sentinel_onboarding_member_description')
                    : vault.t('login.sentinel_genesis_join_description')}
                </p>
              </div>

              {#if sentinelOnboardingPackage.trim()}
                <div
                  class="rounded-lg border border-primary/25 bg-primary/5 p-4"
                >
                  <p class="text-xs leading-relaxed text-muted-foreground">
                    {vault.t('login.sentinel_onboarding_member_security')}
                  </p>
                  <Button
                    type="button"
                    class="mt-4 w-full sm:w-auto"
                    data-testid="sentinel-accept-onboarding"
                    disabled={isBusy || sentinelActionBusy}
                    onclick={() =>
                      void onAcceptSentinelOnboardingPackage?.(
                        sentinelOnboardingPackage,
                      )}
                  >
                    <ShieldCheck class="size-4" />
                    {vault.t('login.sentinel_onboarding_member_action')}
                  </Button>
                </div>
              {:else if generatedParticipantResponse}
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
                      enrollmentLink={generatedParticipantResponseLink}
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
                        value={generatedParticipantResponseLink}></textarea>
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
                          : vault.t('login.sentinel_genesis_copy_response_url')}
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
              {:else if sentinelInvitationRequest.trim()}
                <div
                  class="rounded-lg border border-primary/25 bg-primary/5 p-4"
                  data-testid="sentinel-genesis-connect-card"
                >
                  <p class="text-sm font-semibold text-foreground">
                    {vault.t('login.sentinel_genesis_connect_title')}
                  </p>
                  <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {vault.t('login.sentinel_genesis_connect_description')}
                  </p>
                  <Button
                    type="button"
                    class="mt-4 w-full sm:w-auto"
                    data-testid="sentinel-genesis-connect-device"
                    disabled={isBusy || sentinelActionBusy}
                    onclick={() => refreshJoinPublicKeys()}
                  >
                    <ShieldCheck class="size-4" />
                    {vault.t('login.sentinel_genesis_connect_action')}
                  </Button>
                </div>
              {:else if !sentinelOnboardingPackage.trim()}
                <div
                  class="space-y-3 rounded-lg border border-border/60 bg-muted/10 p-4"
                  data-testid="sentinel-genesis-invitation-required"
                >
                  <p class="text-sm font-semibold text-foreground">
                    {vault.t('login.sentinel_genesis_invitation_required_title')}
                  </p>
                  <p class="text-xs text-pretty text-muted-foreground">
                    {vault.t(
                      'login.sentinel_genesis_invitation_required_description',
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
                    class="w-full sm:w-auto"
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
              {/if}

              {#if !sentinelOnboardingPackage.trim()}
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
              {/if}
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
