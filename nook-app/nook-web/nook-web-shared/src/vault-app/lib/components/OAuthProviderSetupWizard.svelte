<script lang="ts">
  import { I18N_KEYS } from '../../../generated/i18n-keys'
  import {
    FolderOpen,
    FolderPlus,
    LockKeyhole,
    RefreshCw,
    ShieldCheck,
    Users,
  } from '@lucide/svelte'
  import { buttonVariants } from '$lib/components/ui/button/button.svelte'
  import { Button } from '$lib/components/ui/button'
  import SetupWizardStep from '$lib/components/SetupWizardStep.svelte'
  import type {
    GoogleDriveMode,
    ICloudMode,
    OAuthFilePreset,
  } from '$lib/auth/providers'
  import {
    DEFAULT_DRIVE_BACKUP_NAME,
    hasGoogleDriveFolder,
    hasICloudShareTarget,
    oauthAccessToken,
    oauthAccountLabel,
    OAuthAccessTokenKind,
  } from '$lib/auth/providers'
  import { createLogger } from '$lib/runtime/log'
  import {
    BrowserOAuthProvider,
    OAuthOriginUnsupportedReason,
    resolveCurrentOAuthOriginSupport,
  } from '$lib/auth/oauth-origin'
  import { cn } from '$lib/utils'
  import type { VaultState } from '$lib/vault.svelte'
  import * as oauthActions from '$lib/vault/oauth'
  import { OAuthFileDraftKind } from '$lib/vault/state/provider.svelte'
  import { SharedFolderAction } from './oauth-provider-setup-state'

  const log = createLogger('icloud-oauth')

  let {
    vault,
    githubRepo = $bindable(DEFAULT_DRIVE_BACKUP_NAME),
    idPrefix = 'provider',
    preset = 'google-drive' as OAuthFilePreset,
    isVerifying,
    isInitializing,
    onCancelSetup,
    onConnect,
  }: {
    vault: VaultState
    githubRepo?: string
    idPrefix?: string
    preset?: OAuthFilePreset
    isVerifying: boolean
    isInitializing: boolean
    onCancelSetup: () => void
    onConnect: () => void | Promise<void>
  } = $props()

  const isICloud = $derived(preset === 'icloud')
  const googleDriveMode = $derived.by((): GoogleDriveMode => {
    const draft = vault.oauthFileDraft
    if (draft.kind !== OAuthFileDraftKind.Configured) return 'private'
    return draft.config.driveMode
  })
  const iCloudMode = $derived.by((): ICloudMode => {
    const draft = vault.oauthFileDraft
    if (draft.kind !== OAuthFileDraftKind.Configured) return 'private'
    return draft.config.iCloudMode
  })
  const isSharedGoogleDrive = $derived(
    !isICloud && googleDriveMode === 'shared',
  )
  const isSharedICloud = $derived(isICloud && iCloudMode === 'shared')
  const isSharedProvider = $derived(isSharedGoogleDrive || isSharedICloud)
  const oauthSignedIn = $derived(
    vault.oauthFileDraft.kind === OAuthFileDraftKind.Configured &&
      oauthAccessToken(vault.oauthFileDraft.config).kind ===
        OAuthAccessTokenKind.Available,
  )
  const sharedTargetReady = $derived(
    vault.oauthFileDraft.kind === OAuthFileDraftKind.Configured &&
      ((isSharedGoogleDrive &&
        hasGoogleDriveFolder(vault.oauthFileDraft.config)) ||
        (isSharedICloud &&
          hasICloudShareTarget(vault.oauthFileDraft.config))),
  )
  const canConnect = $derived(
    oauthSignedIn && (!isSharedProvider || sharedTargetReady),
  )
  const oauthAccount = $derived(
    vault.oauthFileDraft.kind === OAuthFileDraftKind.Configured
      ? oauthAccountLabel(vault.oauthFileDraft.config)
      : '',
  )
  const oauthBusy = $derived(
    isICloud ? vault.icloudOAuthBusy : vault.googleOAuthBusy,
  )
  const icloudSignInPreparing = $derived(
    isICloud && vault.icloudOAuthPreparing && !vault.icloudOAuthReady,
  )
  const oauthOriginSupport = $derived(
    resolveCurrentOAuthOriginSupport(
      isICloud ? BrowserOAuthProvider.ICloud : BrowserOAuthProvider.GoogleDrive,
    ),
  )
  const oauthOriginUnsupported = $derived(!oauthOriginSupport.supported)
  const oauthOriginUnsupportedMessage = $derived.by(() => {
    if (oauthOriginSupport.supported) return ''
    const translationRequest: Parameters<typeof vault.t>[0] = {
      key: oauthOriginSupport.reason ===
        OAuthOriginUnsupportedReason.CloudflarePrPreview
        ? I18N_KEYS.ProviderSetupOauthPreviewOriginUnsupported
        : I18N_KEYS.ProviderSetupOauthOriginUnsupported,
      replacements: { origin: oauthOriginSupport.origin },
    };
    return vault.t(translationRequest)
  })

  let connectionStepOpen = $state(true)
  let sharedFolderStepOpen = $state(false)
  let syncStepOpen = $state(false)
  let icloudSignInPrepareStarted = $state(false)
  let sharedFolderAction = $state(SharedFolderAction.Create)
  let collaboratorEmail = $state('')
  let sharedFolderRef = $state('')
  let sharedFolderBusy = $state(false)

  function selectGoogleDriveMode(mode: GoogleDriveMode) {
    vault.selectGoogleDriveMode(mode)
    connectionStepOpen = true
    sharedFolderStepOpen = false
    syncStepOpen = false
  }

  function selectICloudMode(mode: ICloudMode) {
    vault.selectICloudMode(mode)
    connectionStepOpen = true
    sharedFolderStepOpen = false
    syncStepOpen = false
  }

  async function createSharedFolder() {
    if (sharedFolderBusy) return
    sharedFolderBusy = true
    vault.errorMsg = ''
    try {
      if (isSharedICloud) {
        await oauthActions.createICloudSharedProvider(vault)
      } else {
        const createRequest: Parameters<
          typeof oauthActions.createGoogleSharedFolder
        >[0] = { state: vault, collaboratorEmail }
        await oauthActions.createGoogleSharedFolder(createRequest)
      }
      sharedFolderStepOpen = false
      syncStepOpen = true
    } catch (error) {
      vault.errorMsg =
        error instanceof Error
          ? error.message
          : vault.t(
              isSharedICloud
                ? I18N_KEYS.ProviderSetupIcloudSharedCreateFailed
                : I18N_KEYS.ProviderSetupGoogleSharedCreateFailed,
            )
    } finally {
      sharedFolderBusy = false
    }
  }

  async function useSharedFolder() {
    if (sharedFolderBusy) return
    sharedFolderBusy = true
    vault.errorMsg = ''
    try {
      if (isSharedICloud) {
        const useRequest: Parameters<
          typeof oauthActions.useICloudSharedProvider
        >[0] = { state: vault, shareReference: sharedFolderRef }
        await oauthActions.useICloudSharedProvider(useRequest)
      } else {
        const useRequest: Parameters<
          typeof oauthActions.useGoogleSharedFolder
        >[0] = { state: vault, folderRef: sharedFolderRef }
        await oauthActions.useGoogleSharedFolder(useRequest)
      }
      sharedFolderStepOpen = false
      syncStepOpen = true
    } catch (error) {
      vault.errorMsg =
        error instanceof Error
          ? error.message
          : vault.t(
              isSharedICloud
                ? I18N_KEYS.ProviderSetupIcloudSharedConnectFailed
                : I18N_KEYS.ProviderSetupGoogleSharedConnectFailed,
            )
    } finally {
      sharedFolderBusy = false
    }
  }

  function watchICloudSignInIntent(node: HTMLElement) {
    let deferredSignInPending = false
    const handleClick = (event: MouseEvent) => {
      if (
        !isICloud ||
        !vault.icloudOAuthReady ||
        vault.icloudOAuthBusy ||
        oauthSignedIn ||
        event.defaultPrevented
      ) {
        return
      }
      const infoArgs: Parameters<typeof log.info>[1] = {
        eventPhase: event.eventPhase,
        ...(event.target instanceof Element
          ? { targetTag: event.target.tagName }
          : {}),
        ...(event.currentTarget instanceof Element
          ? { currentTargetTag: event.currentTarget.tagName }
          : {}),
        isTrusted: event.isTrusted,
        defaultPrevented: event.defaultPrevented,
      };
      log.info('CloudKit native sign-in click observed', infoArgs)
      if (deferredSignInPending) {
        log.info('CloudKit native sign-in click ignored: wait already pending')
        return
      }
      deferredSignInPending = true
      window.setTimeout(() => {
        deferredSignInPending = false
        if (
          !isICloud ||
          !vault.icloudOAuthReady ||
          vault.icloudOAuthBusy ||
          oauthSignedIn
        ) {
          const infoArgs2: Parameters<typeof log.info>[1] = {
            ready: vault.icloudOAuthReady,
            busy: vault.icloudOAuthBusy,
            signedIn: oauthSignedIn,
          };
          log.info('CloudKit native sign-in deferred wait skipped', infoArgs2)
          return
        }
        log.info('CloudKit native sign-in deferred wait started')
        const signInWithICloudArgs: Parameters<typeof oauthActions.signInWithICloud>[0] = {
          state: vault,
          options: { clickPreparedControl: false },
        };
        void oauthActions.signInWithICloud(signInWithICloudArgs)
      }, 0)
    }
    const addEventListenerArgs: Parameters<typeof node.addEventListener>[2] = { capture: true };
    node.addEventListener('click', handleClick, addEventListenerArgs)
    return {
      destroy() {
        const removeEventListenerArgs: Parameters<typeof node.removeEventListener>[2] = { capture: true };
        node.removeEventListener('click', handleClick, removeEventListenerArgs)
      },
    }
  }

  $effect(() => {
    if (oauthSignedIn) {
      connectionStepOpen = false
      sharedFolderStepOpen = isSharedProvider && !sharedTargetReady
      syncStepOpen = !isSharedProvider || sharedTargetReady
    }
  })

  $effect(() => {
    if (!isICloud) {
      icloudSignInPrepareStarted = false
      return
    }
    if (
      !oauthOriginUnsupported &&
      !vault.icloudOAuthReady &&
      !vault.icloudOAuthPreparing &&
      !icloudSignInPrepareStarted
    ) {
      icloudSignInPrepareStarted = true
      void oauthActions.prepareICloudSignIn(vault)
    }
  })
