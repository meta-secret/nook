<script lang="ts">
  import { Search, Plus, Globe, Braces, Sprout } from '@lucide/svelte'
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
    onDeleteSecret,
    onGeneratePassword,
  }: {
    isSaving: boolean
    secrets?: SecretRecord[]
    onAddSecret: (
      id: string,
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
  } = $props()

  let searchPattern = $state('')
  let revealSecrets = $state<Record<string, boolean>>({})
  let copiedKey = $state<string | null>(null)
  let addSecretOpen = $state(false)

  const items = $derived(secrets.map(parseVaultItem))
  const filteredItems = $derived.by(() => {
    const needle = searchPattern.trim().toLowerCase()
    if (!needle) return items
    return items.filter((item) => searchableText(item).includes(needle))
  })

  function getSiteGroupKey(item: VaultItem): string {
    if (item.type === 'seed-phrase') {
      return item.name.trim() || 'Unnamed Seed Phrase'
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
    return Sprout
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

  function searchableText(item: VaultItem): string {
    if (item.type === 'login') {
      return `${item.websiteUrl} ${item.username} ${item.notes}`.toLowerCase()
    }
    if (item.type === 'api-key') {
      return `${item.websiteUrl} ${item.expiresAt}`.toLowerCase()
    }
    return item.name.toLowerCase()
  }

  function openAddSecret() {
    addSecretOpen = true
  }

  function closeAddSecret() {
    addSecretOpen = false
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
  <div class="space-y-4">
    <div class="flex items-center justify-between gap-3">
      <div>
        <h2 class="text-base font-semibold text-foreground">Vault</h2>
        <p class="text-xs text-muted-foreground">
          {items.length}
          {items.length === 1 ? 'item' : 'items'}
        </p>
      </div>
      {#if addSecretOpen}
        <Button
          size="sm"
          variant="outline"
          data-testid="add-secret-cancel-btn"
          onclick={closeAddSecret}
        >
          Cancel
        </Button>
      {:else}
        <Button
          size="sm"
          variant="outline"
          class="border-border bg-background text-foreground hover:bg-accent"
          data-testid="add-secret-btn"
          onclick={openAddSecret}
        >
          <Plus class="size-3.5" />
          Add item
        </Button>
      {/if}
    </div>

    {#if addSecretOpen}
      <Card
        class="border-border bg-card animate-in fade-in slide-in-from-top-2 duration-200"
        data-testid="add-secret-panel"
      >
        <CardContent class="p-4">
          <AddSecretForm
            {isSaving}
            {onAddSecret}
            {onGeneratePassword}
            onCancel={closeAddSecret}
          />
        </CardContent>
      </Card>
    {/if}

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
            {items.length === 0 ? 'Your vault is empty.' : 'No items matched.'}
          </p>
          <p class="text-xs">
            {items.length === 0
              ? 'Add a login, API key, or seed phrase to get started.'
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
            <!-- Group Header -->
            <div
              class="flex items-center gap-2.5 bg-muted/10 border-b border-border/50 px-3 py-2.5"
            >
              <div
                class="flex size-6 items-center justify-center rounded-md border border-border/60 bg-muted/40 text-muted-foreground"
              >
                <Icon class="size-3.5" />
              </div>
              <h3
                class="text-sm font-semibold text-foreground tracking-wide truncate"
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

            <!-- Group Items List -->
            <CardContent class="space-y-3 divide-y divide-border/45 p-3">
              {#each group.items as item, index (item.id)}
                <SecretDetailRow
                  {item}
                  {index}
                  {revealSecrets}
                  {copiedKey}
                  onToggleReveal={toggleReveal}
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
</div>
