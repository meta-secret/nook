<script lang="ts">
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
  import type { OAuthFilePreset } from '$lib/auth-providers'
  import { DEFAULT_DRIVE_BACKUP_NAME } from '$lib/auth-providers'
  import { createLogger } from '$lib/log'
  import { resolveOAuthOriginSupport } from '$lib/oauth-origin'
  import { cn } from '$lib/utils'
  import type { VaultState } from '$lib/vault.svelte'

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
  const googleDriveMode = $derived(
    vault.oauthFile?.driveMode ??
      (vault.oauthFile?.folderId?.trim() ? 'shared' : 'private'),
  )
  const isSharedGoogleDrive = $derived(
    !isICloud && googleDriveMode === 'shared',
  )
  const oauthSignedIn = $derived(Boolean(vault.oauthFile?.accessToken?.trim()))
  const sharedFolderReady = $derived(
    isSharedGoogleDrive && Boolean(vault.oauthFile?.folderId?.trim()),
  )
  const canConnect = $derived(
    oauthSignedIn && (!isSharedGoogleDrive || sharedFolderReady),
  )
  const oauthAccount = $derived(vault.oauthFile?.accountEmail ?? '')
  const oauthBusy = $derived(
    isICloud ? vault.icloudOAuthBusy : vault.googleOAuthBusy,
  )
  const icloudSignInPreparing = $derived(
    isICloud && vault.icloudOAuthPreparing && !vault.icloudOAuthReady,
  )
  const oauthOriginSupport = $derived(
    resolveOAuthOriginSupport(isICloud ? 'icloud' : 'google-drive'),
  )
  const oauthOriginUnsupported = $derived(!oauthOriginSupport.supported)
  const oauthOriginUnsupportedMessage = $derived(
    vault.t(
      oauthOriginSupport.reason === 'cloudflare-pr-preview'
        ? 'provider_setup.oauth_preview_origin_unsupported'
        : 'provider_setup.oauth_origin_unsupported',
      { origin: oauthOriginSupport.origin },
    ),
  )

  let connectionStepOpen = $state(true)
  let sharedFolderStepOpen = $state(false)
  let syncStepOpen = $state(false)
  let icloudSignInPrepareStarted = $state(false)
  let sharedFolderAction = $state<'create' | 'join'>('create')
  let collaboratorEmail = $state('')
  let sharedFolderRef = $state('')
  let sharedFolderBusy = $state(false)

  function selectGoogleDriveMode(mode: 'private' | 'shared') {
    vault.selectGoogleDriveMode(mode)
    connectionStepOpen = true
    sharedFolderStepOpen = false
    syncStepOpen = false
  }

  async function createSharedFolder() {
    if (sharedFolderBusy) return
    sharedFolderBusy = true
    vault.errorMsg = ''
    try {
      await vault.createGoogleSharedFolder(collaboratorEmail)
      sharedFolderStepOpen = false
      syncStepOpen = true
    } catch (error: unknown) {
      vault.errorMsg =
        error instanceof Error
          ? error.message
          : vault.t('provider_setup.google_shared_create_failed')
    } finally {
      sharedFolderBusy = false
    }
  }

  async function useSharedFolder() {
    if (sharedFolderBusy) return
    sharedFolderBusy = true
    vault.errorMsg = ''
    try {
      await vault.useGoogleSharedFolder(sharedFolderRef)
      sharedFolderStepOpen = false
      syncStepOpen = true
    } catch (error: unknown) {
      vault.errorMsg =
        error instanceof Error
          ? error.message
          : vault.t('provider_setup.google_shared_connect_failed')
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
      log.info('CloudKit native sign-in click observed', {
        eventPhase: event.eventPhase,
        targetTag:
          event.target instanceof Element ? event.target.tagName : undefined,
        currentTargetTag:
          event.currentTarget instanceof Element
            ? event.currentTarget.tagName
            : undefined,
        isTrusted: event.isTrusted,
        defaultPrevented: event.defaultPrevented,
      })
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
          log.info('CloudKit native sign-in deferred wait skipped', {
            ready: vault.icloudOAuthReady,
            busy: vault.icloudOAuthBusy,
            signedIn: oauthSignedIn,
          })
          return
        }
        log.info('CloudKit native sign-in deferred wait started')
        void vault.signInWithICloud({ clickPreparedControl: false })
      }, 0)
    }
    node.addEventListener('click', handleClick, { capture: true })
    return {
      destroy() {
        node.removeEventListener('click', handleClick, { capture: true })
      },
    }
  }

  $effect(() => {
    if (oauthSignedIn) {
      connectionStepOpen = false
      sharedFolderStepOpen = isSharedGoogleDrive && !sharedFolderReady
      syncStepOpen = !isSharedGoogleDrive || sharedFolderReady
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
      void vault.prepareICloudSignIn()
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
        >{vault.t('provider_picker.icloud')}</span
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
        >{vault.t('provider_picker.google_drive')}</span
      >
    {/if}
    <button
      type="button"
      class="ml-auto text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
      data-testid="cancel-provider-setup"
      onclick={onCancelSetup}
    >
      {vault.t('provider_setup.change_provider')}
    </button>
  </div>

  <div class="space-y-3">
    <SetupWizardStep
      stepNumber={1}
      title={vault.t('login_wizard.connection_step')}
      subtitle={isICloud
        ? vault.t('provider_setup.icloud_connection_subtitle')
        : vault.t('provider_setup.google_connection_subtitle')}
      bind:open={connectionStepOpen}
      testId={isICloud
        ? 'icloud-setup-connection-step'
        : 'google-setup-connection-step'}
    >
      <p class="text-sm text-foreground text-pretty">
        {isICloud
          ? vault.t('provider_setup.icloud_desc')
          : vault.t(
              isSharedGoogleDrive
                ? 'provider_setup.google_drive_shared_desc'
                : 'provider_setup.google_drive_desc',
            )}
      </p>

      {#if !isICloud}
        <fieldset class="space-y-2" data-testid="google-drive-mode-fieldset">
          <legend class="text-xs font-medium text-foreground">
            {vault.t('provider_setup.google_drive_mode')}
          </legend>
          <div
            class="grid overflow-hidden rounded-lg border border-border/50 sm:grid-cols-2"
            role="radiogroup"
            aria-label={vault.t('provider_setup.google_drive_mode')}
          >
            <button
              type="button"
              role="radio"
              aria-checked={googleDriveMode === 'private'}
              class="flex gap-2.5 px-3 py-3 text-left transition-colors {googleDriveMode ===
              'private'
                ? 'bg-primary/[0.06] text-foreground'
                : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground'}"
              data-testid="google-drive-mode-private"
              onclick={() => selectGoogleDriveMode('private')}
            >
              <LockKeyhole class="mt-0.5 size-4 shrink-0" />
              <span>
                <span class="block text-sm font-medium"
                  >{vault.t('provider_setup.google_drive_private')}</span
                >
                <span class="mt-0.5 block text-[11px] leading-snug"
                  >{vault.t(
                    'provider_setup.google_drive_private_desc',
                  )}</span
                >
              </span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={googleDriveMode === 'shared'}
              class="flex gap-2.5 border-t border-border/40 px-3 py-3 text-left transition-colors sm:border-t-0 sm:border-l {googleDriveMode ===
              'shared'
                ? 'bg-primary/[0.06] text-foreground'
                : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground'}"
              data-testid="google-drive-mode-shared"
              onclick={() => selectGoogleDriveMode('shared')}
            >
              <Users class="mt-0.5 size-4 shrink-0" />
              <span>
                <span class="block text-sm font-medium"
                  >{vault.t('provider_setup.google_drive_shared')}</span
                >
                <span class="mt-0.5 block text-[11px] leading-snug"
                  >{vault.t(
                    'provider_setup.google_drive_shared_mode_desc',
                  )}</span
                >
              </span>
            </button>
          </div>
        </fieldset>
      {/if}

      <div class="space-y-1.5">
        <label
          class="text-xs font-medium text-foreground"
          for="{idPrefix}-drive-file"
        >
          {vault.t(
            isSharedGoogleDrive
              ? 'provider_setup.drive_folder_name'
              : 'provider_setup.drive_file_name',
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
            ? vault.t('provider_setup.icloud_event_log_desc')
            : vault.t(
                isSharedGoogleDrive
                  ? 'provider_setup.drive_shared_event_log_desc'
                  : 'provider_setup.drive_event_log_desc',
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
                buttonVariants({ variant: 'default', size: 'sm' }),
                'absolute inset-0 w-full sm:w-auto',
              )}
            >
              {vault.t('provider_setup.icloud_signing_in')}
            </div>
          {/if}
        </div>
      {:else}
        <button
          type="button"
          class={cn(
            buttonVariants({ variant: 'default', size: 'sm' }),
            'w-full sm:w-auto',
          )}
          data-testid="google-sign-in-btn"
          disabled={oauthBusy || oauthOriginUnsupported}
          onclick={() => void vault.signInWithGoogle()}
        >
          {#if oauthBusy}
            {vault.t('provider_setup.google_signing_in')}
          {:else}
            {vault.t('provider_setup.sign_in_with_google')}
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
            ? vault.t('provider_setup.icloud_signed_in_as', {
                account:
                  oauthAccount || vault.t('auth_storage.icloud_signed_in'),
              })
            : vault.t('provider_setup.google_signed_in_as', {
                account:
                  oauthAccount || vault.t('auth_storage.google_signed_in'),
              })}
        </p>
      {/if}

      <p class="text-[11px] text-muted-foreground text-pretty">
        {isICloud
          ? vault.t('provider_setup.icloud_tokens_local_desc')
          : vault.t('provider_setup.google_tokens_local_desc')}
      </p>
    </SetupWizardStep>

    {#if isSharedGoogleDrive}
      <SetupWizardStep
        stepNumber={2}
        title={vault.t('provider_setup.google_shared_folder_step')}
        subtitle={oauthSignedIn
          ? sharedFolderReady
            ? vault.t('provider_setup.google_shared_folder_ready')
            : vault.t('provider_setup.google_shared_folder_subtitle')
          : vault.t('login_wizard.available_after_connect')}
        disabled={!oauthSignedIn}
        bind:open={sharedFolderStepOpen}
        testId="google-shared-folder-step"
      >
        <div
          class="grid overflow-hidden rounded-lg border border-border/50 sm:grid-cols-2"
          role="radiogroup"
          aria-label={vault.t('provider_setup.google_shared_folder_step')}
        >
          <button
            type="button"
            role="radio"
            aria-checked={sharedFolderAction === 'create'}
            class="flex items-center gap-2.5 px-3 py-2.5 text-left text-sm transition-colors {sharedFolderAction ===
            'create'
              ? 'bg-primary/[0.06] text-foreground'
              : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground'}"
            data-testid="google-shared-folder-create-mode"
            onclick={() => (sharedFolderAction = 'create')}
          >
            <FolderPlus class="size-4 shrink-0" />
            {vault.t('provider_setup.google_shared_create')}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={sharedFolderAction === 'join'}
            class="flex items-center gap-2.5 border-t border-border/40 px-3 py-2.5 text-left text-sm transition-colors sm:border-t-0 sm:border-l {sharedFolderAction ===
            'join'
              ? 'bg-primary/[0.06] text-foreground'
              : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground'}"
            data-testid="google-shared-folder-join-mode"
            onclick={() => (sharedFolderAction = 'join')}
          >
            <FolderOpen class="size-4 shrink-0" />
            {vault.t('provider_setup.google_shared_join')}
          </button>
        </div>

        {#if sharedFolderAction === 'create'}
          <div class="space-y-1.5">
            <label
              class="text-xs font-medium text-foreground"
              for="{idPrefix}-shared-email"
            >
              {vault.t('provider_setup.google_shared_account_email')}
            </label>
            <input
              id="{idPrefix}-shared-email"
              type="email"
              bind:value={collaboratorEmail}
              autocomplete="email"
              data-testid="google-shared-account-email"
              class="flex h-9 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-hidden focus:ring-2 focus:ring-ring"
              placeholder={vault.t(
                'provider_setup.google_shared_account_placeholder',
              )}
            />
            <p class="text-[11px] text-muted-foreground text-pretty">
              {vault.t('provider_setup.google_shared_account_desc')}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            data-testid="google-create-shared-folder-btn"
            disabled={sharedFolderBusy || !collaboratorEmail.trim()}
            onclick={() => void createSharedFolder()}
          >
            {#if sharedFolderBusy}
              <RefreshCw class="size-4 animate-spin" />
            {:else}
              <FolderPlus class="size-4" />
            {/if}
            {vault.t('provider_setup.google_shared_create_and_share')}
          </Button>
        {:else}
          <div class="space-y-1.5">
            <label
              class="text-xs font-medium text-foreground"
              for="{idPrefix}-shared-folder-ref"
            >
              {vault.t('provider_setup.google_shared_folder_link')}
            </label>
            <input
              id="{idPrefix}-shared-folder-ref"
              type="text"
              bind:value={sharedFolderRef}
              autocomplete="off"
              spellcheck="false"
              data-testid="google-shared-folder-ref"
              class="flex h-9 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-hidden focus:ring-2 focus:ring-ring"
              placeholder="https://drive.google.com/drive/folders/…"
            />
            <p class="text-[11px] text-muted-foreground text-pretty">
              {vault.t('provider_setup.google_shared_folder_link_desc')}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            data-testid="google-use-shared-folder-btn"
            disabled={sharedFolderBusy || !sharedFolderRef.trim()}
            onclick={() => void useSharedFolder()}
          >
            {#if sharedFolderBusy}
              <RefreshCw class="size-4 animate-spin" />
            {:else}
              <FolderOpen class="size-4" />
            {/if}
            {vault.t('provider_setup.google_shared_use_folder')}
          </Button>
        {/if}

        {#if vault.sharedGrantInstructions}
          <p
            class="rounded-md border border-border/50 bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
            data-testid="google-shared-folder-status"
          >
            {vault.sharedGrantInstructions}
          </p>
        {/if}
      </SetupWizardStep>
    {/if}

    <SetupWizardStep
      stepNumber={isSharedGoogleDrive ? 3 : 2}
      title={vault.t('auth_storage.connect_and_sync')}
      subtitle={canConnect
        ? isICloud
          ? vault.t('provider_setup.icloud_sync_subtitle')
          : vault.t('provider_setup.google_sync_subtitle')
        : oauthSignedIn && isSharedGoogleDrive
          ? vault.t('provider_setup.google_shared_folder_required')
        : vault.t('login_wizard.available_after_connect')}
      disabled={!canConnect}
      bind:open={syncStepOpen}
      testId={isICloud ? 'icloud-setup-sync-step' : 'google-setup-sync-step'}
    >
      <p class="text-sm text-muted-foreground text-pretty">
        {vault.t('auth_storage.sync_setup_desc')}
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
            {vault.t('onboarding.loading_engine')}
          {:else if isVerifying}
            <RefreshCw class="size-4 animate-spin" />
            {vault.t('auth_storage.sync_connecting')}
          {:else}
            <ShieldCheck class="size-4" />
            {vault.t('auth_storage.connect_and_sync')}
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
