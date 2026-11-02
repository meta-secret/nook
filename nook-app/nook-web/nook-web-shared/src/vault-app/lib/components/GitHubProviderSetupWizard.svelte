<script lang="ts">
  import { untrack } from 'svelte'
  import { I18N_KEYS } from '../../../generated/i18n-keys'
  import { Cloud, ExternalLink, RefreshCw, ShieldCheck } from '@lucide/svelte'
  import { github_provider_draft, type ProviderDraft } from '$app-wasm'
  import { Button, buttonVariants } from '$lib/components/ui/button'
  import SetupWizardStep from '$lib/components/SetupWizardStep.svelte'
  import { DEFAULT_GITHUB_REPO } from '$lib/auth/providers'
  import { cn } from '$lib/utils'
  import type { VaultState } from '$lib/vault.svelte'
  import type { GithubProviderDraft } from '$lib/vault/provider-draft-reads'
  import {
    ConnectQuestionKind,
    ConnectQuestions,
    type ConnectQuestion,
  } from '$lib/components/connect-button-state'
  import { GithubDraftText } from '$lib/components/github-provider-setup-state'

  let {
    vault,
    draft,
    isVerifying,
    isInitializing,
    question,
    onCancelSetup,
    onConnect,
  }: {
    vault: VaultState
    /** The staged GitHub draft this form edits. */
    draft: GithubProviderDraft
    isVerifying: boolean
    isInitializing: boolean
    /** What the host asks before Connect. */
    question: ConnectQuestion
    onCancelSetup: () => void
    onConnect: () => void | Promise<void>
  } = $props()

  const uid = $props.id()

  // The form owns its text, because Rust trims the draft it stages. It
  // takes the draft's text again when another owner replaced the draft: a
  // lock or a cancel clears the typed token.
  let stagedDraft: ProviderDraft = untrack(() => draft)
  let tokenText = $state(untrack(() => GithubDraftText.token(draft)))
  let repositoryText = $state(
    untrack(() => GithubDraftText.repository(draft)),
  )
  $effect.pre(() => {
    const current = draft
    if (current === stagedDraft) return
    stagedDraft = current
    tokenText = GithubDraftText.token(current)
    repositoryText = GithubDraftText.repository(current)
  })

  function stageForm() {
    const form: Parameters<typeof github_provider_draft>[0] = {
      token: tokenText,
      repository: repositoryText,
    }
    const next = github_provider_draft(form)
    stagedDraft = next
    vault.stageProviderDraft(next)
  }

  const githubPatUrl =
    'https://github.com/settings/tokens/new?scopes=repo&description=nook'

  const githubTokenButtonVariant: Parameters<typeof buttonVariants>[0] = {
    variant: 'default',
    size: 'sm',
  }
  const githubTokenButtonClass = cn(
    buttonVariants(githubTokenButtonVariant),
    'w-full sm:w-auto',
  )

  const githubCredentialsReady = $derived(GithubDraftText.tokenEntered(draft))

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
      >{vault.t(I18N_KEYS.ProviderPickerGithub)}</span
    >
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
      subtitle={vault.t(I18N_KEYS.ProviderSetupGithubConnectionSubtitle)}
      bind:open={connectionStepOpen}
      testId="github-setup-connection-step"
    >
      <p class="text-sm text-foreground text-pretty">
        {vault.t(I18N_KEYS.ProviderSetupGithubPatDesc)}
      </p>

      <a
        href={githubPatUrl}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="github-new-token-btn"
        class={githubTokenButtonClass}
      >
        {vault.t(I18N_KEYS.ProviderSetupCreateTokenGithub)}
        <ExternalLink class="size-3.5" />
      </a>

      <div class="space-y-4">
        <div class="space-y-1.5">
          <label
            class="text-xs font-medium text-foreground"
            for="{uid}-github-repo"
          >
            {vault.t(I18N_KEYS.ProviderSetupRepoName)}
          </label>
          <input
            id="{uid}-github-repo"
            type="text"
            value={repositoryText}
            oninput={(event) => {
              repositoryText = event.currentTarget.value
              stageForm()
            }}
            placeholder={DEFAULT_GITHUB_REPO}
            autocomplete="off"
            spellcheck="false"
            data-testid="github-repo-input"
            class="flex h-9 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-hidden focus:ring-2 focus:ring-ring"
          />
          <p class="text-[11px] text-muted-foreground text-pretty">
            {vault.t(I18N_KEYS.ProviderSetupEventLogDesc)}
          </p>
        </div>

        <div class="space-y-1.5">
          <label
            class="text-xs font-medium text-foreground"
            for="{uid}-github-pat"
          >
            {vault.t(I18N_KEYS.ProviderSetupPatLabel)}
          </label>
          <input
            id="{uid}-github-pat"
            type="password"
            value={tokenText}
            oninput={(event) => {
              tokenText = event.currentTarget.value
              stageForm()
            }}
            placeholder="ghp_xxxxxxxxxxxx"
            autocomplete="off"
            data-testid="github-pat-input"
            class="flex h-9 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-hidden focus:ring-2 focus:ring-ring"
          />
          <p class="text-[11px] text-muted-foreground text-pretty">
            {(() => { const translationRequest: Parameters<typeof vault.t>[0] = {
  key: I18N_KEYS.ProviderSetupStoredLocallyDesc,
  replacements: {
              repo: GithubDraftText.repository(draft),
            },
}; return vault.t(translationRequest); })()}
          </p>
        </div>
      </div>
    </SetupWizardStep>

    <SetupWizardStep
      stepNumber={2}
      title={vault.t(I18N_KEYS.AuthStorageConnectAndSync)}
      subtitle={githubCredentialsReady
        ? vault.t(I18N_KEYS.ProviderSetupGoogleSyncSubtitle)
        : vault.t(I18N_KEYS.LoginWizardAvailableAfterConnect)}
      disabled={!githubCredentialsReady}
      bind:open={syncStepOpen}
      testId="github-setup-sync-step"
    >
      <p class="text-sm text-muted-foreground text-pretty">
        {vault.t(I18N_KEYS.AuthStorageSyncSetupDesc)}
      </p>

      {#if question.kind === ConnectQuestionKind.Asked}
        {@render question.prompt()}
      {/if}

      <div class="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          class="sm:min-w-[180px]"
          data-testid="connect-provider-btn"
          disabled={!githubCredentialsReady ||
            ConnectQuestions.holdsConnect(question) ||
            isVerifying ||
            isInitializing}
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
