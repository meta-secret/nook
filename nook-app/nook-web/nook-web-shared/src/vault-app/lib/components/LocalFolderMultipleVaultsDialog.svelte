<script lang="ts">
  import {
    FolderOpen,
    HardDrive,
    Trash2,
    TriangleAlert,
    X,
  } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
  } from '$lib/components/ui/card'
  import type { VaultState } from '$lib/vault.svelte'
  import type { LocalFolderMultipleVaultsIssue } from '$lib/vault/sync'

  let {
    vault,
    issue,
    onChooseFolder,
    onDisconnect,
    onDismiss,
  }: {
    vault: VaultState
    issue: LocalFolderMultipleVaultsIssue
    onChooseFolder: () => void | Promise<void>
    onDisconnect: () => void | Promise<void>
    onDismiss: () => void
  } = $props()
</script>

<div
  class="fixed inset-0 z-50 flex items-center justify-center p-4"
  role="dialog"
  aria-modal="true"
  aria-labelledby="local-folder-multiple-vaults-title"
  data-testid="local-folder-multiple-vaults-dialog"
>
  <div
    class="absolute inset-0 bg-background/80 backdrop-blur-sm"
    aria-hidden="true"
  ></div>

  <Card
    class="relative z-10 w-full max-w-lg border-border bg-card shadow-2xl shadow-black/40 animate-in fade-in zoom-in-95 duration-200"
  >
    <CardHeader class="border-b border-border/60 pb-4">
      <div class="flex items-start justify-between gap-3">
        <div class="space-y-1">
          <CardTitle
            id="local-folder-multiple-vaults-title"
            class="inline-flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground"
          >
            <TriangleAlert class="size-4 shrink-0 text-amber-500" />
            {vault.t('auth_storage.local_folder_multiple_vaults_title')}
          </CardTitle>
          <CardDescription class="text-pretty">
            {vault.t('auth_storage.local_folder_multiple_vaults_desc', {
              provider: issue.providerLabel,
            })}
          </CardDescription>
        </div>
        <button
          type="button"
          class="rounded-md p-1 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          aria-label={vault.t('common.cancel')}
          data-testid="local-folder-multiple-vaults-dismiss-btn"
          onclick={onDismiss}
        >
          <X class="size-4" />
        </button>
      </div>
    </CardHeader>

    <CardContent class="space-y-4 pt-4">
      <div
        class="rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5"
        data-testid="local-folder-multiple-vaults-store-list"
      >
        <div
          class="flex items-center gap-2 text-sm font-medium text-foreground"
        >
          <HardDrive class="size-4 text-primary" />
          {vault.t('auth_storage.local_folder_detected_vaults')}
        </div>
        <ul class="mt-2 space-y-1 font-mono text-xs text-muted-foreground">
          {#if issue.storeIds.length > 0}
            {#each issue.storeIds as storeId (storeId)}
              <li data-testid="local-folder-multiple-vaults-store-id">
                {storeId}
              </li>
            {/each}
          {:else}
            <li>
              {vault.t('auth_storage.local_folder_detected_vaults_unknown')}
            </li>
          {/if}
        </ul>
      </div>

      <p class="text-sm text-muted-foreground text-pretty">
        {vault.t('auth_storage.local_folder_multiple_vaults_resolution')}
      </p>

      <div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
        <Button
          type="button"
          variant="outline"
          class="sm:min-w-[150px]"
          data-testid="local-folder-multiple-vaults-disconnect-btn"
          onclick={() => void onDisconnect()}
        >
          <Trash2 class="size-4" />
          {vault.t('auth_storage.local_folder_disconnect')}
        </Button>
        <Button
          type="button"
          class="sm:min-w-[180px]"
          data-testid="local-folder-multiple-vaults-choose-folder-btn"
          onclick={() => void onChooseFolder()}
        >
          <FolderOpen class="size-4" />
          {vault.t('auth_storage.local_folder_choose_another')}
        </Button>
      </div>
    </CardContent>
  </Card>
</div>
