<script lang="ts">
  import { FolderOpen, RefreshCw, ShieldCheck } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import SetupWizardStep from '$lib/components/SetupWizardStep.svelte'
  import type { VaultState } from '$lib/vault.svelte'

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

  const hasFolder = $derived(Boolean(vault.localFolder?.handleId))

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
      folderError =
        error instanceof Error
          ? error.message
          : vault.t('auth_storage.local_folder_choose_err')
    } finally {
      folderBusy = false
    }
  }
</script>

<div class="space-y-4" data-testid="local-folder-setup">
  <div class="flex items-center gap-2 text-sm">
    <FolderOpen class="size-4 shrink-0 text-muted-foreground" />
    <span class="font-medium text-foreground"
      >{vault.t('provider_picker.local_folder')}</span
    >
    <button
      type="button"
      class="ml-auto text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
      data-testid="{idPrefix}-local-folder-change-provider"
      onclick={onCancelSetup}
    >
      {vault.t('provider_setup.change_provider')}
    </button>
  </div>

  <SetupWizardStep
    stepNumber={1}
    title={vault.t('provider_setup.local_folder_connection_title')}
    subtitle={vault.t('provider_setup.local_folder_connection_subtitle')}
    bind:open={connectionOpen}
    testId="{idPrefix}-local-folder-connection-step"
  >
    <div class="space-y-3">
      <p class="text-xs text-muted-foreground text-pretty">
        {vault.t('provider_setup.local_folder_desc')}
      </p>
      <Button
        type="button"
        variant="outline"
        data-testid="{idPrefix}-choose-local-folder-btn"
        disabled={folderBusy || isVerifying || isInitializing}
        onclick={() => void chooseFolder()}
      >
        {#if folderBusy}
          <RefreshCw class="size-4 animate-spin" />
          {vault.t('provider_setup.local_folder_choosing')}
        {:else}
          <FolderOpen class="size-4" />
          {vault.t('provider_setup.choose_local_folder')}
        {/if}
      </Button>
      {#if vault.localFolder?.directoryName}
        <p
          class="truncate rounded-md border border-border/60 bg-muted/20 px-3 py-2 font-mono text-xs text-muted-foreground"
          data-testid="{idPrefix}-local-folder-selected"
        >
          {vault.localFolder.directoryName}
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
    title={vault.t('provider_setup.local_folder_sync_title')}
    subtitle={vault.t('provider_setup.local_folder_sync_subtitle')}
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
