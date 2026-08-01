<script lang="ts">
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { Copy, RefreshCw, ShieldCheck } from "@lucide/svelte";
  import { Button } from "$lib/components/ui/button";
  import EnrollmentQrCode from "$lib/components/EnrollmentQrCode.svelte";
  import {
    buildSentinelGenesisParticipantResponseLink,
  } from "$lib/enrollment/sentinel-genesis-link";
  import type { VaultState } from "$lib/vault.svelte";
  import { sentinelGenesisParticipantFingerprint } from "$app-wasm";

  let {
    vault,
    isBusy,
    sentinelInvitationRequest,
    sentinelOnboardingPackage,
    onCreateParticipantResponse,
    onRememberRequest,
    onReceiveShare,
    onAcceptOnboardingPackage,
  }: {
    vault: VaultState;
    isBusy: boolean;
    sentinelInvitationRequest: string;
    sentinelOnboardingPackage: string;
    onCreateParticipantResponse?: (
      requestPayload: string,
    ) => string | Promise<string>;
    onRememberRequest?: (
      requestPayload: string,
    ) => void | Promise<void>;
    onReceiveShare?: (sharePayload: string) => void | Promise<void>;
    onAcceptOnboardingPackage?: (
      packageJson: string,
    ) => void | Promise<void>;
  } = $props();

  let copyingJoinResponse = $state(false);
  let actionBusy = $state(false);
  let participantRequest = $state("");
  let sessionParticipantRequest = $state("");
  let generatedParticipantResponse = $state("");
  let generatedParticipantFingerprint = $state("");
  let participantShare = $state("");
  let joinPublicKeysLoading = $state(false);
  let joinPasskeyRequested = $state(false);

  const generatedParticipantResponseLink = $derived(
    buildSentinelGenesisParticipantResponseLink(generatedParticipantResponse),
  );

  $effect(() => {
    const invitation = sentinelInvitationRequest.trim();
    if (!invitation) return;
    participantRequest = invitation;
    joinPasskeyRequested = false;
  });

  $effect(() => {
    const deviceProtectionReady = vault.deviceProtectionReady;
    const invitationPending = sentinelInvitationRequest.trim().length > 0;
    if (
      invitationPending &&
      joinPasskeyRequested &&
      deviceProtectionReady &&
      !sentinelOnboardingPackage.trim() &&
      !generatedParticipantResponse &&
      !joinPublicKeysLoading &&
      !isBusy &&
      onCreateParticipantResponse
    ) {
      void loadJoinPublicKeys();
    }
  });

  async function loadJoinPublicKeys() {
    const requestPayload = participantRequest.trim();
    if (
      joinPublicKeysLoading ||
      generatedParticipantResponse ||
      !requestPayload ||
      !onCreateParticipantResponse
    ) {
      return;
    }
    joinPublicKeysLoading = true;
    try {
      generatedParticipantResponse =
        await onCreateParticipantResponse(requestPayload);
      if (!generatedParticipantResponse && !vault.deviceProtectionReady) {
        joinPasskeyRequested = true;
        return;
      }
      joinPasskeyRequested = false;
      generatedParticipantFingerprint = sentinelGenesisParticipantFingerprint(
        generatedParticipantResponse,
      );
    } catch (error) {
      generatedParticipantResponse = "";
      generatedParticipantFingerprint = "";
      vault.errorMsg =
        error instanceof Error
          ? error.message
          : vault.t(I18N_KEYS.LoginSentinelGenesisResponseFailed);
    } finally {
      joinPublicKeysLoading = false;
    }
  }

  async function copyJoinResponse() {
    if (!generatedParticipantResponseLink) return;
    try {
      await navigator.clipboard.writeText(generatedParticipantResponseLink);
      copyingJoinResponse = true;
      setTimeout(() => {
        copyingJoinResponse = false;
      }, 1500);
    } catch {
      vault.errorMsg = vault.t(I18N_KEYS.LoginSentinelGenesisCopyFailed);
    }
  }

  async function createParticipantResponse() {
    const requestPayload = sessionParticipantRequest.trim();
    if (!requestPayload || actionBusy || !onCreateParticipantResponse) return;
    actionBusy = true;
    try {
      generatedParticipantResponse =
        await onCreateParticipantResponse(requestPayload);
      generatedParticipantFingerprint = sentinelGenesisParticipantFingerprint(
        generatedParticipantResponse,
      );
    } catch (error) {
      generatedParticipantResponse = "";
      generatedParticipantFingerprint = "";
      vault.errorMsg =
        error instanceof Error
          ? error.message
          : vault.t(I18N_KEYS.LoginSentinelGenesisResponseFailed);
    } finally {
      actionBusy = false;
    }
  }

  function refreshJoinPublicKeys() {
    generatedParticipantResponse = "";
    generatedParticipantFingerprint = "";
    void loadJoinPublicKeys();
  }

  async function receiveParticipantShare() {
    const sharePayload = participantShare.trim();
    if (!sharePayload || actionBusy || !onReceiveShare) return;
    actionBusy = true;
    try {
      const requestPayload = participantRequest.trim();
      if (requestPayload && onRememberRequest) {
        await onRememberRequest(requestPayload);
      }
      await onReceiveShare(sharePayload);
      participantShare = "";
    } finally {
      actionBusy = false;
    }
  }
