<script lang="ts">
  import {
    ArrowLeft,
    Plus,
    Search,
    Globe,
    Braces,
    Sprout,
    StickyNote,
  } from '@lucide/svelte'
  import type { VaultState } from '$lib/vault.svelte'
  import { Button } from '$lib/components/ui/button'
  import { Card, CardContent } from '$lib/components/ui/card'
  import AddSecretForm from './AddSecretForm.svelte'
  import SecretDetailRow from './SecretDetailRow.svelte'
  import type { NookSecretRecord, VaultItemType } from '$lib/nook'

  let {
    vault,
    isSaving,
    editsBlocked = false,
    secrets = [] as NookSecretRecord[],
    onAddSecret,
    onReplaceSecret,
    onDeleteSecret,
    onGeneratePassword,
    onAddModeChange,
  }: {
    vault: VaultState
    isSaving: boolean
    editsBlocked?: boolean
    secrets?: NookSecretRecord[]
    onAddSecret: (
      id: string,
      type: VaultItemType,
      data: string,
    ) => Promise<void>
    onReplaceSecret: (
      oldId: string,
      type: VaultItemType,
      data: string,
    ) => Promise<void>
    onDeleteSecret: (id: string) => Promise<void>
    onGeneratePassword: (
      length: number,
      lowercase: boolean,
      uppercase: boolean,
      numbers: boolean,
      symbols: boolean,
    ) => string
    onAddModeChange?: (open: boolean, type?: VaultItemType | undefined) => void
  } = $props()

  let searchPattern = $state('')
  let revealSecrets = $state<Record<string, boolean>>({})
  let expandedSecrets = $state<Record<string, boolean>>({})
  let copiedKey = $state<string | undefined>(undefined)
  let addSecretOpen = $state(false)
  let formSelectedType = $state<VaultItemType | undefined>(undefined)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let editItem = $state<NookSecretRecord | undefined>(undefined)

  const filteredItems = $derived.by(() => {
    const needle = searchPattern.trim()
    if (!needle) return secrets
    return secrets.filter((item) => item.matchesSearch(needle))
  })

  const visibleItemCount = $derived(
    searchPattern.trim() ? filteredItems.length : secrets.length,
  )

  function getGroupIcon(items: NookSecretRecord[]) {
    if (items.some((item) => item.type === 'login')) return Globe
    if (items.some((item) => item.type === 'api-key')) return Braces
    if (items.some((item) => item.type === 'seed-phrase')) return Sprout
    return StickyNote
  }

  const groups = $derived.by(() => {
    const dict: Record<string, NookSecretRecord[]> = {}
    for (const item of filteredItems) {
      const key = item.groupKey
      if (!dict[key]) {
        dict[key] = []
      }
      dict[key].push(item)
    }
    return Object.entries(dict)
      .map(([site, items]) => ({
        site,
        items: items.sort((a, b) => a.type.localeCompare(b.type)),
      }))
      .sort((a, b) => a.site.localeCompare(b.site))
  })

  function notifyAddMode() {
    onAddModeChange?.(addSecretOpen, formSelectedType)
  }

  function openAddSecret() {
    editItem = undefined
    formSelectedType = undefined
    addSecretOpen = true
    notifyAddMode()
  }

  function closeAddSecret() {
    addSecretOpen = false
    formSelectedType = undefined
    notifyAddMode()
  }

  function openEditItem(item: NookSecretRecord) {
    addSecretOpen = false
    editItem = item
    notifyAddMode()
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function closeEditItem() {
    editItem = undefined
    notifyAddMode()
  }

  $effect(() => {
    if (addSecretOpen) {
      void formSelectedType
      notifyAddMode()
    }
  })

  const isSecureNoteEditor = $derived(
    addSecretOpen && formSelectedType === 'secure-note',
  )

  async function copyToClipboard(text: string, id: string, field: string) {
    await navigator.clipboard.writeText(text)
    copiedKey = `${id}-${field}`
    setTimeout(() => {
      if (copiedKey === `${id}-${field}`) copiedKey = undefined
    }, 2000)
  }

  function toggleReveal(id: string) {
    const next = !revealSecrets[id]
    revealSecrets = { ...revealSecrets, [id]: next }
    if (next) {
      expandedSecrets = { ...expandedSecrets, [id]: true }
    }
  }

  function toggleExpand(id: string) {
    expandedSecrets = { ...expandedSecrets, [id]: !expandedSecrets[id] }
  }
</script>

<div
  class="animate-in fade-in duration-200 {addSecretOpen && isSecureNoteEditor
    ? 'flex min-h-0 flex-1 flex-col'
    : !addSecretOpen
      ? 'flex min-h-0 flex-1 flex-col'
      : ''}"
  data-testid="vault-panel"
