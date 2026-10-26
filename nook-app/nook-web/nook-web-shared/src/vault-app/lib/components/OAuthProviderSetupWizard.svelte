<script lang="ts">
  import { I18N_KEYS } from "../../../generated/i18n-keys";
  import { RefreshCw, ShieldCheck } from "@lucide/svelte";
  import { Button } from "$lib/components/ui/button";
  import SetupWizardStep from "$lib/components/SetupWizardStep.svelte";
  import type { OAuthFilePreset } from "$lib/auth/providers";
  import {
    DEFAULT_DRIVE_BACKUP_NAME,
    OAuthFilePresentation,
    oauth_access_token,
  } from "$lib/auth/providers";
  import { browserLogRuntime } from "$lib/runtime/log";
  import {
    BrowserOAuthProvider,
    OAuthOriginUnsupportedReason,
    resolveCurrentOAuthOriginSupport,
  } from "$lib/auth/oauth-origin";
  import { cn } from "$lib/utils";
  import type { VaultState } from "$lib/vault.svelte";
  import * as oauthActions from "$lib/vault/oauth";
  import { OAuthFileDraftKind } from "$lib/vault/state/provider.svelte";

  const log = browserLogRuntime.createLogger("icloud-oauth");

  let {
    vault,
    githubRepo = $bindable(DEFAULT_DRIVE_BACKUP_NAME),
    idPrefix = "provider",
    preset = "google-drive" as OAuthFilePreset,
    isVerifying,
    isInitializing,
    onCancelSetup,
    onConnect,
  }: {
    vault: VaultState;
    githubRepo?: string;
    idPrefix?: string;
    preset?: OAuthFilePreset;
    isVerifying: boolean;
    isInitializing: boolean;
    onCancelSetup: () => void;
    onConnect: () => void | Promise<void>;
  } = $props();

  const isICloud = $derived(preset === "icloud");
  const oauthSignedIn = $derived(
    vault.oauthFileDraft.kind === OAuthFileDraftKind.Configured &&
      oauth_access_token(vault.oauthFileDraft.config).kind === "available",
  );
  const sharedTargetReady = $derived(
    vault.oauthFileDraft.kind === OAuthFileDraftKind.Configured &&
      (isICloud
        ? new OAuthFilePresentation(
            vault.oauthFileDraft.config,
          ).hasICloudShareTarget()
        : new OAuthFilePresentation(
            vault.oauthFileDraft.config,
          ).hasGoogleDriveFolder()),
  );
  const canConnect = $derived(oauthSignedIn);
  const oauthAccount = $derived(
    vault.oauthFileDraft.kind === OAuthFileDraftKind.Configured
      ? new OAuthFilePresentation(
          vault.oauthFileDraft.config,
        ).oauthAccountLabel()
      : "",
  );
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
  const googleFolderOnConnect = $derived.by(() => {
    const folderRequest: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.ProviderSetupGoogleFolderOnConnect,
      replacements: { folder: githubRepo.trim() || DEFAULT_DRIVE_BACKUP_NAME },
    };
    return vault.t(folderRequest);
  });

  const icloudSignInButtonClass = cn(
    "ring-offset-background focus-visible:ring-ring inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
    "bg-primary text-primary-foreground hover:bg-primary/90",
    "h-9 rounded-md px-3",
    "absolute inset-0 w-full sm:w-auto",
  );
  const googleSignInButtonClass = cn(
    "ring-offset-background focus-visible:ring-ring inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
    "bg-primary text-primary-foreground hover:bg-primary/90",
    "h-9 rounded-md px-3",
    "w-full sm:w-auto",
  );

  /**
   * Every Drive provider syncs under an ordinary My Drive folder (an iCloud
   * provider under a CloudKit share) that authorized accounts are later
   * shared into. Connecting opens the folder with the setup name, creating
   * it only when none exists; a retry reuses the bound folder.
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
            connection.value.origin ===
            oauthActions.GoogleVaultFolderOrigin.Existing
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
      <svg
        class="size-4 shrink-0 text-muted-foreground"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          fill="currentColor"
          d="M13.762 4.29a6.51 6.51 0 0 0-11.025 4.126 5.243 5.243 0 0 0-2.326 8.65A4.92 4.92 0 0 0 12 22.5a4.8 4.8 0 0 0 4.7-3.84 6.48 6.48 0 0 0 2.084-12.84 6.5 6.5 0 0 0-4.022-1.59Z"
        />
      </svg>
      <span class="font-medium text-foreground"
        >{vault.t(I18N_KEYS.ProviderPickerIcloud)}</span
      >
    {:else}
      <svg
        class="size-4 shrink-0 text-muted-foreground"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          fill="currentColor"
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
        />
        <path
          fill="currentColor"
          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        />
        <path
          fill="currentColor"
          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        />
        <path
          fill="currentColor"
          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        />
      </svg>
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
      <p class="text-sm text-foreground text-pretty">
        {vault.t(
          isICloud
            ? I18N_KEYS.ProviderSetupIcloudDesc
            : I18N_KEYS.ProviderSetupGoogleDriveDesc,
        )}
      </p>

      <div class="space-y-1.5">
        <label
          class="text-xs font-medium text-foreground"
          for="{idPrefix}-drive-file"
        >
          {vault.t(
            isICloud
              ? I18N_KEYS.ProviderSetupDriveFileName
              : I18N_KEYS.ProviderSetupDriveFolderName,
          )}
        </label>
        <input
          id="{idPrefix}-drive-file"
          type="text"
          bind:value={githubRepo}
          placeholder={DEFAULT_DRIVE_BACKUP_NAME}
          autocomplete="off"
          spellcheck="false"
          data-testid="drive-file-input"
          class="flex h-9 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-hidden focus:ring-2 focus:ring-ring"
        />
        <p class="text-[11px] text-muted-foreground text-pretty">
          {vault.t(
            isICloud
              ? I18N_KEYS.ProviderSetupIcloudEventLogDesc
              : I18N_KEYS.ProviderSetupDriveEventLogDesc,
          )}
        </p>
      </div>

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
                    account:
                      oauthAccount ||
                      vault.t(I18N_KEYS.AuthStorageIcloudSignedIn),
                  },
                };
                return vault.t(translationRequest2);
              })()
            : (() => {
                const translationRequest3: Parameters<typeof vault.t>[0] = {
                  key: I18N_KEYS.ProviderSetupGoogleSignedInAs,
                  replacements: {
                    account:
                      oauthAccount ||
                      vault.t(I18N_KEYS.AuthStorageGoogleSignedIn),
                  },
                };
                return vault.t(translationRequest3);
              })()}
        </p>
      {/if}

      <p class="text-[11px] text-muted-foreground text-pretty">
        {isICloud
          ? vault.t(I18N_KEYS.ProviderSetupIcloudTokensLocalDesc)
          : vault.t(I18N_KEYS.ProviderSetupGoogleTokensLocalDesc)}
      </p>
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
      <p class="text-sm text-muted-foreground text-pretty">
        {vault.t(I18N_KEYS.AuthStorageSyncSetupDesc)}
      </p>
      {#if !sharedTargetReady}
        <p
          class="text-[11px] text-muted-foreground text-pretty"
          data-testid={isICloud
            ? "icloud-share-on-connect"
            : "google-folder-on-connect"}
        >
          {isICloud
            ? vault.t(I18N_KEYS.ProviderSetupIcloudSharedCreateDesc)
            : googleFolderOnConnect}
        </p>
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
      <div class="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          class="sm:min-w-[180px]"
          data-testid="connect-provider-btn"
          disabled={!canConnect ||
            isVerifying ||
            isInitializing ||
            preparingTarget}
          onclick={() => void connectWithVaultTarget()}
        >
          {#if isInitializing}
            <RefreshCw class="size-4 animate-spin" />
            {vault.t(I18N_KEYS.OnboardingLoadingEngine)}
          {:else if isVerifying || preparingTarget}
            <RefreshCw class="size-4 animate-spin" />
            {vault.t(I18N_KEYS.AuthStorageSyncConnecting)}
          {:else}
            <ShieldCheck class="size-4" />
            {vault.t(I18N_KEYS.AuthStorageConnectAndSync)}
          {/if}
        </Button>
      </div>
    </SetupWizardStep>
  </div>
</div>

<style>
  .apple-cloudkit-control :global(button),
  .apple-cloudkit-control :global(a),
  .apple-cloudkit-control :global(iframe) {
    max-width: 100%;
    min-height: 2.25rem;
  }
</style>
