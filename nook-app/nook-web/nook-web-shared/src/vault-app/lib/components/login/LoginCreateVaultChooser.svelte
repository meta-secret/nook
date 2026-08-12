<script lang="ts">
  type SentinelGenesisParticipation = { readonly payload: string; readonly participantLabel?: string }

  import { I18N_KEYS } from '../../../../generated/i18n-keys'
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
    SentinelDashboard,
    SentinelDashboardChoiceKind,
    sentinelDashboardPortal,
    type SentinelDashboardChoice,
  } from '$lib/components/login/sentinel-dashboard-portal'
  import type { VaultState } from '$lib/vault.svelte'
  import {
    ChosenVaultPath,
    VaultCreationWizardStep,
  } from './login-create-vault-chooser-state'
  import { VaultType } from '$lib/vault/architecture-model'
  import { buildSentinelGenesisRequestLink } from '$lib/enrollment/sentinel-genesis-link'
  import {
    SentinelGenesisPhase,
    VaultApplication,
    sentinel_genesis_participant_fingerprint,
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
    appKind: VaultApplication
    isVerifying: boolean
    isInitializing: boolean
    usesExtensionDeviceIdentity?: boolean
    onCreateDeviceVault: (label: string) => void | Promise<void>
    onConnectStorage: () => void
    onStartSentinelGenesis: (args: StartSentinelGenesisArgs) => Promise<boolean>
    onAddSentinelGenesisParticipantResponse?: (
      args: SentinelGenesisParticipation,
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
  function dashboardIs(dashboard: SentinelDashboard): boolean {
    return (
      sentinelDashboardState.kind === SentinelDashboardChoiceKind.Chosen &&
      sentinelDashboardState.dashboard === dashboard
    )
  }
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
      !dashboardIs(SentinelDashboard.Terminal) ||
      !onAddSentinelGenesisParticipantResponse
    ) {
      return
    }
    importedParticipantResponse = response
    const participantRequest: Parameters<
      NonNullable<typeof onAddSentinelGenesisParticipantResponse>
    >[0] = { payload: response }
    void onAddSentinelGenesisParticipantResponse(participantRequest)
  })

  $effect(() => {
    if (sentinelGenesisPhase === SentinelGenesisPhase.Complete) {
      sentinelDashboardState = { kind: SentinelDashboardChoiceKind.NotChosen }
      return
    }
    if (sentinelGenesisPhase !== SentinelGenesisPhase.Inactive) {
      if (
        sentinelDashboardState.kind === SentinelDashboardChoiceKind.NotChosen
      ) {
        sentinelDashboardState = {
          kind: SentinelDashboardChoiceKind.Chosen,
          dashboard: SentinelDashboard.CardStack,
        }
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
    sentinelDashboardState.kind === SentinelDashboardChoiceKind.Chosen &&
      (wizardStep === VaultCreationWizardStep.SentinelPolicy ||
        wizardStep === VaultCreationWizardStep.SentinelCeremony),
  )
  const sentinelGenesisInvitationLink = $derived(
    (() => {
      const linkArgs: Parameters<
        typeof buildSentinelGenesisRequestLink
      >[0] = { requestJson: sentinelGenesisRequest }
      return buildSentinelGenesisRequestLink(linkArgs)
    })(),
  )
  const landingSupporting = $derived(
    appKind === VaultApplication.Simple
      ? vault.t(I18N_KEYS.LoginLandingSupportingSimple)
      : appKind === VaultApplication.Sentinel
        ? vault.t(I18N_KEYS.LoginLandingSupportingSentinel)
        : vault.t(I18N_KEYS.LoginLandingSupporting),
  )
  const existingVaultDescription = $derived(
    appKind === VaultApplication.Simple
      ? vault.t(I18N_KEYS.LoginPathCloudDescriptionSimple)
      : appKind === VaultApplication.Sentinel
        ? vault.t(I18N_KEYS.LoginPathCloudDescriptionSentinel)
        : vault.t(I18N_KEYS.LoginPathCloudDescription),
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
    const choose = vault.t(I18N_KEYS.LoginLandingStepChoose)
    if (chosenPath === ChosenVaultPath.Simple) {
      return [choose, vault.t(I18N_KEYS.LoginLandingStepSimple)]
    }
    if (chosenPath === ChosenVaultPath.Sentinel) {
      return [choose, vault.t(I18N_KEYS.LoginLandingStepSentinel)]
    }
    if (chosenPath === ChosenVaultPath.Join) {
      return [choose, vault.t(I18N_KEYS.LoginLandingStepJoin)]
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
    sentinelDashboardState = {
      kind: SentinelDashboardChoiceKind.Chosen,
      dashboard,
    }
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
      initiatorFingerprint = sentinel_genesis_participant_fingerprint(payload)
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
      const dashboardChoice = sentinelDashboardState
      sentinelDashboardState = { kind: SentinelDashboardChoiceKind.NotChosen }
      wizardStep = VaultCreationWizardStep.SentinelDashboard
      if (dashboardChoice.kind === SentinelDashboardChoiceKind.Chosen) {
        restoreDashboardChoiceFocus(dashboardChoice.dashboard)
      }
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
      sentinelActionBusy
    ) {
      return false
    }
    sentinelActionBusy = true
    try {
      const onStartSentinelGenesisArgs: Parameters<typeof onStartSentinelGenesis>[0] = {
        label: sentinelName.trim(),
        participantCount: sentinelParticipantCount,
        threshold: sentinelThreshold,
      };
      const started = await onStartSentinelGenesis(onStartSentinelGenesisArgs)
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
    dashboardIs(SentinelDashboard.Terminal) && sentinelDashboardActive
      ? 'sentinel-terminal bg-[#090b09] font-mono text-[#b7ff95]'
      : '',
    dashboardIs(SentinelDashboard.CardStack) && sentinelDashboardActive
      ? 'sentinel-card-stack'
      : '',
  ]}
  {...sentinelDashboardActive &&
  sentinelDashboardState.kind === SentinelDashboardChoiceKind.Chosen
    ? { 'data-sentinel-dashboard': sentinelDashboardState.dashboard }
    : {}}
  data-testid="login-create-vault-chooser"
  use:sentinelDashboardPortal={{
    active: sentinelDashboardActive,
    choice: sentinelDashboardState,
  }}
>
  {#if sentinelDashboardActive && dashboardIs(SentinelDashboard.CardStack)}
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
      onAddParticipant={({ payload, participantLabel }) => {
        const participantRequest: Parameters<
          NonNullable<typeof onAddSentinelGenesisParticipantResponse>
        >[0] = { payload, participantLabel }
        return onAddSentinelGenesisParticipantResponse?.(participantRequest)
      }}
      onFinalize={() => onFinalizeSentinelGenesis?.()}
      onCompleteDelivery={() => onCompleteSentinelGenesisDelivery?.()}
    />
  {:else if sentinelDashboardActive && dashboardIs(SentinelDashboard.Terminal)}
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
      onAddParticipant={(payload) => {
        const participantRequest: Parameters<
          NonNullable<typeof onAddSentinelGenesisParticipantResponse>
        >[0] = { payload }
        return onAddSentinelGenesisParticipantResponse?.(participantRequest)
      }}
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
          {vault.t(I18N_KEYS.LoginLandingEyebrow)}
        </p>
        <h1
          class="text-4xl leading-[0.95] font-semibold tracking-tight text-foreground sm:text-5xl lg:text-6xl"
        >
          {vault.t(I18N_KEYS.LoginLandingHeadline)}
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
            sentinelDashboardActive && dashboardIs(SentinelDashboard.CardStack)
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
                  {vault.t(I18N_KEYS.LoginSentinelDashboardWorkspaceEyebrow)}
                </p>
                <h2
                  class="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl"
                >
                  {dashboardIs(SentinelDashboard.Terminal)
                    ? vault.t(I18N_KEYS.LoginSentinelDashboardTerminalTitle)
                    : vault.t(I18N_KEYS.LoginSentinelDashboardCardStackTitle)}
                </h2>
                <p class="mt-2 max-w-2xl text-sm leading-6 text-current/65">
                  {(() => { const tArgs: Parameters<typeof vault.t>[0] = { key: I18N_KEYS.LoginSentinelDashboardWorkspaceDescription, replacements: {
                    name: sentinelName,
                  } }; return vault.t(tArgs); })()}
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
                  {vault.t(I18N_KEYS.LoginSentinelDashboardChange)}
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

                    {#if index === stepIndex && wizardStep === VaultCreationWizardStep.Choose}
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
                            {#if appKind !== VaultApplication.Sentinel}
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
                                      I18N_KEYS.LoginGetStartedPathSimpleTitle,
                                    )}
                                  </span>
                                  <span
                                    class="mt-1 block text-xs leading-snug text-muted-foreground"
                                  >
                                    {vault.t(
                                      I18N_KEYS.LoginGetStartedPathSimpleDescription,
                                    )}
                                  </span>
                                </span>
                                <ArrowRight
                                  class="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                                />
                              </button>
                            {/if}
                            {#if appKind !== VaultApplication.Simple}
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
                                      I18N_KEYS.LoginGetStartedPathSentinelTitle,
                                    )}
                                  </span>
                                  <span
                                    class="mt-1 block text-xs leading-snug text-muted-foreground"
                                  >
                                    {vault.t(
                                      I18N_KEYS.LoginGetStartedPathSentinelDescription,
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
                                {vault.t(I18N_KEYS.LoginExistingVaultAlternative)}
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
                                  {vault.t(I18N_KEYS.LoginPathCloudTitle)}
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
                    {:else if index === stepIndex && wizardStep === VaultCreationWizardStep.SimpleCreate}
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
                              I18N_KEYS.LoginVaultNamePlaceholder,
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
                              {(() => { const tArgs2: Parameters<typeof vault.t>[0] = { key: usesExtensionDeviceIdentity
                                  ? I18N_KEYS.LoginLandingCreateSimpleWithExtension
                                  : I18N_KEYS.LoginLandingCreateSimpleLocally, replacements: { name: trimmedVaultName } }; return vault.t(
                                tArgs2,
                              ); })()}
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
                              {vault.t(I18N_KEYS.LoginCreatingVault)}
                            {:else if isInitializing}
                              <RefreshCw class="size-4 animate-spin" />
                              {vault.t(I18N_KEYS.OnboardingLoadingEngine)}
                            {:else}
                              <ShieldCheck class="size-4" />
                              {vault.t(I18N_KEYS.LoginLandingCreateSimpleBtn)}
                            {/if}
                          </Button>
                        </div>
                      </section>
                    {:else if index === stepIndex && wizardStep === VaultCreationWizardStep.SentinelDashboard}
                      <section
                        class="mt-4 space-y-4"
                        data-testid="sentinel-dashboard-choice"
                      >
                        <p
                          class="text-sm leading-6 text-pretty text-muted-foreground"
                        >
                          {(() => { const tArgs3: Parameters<typeof vault.t>[0] = { key: I18N_KEYS.LoginSentinelDashboardChoiceDescription, replacements: {
                              name: trimmedVaultName,
                            } }; return vault.t(
                            tArgs3,
                          ); })()}
                        </p>
                        <div class="grid gap-3 sm:grid-cols-2">
                          <button
                            type="button"
                            class="group rounded-xl border border-border bg-background p-4 text-left transition hover:border-foreground/40 hover:shadow-md disabled:opacity-60"
                            data-testid="sentinel-dashboard-card-stack"
                            disabled={isBusy}
                            onclick={() =>
                              chooseSentinelDashboard(
                                SentinelDashboard.CardStack,
                              )}
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
                                I18N_KEYS.LoginSentinelDashboardCardStackTitle,
                              )}
                            </span>
                            <span
                              class="mt-1 block text-xs leading-5 text-muted-foreground"
                            >
                              {vault.t(
                                I18N_KEYS.LoginSentinelDashboardCardStackDescription,
                              )}
                            </span>
                          </button>
                          <button
                            type="button"
                            class="group rounded-xl border border-border bg-[#090b09] p-4 text-left text-[#b7ff95] transition hover:border-[#b7ff95]/60 hover:shadow-md disabled:opacity-60"
                            data-testid="sentinel-dashboard-terminal"
                            disabled={isBusy}
                            onclick={() =>
                              chooseSentinelDashboard(
                                SentinelDashboard.Terminal,
                              )}
                          >
                            <span
                              class="mb-4 grid size-10 place-items-center rounded-lg border border-[#b7ff95]/30 bg-[#b7ff95]/10"
                            >
                              <Terminal class="size-5" />
                            </span>
                            <span class="block font-mono text-sm font-semibold">
                              {vault.t(
                                I18N_KEYS.LoginSentinelDashboardTerminalTitle,
                              )}
                            </span>
                            <span
                              class="mt-1 block font-mono text-xs leading-5 text-[#b7ff95]/60"
                            >
                              {vault.t(
                                I18N_KEYS.LoginSentinelDashboardTerminalDescription,
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
                {vault.t(I18N_KEYS.CommonBack)}
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
