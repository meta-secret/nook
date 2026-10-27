<script lang="ts">
  import { err } from "neverthrow";
  import {
    VaultStorageFailure,
    VaultStorageFailureKind,
  } from "$lib/runtime/storage-failure";
  import type {
    LoginCreateVaultChooserProps,
    SentinelGenesisParticipation,
  } from "./login-create-vault-chooser-contract";
  import type { SentinelParticipation } from "./sentinel-card-stack-contract";
  import type { SentinelDashboardSurfaceProps } from "./sentinel-dashboard-surface-contract";
  import type {
    SentinelActionResult,
    SentinelGenesisParticipantResponseOutcome,
  } from "$lib/vault/sentinel-genesis";

  import { I18N_KEYS } from "../../../../generated/i18n-keys";
  import { tick, type ComponentProps } from "svelte";
  import {
    ArrowRight,
    Check,
    Layers3,
    Terminal,
    Users,
  } from "@lucide/svelte";
  import { Button } from "$lib/components/ui/button";
  import BackButton from "$lib/components/workspace/BackButton.svelte";
  import LoginExistingVaultPaths from "$lib/components/login/LoginExistingVaultPaths.svelte";
  import FirstVaultStart from "$lib/components/login/FirstVaultStart.svelte";
  import SentinelUnlockParticipantHelper from "$lib/components/login/SentinelUnlockParticipantHelper.svelte";
  import SentinelGenesisJoinFlow from "$lib/components/login/SentinelGenesisJoinFlow.svelte";
  import SentinelDashboardSurface from "$lib/components/login/SentinelDashboardSurface.svelte";
  import {
    SentinelDashboard,
    SentinelDashboardChoiceKind,
    sentinelDashboardPortal,
    type SentinelDashboardChoice,
  } from "$lib/components/login/sentinel-dashboard-portal";
  import {
    ChosenVaultPath,
    VaultCreationWizardStep,
  } from "./login-create-vault-chooser-state";
  import { VaultType } from "$lib/vault/architecture-model";
  import { sentinelGenesisBrowser } from "$lib/enrollment/sentinel-genesis-link";
  import {
    SentinelGenesisPhase,
    evaluate_sentinel_policy_draft,
    VaultApplication,
    sentinel_genesis_participant_fingerprint,
  } from "$app-wasm";

  let {
    vault,
    appKind,
    isVerifying,
    isInitializing,
    usesExtensionDeviceIdentity = false,
    onCreateDeviceVault,
    onConnectStorage,
    onUseEnrollmentCode,
    onStartSentinelGenesis,
    onAddSentinelGenesisParticipantResponse,
    onFinalizeSentinelGenesis,
    onCreateSentinelGenesisParticipantResponse,
    onCreateSentinelGenesisPublicKeyAnnouncement,
    onRememberSentinelGenesisRequest,
    onReceiveSentinelGenesisShare,
    onCompleteSentinelGenesisDelivery,
    sentinelGenesisPhase = SentinelGenesisPhase.Inactive,
    sentinelGenesisRequest = "",
    sentinelGenesisParticipants = [],
    sentinelGenesisDeliveries = [],
    sentinelInvitationRequest = "",
    sentinelParticipantResponsePending = false,
    sentinelParticipantResponse = "",
    sentinelOnboardingPackage = "",
    onAcceptSentinelOnboardingPackage,
    onFinishSentinelInvitation,
  }: LoginCreateVaultChooserProps = $props();

  type JoinFlowOptionalProps = Partial<
    Pick<
      ComponentProps<typeof SentinelGenesisJoinFlow>,
      | "onCreateParticipantResponse"
      | "onRememberRequest"
      | "onReceiveShare"
      | "onAcceptOnboardingPackage"
    >
  >;
  const joinFlowOptionalProps = $derived.by(() => {
    const props: JoinFlowOptionalProps = {};
    if (onCreateSentinelGenesisParticipantResponse)
      props.onCreateParticipantResponse =
        onCreateSentinelGenesisParticipantResponse;
    if (onRememberSentinelGenesisRequest)
      props.onRememberRequest = onRememberSentinelGenesisRequest;
    if (onReceiveSentinelGenesisShare)
      props.onReceiveShare = onReceiveSentinelGenesisShare;
    if (onAcceptSentinelOnboardingPackage)
      props.onAcceptOnboardingPackage = onAcceptSentinelOnboardingPackage;
    return props;
  });

  type DashboardOptionalProps = Partial<
    Pick<
      SentinelDashboardSurfaceProps,
      "onFinalizeSentinelGenesis" | "onCompleteSentinelGenesisDelivery"
    >
  >;
  const dashboardOptionalProps = $derived.by(() => {
    const props: DashboardOptionalProps = {};
    if (onFinalizeSentinelGenesis)
      props.onFinalizeSentinelGenesis = onFinalizeSentinelGenesis;
    if (onCompleteSentinelGenesisDelivery)
      props.onCompleteSentinelGenesisDelivery =
        onCompleteSentinelGenesisDelivery;
    return props;
  });

  type JoinIdentityProps = Partial<
    Pick<ComponentProps<typeof LoginExistingVaultPaths>, "onUseEnrollmentCode">
  >;
  const joinIdentityProps = $derived.by(() => {
    const props: JoinIdentityProps = {};
    // Sentinel apps join through their own invitation ceremony.
    if (onUseEnrollmentCode && appKind !== VaultApplication.Sentinel)
      props.onUseEnrollmentCode = onUseEnrollmentCode;
    return props;
  });

  const isBusy = $derived(isVerifying || isInitializing);
  /** Simple and unified apps start with one name field; Sentinel keeps its ceremony. */
  const quickStart = $derived(
    appKind !== VaultApplication.Sentinel &&
      !sentinelInvitationRequest.trim() &&
      !sentinelOnboardingPackage.trim() &&
      sentinelGenesisPhase === SentinelGenesisPhase.Inactive,
  );
  let wizardStep = $state<VaultCreationWizardStep>(
    VaultCreationWizardStep.Choose,
  );
  let chosenPath = $state<ChosenVaultPath>(ChosenVaultPath.Undecided);
  let sentinelName = $state("");
  let sentinelDashboardState = $state<SentinelDashboardChoice>({
    kind: SentinelDashboardChoiceKind.NotChosen,
  });
  function dashboardIs(dashboard: SentinelDashboard): boolean {
    return (
      sentinelDashboardState.kind === SentinelDashboardChoiceKind.Chosen &&
      sentinelDashboardState.dashboard === dashboard
    );
  }

  function finishSentinelInvitation(): void {
    chosenPath = ChosenVaultPath.Undecided;
    wizardStep = VaultCreationWizardStep.Choose;
    onFinishSentinelInvitation?.();
  }
  let sentinelParticipantCount = $state(3);
  let sentinelThreshold = $state(2);
  let sentinelActionBusy = $state(false);
  let initiatorFingerprint = $state("");
  let initiatorKeyLoading = $state(false);
  let initiatorPasskeyRequested = $state(false);
  let importedParticipantResponse = $state("");

  function participantActionFailure(): SentinelActionResult<SentinelGenesisParticipantResponseOutcome> {
    return err(
      new VaultStorageFailure(VaultStorageFailureKind.OperationFailed),
    );
  }

  function addCardParticipant(
    request: SentinelParticipation,
  ): Promise<SentinelActionResult<SentinelGenesisParticipantResponseOutcome>> {
    return onAddSentinelGenesisParticipantResponse
      ? onAddSentinelGenesisParticipantResponse(request)
      : Promise.resolve(participantActionFailure());
  }

  function addTerminalParticipant(
    payload: string,
  ): Promise<SentinelActionResult<SentinelGenesisParticipantResponseOutcome>> {
    const terminalParticipantRequest: SentinelGenesisParticipation = {
      payload,
    };
    return onAddSentinelGenesisParticipantResponse
      ? onAddSentinelGenesisParticipantResponse(terminalParticipantRequest)
      : Promise.resolve(participantActionFailure());
  }

  $effect(() => {
    if (
      sentinelOnboardingPackage.trim() &&
      wizardStep === VaultCreationWizardStep.Choose
    ) {
      chosenPath = ChosenVaultPath.Join;
      wizardStep = VaultCreationWizardStep.Join;
    }
  });

  $effect(() => {
    const invitation = sentinelInvitationRequest.trim();
    if (!invitation || wizardStep !== VaultCreationWizardStep.Choose) return;
    chosenPath = ChosenVaultPath.Join;
    wizardStep = VaultCreationWizardStep.Join;
  });

  $effect(() => {
    const response = sentinelParticipantResponse.trim();
    if (
      !response ||
      response === importedParticipantResponse ||
      sentinelGenesisPhase !== SentinelGenesisPhase.CollectingParticipants ||
      !dashboardIs(SentinelDashboard.Terminal) ||
      !onAddSentinelGenesisParticipantResponse
    ) {
      return;
    }
    importedParticipantResponse = response;
    const participantRequest: Parameters<
      NonNullable<typeof onAddSentinelGenesisParticipantResponse>
    >[0] = { payload: response };
    void onAddSentinelGenesisParticipantResponse(participantRequest);
  });

  $effect(() => {
    if (sentinelGenesisPhase === SentinelGenesisPhase.Complete) {
      sentinelDashboardState = { kind: SentinelDashboardChoiceKind.NotChosen };
      return;
    }
    if (sentinelGenesisPhase !== SentinelGenesisPhase.Inactive) {
      if (
        sentinelDashboardState.kind === SentinelDashboardChoiceKind.NotChosen
      ) {
        sentinelDashboardState = {
          kind: SentinelDashboardChoiceKind.Chosen,
          dashboard: SentinelDashboard.CardStack,
        };
      }
      wizardStep = VaultCreationWizardStep.SentinelCeremony;
      chosenPath = ChosenVaultPath.Sentinel;
    }
  });

  const sentinelNameReady = $derived(sentinelName.trim().length > 0);
  const sentinelPolicyRequest = $derived<
    Parameters<typeof evaluate_sentinel_policy_draft>[0]
  >({
    participants: sentinelParticipantCount,
    threshold: sentinelThreshold,
  });
  const sentinelPolicy = $derived(
    evaluate_sentinel_policy_draft(sentinelPolicyRequest),
  );
  const sentinelPolicyValid = $derived(
    sentinelPolicy.admission.kind === "accepted",
  );
  const sentinelDashboardActive = $derived(
    sentinelDashboardState.kind === SentinelDashboardChoiceKind.Chosen &&
      (wizardStep === VaultCreationWizardStep.SentinelPolicy ||
        wizardStep === VaultCreationWizardStep.SentinelCeremony),
  );
  const sentinelGenesisInvitationLink = $derived(
    (() => {
      const linkArgs: Parameters<
        typeof sentinelGenesisBrowser.buildSentinelGenesisRequestLink
      >[0] = {
        requestJson: sentinelGenesisRequest,
      };
      return sentinelGenesisBrowser.buildSentinelGenesisRequestLink(linkArgs);
    })(),
  );
  const existingVaultDescription = $derived(
    appKind === VaultApplication.Simple
      ? vault.t(I18N_KEYS.LoginPathCloudDescriptionSimple)
      : appKind === VaultApplication.Sentinel
        ? vault.t(I18N_KEYS.LoginPathCloudDescriptionSentinel)
        : vault.t(I18N_KEYS.LoginPathCloudDescription),
  );

  $effect(() => {
    const deviceProtectionReady = vault.deviceProtectionReady;
    if (
      initiatorPasskeyRequested &&
      deviceProtectionReady &&
      sentinelDashboardActive &&
      sentinelGenesisPhase === SentinelGenesisPhase.Inactive &&
      !initiatorFingerprint &&
      !initiatorKeyLoading &&
      !isBusy
    ) {
      void prepareInitiatorDeviceKeys();
    }
  });
  const canGoBack = $derived(
    wizardStep === VaultCreationWizardStep.SentinelDashboard ||
      wizardStep === VaultCreationWizardStep.SentinelPolicy ||
      wizardStep === VaultCreationWizardStep.Join,
  );

  const stepIndex = $derived.by(() => {
    switch (wizardStep) {
      case VaultCreationWizardStep.Choose:
        return 0;
      case VaultCreationWizardStep.SentinelDashboard:
      case VaultCreationWizardStep.SentinelPolicy:
      case VaultCreationWizardStep.Join:
      case VaultCreationWizardStep.SentinelCeremony:
        return 1;
    }
  });

  // Simple and unified apps create through FirstVaultStart; this chooser
  // carries the Sentinel paths and invitation flows.
  const progressSteps = $derived.by(() => {
    const choose = vault.t(I18N_KEYS.LoginLandingStepChoose);
    if (chosenPath === ChosenVaultPath.Sentinel) {
      return [choose, vault.t(I18N_KEYS.LoginLandingStepSentinel)];
    }
    if (chosenPath === ChosenVaultPath.Join) {
      return [choose, vault.t(I18N_KEYS.LoginLandingStepJoin)];
    }
    return [choose];
  });

  function chooseSentinelCreatePath() {
    vault.draftVaultType = VaultType.Sentinel;
    chosenPath = ChosenVaultPath.Sentinel;
    initiatorFingerprint = "";
    initiatorPasskeyRequested = false;
    sentinelDashboardState = { kind: SentinelDashboardChoiceKind.NotChosen };
    wizardStep = VaultCreationWizardStep.SentinelDashboard;
  }

  function chooseSentinelDashboard(dashboard: SentinelDashboard) {
    sentinelDashboardState = {
      kind: SentinelDashboardChoiceKind.Chosen,
      dashboard,
    };
    wizardStep = VaultCreationWizardStep.SentinelPolicy;
  }

  async function prepareInitiatorDeviceKeys() {
    if (
      initiatorKeyLoading ||
      initiatorFingerprint ||
      !onCreateSentinelGenesisPublicKeyAnnouncement
    )
      return;
    initiatorKeyLoading = true;
    try {
      const payload = await onCreateSentinelGenesisPublicKeyAnnouncement();
      if (payload.isErr()) {
        initiatorPasskeyRequested =
          payload.error.kind ===
          VaultStorageFailureKind.DeviceAuthorizationRequired;
        vault.errorMsg = vault.t(payload.error.translationKey);
        return;
      }
      try {
        initiatorFingerprint = sentinel_genesis_participant_fingerprint(
          payload.value,
        );
        initiatorPasskeyRequested = false;
      } catch {
        initiatorFingerprint = "";
        vault.errorMsg = vault.t(I18N_KEYS.LoginSentinelGenesisResponseFailed);
      }
    } finally {
      initiatorKeyLoading = false;
    }
  }

  function restoreDashboardChoiceFocus(dashboard: SentinelDashboard) {
    void tick().then(() => {
      requestAnimationFrame(() => {
        document
          .querySelector<HTMLElement>(
            `[data-testid="sentinel-dashboard-${dashboard}"]`,
          )
          ?.focus();
      });
    });
  }

  function goBack() {
    if (wizardStep === VaultCreationWizardStep.SentinelCeremony) return;
    if (
      wizardStep === VaultCreationWizardStep.Join &&
      sentinelInvitationRequest.trim()
    ) {
      finishSentinelInvitation();
      return;
    }
    if (wizardStep === VaultCreationWizardStep.Join) {
      chosenPath = ChosenVaultPath.Undecided;
      wizardStep = VaultCreationWizardStep.Choose;
      return;
    }
    if (wizardStep === VaultCreationWizardStep.SentinelDashboard) {
      sentinelDashboardState = { kind: SentinelDashboardChoiceKind.NotChosen };
      chosenPath = ChosenVaultPath.Undecided;
      wizardStep = VaultCreationWizardStep.Choose;
      return;
    }
    if (wizardStep === VaultCreationWizardStep.SentinelPolicy) {
      const dashboardChoice = sentinelDashboardState;
      sentinelDashboardState = { kind: SentinelDashboardChoiceKind.NotChosen };
      wizardStep = VaultCreationWizardStep.SentinelDashboard;
      if (dashboardChoice.kind === SentinelDashboardChoiceKind.Chosen) {
        restoreDashboardChoiceFocus(dashboardChoice.dashboard);
      }
    }
  }


  async function startSentinelGenesis(): Promise<boolean> {
    if (
      !sentinelNameReady ||
      !sentinelPolicyValid ||
      isBusy ||
      sentinelActionBusy
    ) {
      return false;
    }
    sentinelActionBusy = true;
    try {
      const onStartSentinelGenesisArgs: Parameters<
        typeof onStartSentinelGenesis
      >[0] = {
        label: sentinelName.trim(),
        participantCount: sentinelParticipantCount,
        threshold: sentinelThreshold,
      };
      const started = await onStartSentinelGenesis(onStartSentinelGenesisArgs);
      if (started !== false) {
        wizardStep = VaultCreationWizardStep.SentinelCeremony;
        return true;
      }
      return false;
    } finally {
      sentinelActionBusy = false;
    }
  }
