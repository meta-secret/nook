<script lang="ts">
  import { I18N_KEYS } from "../../../generated/i18n-keys";
  import { RefreshCw, ShieldCheck } from "@lucide/svelte";
  import { Button, buttonVariants } from "$lib/components/ui/button";
  import SetupWizardStep from "$lib/components/SetupWizardStep.svelte";
  import GoogleDriveVaultInventory from "$lib/components/provider-vaults/GoogleDriveVaultInventory.svelte";
  import { browserLogRuntime } from "$lib/runtime/log";
  import {
    BrowserOAuthProvider,
    OAuthOriginUnsupportedReason,
    resolveCurrentOAuthOriginSupport,
  } from "$lib/auth/oauth-origin";
  import { cn } from "$lib/utils";
  import type { VaultState } from "$lib/vault.svelte";
  import * as oauthActions from "$lib/vault/oauth";
  import { NookDriveRootOrigin } from "$app-wasm";
  import {
    DraftDriveSignInKind,
    ProviderDraftReads,
    type OAuthProviderDraft,
  } from "$lib/vault/provider-draft-reads";
  import {
    OAuthDraftView,
    type OAuthAccountTextRequest,
  } from "$lib/components/oauth-provider-setup-state";
  import {
    ConnectButtonLook,
    type ConnectPlanButton,
  } from "$lib/components/provider-vaults/drive-vault-inventory";
  import NewIdentityOption from "$lib/components/provider-vaults/NewIdentityOption.svelte";
  import FirstRunDiagram from "$lib/components/login/FirstRunDiagram.svelte";
  import GoogleDriveMark from "$lib/components/provider-marks/GoogleDriveMark.svelte";
  import ICloudMark from "$lib/components/provider-marks/ICloudMark.svelte";
  import {
    firstRunSyncDiagram,
    FirstRunSyncDiagramProvider,
    type FirstRunSyncDiagramRequest,
  } from "$lib/components/login/first-run-diagram";

  const log = browserLogRuntime.createLogger("icloud-oauth");

  let {
    vault,
    draft,
    isVerifying,
    isInitializing,
    onCancelSetup,
    onConnect,
  }: {
    vault: VaultState;
    /** The staged Google Drive or iCloud draft. */
    draft: OAuthProviderDraft;
    isVerifying: boolean;
    isInitializing: boolean;
    onCancelSetup: () => void;
    onConnect: () => void | Promise<void>;
  } = $props();

  const isICloud = $derived(draft.preset === "icloud");
  const icloudAccountText = $derived.by(() => {
    const request: OAuthAccountTextRequest = {
      draft,
      unknownAccount: vault.t(I18N_KEYS.AuthStorageIcloudSignedIn),
    };
    return OAuthDraftView.accountText(request);
  });
  const googleAccountText = $derived.by(() => {
    const request: OAuthAccountTextRequest = {
      draft,
      unknownAccount: vault.t(I18N_KEYS.AuthStorageGoogleSignedIn),
    };
    return OAuthDraftView.accountText(request);
  });
  const oauthSignedIn = $derived(OAuthDraftView.signedIn(draft));
  const sharedTargetReady = $derived(OAuthDraftView.targetReady(draft));
  const canConnect = $derived(oauthSignedIn);
  const oauthBusy = $derived(
    isICloud ? vault.icloudOAuthBusy : vault.googleOAuthBusy,
  );
  const icloudSignInPreparing = $derived(
    isICloud && vault.icloudOAuthPreparing && !vault.icloudOAuthReady,
  );
  const oauthOriginSupport = $derived(
    resolveCurrentOAuthOriginSupport(
      isICloud ? BrowserOAuthProvider.ICloud : BrowserOAuthProvider.GoogleDrive,
    ),
  );
  const oauthOriginUnsupported = $derived(!oauthOriginSupport.supported);
  const oauthOriginUnsupportedMessage = $derived.by(() => {
    if (oauthOriginSupport.supported) return "";
    const translationRequest: Parameters<typeof vault.t>[0] = {
      key:
        oauthOriginSupport.reason ===
        OAuthOriginUnsupportedReason.CloudflarePrPreview
          ? I18N_KEYS.ProviderSetupOauthPreviewOriginUnsupported
          : I18N_KEYS.ProviderSetupOauthOriginUnsupported,
      replacements: { origin: oauthOriginSupport.origin },
    };
    return vault.t(translationRequest);
  });

  let connectionStepOpen = $state(true);
  let syncStepOpen = $state(false);
  let icloudSignInPrepareStarted = $state(false);
  let preparingTarget = $state(false);
  /** Set once Connect & sync bound the provider to a folder that existed. */
  let existingFolderNotice = $state("");
  /** The signed-in Drive access: listing its Nook folder needs its token. */
  const driveSignIn = $derived(ProviderDraftReads.driveSignIn(draft));

  // Sign-in controls are plain elements for the providers' SDKs, so they
  // take the primary Button's classes rather than the component.
  const signInButtonVariant: Parameters<typeof buttonVariants>[0] = {
    variant: "default",
    size: "sm",
  };
  const signInButtonClass = buttonVariants(signInButtonVariant);
  const icloudSignInButtonClass = cn(
    signInButtonClass,
    "absolute inset-0 w-full sm:w-auto",
  );
  const googleSignInButtonClass = cn(signInButtonClass, "w-full sm:w-auto");

  /**
   * Every Drive provider syncs under the account's one Nook root folder (an
   * iCloud provider under a CloudKit share) that authorized accounts are
   * later shared into. Connecting opens the root, creating it only when the
   * account has none; a retry reuses the bound folder.
   */
  async function connectWithVaultTarget() {
    if (preparingTarget) return;
    if (!sharedTargetReady) {
      preparingTarget = true;
      vault.errorMsg = "";
      try {
        const actions = new oauthActions.VaultOAuthActions(vault);
        if (isICloud) {
          const creation = await actions.createICloudSharedProvider();
          if (creation.isErr()) {
            vault.errorMsg = vault.t(creation.error.translationKey);
            return;
          }
        } else {
          const connection = await actions.connectGoogleVaultFolder();
          if (connection.isErr()) {
            vault.errorMsg = vault.t(connection.error.translationKey);
            return;
          }
          if (
            connection.value.origin === NookDriveRootOrigin.Existing
          ) {
            const noticeRequest: Parameters<typeof vault.t>[0] = {
              key: I18N_KEYS.ProviderSetupGoogleFolderExisting,
              replacements: { folder: connection.value.name },
            };
            existingFolderNotice = vault.t(noticeRequest);
          }
        }
      } finally {
        preparingTarget = false;
      }
    }
    await onConnect();
    // The wizard usually closes once connected; the notice outlives it.
    if (existingFolderNotice && !vault.errorMsg)
      vault.showSuccess(existingFolderNotice);
  }

  /** The step's button when no listing owns it: Connect & sync alone. */
  /** The connection step draws what the provider does instead of saying it. */
  const providerDiagram = $derived.by(() => {
    const request: FirstRunSyncDiagramRequest = {
      vault,
      provider: isICloud
        ? FirstRunSyncDiagramProvider.ICloud
        : FirstRunSyncDiagramProvider.GoogleDrive,
    };
    return firstRunSyncDiagram(request);
  });

  const directConnect: ConnectPlanButton = {
    busy: false,
    label: "",
    detail: "",
    look: ConnectButtonLook.Primary,
    run: connectWithVaultTarget,
  };

  function watchICloudSignInIntent(node: HTMLElement) {
    let deferredSignInPending = false;
    const handleClick = (event: MouseEvent) => {
      if (
        !isICloud ||
        !vault.icloudOAuthReady ||
        vault.icloudOAuthBusy ||
        oauthSignedIn ||
        event.defaultPrevented
      ) {
        return;
      }
      log.info("CloudKit native sign-in click observed");
      if (deferredSignInPending) {
        log.info("CloudKit native sign-in click ignored: wait already pending");
        return;
      }
      deferredSignInPending = true;
      window.setTimeout(() => {
        deferredSignInPending = false;
        if (
          !isICloud ||
          !vault.icloudOAuthReady ||
          vault.icloudOAuthBusy ||
          oauthSignedIn
        ) {
          log.info("CloudKit native sign-in deferred wait skipped");
          return;
        }
        log.info("CloudKit native sign-in deferred wait started");
        const signInWithICloudArgs: Parameters<
          oauthActions.VaultOAuthActions["signInWithICloud"]
        >[0] = {
          clickPreparedControl: false,
        };
        void new oauthActions.VaultOAuthActions(vault).signInWithICloud(
          signInWithICloudArgs,
        );
      }, 0);
    };
    const addEventListenerArgs: Parameters<typeof node.addEventListener>[2] = {
      capture: true,
    };
    node.addEventListener("click", handleClick, addEventListenerArgs);
    return {
      destroy() {
        const removeEventListenerArgs: Parameters<
          typeof node.removeEventListener
        >[2] = { capture: true };
        node.removeEventListener("click", handleClick, removeEventListenerArgs);
      },
    };
  }

  $effect(() => {
    if (oauthSignedIn) {
      connectionStepOpen = false;
      syncStepOpen = true;
    }
  });

  $effect(() => {
    if (!isICloud) {
      icloudSignInPrepareStarted = false;
      return;
    }
    if (
      !oauthOriginUnsupported &&
      !vault.icloudOAuthReady &&
      !vault.icloudOAuthPreparing &&
      !icloudSignInPrepareStarted
    ) {
      icloudSignInPrepareStarted = true;
      void new oauthActions.VaultOAuthActions(vault).prepareICloudSignIn();
    }
  });