</script>

            <section
              class="mt-6 space-y-4 border-t border-border pt-6"
              data-testid="sentinel-genesis-participant-step"
            >
              <div class="space-y-1">
                <h3 class="text-lg font-semibold text-foreground">
                  {sentinelOnboardingPackage.trim()
                    ? vault.t(I18N_KEYS.LoginSentinelOnboardingMemberTitle)
                    : vault.t(I18N_KEYS.LoginSentinelGenesisJoinTitle)}
                </h3>
                <p class="text-sm text-pretty text-muted-foreground">
                  {sentinelOnboardingPackage.trim()
                    ? vault.t(I18N_KEYS.LoginSentinelOnboardingMemberDescription)
                    : vault.t(I18N_KEYS.LoginSentinelGenesisJoinDescription)}
                </p>
              </div>

              {#if sentinelOnboardingPackage.trim()}
                <div
                  class="rounded-lg border border-primary/25 bg-primary/5 p-4"
                >
                  <p class="text-xs leading-relaxed text-muted-foreground">
                    {vault.t(I18N_KEYS.LoginSentinelOnboardingMemberSecurity)}
                  </p>
                  <Button
                    type="button"
                    class="mt-4 w-full sm:w-auto"
                    data-testid="sentinel-accept-onboarding"
                    disabled={isBusy || actionBusy}
                    onclick={() =>
                      void onAcceptOnboardingPackage?.(
                        sentinelOnboardingPackage,
                      )}
                  >
                    <ShieldCheck class="size-4" />
                    {vault.t(I18N_KEYS.LoginSentinelOnboardingMemberAction)}
                  </Button>
                </div>
              {:else if generatedParticipantResponse}
                <div
                  class="space-y-3 rounded-lg border border-border/60 bg-muted/10 p-4"
                  data-testid="sentinel-genesis-join-response"
                >
                  <div class="space-y-1">
                    <p class="text-sm font-semibold text-foreground">
                      {vault.t(I18N_KEYS.LoginSentinelGenesisGeneratedResponse)}
                    </p>
                    <p class="text-xs text-pretty text-muted-foreground">
                      {vault.t(I18N_KEYS.LoginSentinelGenesisJoinQrHint)}
                    </p>
                  </div>
                  <div class="grid gap-3 sm:grid-cols-[160px_1fr]">
                    <EnrollmentQrCode
                      enrollmentLink={generatedParticipantResponseLink}
                      loadingLabel={vault.t(
                        I18N_KEYS.LoginSentinelGenesisQrLoading,
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
                          {vault.t(I18N_KEYS.LoginSentinelGenesisFingerprint)}:
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
                          ? vault.t(I18N_KEYS.CommonCopied)
                          : vault.t(I18N_KEYS.LoginSentinelGenesisCopyResponseUrl)}
                      </Button>
                    </div>
                  </div>
                </div>
              {:else if joinPublicKeysLoading}
                <p
                  class="text-sm text-muted-foreground"
                  data-testid="sentinel-genesis-join-loading"
                >
                  {vault.t(I18N_KEYS.LoginSentinelGenesisJoinLoading)}
                </p>
              {:else if sentinelInvitationRequest.trim()}
                <div
                  class="rounded-lg border border-primary/25 bg-primary/5 p-4"
                  data-testid="sentinel-genesis-connect-card"
                >
                  <p class="text-sm font-semibold text-foreground">
                    {vault.t(I18N_KEYS.LoginSentinelGenesisConnectTitle)}
                  </p>
                  <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {vault.t(I18N_KEYS.LoginSentinelGenesisConnectDescription)}
                  </p>
                  <Button
                    type="button"
                    class="mt-4 w-full sm:w-auto"
                    data-testid="sentinel-genesis-connect-device"
                    disabled={isBusy || actionBusy}
                    onclick={() => refreshJoinPublicKeys()}
                  >
                    <ShieldCheck class="size-4" />
                    {vault.t(I18N_KEYS.LoginSentinelGenesisConnectAction)}
                  </Button>
                </div>
              {:else if !sentinelOnboardingPackage.trim()}
                <div
                  class="space-y-3 rounded-lg border border-border/60 bg-muted/10 p-4"
                  data-testid="sentinel-genesis-invitation-required"
                >
                  <p class="text-sm font-semibold text-foreground">
                    {vault.t(I18N_KEYS.LoginSentinelGenesisInvitationRequiredTitle)}
                  </p>
                  <p class="text-xs text-pretty text-muted-foreground">
                    {vault.t(
                      I18N_KEYS.LoginSentinelGenesisInvitationRequiredDescription,
                    )}
                  </p>
                  <label
                    class="text-xs font-medium text-foreground"
                    for="sentinel-participant-request"
                  >
                    {vault.t(I18N_KEYS.LoginSentinelGenesisJoinRequestLabel)}
                  </label>
                  <textarea
                    id="sentinel-participant-request"
                    class="min-h-20 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
                    data-testid="sentinel-genesis-join-request-input"
                    placeholder={vault.t(
                      I18N_KEYS.LoginSentinelGenesisJoinRequestPlaceholder,
                    )}
                    bind:value={sessionParticipantRequest}
                    disabled={isBusy || actionBusy}></textarea>
                  <Button
                    type="button"
                    class="w-full sm:w-auto"
                    data-testid="sentinel-genesis-create-response"
                    disabled={isBusy ||
                      actionBusy ||
                      !sessionParticipantRequest.trim() ||
                      !onCreateParticipantResponse}
                    onclick={() => void createParticipantResponse()}
                  >
                    {#if actionBusy}
                      <RefreshCw class="size-4 animate-spin" />
                    {:else}
                      <ShieldCheck class="size-4" />
                    {/if}
                    {vault.t(I18N_KEYS.LoginSentinelGenesisCreateSessionResponse)}
                  </Button>
                </div>
              {/if}

              {#if !sentinelOnboardingPackage.trim()}
                <div class="space-y-2 border-t border-border pt-4">
                  <p class="text-xs font-medium text-foreground">
                    {vault.t(I18N_KEYS.LoginSentinelGenesisJoinShareTitle)}
                  </p>
                  <p class="text-xs text-pretty text-muted-foreground">
                    {vault.t(I18N_KEYS.LoginSentinelGenesisJoinShareDescription)}
                  </p>
                  <label
                    class="text-xs font-medium text-foreground"
                    for="sentinel-share-request"
                  >
                    {vault.t(I18N_KEYS.LoginSentinelGenesisJoinShareRequestLabel)}
                  </label>
                  <textarea
                    id="sentinel-share-request"
                    class="min-h-16 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
                    data-testid="sentinel-genesis-share-request-input"
                    placeholder={vault.t(
                      I18N_KEYS.LoginSentinelGenesisJoinShareRequestPlaceholder,
                    )}
                    bind:value={participantRequest}
                    disabled={isBusy || actionBusy}></textarea>
                  <label
                    class="text-xs font-medium text-foreground"
                    for="sentinel-received-share"
                  >
                    {vault.t(I18N_KEYS.LoginSentinelGenesisReceiveShareLabel)}
                  </label>
                  <textarea
                    id="sentinel-received-share"
                    class="min-h-20 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
                    data-testid="sentinel-genesis-receive-share-input"
                    placeholder={vault.t(
                      I18N_KEYS.LoginSentinelGenesisReceiveSharePlaceholder,
                    )}
                    bind:value={participantShare}
                    disabled={isBusy || actionBusy}></textarea>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-testid="sentinel-genesis-receive-share"
                    disabled={isBusy ||
                      actionBusy ||
                      !participantShare.trim() ||
                      !onReceiveShare}
                    onclick={() => void receiveParticipantShare()}
                  >
                    <ShieldCheck class="size-4" />
                    {vault.t(I18N_KEYS.LoginSentinelGenesisReceiveShare)}
                  </Button>
                </div>
              {/if}
            </section>
