<script lang="ts">
  import type { Snippet } from 'svelte'
  import { Cloud, ExternalLink, RefreshCw, ShieldCheck } from '@lucide/svelte'
  import { buttonVariants } from '$lib/components/ui/button/button.svelte'
  import { Button } from '$lib/components/ui/button'
  import SetupWizardStep from '$lib/components/SetupWizardStep.svelte'
  import { DEFAULT_GITHUB_REPO } from '$lib/auth-providers'
  import { cn } from '$lib/utils'
  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
    githubPat = $bindable(''),
    githubRepo = $bindable(DEFAULT_GITHUB_REPO),
    idPrefix = 'provider',
    isVerifying,
    isInitializing,
    connectDisabled = false,
    onCancelSetup,
    onConnect,
    beforeConnect,
  }: {
    vault: VaultState
    githubPat?: string
    githubRepo?: string
    idPrefix?: string
    isVerifying: boolean
    isInitializing: boolean
    connectDisabled?: boolean
    onCancelSetup: () => void
    onConnect: () => void | Promise<void>
    beforeConnect?: Snippet
  } = $props()

  const githubPatUrl =
    'https://github.com/settings/tokens/new?scopes=repo&description=nook'

  const githubCredentialsReady = $derived(Boolean(githubPat.trim()))

  let connectionStepOpen = $state(true)
  let syncStepOpen = $state(false)

  $effect(() => {
    if (githubCredentialsReady) {
      connectionStepOpen = false
      syncStepOpen = true
    }
  })
</script>

<div class="space-y-4" data-testid="github-token-setup">
  <div class="flex items-center gap-2 text-sm">
    <Cloud class="size-4 shrink-0 text-muted-foreground" />
    <span class="font-medium text-foreground"
      >{vault.t('provider_picker.github')}</span
    >
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
      subtitle={vault.t('provider_setup.github_connection_subtitle')}
      bind:open={connectionStepOpen}
      testId="github-setup-connection-step"
    >
      <p class="text-sm text-foreground text-pretty">
        {vault.t('provider_setup.github_pat_desc')}
      </p>

      <a
        href={githubPatUrl}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="github-new-token-btn"
        class={cn(
          buttonVariants({ variant: 'default', size: 'sm' }),
          'w-full sm:w-auto',
        )}
      >
        {vault.t('provider_setup.create_token_github')}
        <ExternalLink class="size-3.5" />
      </a>

      <div class="space-y-4">
        <div class="space-y-1.5">
          <label
            class="text-xs font-medium text-foreground"
            for="{idPrefix}-github-repo"
          >
            {vault.t('provider_setup.repo_name')}
          </label>
          <input
            id="{idPrefix}-github-repo"
            type="text"
            bind:value={githubRepo}
            placeholder={DEFAULT_GITHUB_REPO}
            autocomplete="off"
            spellcheck="false"
            data-testid="github-repo-input"
            class="flex h-9 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-hidden focus:ring-2 focus:ring-ring"
          />
          <p class="text-[11px] text-muted-foreground text-pretty">
            {vault.t('provider_setup.vault_file_desc')}
          </p>
        </div>

        <div class="space-y-1.5">
          <label
            class="text-xs font-medium text-foreground"
            for="{idPrefix}-github-pat"
          >
            {vault.t('provider_setup.pat_label')}
          </label>
          <input
            id="{idPrefix}-github-pat"
            type="password"
            bind:value={githubPat}
            placeholder="ghp_xxxxxxxxxxxx"
            autocomplete="off"
            data-testid="github-pat-input"
            class="flex h-9 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-hidden focus:ring-2 focus:ring-ring"
          />
          <p class="text-[11px] text-muted-foreground text-pretty">
            {vault.t('provider_setup.stored_locally_desc', {
              repo: githubRepo.trim() || DEFAULT_GITHUB_REPO,
            })}
          </p>
        </div>
      </div>
    </SetupWizardStep>

    <SetupWizardStep
      stepNumber={2}
      title={vault.t('auth_storage.connect_and_sync')}
      subtitle={githubCredentialsReady
        ? vault.t('provider_setup.google_sync_subtitle')
        : vault.t('login_wizard.available_after_connect')}
      disabled={!githubCredentialsReady}
      bind:open={syncStepOpen}
      testId="github-setup-sync-step"
    >
      <p class="text-sm text-muted-foreground text-pretty">
        {vault.t('auth_storage.sync_setup_desc')}
      </p>

      {@render beforeConnect?.()}

      <div class="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          class="sm:min-w-[180px]"
          data-testid="connect-provider-btn"
          disabled={!githubCredentialsReady ||
            connectDisabled ||
            isVerifying ||
            isInitializing}
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
