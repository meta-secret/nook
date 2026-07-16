<script lang="ts">
  import {
    ArrowLeft,
    ChevronLeft,
    ChevronRight,
    Plus,
    Search,
    Globe,
    Braces,
    Sprout,
    StickyNote,
    TriangleAlert,
  } from '@lucide/svelte'
  import type { VaultState } from '$lib/vault.svelte'
  import { Button } from '$lib/components/ui/button'
  import { Card, CardContent } from '$lib/components/ui/card'
  import AddSecretForm from './AddSecretForm.svelte'
  import SecretDetailRow from './SecretDetailRow.svelte'
  import type { NookSecretListItem, VaultItemType } from '$lib/nook'
  import {
    freeDecryptedSecrets,
    toggleSecretExposure,
    withDecryptedSecret,
    type DecryptedSecrets,
  } from '$lib/vault/secret-exposure'
  import { onDestroy, untrack } from 'svelte'

  let {
    vault,
    isSaving,
    editsBlocked = false,
    editBlockReason = undefined,
    secrets = [] as NookSecretListItem[],
    onAddSecret,
    onReplaceSecret,
    onDeleteSecret,
    onGeneratePassword,
    onAddModeChange,
  }: {
    vault: VaultState
    isSaving: boolean
    editsBlocked?: boolean
    editBlockReason?: string | undefined
    secrets?: NookSecretListItem[]
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

  let searchPattern = $derived(vault.secretQuery)
  let decryptedSecrets = $state<DecryptedSecrets>({})
  let expandedSecrets = $state<Record<string, boolean>>({})
  let copiedKey = $state<string | undefined>(undefined)
  let addSecretOpen = $state(false)
  let formSelectedType = $state<VaultItemType | undefined>(undefined)

  const filteredItems = $derived(secrets)

  const visibleItemCount = $derived(secrets.length)
  const currentPage = $derived(
    Math.floor(vault.secretPageOffset / vault.secretPageSize) + 1,
  )
  const pageCount = $derived(
    Math.max(1, Math.ceil(vault.secretTotal / vault.secretPageSize)),
  )

  function getGroupIcon(items: NookSecretListItem[]) {
    if (items.some((item) => item.type === 'login')) return Globe
    if (items.some((item) => item.type === 'api-key')) return Braces
    if (items.some((item) => item.type === 'seed-phrase')) return Sprout
    return StickyNote
  }

  const groups = $derived.by(() => {
    const dict: Record<string, NookSecretListItem[]> = {}
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
    formSelectedType = undefined
    addSecretOpen = true
    notifyAddMode()
  }

  function closeAddSecret() {
    addSecretOpen = false
    formSelectedType = undefined
    notifyAddMode()
  }

  async function openEditItem() {
    addSecretOpen = false
    notifyAddMode()
  }

  $effect(() => {
    if (addSecretOpen) {
      void formSelectedType
      notifyAddMode()
    }
  })

  $effect(() => {
    const query = searchPattern.trim()
    if (query === vault.secretQuery) return
    const timer = setTimeout(() => {
      void vault.loadSecretPage(query, 0)
    }, 200)
    return () => clearTimeout(timer)
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

  async function toggleReveal(id: string) {
    const revealing = decryptedSecrets[id] === undefined
    decryptedSecrets = await toggleSecretExposure(
      decryptedSecrets,
      id,
      (secretId) => vault.decryptSecret(secretId),
    )
    if (revealing) {
      expandedSecrets = { ...expandedSecrets, [id]: true }
    }
  }

  async function copySecret(id: string) {
    await withDecryptedSecret(
      decryptedSecrets,
      id,
      (secretId) => vault.decryptSecret(secretId),
      (record) => copyToClipboard(record.primaryCredential, id, 'secret'),
    )
  }

  function toggleExpand(id: string) {
    expandedSecrets = { ...expandedSecrets, [id]: !expandedSecrets[id] }
  }

  $effect(() => {
    void vault.secretQuery
    void vault.secretPageOffset
    freeDecryptedSecrets(untrack(() => decryptedSecrets))
    decryptedSecrets = {}
  })

  onDestroy(() => {
    freeDecryptedSecrets(decryptedSecrets)
  })
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
            {vault.secretTotal !== visibleItemCount
              ? vault.t('vault.secret_count_page', {
                  count: String(visibleItemCount),
                  total: String(vault.secretTotal),
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
            title={editsBlocked ? editBlockReason : undefined}
            onclick={openAddSecret}
          >
            <Plus class="size-3.5" />
            {vault.t('vault.add_secret')}
          </Button>
        </div>
      </div>

      {#if editsBlocked && editBlockReason}
        <div
          class="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-foreground"
          data-testid="secret-edit-blocked-banner"
        >
          <TriangleAlert class="mt-0.5 size-4 shrink-0 text-amber-600" />
          <p class="text-pretty text-xs text-muted-foreground">
            {editBlockReason}
          </p>
        </div>
      {/if}

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
                    decrypted={decryptedSecrets[item.id]}
                    {copiedKey}
                    onToggleExpand={toggleExpand}
                    onToggleReveal={toggleReveal}
                    onEditItem={openEditItem}
                    {onDeleteSecret}
                    onCopyToClipboard={copyToClipboard}
                    onCopySecret={copySecret}
                    {vault}
                  />
                {/each}
              </CardContent>
            </Card>
          {/each}
          {#if vault.secretTotal > vault.secretPageSize}
            <div
              class="flex items-center justify-between gap-3 pt-1"
              data-testid="secret-pagination"
            >
              <Button
                size="sm"
                variant="outline"
                data-testid="secret-page-previous"
                disabled={vault.secretPageOffset === 0}
                onclick={() =>
                  vault.loadSecretPage(
                    vault.secretQuery,
                    Math.max(0, vault.secretPageOffset - vault.secretPageSize),
                  )}
              >
                <ChevronLeft class="size-3.5" />
                {vault.t('vault.previous_page')}
              </Button>
              <span class="text-xs text-muted-foreground">
                {vault.t('vault.page_status', {
                  page: String(currentPage),
                  total: String(pageCount),
                })}
              </span>
              <Button
                size="sm"
                variant="outline"
                data-testid="secret-page-next"
                disabled={vault.secretPageOffset + vault.secretPageSize >=
                  vault.secretTotal}
                onclick={() =>
                  vault.loadSecretPage(
                    vault.secretQuery,
                    vault.secretPageOffset + vault.secretPageSize,
                  )}
              >
                {vault.t('vault.next_page')}
                <ChevronRight class="size-3.5" />
              </Button>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>
