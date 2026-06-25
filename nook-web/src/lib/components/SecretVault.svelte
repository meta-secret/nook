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
  import { Button } from '$lib/components/ui/button'
  import { Card, CardContent } from '$lib/components/ui/card'
  import AddSecretForm from './AddSecretForm.svelte'
  import SecretDetailRow from './SecretDetailRow.svelte'
  import {
    parseVaultItem,
    type SecretRecord,
    type VaultItem,
    type VaultItemType,
  } from '$lib/nook'

  let {
    isSaving,
    secrets = [] as SecretRecord[],
    onAddSecret,
    onReplaceSecret,
    onDeleteSecret,
    onGeneratePassword,
    onAddModeChange,
  }: {
    isSaving: boolean
    secrets?: SecretRecord[]
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
    onAddModeChange?: (open: boolean) => void
  } = $props()

  let searchPattern = $state('')
  let revealSecrets = $state<Record<string, boolean>>({})
  let copiedKey = $state<string | null>(null)
  let addSecretOpen = $state(false)
  let editItem = $state<VaultItem | null>(null)

  const items = $derived(secrets.map(parseVaultItem))
  const filteredItems = $derived.by(() => {
    const needle = searchPattern.trim().toLowerCase()
    if (!needle) return items
    return items.filter((item) => itemMatchesSearch(item, needle))
  })

  const visibleItemCount = $derived(
    searchPattern.trim() ? filteredItems.length : items.length,
  )

  function getSiteGroupKey(item: VaultItem): string {
    if (item.type === 'seed-phrase') {
      return item.name.trim() || 'Unnamed Seed Phrase'
    }
    if (item.type === 'secure-note') {
      return item.title.trim() || 'Unnamed Note'
    }
    const url = item.websiteUrl.trim()
    if (!url) return 'No Website'
    try {
      const parsed = new URL(url.startsWith('http') ? url : `https://${url}`)
      return parsed.hostname.replace(/^www\./, '')
    } catch {
      return url
    }
  }

  function getGroupIcon(items: VaultItem[]) {
    if (items.some((item) => item.type === 'login')) return Globe
    if (items.some((item) => item.type === 'api-key')) return Braces
    if (items.some((item) => item.type === 'seed-phrase')) return Sprout
    return StickyNote
  }

  const groups = $derived.by(() => {
    const dict: Record<string, VaultItem[]> = {}
    for (const item of filteredItems) {
      const key = getSiteGroupKey(item)
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

  function itemMatchesSearch(item: VaultItem, needle: string): boolean {
    const fields = [getSiteGroupKey(item)]
    if (item.type === 'login') {
      fields.push(item.websiteUrl.trim(), item.username.trim())
    } else if (item.type === 'api-key') {
      fields.push(item.websiteUrl.trim())
      if (item.expiresAt) fields.push(item.expiresAt)
    } else if (item.type === 'seed-phrase') {
      fields.push(item.name.trim())
    } else {
      fields.push(item.title.trim())
    }
    return fields.some((field) => field.toLowerCase().includes(needle))
  }

  function openAddSecret() {
    editItem = null
    addSecretOpen = true
    onAddModeChange?.(true)
  }

  function closeAddSecret() {
    addSecretOpen = false
    onAddModeChange?.(false)
  }

  function openEditItem(item: VaultItem) {
    addSecretOpen = false
    editItem = item
    onAddModeChange?.(true)
  }

  function closeEditItem() {
    editItem = null
    onAddModeChange?.(false)
  }

  async function copyToClipboard(text: string, id: string, field: string) {
    await navigator.clipboard.writeText(text)
    copiedKey = `${id}-${field}`
    setTimeout(() => {
      if (copiedKey === `${id}-${field}`) copiedKey = null
    }, 2000)
  }

  function toggleReveal(id: string) {
    revealSecrets = { ...revealSecrets, [id]: !revealSecrets[id] }
  }
</script>

<div class="animate-in fade-in duration-200" data-testid="vault-panel">
  {#if addSecretOpen}
    <div
      class="animate-in fade-in slide-in-from-right-2 duration-200"
      data-testid="add-secret-panel"
    >
      <div class="mb-5 flex items-center gap-3">
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          data-testid="add-secret-back-btn"
          onclick={closeAddSecret}
        >
          <ArrowLeft class="size-4" />
          Vault
        </button>
        <div class="min-w-0">
          <h2 class="text-base font-semibold text-foreground">Add item</h2>
          <p class="text-xs text-muted-foreground">Save a new secret</p>
        </div>
      </div>

      <AddSecretForm
        {isSaving}
        {onAddSecret}
        {onReplaceSecret}
        {onGeneratePassword}
        onCancel={closeAddSecret}
      />
    </div>
  {:else if editItem}
    <div
      class="animate-in fade-in slide-in-from-right-2 duration-200"
      data-testid="edit-secret-panel"
    >
      <div class="mb-5 flex items-center gap-3">
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          data-testid="edit-secret-back-btn"
          onclick={closeEditItem}
        >
          <ArrowLeft class="size-4" />
          Vault
        </button>
        <div class="min-w-0">
          <h2 class="text-base font-semibold text-foreground">Edit item</h2>
          <p class="text-xs text-muted-foreground">Update this secret</p>
        </div>
      </div>

      <AddSecretForm
        {isSaving}
        {onAddSecret}
        {onReplaceSecret}
        {onGeneratePassword}
        initialItem={editItem}
        onCancel={closeEditItem}
      />
    </div>
  {:else}
    <div class="space-y-4">
      <div
        class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
      >
        <div>
          <p class="text-sm font-semibold text-foreground">
            {visibleItemCount}
            {visibleItemCount === 1 ? 'item' : 'items'}
            {#if searchPattern.trim() && visibleItemCount !== items.length}
              <span class="text-muted-foreground"> of {items.length}</span>
            {/if}
          </p>
        </div>
        <div class="flex w-full shrink-0 items-center gap-2 sm:w-auto">
          <Button
            size="sm"
            variant="outline"
            class="flex-1 border-border bg-background text-foreground hover:bg-accent sm:flex-none"
            data-testid="add-secret-btn"
            onclick={openAddSecret}
          >
            <Plus class="size-3.5" />
            Add item
          </Button>
        </div>
      </div>

      <div class="relative">
        <Search class="absolute left-3 top-3 size-4 text-muted-foreground/60" />
        <input
          type="search"
          bind:value={searchPattern}
          data-testid="search-secrets"
          placeholder="Search vault…"
          class="flex h-10 w-full rounded-lg border border-border bg-background py-2 pl-10 pr-4 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring"
        />
      </div>

      {#if filteredItems.length === 0}
        <Card class="border-border bg-card">
          <CardContent
            class="space-y-2 p-10 text-center text-muted-foreground"
            data-testid="vault-empty-search"
          >
            <p>
              {items.length === 0
                ? 'Your vault is empty.'
                : 'No items matched.'}
            </p>
            <p class="text-xs">
              {items.length === 0
                ? 'Add a login, API key, seed phrase, or secure note to get started.'
                : 'Try a different search term.'}
            </p>
          </CardContent>
        </Card>
      {:else}
        <div class="space-y-3">
          {#each groups as group (group.site)}
            {@const Icon = getGroupIcon(group.items)}
            <Card
              class="gap-0 overflow-hidden border-border bg-card py-0 shadow-xs"
              data-testid="vault-site-group"
            >
              <div
                class="flex items-center gap-2.5 border-b border-border/50 bg-muted/10 px-3 py-2.5"
              >
                <div
                  class="flex size-6 items-center justify-center rounded-md border border-border/60 bg-muted/40 text-muted-foreground"
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
                    {group.items.length} items
                  </span>
                {/if}
              </div>

              <CardContent class="space-y-3 divide-y divide-border/45 p-3">
                {#each group.items as item, index (item.id)}
                  <SecretDetailRow
                    {item}
                    {index}
                    {revealSecrets}
                    {copiedKey}
                    onToggleReveal={toggleReveal}
                    onEditItem={openEditItem}
                    {onDeleteSecret}
                    onCopyToClipboard={copyToClipboard}
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
