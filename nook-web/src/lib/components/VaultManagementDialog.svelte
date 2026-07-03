<script lang="ts">
  import { Check, FolderKey, RefreshCw, X } from '@lucide/svelte'
  import LoginVaultNameForm from '$lib/components/login/LoginVaultNameForm.svelte'
  import { Button } from '$lib/components/ui/button'
  import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
  } from '$lib/components/ui/card'
  import type { LocalVaultEntry } from '$lib/local-vault'
  import { vaultDisplayLabel } from '$lib/vault-display'
  import type { VaultState } from '$lib/vault.svelte'

  type DialogMode = 'create' | 'manage'

  let {
    vault,
    mode,
    vaults,
    activeStoreId,
    isBusy = false,
    switchingTo = null,
    onClose,
    onCreate,
    onRename,
    onSwitch,
  }: {
    vault: VaultState
    mode: DialogMode
    vaults: LocalVaultEntry[]
    activeStoreId: string
    isBusy?: boolean
    switchingTo?: string | null
    onClose: () => void
    onCreate: (label: string) => void | Promise<void>
    onRename: (entry: LocalVaultEntry, label: string) => void | Promise<void>
    onSwitch: (entry: LocalVaultEntry) => void | Promise<void>
  } = $props()

  let drafts = $state<Record<string, string>>({})
  let draftSeed = $state('')
  let renamingStoreId = $state<string | null>(null)

  const title = $derived(
    mode === 'create'
      ? vault.t('vault.create_title')
      : vault.t('vault.manage_title'),
  )
  const testId = $derived(
    mode === 'create' ? 'vault-switcher-create-dialog' : 'vault-manager-dialog',
  )

  function buildDrafts() {
    const next: Record<string, string> = {}
    for (const entry of vaults) {
      next[entry.storeId] = vaultDisplayLabel(entry, vault.t)
    }
    drafts = next
  }

  $effect(() => {
    if (mode !== 'manage') return
    const seed = vaults
      .map((entry) => `${entry.storeId}:${entry.label ?? ''}`)
      .join('|')
    if (seed !== draftSeed) {
      draftSeed = seed
      buildDrafts()
    }
  })

  function draftFor(entry: LocalVaultEntry) {
    return drafts[entry.storeId] ?? vaultDisplayLabel(entry, vault.t)
  }

  function setDraft(entry: LocalVaultEntry, value: string) {
    drafts = { ...drafts, [entry.storeId]: value }
  }

  function resetDraft(entry: LocalVaultEntry) {
    setDraft(entry, vaultDisplayLabel(entry, vault.t))
  }

  function canSave(entry: LocalVaultEntry) {
    const draft = draftFor(entry).trim()
    return (
      !isBusy &&
      renamingStoreId === null &&
      draft.length > 0 &&
      draft !== vaultDisplayLabel(entry, vault.t)
    )
  }

  async function submitRename(entry: LocalVaultEntry) {
    if (!canSave(entry)) return
    renamingStoreId = entry.storeId
    try {
      await onRename(entry, draftFor(entry))
    } finally {
      renamingStoreId = null
    }
  }

  function handleNameKeydown(event: KeyboardEvent, entry: LocalVaultEntry) {
    if (event.key === 'Enter') {
      event.preventDefault()
      void submitRename(entry)
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      resetDraft(entry)
    }
  }
</script>

<div
  class="fixed inset-0 z-50 flex items-center justify-center p-4"
  role="dialog"
  aria-modal="true"
  aria-labelledby="vault-management-title"
  data-testid={testId}
>
  <button
    type="button"
    class="absolute inset-0 bg-background/80 backdrop-blur-sm"
    aria-label={vault.t('common.cancel')}
    onclick={onClose}
  ></button>

  <Card
    class="relative z-10 w-full max-w-lg border-border bg-card shadow-2xl shadow-black/40 animate-in fade-in zoom-in-95 duration-200"
  >
    <CardHeader class="border-b border-border/60 pb-4">
      <div class="flex items-center justify-between gap-3">
        <CardTitle
          id="vault-management-title"
          class="inline-flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground"
        >
          <FolderKey class="size-4 shrink-0 text-primary" />
          {title}
        </CardTitle>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={vault.t('common.cancel')}
          onclick={onClose}
        >
          <X class="size-4" />
        </Button>
      </div>
    </CardHeader>

    <CardContent class="space-y-4 pt-4">
      {#if mode === 'create'}
        <div class="space-y-4">
          <LoginVaultNameForm
            {vault}
            isVerifying={vault.isVerifying}
            isInitializing={vault.isInitializing}
            testId="vault-switcher-create-submit"
            submitLabel={vault.t('vault.switcher_create_new')}
            {onCreate}
          />
          <Button
            type="button"
            variant="outline"
            class="w-full"
            disabled={isBusy}
            onclick={onClose}
          >
            {vault.t('common.cancel')}
          </Button>
        </div>
      {:else}
        <ul class="max-h-[min(65vh,28rem)] space-y-2 overflow-y-auto">
          {#each vaults as entry (entry.storeId)}
            {@const isActive = entry.storeId === activeStoreId}
            <li
              class="rounded-lg border border-border/60 bg-muted/20 p-3"
              data-testid="vault-manager-entry"
              data-store-id={entry.storeId}
            >
              <div class="flex items-start gap-3">
                <FolderKey
                  class="mt-2 size-4 shrink-0 {isActive
                    ? 'text-primary'
                    : 'text-muted-foreground'}"
                />
                <div class="min-w-0 flex-1 space-y-2">
                  <div class="flex min-w-0 items-center gap-2">
                    <input
                      class="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
                      aria-label={vault.t('vault.manager_name_label')}
                      data-testid="vault-manager-name-input"
                      data-store-id={entry.storeId}
                      value={draftFor(entry)}
                      disabled={isBusy}
                      oninput={(event) =>
                        setDraft(
                          entry,
                          (event.currentTarget as HTMLInputElement).value,
                        )}
                      onkeydown={(event) => handleNameKeydown(event, entry)}
                    />
                    {#if isActive}
                      <span
                        class="inline-flex h-7 shrink-0 items-center gap-1 rounded-md bg-primary/10 px-2 text-xs font-medium text-primary"
                        data-testid="vault-manager-active-badge"
                      >
                        <Check class="size-3.5" />
                        {vault.t('vault.switcher_open_badge')}
                      </span>
                    {/if}
                  </div>
                  <div
                    class="truncate font-mono text-[10px] text-muted-foreground"
                  >
                    {entry.storeId}
                  </div>
                  <div class="flex flex-wrap justify-end gap-2">
                    {#if !isActive}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        data-testid="vault-manager-switch-btn"
                        data-store-id={entry.storeId}
                        disabled={isBusy}
                        onclick={() => void onSwitch(entry)}
                      >
                        {#if switchingTo === entry.storeId}
                          <RefreshCw class="size-4 animate-spin" />
                        {/if}
                        {vault.t('common.switch')}
                      </Button>
                    {/if}
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      data-testid="vault-manager-rename-btn"
                      data-store-id={entry.storeId}
                      disabled={!canSave(entry)}
                      onclick={() => void submitRename(entry)}
                    >
                      {#if renamingStoreId === entry.storeId}
                        <RefreshCw class="size-4 animate-spin" />
                      {/if}
                      {vault.t('common.save')}
                    </Button>
                  </div>
                </div>
              </div>
            </li>
          {/each}
        </ul>
        <div class="flex justify-end">
          <Button type="button" variant="outline" onclick={onClose}>
            {vault.t('common.done')}
          </Button>
        </div>
      {/if}
    </CardContent>
  </Card>
</div>
