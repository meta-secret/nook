<script lang="ts">
  import {
    Check,
    CheckCircle2,
    FolderKey,
    Plus,
    RefreshCw,
  } from '@lucide/svelte'
  import SettingsAccordionSection from '$lib/components/settings/SettingsAccordionSection.svelte'
  import { Button } from '$lib/components/ui/button'
  import type { LocalVaultEntry } from '$lib/local-vault'
  import { vaultDisplayLabel } from '$lib/vault-display'
  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
    isVerifying,
    isInitializing,
  }: {
    vault: VaultState
    isVerifying: boolean
    isInitializing: boolean
  } = $props()

  let activeSection = $state<string | null>('vaults')
  let newVaultName = $state('')
  let drafts = $state<Record<string, string>>({})
  let draftSeed = $state('')
  let creating = $state(false)
  let renamingStoreId = $state<string | null>(null)
  let switchingTo = $state<string | null>(null)

  const activeStoreId = $derived(vault.activeVaultStoreId?.trim() ?? '')
  const vaults = $derived(vault.localVaults)
  const isBusy = $derived(
    isVerifying ||
      isInitializing ||
      vault.isVerifying ||
      creating ||
      renamingStoreId !== null ||
      switchingTo !== null,
  )

  function buildDrafts() {
    const next: Record<string, string> = {}
    for (const entry of vaults) {
      next[entry.storeId] = vaultDisplayLabel(entry, vault.t)
    }
    drafts = next
  }

  $effect(() => {
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

  function canSave(entry: LocalVaultEntry) {
    const draft = draftFor(entry).trim()
    return (
      !isBusy && draft.length > 0 && draft !== vaultDisplayLabel(entry, vault.t)
    )
  }

  async function createVault() {
    const label = newVaultName.trim()
    if (!label || isBusy) return
    creating = true
    try {
      await vault.createLocalVaultWithDeviceKeys(label)
      if (!vault.errorMsg) {
        newVaultName = ''
      }
    } finally {
      creating = false
    }
  }

  async function renameVault(entry: LocalVaultEntry) {
    if (!canSave(entry)) return
    renamingStoreId = entry.storeId
    try {
      await vault.renameLocalVault(entry.storeId, draftFor(entry))
    } finally {
      renamingStoreId = null
    }
  }

  async function switchTo(entry: LocalVaultEntry) {
    if (entry.storeId === activeStoreId || isBusy) return
    switchingTo = entry.storeId
    try {
      await vault.switchToVault(entry.storeId)
    } finally {
      switchingTo = null
    }
  }
</script>

<div class="space-y-2" data-testid="vault-admin-panel">
  <SettingsAccordionSection
    title={vault.t('vault.admin_vaults_title')}
    subtitle={vault.t('vault.admin_vaults_desc')}
    section="vaults"
    bind:activeSection
    testId="vault-admin-vaults-section"
  >
    {#snippet badge()}
      <span
        class="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400"
        data-testid="vault-admin-vault-count"
      >
        <CheckCircle2 class="size-3" />
        {vault.t('vault.admin_vault_count', { count: String(vaults.length) })}
      </span>
    {/snippet}

    <div class="space-y-4" data-testid="vault-admin-vaults-panel">
      <div
        class="flex flex-col gap-3 rounded-lg border border-dashed border-border/50 bg-muted/10 p-3 sm:flex-row sm:items-end"
      >
        <div class="min-w-0 flex-1 space-y-1">
          <label
            for="vault-admin-create-input"
            class="text-xs font-medium text-muted-foreground"
          >
            {vault.t('vault.admin_new_vault_label')}
          </label>
          <input
            id="vault-admin-create-input"
            class="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
            placeholder={vault.t('login.vault_name_placeholder')}
            data-testid="vault-admin-create-input"
            value={newVaultName}
            disabled={isBusy}
            oninput={(event) => {
              newVaultName = (event.currentTarget as HTMLInputElement).value
            }}
            onkeydown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void createVault()
              }
            }}
          />
        </div>
        <Button
          type="button"
          class="sm:min-w-[11rem]"
          data-testid="vault-admin-create-btn"
          disabled={isBusy || newVaultName.trim().length === 0}
          onclick={() => void createVault()}
        >
          {#if creating}
            <RefreshCw class="size-4 animate-spin" />
          {:else}
            <Plus class="size-4" />
          {/if}
          {vault.t('vault.switcher_create_new')}
        </Button>
      </div>

      <ul
        class="overflow-hidden rounded-lg border border-border/60 bg-background/35"
      >
        {#each vaults as entry (entry.storeId)}
          {@const isActive = entry.storeId === activeStoreId}
          <li
            class="grid gap-3 border-b border-border/60 p-3 last:border-b-0 sm:grid-cols-[1fr_auto]"
            data-testid="vault-admin-entry"
            data-store-id={entry.storeId}
          >
            <div class="grid min-w-0 gap-3 sm:grid-cols-[auto_1fr]">
              <FolderKey
                class="mt-2 hidden size-4 shrink-0 text-primary sm:block"
              />
              <div class="min-w-0 space-y-2">
                <div class="flex min-w-0 items-center gap-2">
                  <input
                    class="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
                    aria-label={vault.t('vault.manager_name_label')}
                    data-testid="vault-admin-name-input"
                    data-store-id={entry.storeId}
                    value={draftFor(entry)}
                    disabled={isBusy}
                    oninput={(event) =>
                      setDraft(
                        entry,
                        (event.currentTarget as HTMLInputElement).value,
                      )}
                    onkeydown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        void renameVault(entry)
                      }
                    }}
                  />
                  {#if isActive}
                    <span
                      class="inline-flex h-8 shrink-0 items-center gap-1 rounded-md bg-primary/10 px-2 text-xs font-medium text-primary"
                      data-testid="vault-admin-active-badge"
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
              </div>
            </div>

            <div class="flex flex-wrap items-center justify-end gap-2">
              {#if !isActive}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="vault-admin-switch-btn"
                  data-store-id={entry.storeId}
                  disabled={isBusy}
                  onclick={() => void switchTo(entry)}
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
                data-testid="vault-admin-rename-btn"
                data-store-id={entry.storeId}
                disabled={!canSave(entry)}
                onclick={() => void renameVault(entry)}
              >
                {#if renamingStoreId === entry.storeId}
                  <RefreshCw class="size-4 animate-spin" />
                {/if}
                {vault.t('common.save')}
              </Button>
            </div>
          </li>
        {/each}
      </ul>
    </div>
  </SettingsAccordionSection>
</div>