</script>

<div
  class="space-y-4"
  data-testid={isICloud ? 'icloud-oauth-setup' : 'google-oauth-setup'}
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
        ? 'icloud-setup-connection-step'
        : 'google-setup-connection-step'}
    >
      <p class="text-sm text-foreground text-pretty">
        {isICloud
          ? vault.t(
              isSharedICloud
                ? I18N_KEYS.ProviderSetupIcloudSharedDesc
                : I18N_KEYS.ProviderSetupIcloudDesc,
            )
          : vault.t(
              isSharedGoogleDrive
                ? I18N_KEYS.ProviderSetupGoogleDriveSharedDesc
                : I18N_KEYS.ProviderSetupGoogleDriveDesc,
            )}
      </p>

      <fieldset
        class="space-y-2"
        data-testid={isICloud
          ? 'icloud-mode-fieldset'
          : 'google-drive-mode-fieldset'}
      >
        <legend class="text-xs font-medium text-foreground">
          {vault.t(
            isICloud
              ? I18N_KEYS.ProviderSetupIcloudMode
              : I18N_KEYS.ProviderSetupGoogleDriveMode,
          )}
        </legend>
        <div
          class="grid overflow-hidden rounded-lg border border-border/50 sm:grid-cols-2"
          role="radiogroup"
          aria-label={vault.t(
            isICloud
              ? I18N_KEYS.ProviderSetupIcloudMode
              : I18N_KEYS.ProviderSetupGoogleDriveMode,
          )}
        >
          <button
            type="button"
            role="radio"
            aria-checked={(isICloud ? iCloudMode : googleDriveMode) ===
              'private'}
            class="flex gap-2.5 px-3 py-3 text-left transition-colors {(isICloud
              ? iCloudMode
              : googleDriveMode) === 'private'
              ? 'bg-primary/[0.06] text-foreground'
              : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground'}"
            data-testid={isICloud
              ? 'icloud-mode-private'
              : 'google-drive-mode-private'}
            onclick={() =>
              isICloud
                ? selectICloudMode('private')
                : selectGoogleDriveMode('private')}
          >
            <LockKeyhole class="mt-0.5 size-4 shrink-0" />
            <span>
              <span class="block text-sm font-medium"
                >{vault.t(
                  isICloud
                    ? I18N_KEYS.ProviderSetupIcloudPrivate
                    : I18N_KEYS.ProviderSetupGoogleDrivePrivate,
                )}</span
              >
              <span class="mt-0.5 block text-[11px] leading-snug"
                >{vault.t(
                  isICloud
                    ? I18N_KEYS.ProviderSetupIcloudPrivateDesc
                    : I18N_KEYS.ProviderSetupGoogleDrivePrivateDesc,
                )}</span
              >
            </span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={(isICloud ? iCloudMode : googleDriveMode) ===
              'shared'}
            class="flex gap-2.5 border-t border-border/40 px-3 py-3 text-left transition-colors sm:border-t-0 sm:border-l {(isICloud
              ? iCloudMode
              : googleDriveMode) === 'shared'
              ? 'bg-primary/[0.06] text-foreground'
              : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground'}"
            data-testid={isICloud
              ? 'icloud-mode-shared'
              : 'google-drive-mode-shared'}
            onclick={() =>
              isICloud
                ? selectICloudMode('shared')
                : selectGoogleDriveMode('shared')}
          >
            <Users class="mt-0.5 size-4 shrink-0" />
            <span>
              <span class="block text-sm font-medium"
                >{vault.t(
                  isICloud
                    ? I18N_KEYS.ProviderSetupIcloudShared
                    : I18N_KEYS.ProviderSetupGoogleDriveShared,
                )}</span
              >
              <span class="mt-0.5 block text-[11px] leading-snug"
                >{vault.t(
                  isICloud
                    ? I18N_KEYS.ProviderSetupIcloudSharedModeDesc
                    : I18N_KEYS.ProviderSetupGoogleDriveSharedModeDesc,
                )}</span
              >
            </span>
          </button>
        </div>
      </fieldset>

      <div class="space-y-1.5">
        <label
          class="text-xs font-medium text-foreground"
          for="{idPrefix}-drive-file"
        >
          {vault.t(
            isSharedGoogleDrive
              ? I18N_KEYS.ProviderSetupDriveFolderName
              : I18N_KEYS.ProviderSetupDriveFileName,
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
          {isICloud
            ? vault.t(I18N_KEYS.ProviderSetupIcloudEventLogDesc)
            : vault.t(
                isSharedGoogleDrive
                  ? I18N_KEYS.ProviderSetupDriveSharedEventLogDesc
                  : I18N_KEYS.ProviderSetupDriveEventLogDesc,
              )}
        </p>
      </div>

      {#if isICloud}
        <div
          class={cn(
            'apple-cloudkit-control relative min-h-9 w-full sm:w-fit',
            (oauthBusy || icloudSignInPreparing || oauthOriginUnsupported) &&
              'pointer-events-none opacity-60',
          )}
          data-testid="icloud-sign-in-btn"
          use:watchICloudSignInIntent
        >
          <div id="apple-sign-in-button"></div>
          <div id="apple-sign-out-button" class="hidden"></div>
          {#if oauthBusy || icloudSignInPreparing}
            <div
              class={cn(
                (() => { const buttonVariantsArgs: Parameters<typeof buttonVariants>[0] = { variant: 'default', size: 'sm' }; return buttonVariants(buttonVariantsArgs); })(),
                'absolute inset-0 w-full sm:w-auto',
              )}
            >
              {vault.t(I18N_KEYS.ProviderSetupIcloudSigningIn)}
            </div>
          {/if}
        </div>
      {:else}
        <button
          type="button"
          class={cn(
            (() => { const buttonVariantsArgs2: Parameters<typeof buttonVariants>[0] = { variant: 'default', size: 'sm' }; return buttonVariants(buttonVariantsArgs2); })(),
            'w-full sm:w-auto',
          )}
          data-testid="google-sign-in-btn"
          disabled={oauthBusy || oauthOriginUnsupported}
          onclick={() => void oauthActions.signInWithGoogle(vault)}
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
            ? 'icloud-origin-unsupported'
            : 'google-origin-unsupported'}
        >
          {oauthOriginUnsupportedMessage}
        </p>
      {/if}

      {#if vault.errorMsg}
        <p
          class="text-xs text-destructive"
          data-testid={isICloud ? 'icloud-oauth-error' : 'google-oauth-error'}
        >
          {vault.errorMsg}
        </p>
      {/if}

      {#if oauthSignedIn}
        <p
          class="text-xs text-muted-foreground"
          data-testid={isICloud
            ? 'icloud-account-status'
            : 'google-account-status'}
        >
          {isICloud
            ? (() => { const translationRequest2: Parameters<typeof vault.t>[0] = {
  key: I18N_KEYS.ProviderSetupIcloudSignedInAs,
  replacements: {
                account:
                  oauthAccount || vault.t(I18N_KEYS.AuthStorageIcloudSignedIn),
              },
}; return vault.t(translationRequest2); })()
            : (() => { const translationRequest3: Parameters<typeof vault.t>[0] = {
  key: I18N_KEYS.ProviderSetupGoogleSignedInAs,
  replacements: {
                account:
                  oauthAccount || vault.t(I18N_KEYS.AuthStorageGoogleSignedIn),
              },
}; return vault.t(translationRequest3); })()}
        </p>
      {/if}

      <p class="text-[11px] text-muted-foreground text-pretty">
        {isICloud
          ? vault.t(I18N_KEYS.ProviderSetupIcloudTokensLocalDesc)
          : vault.t(I18N_KEYS.ProviderSetupGoogleTokensLocalDesc)}
      </p>
    </SetupWizardStep>

    {#if isSharedProvider}
      <SetupWizardStep
        stepNumber={2}
        title={vault.t(
          isSharedICloud
            ? I18N_KEYS.ProviderSetupIcloudSharedTargetStep
            : I18N_KEYS.ProviderSetupGoogleSharedFolderStep,
        )}
        subtitle={oauthSignedIn
          ? sharedTargetReady
            ? vault.t(
                isSharedICloud
                  ? I18N_KEYS.ProviderSetupIcloudSharedTargetReady
                  : I18N_KEYS.ProviderSetupGoogleSharedFolderReady,
              )
            : vault.t(
                isSharedICloud
                  ? I18N_KEYS.ProviderSetupIcloudSharedTargetSubtitle
                  : I18N_KEYS.ProviderSetupGoogleSharedFolderSubtitle,
              )
          : vault.t(I18N_KEYS.LoginWizardAvailableAfterConnect)}
        disabled={!oauthSignedIn}
        bind:open={sharedFolderStepOpen}
        testId={isSharedICloud
          ? 'icloud-shared-target-step'
          : 'google-shared-folder-step'}
      >
        <div
          class="grid overflow-hidden rounded-lg border border-border/50 sm:grid-cols-2"
          role="radiogroup"
          aria-label={vault.t(
            isSharedICloud
              ? I18N_KEYS.ProviderSetupIcloudSharedTargetStep
              : I18N_KEYS.ProviderSetupGoogleSharedFolderStep,
          )}
        >
          <button
            type="button"
            role="radio"
            aria-checked={sharedFolderAction === SharedFolderAction.Create}
            class="flex items-center gap-2.5 px-3 py-2.5 text-left text-sm transition-colors {sharedFolderAction ===
            SharedFolderAction.Create
              ? 'bg-primary/[0.06] text-foreground'
              : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground'}"
            data-testid={isSharedICloud
              ? 'icloud-shared-create-mode'
              : 'google-shared-folder-create-mode'}
            onclick={() => (sharedFolderAction = SharedFolderAction.Create)}
          >
            <FolderPlus class="size-4 shrink-0" />
            {vault.t(
              isSharedICloud
                ? I18N_KEYS.ProviderSetupIcloudSharedCreate
                : I18N_KEYS.ProviderSetupGoogleSharedCreate,
            )}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={sharedFolderAction === SharedFolderAction.Join}
            class="flex items-center gap-2.5 border-t border-border/40 px-3 py-2.5 text-left text-sm transition-colors sm:border-t-0 sm:border-l {sharedFolderAction ===
            SharedFolderAction.Join
              ? 'bg-primary/[0.06] text-foreground'
              : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground'}"
            data-testid={isSharedICloud
              ? 'icloud-shared-join-mode'
              : 'google-shared-folder-join-mode'}
            onclick={() => (sharedFolderAction = SharedFolderAction.Join)}
          >
            <FolderOpen class="size-4 shrink-0" />
            {vault.t(
              isSharedICloud
                ? I18N_KEYS.ProviderSetupIcloudSharedJoin
                : I18N_KEYS.ProviderSetupGoogleSharedJoin,
            )}
          </button>
        </div>

        {#if sharedFolderAction === SharedFolderAction.Create}
          {#if !isSharedICloud}
            <div class="space-y-1.5">
              <label
                class="text-xs font-medium text-foreground"
                for="{idPrefix}-shared-email"
              >
                {vault.t(I18N_KEYS.ProviderSetupGoogleSharedAccountEmail)}
              </label>
              <input
                id="{idPrefix}-shared-email"
                type="email"
                bind:value={collaboratorEmail}
                autocomplete="email"
                data-testid="google-shared-account-email"
                class="flex h-9 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-hidden focus:ring-2 focus:ring-ring"
                placeholder={vault.t(
                  I18N_KEYS.ProviderSetupGoogleSharedAccountPlaceholder,
                )}
              />
              <p class="text-[11px] text-muted-foreground text-pretty">
                {vault.t(I18N_KEYS.ProviderSetupGoogleSharedAccountDesc)}
              </p>
            </div>
          {/if}
          {#if isSharedICloud}
            <p class="text-[11px] text-muted-foreground text-pretty">
              {vault.t(I18N_KEYS.ProviderSetupIcloudSharedCreateDesc)}
            </p>
          {/if}
          <Button
            type="button"
            size="sm"
            data-testid={isSharedICloud
              ? 'icloud-create-share-btn'
              : 'google-create-shared-folder-btn'}
            disabled={sharedFolderBusy ||
              (!isSharedICloud && !collaboratorEmail.trim())}
            onclick={() => void createSharedFolder()}
          >
            {#if sharedFolderBusy}
              <RefreshCw class="size-4 animate-spin" />
            {:else}
              <FolderPlus class="size-4" />
            {/if}
            {vault.t(
              isSharedICloud
                ? I18N_KEYS.ProviderSetupIcloudSharedCreateAndShare
                : I18N_KEYS.ProviderSetupGoogleSharedCreateAndShare,
            )}
          </Button>
        {:else}
          <div class="space-y-1.5">
            <label
              class="text-xs font-medium text-foreground"
              for="{idPrefix}-shared-folder-ref"
            >
              {vault.t(
                isSharedICloud
                  ? I18N_KEYS.ProviderSetupIcloudSharedLink
                  : I18N_KEYS.ProviderSetupGoogleSharedFolderLink,
              )}
            </label>
            <input
              id="{idPrefix}-shared-folder-ref"
              type="text"
              bind:value={sharedFolderRef}
              autocomplete="off"
              spellcheck="false"
              data-testid={isSharedICloud
                ? 'icloud-shared-ref'
                : 'google-shared-folder-ref'}
              class="flex h-9 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-hidden focus:ring-2 focus:ring-ring"
              placeholder={vault.t(
                isSharedICloud
                  ? I18N_KEYS.ProviderSetupIcloudSharedLinkPlaceholder
                  : I18N_KEYS.ProviderSetupGoogleSharedFolderLinkPlaceholder,
              )}
            />
            <p class="text-[11px] text-muted-foreground text-pretty">
              {vault.t(
                isSharedICloud
                  ? I18N_KEYS.ProviderSetupIcloudSharedLinkDesc
                  : I18N_KEYS.ProviderSetupGoogleSharedFolderLinkDesc,
              )}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            data-testid={isSharedICloud
              ? 'icloud-use-share-btn'
              : 'google-use-shared-folder-btn'}
            disabled={sharedFolderBusy || !sharedFolderRef.trim()}
            onclick={() => void useSharedFolder()}
          >
            {#if sharedFolderBusy}
              <RefreshCw class="size-4 animate-spin" />
            {:else}
              <FolderOpen class="size-4" />
            {/if}
            {vault.t(
              isSharedICloud
                ? I18N_KEYS.ProviderSetupIcloudSharedUse
                : I18N_KEYS.ProviderSetupGoogleSharedUseFolder,
            )}
          </Button>
        {/if}

        {#if vault.sharedGrantInstructions}
          <p
            class="rounded-md border border-border/50 bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
            data-testid={isSharedICloud
              ? 'icloud-shared-status'
              : 'google-shared-folder-status'}
          >
            {vault.sharedGrantInstructions}
          </p>
        {/if}
      </SetupWizardStep>
    {/if}

    <SetupWizardStep
      stepNumber={isSharedProvider ? 3 : 2}
      title={vault.t(I18N_KEYS.AuthStorageConnectAndSync)}
      subtitle={canConnect
        ? isICloud
          ? vault.t(I18N_KEYS.ProviderSetupIcloudSyncSubtitle)
          : vault.t(I18N_KEYS.ProviderSetupGoogleSyncSubtitle)
        : oauthSignedIn && isSharedProvider
          ? vault.t(
              isSharedICloud
                ? I18N_KEYS.ProviderSetupIcloudSharedTargetRequired
                : I18N_KEYS.ProviderSetupGoogleSharedFolderRequired,
            )
          : vault.t(I18N_KEYS.LoginWizardAvailableAfterConnect)}
      disabled={!canConnect}
      bind:open={syncStepOpen}
      testId={isICloud ? 'icloud-setup-sync-step' : 'google-setup-sync-step'}
    >
      <p class="text-sm text-muted-foreground text-pretty">
        {vault.t(I18N_KEYS.AuthStorageSyncSetupDesc)}
      </p>
      <div class="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          class="sm:min-w-[180px]"
          data-testid="connect-provider-btn"
          disabled={!canConnect || isVerifying || isInitializing}
          onclick={() => void onConnect()}
        >
          {#if isInitializing}
            <RefreshCw class="size-4 animate-spin" />
            {vault.t(I18N_KEYS.OnboardingLoadingEngine)}
          {:else if isVerifying}
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