>
  {#if addSecretOpen}
    <div
      class="animate-in fade-in slide-in-from-right-2 duration-200 {isSecureNoteEditor
        ? 'flex min-h-0 flex-1 flex-col'
        : ''}"
      data-testid="add-secret-panel"
    >
      {#if formSelectedType === undefined}
        <div class="mb-3">
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            data-testid="add-secret-back-btn"
            onclick={closeAddSecret}
          >
            <ArrowLeft class="size-4" />
            {vault.t('common.back')}
          </button>
        </div>
      {/if}

      <AddSecretForm
        {vault}
        {isSaving}
        bind:selectedType={formSelectedType}
        {onAddSecret}
        {onReplaceSecret}
        {onGeneratePassword}
        onCancel={closeAddSecret}
      />
    </div>
  {:else}
    <div class="flex min-h-0 flex-1 flex-col gap-4">
      <div
        class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
      >
        <div>
          <p class="text-sm font-semibold text-foreground">
            {searchPattern.trim() && visibleItemCount !== secrets.length
              ? vault.t('vault.secret_count_filtered', {
                  count: String(visibleItemCount),
                  total: String(secrets.length),
                })
              : vault.t('vault.secret_count', {
                  count: String(visibleItemCount),
                })}
          </p>
        </div>
        <div class="flex w-full shrink-0 items-center gap-2 sm:w-auto">
          <Button
            size="sm"
            variant="outline"
            class="flex-1 border-border/40 bg-background/70 text-foreground hover:bg-accent sm:flex-none sm:bg-background"
            data-testid="add-secret-btn"
            disabled={editsBlocked}
            title={editsBlocked
              ? vault.t('auth_storage.sync_blocked_edits')
              : undefined}
            onclick={openAddSecret}
          >
            <Plus class="size-3.5" />
            {vault.t('vault.add_secret')}
          </Button>
        </div>
      </div>

      <div class="relative">
        <Search class="absolute left-3 top-3 size-4 text-muted-foreground/60" />
        <input
          type="search"
          bind:value={searchPattern}
          data-testid="search-secrets"
          placeholder={vault.t('vault.search_placeholder')}
          class="flex h-10 w-full rounded-lg border border-border/45 bg-background/80 py-2 pl-10 pr-4 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring sm:bg-background"
        />
      </div>

      {#if filteredItems.length === 0}
        <Card
          class="flex min-h-0 flex-1 flex-col gap-0 border-border/45 bg-card py-0 sm:border-border/70"
        >
          <CardContent
            class="flex flex-1 items-center justify-center p-10 text-center text-muted-foreground"
            data-testid="vault-empty-search"
          >
            <p>
              {secrets.length === 0
                ? vault.t('vault.no_secrets')
                : vault.t('vault.no_secrets')}
            </p>
          </CardContent>
        </Card>
      {:else}
        <div class="space-y-3">
          {#each groups as group (group.site)}
            {@const Icon = getGroupIcon(group.items)}
            {@const titleAsCardHeader =
              group.items.length === 1 &&
              (group.items[0].type === 'secure-note' ||
                group.items[0].type === 'login')}
            <Card
              class="gap-0 overflow-hidden border-border/35 bg-card py-0 shadow-xs sm:border-border/60"
              data-testid="vault-site-group"
            >
              {#if !titleAsCardHeader}
                <div
                  class="flex items-center gap-2.5 border-b border-border/30 bg-muted/10 px-3 py-2.5 sm:border-border/50"
                >
                  <div
                    class="flex size-6 items-center justify-center rounded-md border border-border/35 bg-muted/35 text-muted-foreground sm:border-border/60"
                  >
                    <Icon class="size-3.5" />
                  </div>
                  <h3
                    class="truncate text-sm font-semibold tracking-wide text-foreground"
                  >
                    {group.site}
                  </h3>
                  {#if group.items.length > 1}
                    <span
                      class="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                    >
                      {vault.t('vault.secret_count', {
                        count: String(group.items.length),
                      })}
                    </span>
                  {/if}
                </div>
              {/if}

              <CardContent
                class="space-y-3 divide-y divide-border/30 p-3 sm:divide-border/45 {titleAsCardHeader
                  ? '!p-0'
                  : ''}"
              >
                {#each group.items as item, index (item.id)}
                  <SecretDetailRow
                    {item}
                    {index}
                    titleAsHeader={titleAsCardHeader}
                    expanded={Boolean(expandedSecrets[item.id])}
                    {revealSecrets}
                    {copiedKey}
                    onToggleExpand={toggleExpand}
                    onToggleReveal={toggleReveal}
                    onEditItem={openEditItem}
                    {onDeleteSecret}
                    onCopyToClipboard={copyToClipboard}
                    {vault}
                  />
                {/each}
              </CardContent>
            </Card>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>
