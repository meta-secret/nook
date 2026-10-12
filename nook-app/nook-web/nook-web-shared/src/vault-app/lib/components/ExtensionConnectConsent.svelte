<script lang="ts">
  import { I18N_KEYS } from "../../../generated/i18n-keys";
  import { onDestroy } from "svelte";
  import type { ExtensionConnectRequest } from "../extension/connect";
  import type { VaultState } from "$lib/vault.svelte";
  import { ExtensionConsentScopeTranslation } from "./extension-connect-consent-state";
  import {
    ExtensionConsentIdentityText,
    type ExtensionConsentIdentityTextLayout,
  } from "./extension-consent-identity-text";
  import {
    ExtensionConsentDeliveryOutcomeKind,
    ExtensionConsentWorkflowKind,
    ExtensionConsentWorkflowNoticeKind,
    ExtensionConnectConsentWorkflow,
    ExtensionConsentWorkflowPresentation,
    type ExtensionConsentWorkflowState,
  } from "./extension-connect-consent-workflow";
  import { ExtensionConsentCloseOutcome } from "./extension-connect-consent-outcome";

  type ExtensionConsentWorkflowSession = {
    readonly workflow: ExtensionConnectConsentWorkflow;
    readonly state: ExtensionConsentWorkflowState;
    approve(): Promise<void>;
    dispose(): void;
  };

  type ExtensionConsentWorkflowSessionRequest = {
    readonly vault: VaultState;
    readonly request: ExtensionConnectRequest;
  };

  let {
    vault,
    request,
    onClose,
  }: {
    vault: VaultState;
    request: ExtensionConnectRequest;
    onClose: (outcome: ExtensionConsentCloseOutcome) => void;
  } = $props();

  function createWorkflowSession({
    vault: sessionVault,
    request: sessionRequest,
  }: ExtensionConsentWorkflowSessionRequest): ExtensionConsentWorkflowSession {
    const workflowRequest: ConstructorParameters<
      typeof ExtensionConnectConsentWorkflow
    >[0] = { vault: sessionVault, request: sessionRequest };
    const workflow = new ExtensionConnectConsentWorkflow(workflowRequest);
    let state = $state.raw(workflow.initialState());

    return {
      workflow,
      get state() {
        return state;
      },
      async approve() {
        const approvalRequest: Parameters<typeof workflow.approve>[0] = {
          state,
          publish: (next) => (state = next),
        };
        await workflow.approve(approvalRequest);
      },
      dispose() {
        workflow.dispose();
      },
    };
  }

  const sessionRequest = $derived<ExtensionConsentWorkflowSessionRequest>({
    vault,
    request,
  });
  let session = $derived(createWorkflowSession(sessionRequest));
  const presentation = new ExtensionConsentWorkflowPresentation();
  const workflowState = $derived(session.state);
  const availability = $derived(
    session.workflow.approvalAvailability(workflowState),
  );
  const noticeRequest = $derived<Parameters<typeof presentation.notice>[0]>({
    state: workflowState,
    availability,
  });
  const notice = $derived(presentation.notice(noticeRequest));
  const actionTranslationKey = $derived(
    presentation.actionTranslationKey(workflowState),
  );
  const closeOutcome = $derived(session.workflow.closeOutcome(workflowState));
  const isDeliveredSuccess = $derived(
    workflowState.kind === ExtensionConsentWorkflowKind.Completed &&
      workflowState.outcome.kind ===
        ExtensionConsentDeliveryOutcomeKind.Delivered,
  );

  $effect.pre(() => {
    const activeSession = session;
    return () => activeSession.dispose();
  });
  $effect(() => {
    if (!isDeliveredSuccess) return;

    // Leave the consent status visible briefly, then announce approval in the vault.
    const returnTimer = window.setTimeout(() => {
      vault.showSuccess(vault.t(I18N_KEYS.ExtensionConsentApproved));
      onClose(ExtensionConsentCloseOutcome.Approved);
    }, 2_000);
    return () => window.clearTimeout(returnTimer);
  });
  onDestroy(() => session.dispose());

  const identityTextLayout: ExtensionConsentIdentityTextLayout = {
    head: 14,
    tail: 10,
  };
  const displayedDevicePublicKey = $derived(
    new ExtensionConsentIdentityText(request.devicePublicKey).truncate(
      identityTextLayout,
    ),
  );
  const displayedDeviceSigningPublicKey = $derived(
    new ExtensionConsentIdentityText(request.deviceSigningPublicKey).truncate(
      identityTextLayout,
    ),
  );

  async function approveExtension() {
    await session.approve();
  }

  function closeConsent() {
    onClose(closeOutcome);
  }
</script>

<section class="preferences" data-testid="extension-connect-consent">
  <header>
    <p class="eyebrow">{vault.t(I18N_KEYS.ExtensionConsentDevice)}</p>
    <h1>{vault.t(I18N_KEYS.ExtensionConsentTitle)}</h1>
    <p>{vault.t(I18N_KEYS.ExtensionConsentDescription)}</p>
  </header>
  <dl class="secret-fields">
    <div>
      <dt>{vault.t(I18N_KEYS.ExtensionConsentDevice)}</dt>
      <dd>{request.deviceLabel}<br />{request.deviceId}</dd>
    </div>
    <div>
      <dt>{vault.t(I18N_KEYS.ExtensionConsentEncryptionKey)}</dt>
      <dd title={request.devicePublicKey}>{displayedDevicePublicKey}</dd>
    </div>
    <div>
      <dt>{vault.t(I18N_KEYS.ExtensionConsentSigningKey)}</dt>
      <dd title={request.deviceSigningPublicKey}>
        {displayedDeviceSigningPublicKey}
      </dd>
    </div>
  </dl>
  <ul>
    {#each request.scopes as scope (scope)}<li>
        {vault.t(new ExtensionConsentScopeTranslation(scope).key)}
      </li>{/each}
  </ul>
  {#if notice.kind !== ExtensionConsentWorkflowNoticeKind.Hidden}<p
      role="status"
    >
      {vault.t(notice.translationKey)}
    </p>{/if}{#if isDeliveredSuccess}<p
      role="status"
      data-testid="extension-connect-approved"
    >
      {vault.t(I18N_KEYS.ExtensionConsentApproved)}
    </p>{:else}<div class="form-actions">
      <button
        disabled={!session.workflow.canContinue(workflowState)}
        onclick={closeConsent}>{vault.t(I18N_KEYS.CommonCancel)}</button
      ><button
        class="primary"
        disabled={!session.workflow.canContinue(workflowState)}
        data-testid="approve-extension-device-btn"
        onclick={approveExtension}>{vault.t(actionTranslationKey)}</button
      >
    </div>{/if}
</section>
