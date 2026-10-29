<script lang="ts">
  import { I18N_KEYS } from '../../../generated/i18n-keys'
  import { ShieldCheck } from '@lucide/svelte'
  import { onDestroy } from 'svelte'
  import { NookExtensionConsentPhaseState } from '$app-wasm'
  import { Button } from '$lib/components/ui/button'
  import type { ExtensionConnectRequest } from '../extension/connect'
  import type { VaultState } from '$lib/vault.svelte'
  import ExtensionConnectFacts from './ExtensionConnectFacts.svelte'
  import FirstRunDiagram from './login/FirstRunDiagram.svelte'
  import {
    extensionConnectDiagram,
    type ExtensionConnectDiagramRequest,
  } from './extension-connect-diagram'
  import {
    ExtensionConsentDeliveryOutcomeKind,
    ExtensionConsentRejectionKind,
    ExtensionConsentWorkflowKind,
    ExtensionConsentWorkflowNoticeKind,
    ExtensionConnectConsentWorkflow,
    ExtensionConsentWorkflowPresentation,
    type ExtensionConsentWorkflowState,
  } from './extension-connect-consent-workflow'
  import { ExtensionConsentCloseOutcome } from './extension-connect-consent-outcome'
  import { ExtensionConnectConsentSteps } from './extension-connect-consent-progress'
  import {
    ExtensionConsentActivityKind,
    ExtensionConsentActivityPresentation,
    ExtensionConsentActivitySegment,
  } from './extension-connect-consent-activity'
  import { extensionConnectProgress } from '$lib/extension/connect-progress'

  type ExtensionConsentWorkflowSession = {
    readonly workflow: ExtensionConnectConsentWorkflow
    readonly state: ExtensionConsentWorkflowState
    approve(): Promise<void>
    dispose(): void
  }

  type ExtensionConsentWorkflowSessionRequest = {
    readonly vault: VaultState
    readonly request: ExtensionConnectRequest
  }

  let {
    vault,
    request,
    onClose,
  }: {
    vault: VaultState
    request: ExtensionConnectRequest
    onClose: (outcome: ExtensionConsentCloseOutcome) => void
  } = $props()

  function createWorkflowSession({
    vault: sessionVault,
    request: sessionRequest,
  }: ExtensionConsentWorkflowSessionRequest): ExtensionConsentWorkflowSession {
    const workflowRequest: ConstructorParameters<
      typeof ExtensionConnectConsentWorkflow
    >[0] = { vault: sessionVault, request: sessionRequest }
    const workflow = new ExtensionConnectConsentWorkflow(workflowRequest)
    let state = $state.raw(workflow.initialState())

    return {
      workflow,
      get state() {
        return state
      },
      async approve() {
        const approvalRequest: Parameters<typeof workflow.approve>[0] = {
          state,
          publish: (next) => (state = next),
        }
        await workflow.approve(approvalRequest)
      },
      dispose() {
        workflow.dispose()
      },
    }
  }

  const sessionRequest = $derived<ExtensionConsentWorkflowSessionRequest>({
    vault,
    request,
  })
  let session = $derived(createWorkflowSession(sessionRequest))
  const presentation = new ExtensionConsentWorkflowPresentation()

  const identityName = $derived(
    vault.identityControl.snapshot === false
      ? vault.t(I18N_KEYS.WorkspaceIdentityFallback)
      : vault.identityControl.snapshot.identityLabel ||
          vault.t(I18N_KEYS.WorkspaceIdentityFallback),
  )
  const diagramRequest = $derived<ExtensionConnectDiagramRequest>({
    vault,
    keyring: identityName,
  })
  const diagram = $derived(extensionConnectDiagram(diagramRequest))
  const workflowState = $derived(session.state)
  const availability = $derived(
    session.workflow.approvalAvailability(workflowState),
  )
  const noticeRequest = $derived<Parameters<typeof presentation.notice>[0]>({
    state: workflowState,
    availability,
  })
  const notice = $derived(presentation.notice(noticeRequest))
  const actionTranslationKey = $derived(
    presentation.actionTranslationKey(workflowState),
  )
  const closeOutcome = $derived(session.workflow.closeOutcome(workflowState))
  const isDeliveredSuccess = $derived(
    workflowState.kind === ExtensionConsentWorkflowKind.Completed &&
      workflowState.outcome.kind ===
        ExtensionConsentDeliveryOutcomeKind.Delivered,
  )
  const activity = $derived(
    ExtensionConsentActivityPresentation.of(workflowState),
  )
  const activitySegments = $derived(
    ExtensionConsentActivityPresentation.segments(activity),
  )
  const activityStepLabel = $derived.by(() => {
    if (activity.kind !== ExtensionConsentActivityKind.Working) return ''
    const stepRequest: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.ExtensionConsentProgressStep,
      replacements: {
        step: String(activity.step),
        total: String(activity.total),
      },
    }
    return vault.t(stepRequest)
  })

  // The side panel follows the consent; approved is reported only after
  // the extension took the grant and event log.
  $effect(() => {
    extensionConnectProgress.report(
      ExtensionConnectConsentSteps.consent(workflowState),
    )
  })
  $effect.pre(() => {
    const activeSession = session
    return () => activeSession.dispose()
  })
  $effect(() => {
    if (!isDeliveredSuccess) return

    // The progress stays up until here; the vault announces the approval.
    vault.showSuccess(vault.t(I18N_KEYS.ExtensionConsentApproved))
    onClose(ExtensionConsentCloseOutcome.Approved)
  })
  onDestroy(() => session.dispose())

  async function approveExtension() {
    await session.approve()
  }

  function closeConsent() {
    onClose(closeOutcome)
  }
