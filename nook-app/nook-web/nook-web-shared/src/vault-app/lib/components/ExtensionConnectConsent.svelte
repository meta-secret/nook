<script lang="ts">
  import { I18N_KEYS } from '../../../generated/i18n-keys'
  import { Check, KeyRound, ShieldCheck } from '@lucide/svelte'
  import { onDestroy } from 'svelte'
  import { NookExtensionConsentPhaseState } from '$app-wasm'
  import { Button } from '$lib/components/ui/button'
  import type { ExtensionConnectRequest } from '../extension/connect'
  import type { VaultState } from '$lib/vault.svelte'
  import { ExtensionConsentScopeTranslation } from './extension-connect-consent-state'
  import {
    ExtensionConsentIdentityText,
    type ExtensionConsentIdentityTextLayout,
  } from './extension-consent-identity-text'
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

  $effect.pre(() => {
    const activeSession = session
    return () => activeSession.dispose()
  })
  onDestroy(() => session.dispose())

  const identityTextLayout: ExtensionConsentIdentityTextLayout = {
    head: 14,
    tail: 10,
  }
  const displayedDevicePublicKey = $derived(
    new ExtensionConsentIdentityText(request.devicePublicKey).truncate(
      identityTextLayout,
    ),
  )
  const displayedDeviceSigningPublicKey = $derived(
    new ExtensionConsentIdentityText(request.deviceSigningPublicKey).truncate(
      identityTextLayout,
    ),
  )

  async function approveExtension() {
    await session.approve()
  }

  function closeConsent() {
    onClose(closeOutcome)
  }
</script>

<section
  class="rounded-xl border border-border/60 bg-card p-4 shadow-sm sm:p-5"
  data-testid="extension-connect-consent"
>
  <div class="flex items-start gap-3">
    <div
      class="flex size-10 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary"
    >
      <ShieldCheck class="size-5" />
    </div>
    <div class="min-w-0 space-y-1">
      <h2 class="text-lg font-semibold text-foreground">
        {vault.t(I18N_KEYS.ExtensionConsentTitle)}
      </h2>
      <p class="text-sm leading-relaxed text-muted-foreground">
        {vault.t(I18N_KEYS.ExtensionConsentDescription)}
      </p>
    </div>
  </div>

  <div
    class="mt-4 grid gap-3 rounded-lg border border-border/50 bg-background/60 p-3"
  >
    <div>
      <p
        class="text-xs font-medium uppercase tracking-wide text-muted-foreground"
      >
        {vault.t(I18N_KEYS.ExtensionConsentDevice)}
      </p>
      <p class="mt-1 text-sm font-semibold text-foreground">
        {request.deviceLabel}
      </p>
      <p class="mt-1 break-all font-mono text-[11px] text-muted-foreground">
        {request.deviceId}
      </p>
    </div>
    <div class="rounded-md border border-border/40 bg-muted/20 px-3 py-2">
      <p class="flex items-center gap-2 text-xs font-medium text-foreground">
        <KeyRound class="size-3.5 text-muted-foreground" />
        {vault.t(I18N_KEYS.ExtensionConsentEncryptionKey)}
      </p>
      <p
        class="mt-1 truncate font-mono text-[11px] text-muted-foreground"
        title={request.devicePublicKey}
      >
        {displayedDevicePublicKey}
      </p>
    </div>
    <div class="rounded-md border border-border/40 bg-muted/20 px-3 py-2">
      <p class="flex items-center gap-2 text-xs font-medium text-foreground">
        <KeyRound class="size-3.5 text-muted-foreground" />
        {vault.t(I18N_KEYS.ExtensionConsentSigningKey)}
      </p>
      <p
        class="mt-1 truncate font-mono text-[11px] text-muted-foreground"
        title={request.deviceSigningPublicKey}
      >
        {displayedDeviceSigningPublicKey}
      </p>
    </div>
  </div>

  <div class="mt-4 space-y-2">
    <p class="text-sm font-medium text-foreground">
      {vault.t(I18N_KEYS.ExtensionConsentRequestedAccess)}
    </p>
    <ul class="grid gap-2" data-testid="extension-connect-scopes">
      {#each request.scopes as scope (scope)}
        <li
          class="flex items-center gap-2 rounded-md border border-border/40 bg-background/70 px-3 py-2 text-sm text-foreground"
        >
          <Check class="size-3.5 text-primary" />
          {vault.t(new ExtensionConsentScopeTranslation(scope).key)}
        </li>
      {/each}
    </ul>
  </div>

  {#if notice.kind === ExtensionConsentWorkflowNoticeKind.Message}
    <p
      class="mt-4 rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300"
      role="alert"
    >
      {vault.t(notice.translationKey)}
    </p>
  {:else if notice.kind === ExtensionConsentWorkflowNoticeKind.Rejected}
    {#if notice.rejection.kind === ExtensionConsentRejectionKind.WithReason}
      <p
        class="mt-4 rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300"
        data-extension-pairing-rejection-reason={notice.rejection.reason}
        role="alert"
      >
        {vault.t(notice.translationKey)}
      </p>
    {:else}
      <p
        class="mt-4 rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300"
        role="alert"
      >
        {vault.t(notice.translationKey)}
      </p>
    {/if}
  {/if}

  {#if (workflowState.kind === ExtensionConsentWorkflowKind.Completed && workflowState.outcome.kind !== ExtensionConsentDeliveryOutcomeKind.Delivered) || (workflowState.kind === ExtensionConsentWorkflowKind.Failed && workflowState.phase.state === NookExtensionConsentPhaseState.Approved)}
    <p
      class="mt-4 rounded-md border border-primary/25 bg-primary/10 px-3 py-2 text-sm text-primary"
      data-testid="extension-connect-approved"
    >
      {vault.t(I18N_KEYS.ExtensionConsentApprovedReopen)}
    </p>
  {:else if workflowState.kind === ExtensionConsentWorkflowKind.Completed}
    <p
      class="mt-4 rounded-md border border-primary/25 bg-primary/10 px-3 py-2 text-sm text-primary"
      data-testid="extension-connect-approved"
    >
      {vault.t(I18N_KEYS.ExtensionConsentApprovedReturn)}
    </p>
  {/if}

  <div class="mt-4 flex flex-wrap justify-end gap-2">
    <Button
      type="button"
      variant="outline"
      disabled={workflowState.kind ===
        ExtensionConsentWorkflowKind.SubmittingAuthorization ||
        workflowState.kind === ExtensionConsentWorkflowKind.PreparingGrant ||
        workflowState.kind === ExtensionConsentWorkflowKind.DeliveringGrant ||
        workflowState.kind === ExtensionConsentWorkflowKind.RefreshingDevices}
      onclick={closeConsent}
    >
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
      {workflowState.kind ===
        ExtensionConsentWorkflowKind.SubmittingAuthorization ||
      workflowState.kind === ExtensionConsentWorkflowKind.PreparingGrant ||
      workflowState.kind === ExtensionConsentWorkflowKind.DeliveringGrant ||
      workflowState.kind === ExtensionConsentWorkflowKind.RefreshingDevices
        ? vault.t(I18N_KEYS.ExtensionConsentApproving)
        : vault.t(actionTranslationKey)}
    </Button>
  </div>
</section>
