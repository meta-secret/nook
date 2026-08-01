<script lang="ts">
  import { I18N_KEYS } from '../../../generated/i18n-keys'
  import { FolderOpen, RefreshCw, ShieldCheck } from '@lucide/svelte'
  import {
    localFolderDirectoryValue,
    localFolderHandle,
    LocalFolderHandleKind,
  } from '$lib/auth/providers'
  import { Button } from '$lib/components/ui/button'
  import SetupWizardStep from '$lib/components/SetupWizardStep.svelte'
  import type { VaultState } from '$lib/vault.svelte'
  import { LocalFolderDraftKind } from '$lib/vault/state/provider.svelte'

  let {
    vault,
    idPrefix = 'local-folder',
    isVerifying,
    isInitializing,
    onCancelSetup,
    onConnect,
  }: {
    vault: VaultState
    idPrefix?: string
    isVerifying: boolean
    isInitializing: boolean
    onCancelSetup: () => void
    onConnect: () => void | Promise<void>
  } = $props()

  let folderBusy = $state(false)
  let folderError = $state('')
  let connectionOpen = $state(true)
  let syncOpen = $state(false)

  const folderHandle = $derived(
    vault.localFolderDraft.kind === LocalFolderDraftKind.Configured
      ? localFolderHandle(vault.localFolderDraft.config)
      : { kind: LocalFolderHandleKind.Unselected },
  )
  const hasFolder = $derived(
    folderHandle.kind === LocalFolderHandleKind.Selected,
  )
  const selectedDirectoryName = $derived(
    vault.localFolderDraft.kind === LocalFolderDraftKind.Configured
      ? localFolderDirectoryValue(vault.localFolderDraft.config.directoryName)
      : '',
  )
  const localFolderUnavailable = $derived(!vault.localFolderBackupSupported)

  $effect(() => {
    if (hasFolder) {
      syncOpen = true
    }
  })

  async function chooseFolder() {
    folderBusy = true
    folderError = ''
    try {
      await vault.chooseLocalFolderBackupDirectory()
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : vault.t(I18N_KEYS.AuthStorageLocalFolderChooseErr)
      if (message.includes('Page.setInterceptFileChooserDialog')) {
        folderError = vault.t(
          I18N_KEYS.ProviderSetupLocalFolderAutomatedBrowserError,
        )
      } else if (
        message.includes('Local folder backup is not supported in this browser')
      ) {
        folderError = vault.t(I18N_KEYS.ProviderSetupLocalFolderUnsupportedBrowser)
      } else {
        folderError = message
      }
    } finally {
      folderBusy = false
    }
  }
</script>

<div class="space-y-4" data-testid="local-folder-setup">
  <div class="flex items-center gap-2 text-sm">
    <FolderOpen class="size-4 shrink-0 text-muted-foreground" />
    <span class="font-medium text-foreground"
      >{vault.t(I18N_KEYS.ProviderPickerLocalFolder)}</span
    >
    <button
      type="button"
      class="ml-auto text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
      data-testid="{idPrefix}-local-folder-change-provider"
      onclick={onCancelSetup}
    >
      {vault.t(I18N_KEYS.ProviderSetupChangeProvider)}
    </button>
  </div>

  <SetupWizardStep
    stepNumber={1}
    title={vault.t(I18N_KEYS.ProviderSetupLocalFolderConnectionTitle)}
    subtitle={vault.t(I18N_KEYS.ProviderSetupLocalFolderConnectionSubtitle)}
    bind:open={connectionOpen}
    testId="{idPrefix}-local-folder-connection-step"
  >
    <div class="space-y-3">
      <p class="text-xs text-muted-foreground text-pretty">
        {vault.t(I18N_KEYS.ProviderSetupLocalFolderDesc)}
      </p>
      <Button
        type="button"
        variant="outline"
        data-testid="{idPrefix}-choose-local-folder-btn"
        disabled={localFolderUnavailable ||
          folderBusy ||
          isVerifying ||
          isInitializing}
        onclick={() => void chooseFolder()}
      >
        {#if folderBusy}
          <RefreshCw class="size-4 animate-spin" />
          {vault.t(I18N_KEYS.ProviderSetupLocalFolderChoosing)}
        {:else}
          <FolderOpen class="size-4" />
          {vault.t(I18N_KEYS.ProviderSetupChooseLocalFolder)}
        {/if}
      </Button>
      {#if localFolderUnavailable}
        <p
          class="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground"
          data-testid="{idPrefix}-local-folder-unsupported"
        >
          {vault.t(I18N_KEYS.ProviderSetupLocalFolderUnsupportedBrowser)}
        </p>
      {/if}
      {#if selectedDirectoryName}
        <p
          class="truncate rounded-md border border-border/60 bg-muted/20 px-3 py-2 font-mono text-xs text-muted-foreground"
          data-testid="{idPrefix}-local-folder-selected"
        >
          {selectedDirectoryName}
        </p>
      {/if}
      {#if folderError}
        <p
          class="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          data-testid="{idPrefix}-local-folder-error"
        >
          {folderError}
        </p>
      {/if}
    </div>
  </SetupWizardStep>

  <SetupWizardStep
    stepNumber={2}
    title={vault.t(I18N_KEYS.ProviderSetupLocalFolderSyncTitle)}
    subtitle={vault.t(I18N_KEYS.ProviderSetupLocalFolderSyncSubtitle)}
    disabled={!hasFolder}
    bind:open={syncOpen}
    testId="{idPrefix}-local-folder-sync-step"
  >
    <div class="flex justify-end">
      <Button
        type="button"
        class="sm:min-w-[180px]"
        data-testid="{idPrefix}-connect-local-folder-btn"
        disabled={!hasFolder || isVerifying || isInitializing}
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