</script>

<div
  class={[
    "animate-in fade-in duration-300",
    sentinelDashboardActive
      ? "fixed inset-0 z-40 w-full overflow-y-auto bg-[#10141a] text-white"
      : "w-full",
    dashboardIs(SentinelDashboard.Terminal) && sentinelDashboardActive
      ? "sentinel-terminal bg-[#090b09] font-mono text-[#b7ff95]"
      : "",
    dashboardIs(SentinelDashboard.CardStack) && sentinelDashboardActive
      ? "sentinel-card-stack"
      : "",
  ]}
  {...sentinelDashboardActive &&
  sentinelDashboardState.kind === SentinelDashboardChoiceKind.Chosen
    ? { "data-sentinel-dashboard": sentinelDashboardState.dashboard }
    : {}}
  data-testid="login-create-vault-chooser"
  use:sentinelDashboardPortal={{
    active: sentinelDashboardActive,
    choice: sentinelDashboardState,
  }}
>
  {#if quickStart}
    <FirstVaultStart
      {vault}
      {isBusy}
      {isVerifying}
      {usesExtensionDeviceIdentity}
      onCreate={onCreateDeviceVault}
      {onConnectStorage}
      {...joinIdentityProps}
    />
  {:else if sentinelDashboardActive && dashboardIs(SentinelDashboard.CardStack)}
    <SentinelDashboardSurface
      {vault}
      dashboard={SentinelDashboard.CardStack}
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
      onAddCardParticipant={addCardParticipant}
      onAddTerminalParticipant={addTerminalParticipant}
      {...dashboardOptionalProps}
    />
  {:else if sentinelDashboardActive && dashboardIs(SentinelDashboard.Terminal)}
    <SentinelDashboardSurface
      {vault}
      dashboard={SentinelDashboard.Terminal}
      bind:name={sentinelName}
      bind:participantCount={sentinelParticipantCount}
      bind:threshold={sentinelThreshold}
      status={sentinelGenesisPhase}
      request={sentinelGenesisInvitationLink}
      participantResponse=""
      participants={sentinelGenesisParticipants}
      deliveries={sentinelGenesisDeliveries}
      isBusy={isBusy || sentinelActionBusy}
      initiatorFingerprint=""
      initiatorKeyLoading={false}
      onPrepareInitiator={() => prepareInitiatorDeviceKeys()}
      onBack={goBack}
      onStart={() => startSentinelGenesis()}
      onAddCardParticipant={addCardParticipant}
      onAddTerminalParticipant={addTerminalParticipant}
      {...dashboardOptionalProps}
    />
  {:else}
    <section
      class={[
        "mx-auto w-full",
        sentinelDashboardActive
          ? "relative min-h-screen max-w-7xl px-5 py-20 sm:px-10"
          : "",
      ]}
    >
      <div class={sentinelDashboardActive ? "relative w-full" : ""}>

        <div
          class={[
            "relative",
            sentinelDashboardActive && dashboardIs(SentinelDashboard.CardStack)
              ? "sentinel-card-stack-panel rounded-none border border-[#657580] border-l-4 border-l-[#6ed9ff] bg-[#242d35] p-6 sm:p-10"
              : sentinelDashboardActive
                ? "rounded-none border border-[#294323] bg-black/40 p-5 shadow-[0_0_80px_rgb(94_255_112/0.05)] sm:p-8"
                : "",
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
                  {(() => {
                    const tArgs: Parameters<typeof vault.t>[0] = {
                      key: I18N_KEYS.LoginSentinelDashboardWorkspaceDescription,
                      replacements: {
                        name: sentinelName,
                      },
                    };
                    return vault.t(tArgs);
                  })()}
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
                      "mt-0.5 grid size-7 shrink-0 place-items-center font-mono text-xs font-bold",
                      index < stepIndex
                        ? "bg-emerald-700 text-white"
                        : index === stepIndex
                          ? "bg-foreground text-background"
                          : "bg-muted text-muted-foreground",
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
                        "text-base",
                        index === stepIndex
                          ? "font-semibold text-foreground"
                          : "text-muted-foreground",
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
                            {#if appKind !== VaultApplication.Simple}
                              <button
                                type="button"
                                class="group grid grid-cols-[auto_1fr_auto] items-center gap-3 nk-frame-nick nk-frame-interactive px-4 py-3 text-left text-foreground transition-colors hover:bg-accent/40 disabled:opacity-60"
                                data-testid="get-started-path-sentinel"
                                disabled={isBusy}
                                onclick={chooseSentinelCreatePath}
                              >
                                <span
                                  class="nk-tile border-foreground bg-foreground text-background"
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
                          {(() => {
                            const tArgs3: Parameters<typeof vault.t>[0] = {
                              key: I18N_KEYS.LoginSentinelDashboardChoiceDescription,
                              replacements: {
                                name: sentinelName.trim(),
                              },
                            };
                            return vault.t(tArgs3);
                          })()}
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
            {#if wizardStep === VaultCreationWizardStep.Choose}
              <LoginExistingVaultPaths
                {vault}
                {isBusy}
                {isVerifying}
                restoreDescription={existingVaultDescription}
                {onConnectStorage}
                {...joinIdentityProps}
              />
            {/if}
          {/if}

          {#if wizardStep === VaultCreationWizardStep.Join}
            {#key sentinelInvitationRequest}
              <SentinelGenesisJoinFlow
                {vault}
                {isBusy}
                {sentinelInvitationRequest}
                {sentinelParticipantResponsePending}
                {sentinelOnboardingPackage}
                {...joinFlowOptionalProps}
                onFinishSentinelInvitation={finishSentinelInvitation}
              />
            {/key}
          {/if}

          {#if canGoBack && !sentinelDashboardActive}
            <div class="mt-8">
              <BackButton
                label={vault.t(I18N_KEYS.CommonBack)}
                testId="create-vault-wizard-back"
                disabled={isBusy || sentinelActionBusy}
                onBack={goBack}
              />
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