</script>

<div
  class="space-y-4"
  data-testid={isICloud ? "icloud-oauth-setup" : "google-oauth-setup"}
>
  <div class="flex items-center gap-2 text-sm">
    {#if isICloud}
      <ICloudMark class="size-4 shrink-0 text-muted-foreground" />
      <span class="font-medium text-foreground"
        >{vault.t(I18N_KEYS.ProviderPickerIcloud)}</span
      >
    {:else}
      <GoogleDriveMark class="size-4 shrink-0 text-muted-foreground" />
      <span class="font-medium text-foreground"
        >{vault.t(I18N_KEYS.ProviderPickerGoogleDrive)}</span
      >
    {/if}
    <button
      type="button"
      class="ml-auto text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
      data-testid="cancel-provider-setup"
      onclick={onCancelSetup}
    >
      {vault.t(I18N_KEYS.ProviderSetupChangeProvider)}
    </button>
  </div>

  <div class="space-y-3">
    <SetupWizardStep
      stepNumber={1}
      title={vault.t(I18N_KEYS.LoginWizardConnectionStep)}
      subtitle={isICloud
        ? vault.t(I18N_KEYS.ProviderSetupIcloudConnectionSubtitle)
        : vault.t(I18N_KEYS.ProviderSetupGoogleConnectionSubtitle)}
      bind:open={connectionStepOpen}
      testId={isICloud
        ? "icloud-setup-connection-step"
        : "google-setup-connection-step"}
    >
      <!-- One centred column: the picture, then its button. -->
      <div class="grid justify-items-center gap-4 text-center">
        <FirstRunDiagram diagram={providerDiagram} />

        {#if isICloud}
          <div
            class={cn(
              "apple-cloudkit-control relative min-h-9 w-full sm:w-fit",
              (oauthBusy || icloudSignInPreparing || oauthOriginUnsupported) &&
                "pointer-events-none opacity-60",
            )}
            data-testid="icloud-sign-in-btn"
            use:watchICloudSignInIntent
          >
            <div id="apple-sign-in-button"></div>
            <div id="apple-sign-out-button" class="hidden"></div>
            {#if oauthBusy || icloudSignInPreparing}
              <div class={icloudSignInButtonClass}>
                {vault.t(
                  icloudSignInPreparing
                    ? I18N_KEYS.ProviderSetupIcloudPreparingSignIn
                    : I18N_KEYS.ProviderSetupIcloudSigningIn,
                )}
              </div>
            {/if}
          </div>
        {:else}
          <button
            type="button"
            class={googleSignInButtonClass}
            data-testid="google-sign-in-btn"
            disabled={oauthBusy || oauthOriginUnsupported}
            onclick={() =>
              void new oauthActions.VaultOAuthActions(vault).signInWithGoogle()}
          >
            {#if oauthBusy}
              {vault.t(I18N_KEYS.ProviderSetupGoogleSigningIn)}
            {:else}
              {vault.t(I18N_KEYS.ProviderSetupSignInWithGoogle)}
            {/if}
          </button>
        {/if}

        {#if oauthOriginUnsupported}
          <p
            class="text-xs text-muted-foreground"
            data-testid={isICloud
              ? "icloud-origin-unsupported"
              : "google-origin-unsupported"}
          >
            {oauthOriginUnsupportedMessage}
          </p>
        {/if}

        <!-- Errors show in the step that is open: Connect & sync once signed in. -->
        {#if vault.errorMsg && !canConnect}
          <p
            class="text-xs text-destructive"
            data-testid={isICloud ? "icloud-oauth-error" : "google-oauth-error"}
          >
            {vault.errorMsg}
          </p>
        {/if}

        {#if oauthSignedIn}
          <p
            class="text-xs text-muted-foreground"
            data-testid={isICloud
              ? "icloud-account-status"
              : "google-account-status"}
          >
            {isICloud
              ? (() => {
                  const translationRequest2: Parameters<typeof vault.t>[0] = {
                    key: I18N_KEYS.ProviderSetupIcloudSignedInAs,
                    replacements: {
                      account: icloudAccountText,
                    },
                  };
                  return vault.t(translationRequest2);
                })()
              : (() => {
                  const translationRequest3: Parameters<typeof vault.t>[0] = {
                    key: I18N_KEYS.ProviderSetupGoogleSignedInAs,
                    replacements: {
                      account: googleAccountText,
                    },
                  };
                  return vault.t(translationRequest3);
                })()}
          </p>
        {/if}

      </div>
    </SetupWizardStep>

    <SetupWizardStep
      stepNumber={2}
      title={vault.t(I18N_KEYS.AuthStorageConnectAndSync)}
      subtitle={canConnect
        ? isICloud
          ? vault.t(I18N_KEYS.ProviderSetupIcloudSyncSubtitle)
          : vault.t(I18N_KEYS.ProviderSetupGoogleSyncSubtitle)
        : vault.t(I18N_KEYS.LoginWizardAvailableAfterConnect)}
      disabled={!canConnect}
      bind:open={syncStepOpen}
      testId={isICloud ? "icloud-setup-sync-step" : "google-setup-sync-step"}
    >
      {#if isICloud && !sharedTargetReady}
        <p
          class="text-[11px] text-muted-foreground text-pretty"
          data-testid="icloud-share-on-connect"
        >
          {vault.t(I18N_KEYS.ProviderSetupIcloudSharedCreateDesc)}
        </p>
      {:else if driveSignIn.kind === DraftDriveSignInKind.SignedIn}
        <!-- What the account's Nook folder already holds, before Connect &
             sync. It owns the step's one action button: Connect & sync, or the
             identity plan followed by it. -->
        <GoogleDriveVaultInventory
          {vault}
          accessToken={driveSignIn.access.authorization.accessToken}
          busy={isVerifying || isInitializing || preparingTarget}
          onConnect={connectWithVaultTarget}
          {connectButton}
        />
      {/if}
      {#if existingFolderNotice}
        <p
          class="text-[11px] text-muted-foreground text-pretty"
          data-testid="google-folder-existing"
        >
          {existingFolderNotice}
        </p>
      {/if}
      {#if vault.errorMsg}
        <p
          class="text-xs text-destructive"
          role="alert"
          data-testid={isICloud ? "icloud-oauth-error" : "google-oauth-error"}
        >
          {vault.errorMsg}
        </p>
      {/if}
      {#if isICloud && !sharedTargetReady}
        {@render connectButton(directConnect)}
      {:else if driveSignIn.kind === DraftDriveSignInKind.NotSignedIn}
        {@render connectButton(directConnect)}
      {/if}
    </SetupWizardStep>
  </div>
</div>

{#snippet connectButton(button: ConnectPlanButton)}
  {#if button.look === ConnectButtonLook.NewIdentity}
    <NewIdentityOption
      title={button.label}
      detail={button.detail}
      testId="connect-provider-btn"
      disabled={!canConnect ||
        button.busy ||
        isVerifying ||
        isInitializing ||
        preparingTarget}
      busy={isVerifying || preparingTarget}
      onCreate={() => void button.run()}
    />
  {:else}
    <div class="flex flex-col gap-2 sm:flex-row sm:justify-end">
      <Button
        type="button"
        class="sm:min-w-[180px]"
        data-testid="connect-provider-btn"
        disabled={!canConnect ||
          button.busy ||
          isVerifying ||
          isInitializing ||
          preparingTarget}
        onclick={() => void button.run()}
      >
        {#if isInitializing}
          <RefreshCw class="size-4 animate-spin" />
          {vault.t(I18N_KEYS.OnboardingLoadingEngine)}
        {:else if isVerifying || preparingTarget}
          <RefreshCw class="size-4 animate-spin" />
          {vault.t(I18N_KEYS.AuthStorageSyncConnecting)}
        {:else}
          <ShieldCheck class="size-4" />
          {button.label || vault.t(I18N_KEYS.AuthStorageConnectAndSync)}
        {/if}
      </Button>
    </div>
  {/if}
{/snippet}

<style>
  .apple-cloudkit-control :global(button),
  .apple-cloudkit-control :global(a),
  .apple-cloudkit-control :global(iframe) {
    max-width: 100%;
    min-height: 2.25rem;
  }
</style>
