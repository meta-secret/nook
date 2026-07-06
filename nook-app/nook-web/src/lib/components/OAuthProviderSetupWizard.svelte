<script lang="ts">
  import { RefreshCw, ShieldCheck } from '@lucide/svelte'
  import { buttonVariants } from '$lib/components/ui/button/button.svelte'
  import { Button } from '$lib/components/ui/button'
  import SetupWizardStep from '$lib/components/SetupWizardStep.svelte'
  import type { OAuthFilePreset } from '$lib/auth-providers'
  import { DEFAULT_DRIVE_BACKUP_NAME } from '$lib/auth-providers'
  import { cn } from '$lib/utils'
  import type { VaultState } from '$lib/vault.svelte'

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
  const oauthSignedIn = $derived(Boolean(vault.oauthFile?.accessToken?.trim()))
  const oauthAccount = $derived(vault.oauthFile?.accountEmail ?? '')
  const oauthBusy = $derived(
    isICloud ? vault.icloudOAuthBusy : vault.googleOAuthBusy,
  )

  let connectionStepOpen = $state(true)
  let syncStepOpen = $state(false)

  $effect(() => {
    if (oauthSignedIn) {
      connectionStepOpen = false
      syncStepOpen = true
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
          : vault.t('provider_setup.google_drive_desc')}
      </p>

      <div class="space-y-1.5">
        <label
          class="text-xs font-medium text-foreground"
          for="{idPrefix}-drive-file"
        >
          {vault.t('provider_setup.drive_file_name')}
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
            : vault.t('provider_setup.drive_event_log_desc')}
        </p>
      </div>

      <button
        type="button"
        class={cn(
          buttonVariants({ variant: 'default', size: 'sm' }),
          'w-full sm:w-auto',
        )}
        data-testid={isICloud ? 'icloud-sign-in-btn' : 'google-sign-in-btn'}
        disabled={oauthBusy}
        onclick={() =>
          void (isICloud ? vault.signInWithICloud() : vault.signInWithGoogle())}
      >
        {#if oauthBusy}
          {isICloud
            ? vault.t('provider_setup.icloud_signing_in')
            : vault.t('provider_setup.google_signing_in')}
        {:else if isICloud}
          {vault.t('provider_setup.sign_in_with_icloud')}
        {:else}
          {vault.t('provider_setup.sign_in_with_google')}
        {/if}
      </button>

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

    <SetupWizardStep
      stepNumber={2}
      title={vault.t('auth_storage.connect_and_sync')}
      subtitle={oauthSignedIn
        ? isICloud
          ? vault.t('provider_setup.icloud_sync_subtitle')
          : vault.t('provider_setup.google_sync_subtitle')
        : vault.t('login_wizard.available_after_connect')}
      disabled={!oauthSignedIn}
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
          disabled={!oauthSignedIn || isVerifying || isInitializing}
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
