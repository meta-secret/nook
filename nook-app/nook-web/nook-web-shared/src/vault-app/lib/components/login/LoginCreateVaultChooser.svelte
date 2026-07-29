<script lang="ts">
  import { omittedValue } from '../../../../explicit-state'

  import { tick } from 'svelte'
  import {
    ArrowRight,
    Check,
    Cloud,
    KeyRound,
    Layers3,
    RefreshCw,
    ShieldCheck,
    Terminal,
    Users,
  } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import SentinelCardStackDashboard from '$lib/components/login/SentinelCardStackDashboard.svelte'
  import SentinelTerminalDashboard from '$lib/components/login/SentinelTerminalDashboard.svelte'
  import SentinelUnlockParticipantHelper from '$lib/components/login/SentinelUnlockParticipantHelper.svelte'
  import VaultSecurityOrbit from '$lib/components/login/VaultSecurityOrbit.svelte'
  import SentinelGenesisJoinFlow from '$lib/components/login/SentinelGenesisJoinFlow.svelte'
  import {
    sentinelDashboardPortal,
    type SentinelDashboard,
  } from '$lib/components/login/sentinel-dashboard-portal'
  import type { VaultState } from '$lib/vault.svelte'
  import {
    ChosenVaultPath,
    SentinelDashboardChoiceKind,
    VaultCreationWizardStep,
    type SentinelDashboardChoice,
  } from './login-create-vault-chooser-state'
  import { VaultType } from '$lib/vault-architecture'
  import { AppKind } from '$lib/app-kind'
  import { buildSentinelGenesisRequestLink } from '$lib/sentinel-genesis-link'
  import {
    SentinelGenesisPhase,
    sentinelGenesisParticipantFingerprint,
    type NookSentinelGenesisDelivery,
    type NookSentinelGenesisParticipantStatus,
    type StartSentinelGenesisArgs,
  } from '$app-wasm'

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
    sentinelGenesisPhase = SentinelGenesisPhase.Inactive,
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
    sentinelGenesisPhase?: SentinelGenesisPhase
    sentinelGenesisRequest?: string
    sentinelGenesisParticipants?: NookSentinelGenesisParticipantStatus[]
    sentinelGenesisDeliveries?: NookSentinelGenesisDelivery[]
    sentinelInvitationRequest?: string
    sentinelParticipantResponse?: string
    sentinelOnboardingPackage?: string
    onAcceptSentinelOnboardingPackage?: (
      packageJson: string,
    ) => void | Promise<void>
  } = $props()

  const isBusy = $derived(isVerifying || isInitializing)
  let wizardStep = $state<VaultCreationWizardStep>(
    VaultCreationWizardStep.Choose,
  )
  let chosenPath = $state<ChosenVaultPath>(ChosenVaultPath.Undecided)
  let vaultName = $state('')
  let sentinelName = $state('')
  let sentinelDashboardState = $state<SentinelDashboardChoice>({
    kind: SentinelDashboardChoiceKind.NotChosen,
  })
  const sentinelDashboard = $derived(
    sentinelDashboardState.kind === SentinelDashboardChoiceKind.Chosen
      ? sentinelDashboardState.dashboard
      : omittedValue(),
  )
  let sentinelParticipantCount = $state(3)
  let sentinelThreshold = $state(2)
  let sentinelActionBusy = $state(false)
  let initiatorFingerprint = $state('')
  let initiatorKeyLoading = $state(false)
  let initiatorPasskeyRequested = $state(false)
  let importedParticipantResponse = $state('')

  $effect(() => {
    if (
      sentinelOnboardingPackage.trim() &&
      wizardStep === VaultCreationWizardStep.Choose
    ) {
      chosenPath = ChosenVaultPath.Join
      wizardStep = VaultCreationWizardStep.Join
    }
  })

  $effect(() => {
    const invitation = sentinelInvitationRequest.trim()
    if (!invitation || wizardStep !== VaultCreationWizardStep.Choose) return
    chosenPath = ChosenVaultPath.Join
    wizardStep = VaultCreationWizardStep.Join
  })

  $effect(() => {
    const response = sentinelParticipantResponse.trim()
    if (
      !response ||
      response === importedParticipantResponse ||
      sentinelGenesisPhase !== SentinelGenesisPhase.CollectingParticipants ||
      sentinelDashboard !== 'terminal' ||
      !onAddSentinelGenesisParticipantResponse
    ) {
      return
    }
    importedParticipantResponse = response
    void onAddSentinelGenesisParticipantResponse(response)
  })


  $effect(() => {
    if (sentinelGenesisPhase === SentinelGenesisPhase.Complete) {
      sentinelDashboardState = { kind: SentinelDashboardChoiceKind.NotChosen }
      return
    }
    if (sentinelGenesisPhase !== SentinelGenesisPhase.Inactive) {
      if (sentinelDashboardState.kind === SentinelDashboardChoiceKind.NotChosen) {
        sentinelDashboardState = { kind: SentinelDashboardChoiceKind.Chosen, dashboard: 'card-stack' }
      }
      wizardStep = VaultCreationWizardStep.SentinelCeremony
      chosenPath = ChosenVaultPath.Sentinel
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
    Boolean(sentinelDashboard) &&
      (wizardStep === VaultCreationWizardStep.SentinelPolicy ||
        wizardStep === VaultCreationWizardStep.SentinelCeremony),
  )
  const sentinelGenesisInvitationLink = $derived(
    buildSentinelGenesisRequestLink(sentinelGenesisRequest),
  )
  const landingSupporting = $derived(
    appKind === AppKind.Simple
      ? vault.t('login.landing_supporting_simple')
      : appKind === AppKind.Sentinel
        ? vault.t('login.landing_supporting_sentinel')
        : vault.t('login.landing_supporting'),
  )
  const existingVaultDescription = $derived(
    appKind === AppKind.Simple
      ? vault.t('login.path_cloud_description_simple')
      : appKind === AppKind.Sentinel
        ? vault.t('login.path_cloud_description_sentinel')
        : vault.t('login.path_cloud_description'),
  )

  $effect(() => {
    const deviceProtectionReady = vault.deviceProtectionReady
    if (
      initiatorPasskeyRequested &&
      deviceProtectionReady &&
      sentinelDashboardActive &&
      sentinelGenesisPhase === SentinelGenesisPhase.Inactive &&
      !initiatorFingerprint &&
      !initiatorKeyLoading &&
      !isBusy
    ) {
      void prepareInitiatorDeviceKeys()
    }
  })
  const canGoBack = $derived(
    wizardStep === VaultCreationWizardStep.SimpleCreate ||
      wizardStep === VaultCreationWizardStep.SentinelDashboard ||
      wizardStep === VaultCreationWizardStep.SentinelPolicy ||
      (wizardStep === VaultCreationWizardStep.Join &&
        !sentinelInvitationRequest.trim()),
  )

  const stepIndex = $derived.by(() => {
    switch (wizardStep) {
      case VaultCreationWizardStep.Choose:
        return 0
      case VaultCreationWizardStep.SimpleCreate:
      case VaultCreationWizardStep.SentinelDashboard:
      case VaultCreationWizardStep.SentinelPolicy:
      case VaultCreationWizardStep.Join:
      case VaultCreationWizardStep.SentinelCeremony:
        return 1
    }
  })

  const progressSteps = $derived.by(() => {
    const choose = vault.t('login.landing_step_choose')
    if (chosenPath === ChosenVaultPath.Simple) {
      return [choose, vault.t('login.landing_step_simple')]
    }
    if (chosenPath === ChosenVaultPath.Sentinel) {
      return [choose, vault.t('login.landing_step_sentinel')]
    }
    if (chosenPath === ChosenVaultPath.Join) {
      return [choose, vault.t('login.landing_step_join')]
    }
    return [choose]
  })


  function chooseSimplePath() {
    vault.draftVaultType = VaultType.Simple
    chosenPath = ChosenVaultPath.Simple
    wizardStep = VaultCreationWizardStep.SimpleCreate
  }

  function chooseSentinelCreatePath() {
    vault.draftVaultType = VaultType.Sentinel
    chosenPath = ChosenVaultPath.Sentinel
    initiatorFingerprint = ''
    initiatorPasskeyRequested = false
    sentinelDashboardState = { kind: SentinelDashboardChoiceKind.NotChosen }
    wizardStep = VaultCreationWizardStep.SentinelDashboard
  }

  function chooseSentinelDashboard(dashboard: SentinelDashboard) {
    sentinelDashboardState = { kind: SentinelDashboardChoiceKind.Chosen, dashboard }
    wizardStep = VaultCreationWizardStep.SentinelPolicy
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
    if (wizardStep === VaultCreationWizardStep.SentinelCeremony) return
    if (
      wizardStep === VaultCreationWizardStep.SimpleCreate ||
      wizardStep === VaultCreationWizardStep.Join
    ) {
      chosenPath = ChosenVaultPath.Undecided
      wizardStep = VaultCreationWizardStep.Choose
      return
    }
    if (wizardStep === VaultCreationWizardStep.SentinelDashboard) {
      sentinelDashboardState = { kind: SentinelDashboardChoiceKind.NotChosen }
      chosenPath = ChosenVaultPath.Undecided
      wizardStep = VaultCreationWizardStep.Choose
      return
    }
    if (wizardStep === VaultCreationWizardStep.SentinelPolicy) {
      const dashboard = sentinelDashboard
      sentinelDashboardState = { kind: SentinelDashboardChoiceKind.NotChosen }
      wizardStep = VaultCreationWizardStep.SentinelDashboard
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
        wizardStep = VaultCreationWizardStep.SentinelCeremony
        return true
      }
      return false
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
    : omittedValue()}
  use:sentinelDashboardPortal={{
    active: sentinelDashboardActive,
    dashboard: sentinelDashboard,
  }}
>
  {#if sentinelDashboardActive && sentinelDashboard === 'card-stack'}
    <SentinelCardStackDashboard
      {vault}
      bind:name={sentinelName}
      bind:participantCount={sentinelParticipantCount}
      bind:threshold={sentinelThreshold}
      status={sentinelGenesisPhase}
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
      status={sentinelGenesisPhase}
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
              {#if wizardStep === VaultCreationWizardStep.SentinelPolicy}
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

                    {#if index === stepIndex &&
                      wizardStep === VaultCreationWizardStep.Choose}
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
                            {#if appKind !== AppKind.Sentinel}
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
                            {#if appKind !== AppKind.Simple}
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
                    {:else if index === stepIndex &&
                      wizardStep === VaultCreationWizardStep.SimpleCreate}
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
                    {:else if index === stepIndex &&
                      wizardStep === VaultCreationWizardStep.SentinelDashboard}
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

          {#if wizardStep === VaultCreationWizardStep.Join}
            <SentinelGenesisJoinFlow
              {vault}
              {isBusy}
              {sentinelInvitationRequest}
              {sentinelOnboardingPackage}
              onCreateParticipantResponse={onCreateSentinelGenesisParticipantResponse}
              onRememberRequest={onRememberSentinelGenesisRequest}
              onReceiveShare={onReceiveSentinelGenesisShare}
              onAcceptOnboardingPackage={onAcceptSentinelOnboardingPackage}
            />
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
</style>