</script>

<section
  class="grid min-w-0 content-start gap-6"
  data-testid="extension-connect-consent"
>
  <header class="flex items-center gap-3">
    <span class="nk-vault-icon nk-vault-icon-open size-10" aria-hidden="true">
      <ShieldCheck class="size-4" />
    </span>
    <h2 class="text-lg font-semibold tracking-tight text-foreground">
      {vault.t(I18N_KEYS.ExtensionConsentTitle)}
    </h2>
  </header>

  <FirstRunDiagram {diagram} />

  <ExtensionConnectFacts {vault} {request} />

  {#if notice.kind === ExtensionConsentWorkflowNoticeKind.Message && !isDeliveredSuccess}
    <p
      class="rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300"
      role="alert"
    >
      {vault.t(notice.translationKey)}
    </p>
  {:else if notice.kind === ExtensionConsentWorkflowNoticeKind.Rejected}
    {#if notice.rejection.kind === ExtensionConsentRejectionKind.WithReason}
      <p
        class="rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300"
        data-extension-pairing-rejection-reason={notice.rejection.reason}
        role="alert"
      >
        {vault.t(notice.translationKey)}
      </p>
    {:else}
      <p
        class="rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300"
        role="alert"
      >
        {vault.t(notice.translationKey)}
      </p>
    {/if}
  {/if}

  {#if (workflowState.kind === ExtensionConsentWorkflowKind.Completed && workflowState.outcome.kind !== ExtensionConsentDeliveryOutcomeKind.Delivered) || (workflowState.kind === ExtensionConsentWorkflowKind.Failed && workflowState.phase.state === NookExtensionConsentPhaseState.Approved)}
    <p
      class="rounded-md border border-primary/25 bg-primary/10 px-3 py-2 text-sm text-primary"
      data-testid="extension-connect-approved"
    >
      {vault.t(I18N_KEYS.ExtensionConsentApprovedReopen)}
    </p>
  {/if}

  {#if activity.kind === ExtensionConsentActivityKind.Working}
    <div
      class="grid gap-2 rounded-md border border-border/50 bg-background/60 px-3 py-3"
      role="status"
      aria-live="polite"
      data-testid="extension-connect-progress"
      data-extension-connect-progress-step={activity.step}
    >
      <div class="flex items-baseline justify-between gap-3">
        <p class="text-sm text-foreground">
          {vault.t(activity.translationKey)}
        </p>
        <p class="shrink-0 font-mono text-[11px] text-muted-foreground">
          {activityStepLabel}
        </p>
      </div>
      <div class="grid grid-cols-4 gap-1" aria-hidden="true">
        {#each activitySegments as segment, index (index)}
          {#if segment === ExtensionConsentActivitySegment.Current}
            <span class="nk-progress-sweep"></span>
          {:else}
            <span
              class="block h-0.5 {segment ===
              ExtensionConsentActivitySegment.Done
                ? 'bg-[var(--titanium)]'
                : 'bg-foreground/10'}"
            ></span>
          {/if}
        {/each}
      </div>
    </div>
  {:else}
    <div class="flex flex-wrap justify-end gap-2">
      <Button type="button" variant="outline" onclick={closeConsent}>
        {closeOutcome === ExtensionConsentCloseOutcome.Approved
          ? vault.t(I18N_KEYS.CommonDone)
          : vault.t(I18N_KEYS.CommonCancel)}
      </Button>
      <Button
        type="button"
        disabled={!session.workflow.canContinue(workflowState)}
        data-testid="approve-extension-device-btn"
        onclick={() => void approveExtension()}
      >
        {vault.t(actionTranslationKey)}
      </Button>
    </div>
  {/if}
</section>
