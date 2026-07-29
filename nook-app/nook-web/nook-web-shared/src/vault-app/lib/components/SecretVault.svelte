<script lang="ts">
  import {
    NookSecretTypeFilter,
    secretTypeName,
    VaultEditDecision,
  } from '$app-wasm'

  import {
    ArrowLeft,
    ChevronLeft,
    ChevronRight,
    Plus,
    Search,
    ListFilter,
    Globe,
    Braces,
    Sprout,
    StickyNote,
    ShieldCheck,
    KeyRound,
    CreditCard,
    Paperclip,
    TriangleAlert,
  } from '@lucide/svelte'
  import type { VaultEditRestriction, VaultState } from '$lib/vault.svelte'
  import { Button } from '$lib/components/ui/button'
  import { Card, CardContent } from '$lib/components/ui/card'
  import * as Select from '$lib/components/ui/select'
  import AddSecretForm from './AddSecretForm.svelte'
  import SecretDetailRow from './SecretDetailRow.svelte'
  import type { AuthenticatorCodeView, NookSecretListItem } from '$lib/nook'
  import { SecretType } from '$lib/nook'
  import {
    freeDecryptedSecrets,
    toggleSecretExposure,
    withDecryptedSecret,
    type DecryptedSecrets,
  } from '$lib/vault/secret-exposure'
  import { onDestroy, untrack } from 'svelte'
  import {
    SecretTypeSelectionKind,
    type SecretTypeSelection,
  } from '$lib/components/secret-form-state'
  import {
    AuthenticatorCodePresentationKind,
    ClipboardNoticeKind,
    SecretEditorKind,
    SecretRevealKind,
    type AuthenticatorCodePresentation,
    type ClipboardNotice,
    type SecretEditor,
    type SecretReveal,
  } from './secret-vault-state'

  let {
    vault,
    isSaving,
    editRestriction = { decision: VaultEditDecision.Allowed },
    secrets = [] as NookSecretListItem[],
    onAddSecret,
    onReplaceSecret,
    onDeleteSecret,
    onGeneratePassword,
    onAddModeChange,
  }: {
    vault: VaultState
    isSaving: boolean
    editRestriction?: VaultEditRestriction
    secrets?: NookSecretListItem[]
    onAddSecret: (id: string, type: SecretType, data: string) => Promise<void>
    onReplaceSecret: (
      oldId: string,
      type: SecretType,
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
    onAddModeChange?: (open: boolean, selection: SecretTypeSelection) => void
  } = $props()

  const editsBlocked = $derived(
    editRestriction.decision !== VaultEditDecision.Allowed,
  )
  let searchPattern = $derived(vault.secretQuery)
  let decryptedSecrets = $state<DecryptedSecrets>({})
  let expandedSecrets = $state<Record<string, boolean>>({})
  let copiedKey = $state<ClipboardNotice>({ kind: ClipboardNoticeKind.Hidden })
  let addSecretOpen = $state(false)
  let formSelectedType = $state<SecretTypeSelection>({
    kind: SecretTypeSelectionKind.ChoosingType,
  })
  let editingItem = $state<SecretEditor>({ kind: SecretEditorKind.Creating })
  let editLoadSequence = 0
  let authenticatorCodes = $state<Record<string, AuthenticatorCodeView>>({})

  const typeFilters: Array<{
    value: SecretType
    filter: NookSecretTypeFilter
    testId: string
    labelKey: string
  }> = [
    {
      value: SecretType.Login,
      filter: NookSecretTypeFilter.Login,
      testId: secretTypeName(SecretType.Login),
      labelKey: 'vault.types.login',
    },
    {
      value: SecretType.Authenticator,
      filter: NookSecretTypeFilter.Authenticator,
      testId: secretTypeName(SecretType.Authenticator),
      labelKey: 'vault.types.authenticator',
    },
    {
      value: SecretType.ApiKey,
      filter: NookSecretTypeFilter.ApiKey,
      testId: secretTypeName(SecretType.ApiKey),
      labelKey: 'vault.types.api_key',
    },
    {
      value: SecretType.SeedPhrase,
      filter: NookSecretTypeFilter.SeedPhrase,
      testId: secretTypeName(SecretType.SeedPhrase),
      labelKey: 'vault.types.seed_phrase',
    },
    {
      value: SecretType.SecureNote,
      filter: NookSecretTypeFilter.SecureNote,
      testId: secretTypeName(SecretType.SecureNote),
      labelKey: 'vault.types.secure_note',
    },
    {
      value: SecretType.CreditCard,
      filter: NookSecretTypeFilter.CreditCard,
      testId: secretTypeName(SecretType.CreditCard),
      labelKey: 'vault.types.credit_card',
    },
    {
      value: SecretType.FileAttachment,
      filter: NookSecretTypeFilter.FileAttachment,
      testId: secretTypeName(SecretType.FileAttachment),
      labelKey: 'vault.types.file_attachment',
    },
    {
      value: SecretType.Passkey,
      filter: NookSecretTypeFilter.Passkey,
      testId: secretTypeName(SecretType.Passkey),
      labelKey: 'vault.types.passkey',
    },
  ]

  const filteredItems = $derived(secrets)

  const visibleItemCount = $derived(secrets.length)
  const activeTypeFilterLabel = $derived.by(() => {
    if (vault.secretTypeFilter === NookSecretTypeFilter.All) {
      return vault.t('vault.filter_all_types')
    }
    const active = typeFilters.find(
      ({ filter }) => filter === vault.secretTypeFilter,
    )
    return active ? vault.t(active.labelKey) : vault.t('vault.filter_all_types')
  })
  const currentPage = $derived(
    Math.floor(vault.secretPageOffset / vault.secretPageSize) + 1,
  )
  const pageCount = $derived(
    Math.max(1, Math.ceil(vault.secretTotal / vault.secretPageSize)),
  )

  function getGroupIcon(items: NookSecretListItem[]) {
    if (items.some((item) => item.type === SecretType.Login)) return Globe
    if (items.some((item) => item.type === SecretType.ApiKey)) return Braces
    if (items.some((item) => item.type === SecretType.SeedPhrase)) return Sprout
    if (items.some((item) => item.type === SecretType.Authenticator))
      return ShieldCheck
    if (items.some((item) => item.type === SecretType.CreditCard))
      return CreditCard
    if (items.some((item) => item.type === SecretType.FileAttachment))
      return Paperclip
    if (items.some((item) => item.type === SecretType.Passkey)) return KeyRound
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
        items: items.sort((a, b) => a.type - b.type),
      }))
      .sort((a, b) => a.site.localeCompare(b.site))
  })

  function notifyAddMode() {
    onAddModeChange?.(addSecretOpen, formSelectedType)
  }

  function selectTypeFilter(value: unknown) {
    if (typeof value !== 'string') return
    if (value === 'all') {
      vault.secretTypeFilter = NookSecretTypeFilter.All
      void vault.loadSecretPage(searchPattern.trim(), 0)
      return
    }
    const nextFilter = typeFilters.find(
      (filter) => filter.filter === Number(value),
    )
    if (!nextFilter) return
    vault.secretTypeFilter = nextFilter.filter
    void vault.loadSecretPage(searchPattern.trim(), 0)
  }

  function resetTransientSecretViews(
    _query: string,
    _offset: number,
    _filter: NookSecretTypeFilter,
  ) {
    freeDecryptedSecrets(untrack(() => decryptedSecrets))
    decryptedSecrets = {}
    authenticatorCodes = {}
  }

  function openAddSecret() {
    editLoadSequence += 1
    releaseEditingItem()
    formSelectedType = { kind: SecretTypeSelectionKind.ChoosingType }
    addSecretOpen = true
    notifyAddMode()
  }

  function closeAddSecret() {
    editLoadSequence += 1
    releaseEditingItem()
    addSecretOpen = false
    formSelectedType = { kind: SecretTypeSelectionKind.ChoosingType }
    notifyAddMode()
  }

  function releaseEditingItem() {
    if (editingItem.kind === SecretEditorKind.Editing) editingItem.record.free()
    editingItem = { kind: SecretEditorKind.Creating }
  }

  async function openEditItem(item: NookSecretListItem) {
    if (editsBlocked) return
    const sequence = ++editLoadSequence
    const record = await vault.decryptSecret(item.id)
    if (sequence !== editLoadSequence) {
      record.free()
      return
    }
    releaseEditingItem()
    editingItem = { kind: SecretEditorKind.Editing, record }
    formSelectedType = {
      kind: SecretTypeSelectionKind.EditingFields,
      itemType: item.type,
    }
    addSecretOpen = true
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
    addSecretOpen &&
      formSelectedType.kind === SecretTypeSelectionKind.EditingFields &&
      formSelectedType.itemType === SecretType.SecureNote,
  )

  async function copyToClipboard(text: string, id: string, field: string) {
    await navigator.clipboard.writeText(text)
    copiedKey = {
      kind: ClipboardNoticeKind.Visible,
      fieldKey: `${id}-${field}`,
    }
    setTimeout(() => {
      if (
        copiedKey.kind === ClipboardNoticeKind.Visible &&
        copiedKey.fieldKey === `${id}-${field}`
      )
        copiedKey = { kind: ClipboardNoticeKind.Hidden }
    }, 2000)
  }

  function secretReveal(itemId: string): SecretReveal {
    const record = decryptedSecrets[itemId]
    return record
      ? { kind: SecretRevealKind.Revealed, record }
      : { kind: SecretRevealKind.Hidden }
  }

  function authenticatorCodePresentation(
    itemId: string,
  ): AuthenticatorCodePresentation {
    const code = authenticatorCodes[itemId]
    return code
      ? { kind: AuthenticatorCodePresentationKind.Visible, code }
      : { kind: AuthenticatorCodePresentationKind.Hidden }
  }

  async function toggleReveal(id: string) {
    const revealing = !(id in decryptedSecrets)
    decryptedSecrets = await toggleSecretExposure(
      decryptedSecrets,
      id,
      (secretId) => vault.decryptSecret(secretId),
    )
    if (revealing) {
      expandedSecrets = { ...expandedSecrets, [id]: true }
      if (
        filteredItems.find((item) => item.id === id)?.type ===
        SecretType.Authenticator
      ) {
        await refreshAuthenticatorCode(id)
      }
    } else if (authenticatorCodes[id]) {
      const nextCodes = { ...authenticatorCodes }
      delete nextCodes[id]
      authenticatorCodes = nextCodes
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

  async function refreshAuthenticatorCode(id: string) {
    const code = await vault.currentAuthenticatorCode(id)
    if (!(id in decryptedSecrets)) return
    authenticatorCodes = { ...authenticatorCodes, [id]: code }
  }

  function toggleExpand(id: string) {
    const expanding = !expandedSecrets[id]
    expandedSecrets = { ...expandedSecrets, [id]: expanding }
  }

  $effect(() => {
    const timer = setInterval(() => {
      const now = Math.floor(Date.now() / 1000)
      const nextCodes = { ...authenticatorCodes }
      for (const [id, current] of Object.entries(authenticatorCodes)) {
        const secondsRemaining = Math.max(0, current.expiresAtUnixSeconds - now)
        if (secondsRemaining === 0) {
          delete nextCodes[id]
          void refreshAuthenticatorCode(id)
        } else {
          nextCodes[id] = {
            ...current,
            secondsRemaining,
          }
        }
      }
      authenticatorCodes = nextCodes
    }, 1000)
    return () => clearInterval(timer)
  })

  $effect(() => {
    resetTransientSecretViews(
      vault.secretQuery,
      vault.secretPageOffset,
      vault.secretTypeFilter,
    )
  })

  onDestroy(() => {
    editLoadSequence += 1
    releaseEditingItem()
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
      class="animate-in min-w-0 max-w-full fade-in slide-in-from-right-2 duration-200 {isSecureNoteEditor
        ? 'flex min-h-0 flex-1 flex-col overflow-hidden'
        : ''}"
      data-testid="add-secret-panel"
    >
      {#if formSelectedType.kind === SecretTypeSelectionKind.ChoosingType}
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
        bind:selectedTypeState={formSelectedType}
        {onAddSecret}
        {onReplaceSecret}
        {onGeneratePassword}
        onCancel={closeAddSecret}
        editor={editingItem}
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
            {...editRestriction.decision !== VaultEditDecision.Allowed
              ? { title: editRestriction.reason }
              : {}}
            onclick={openAddSecret}
          >
            <Plus class="size-3.5" />
            {vault.t('vault.add_secret')}
          </Button>
        </div>
      </div>

      {#if editRestriction.decision !== VaultEditDecision.Allowed}
        <div
          class="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-foreground"
          data-testid="secret-edit-blocked-banner"
        >
          <TriangleAlert class="mt-0.5 size-4 shrink-0 text-amber-600" />
          <p class="text-pretty text-xs text-muted-foreground">
            {editRestriction.reason}
          </p>
        </div>
      {/if}

      <div class="relative" data-testid="secret-search-and-filter">
        <Search class="absolute left-3 top-3 size-4 text-muted-foreground/60" />
        <input
          type="search"
          bind:value={searchPattern}
          data-testid="search-secrets"
          placeholder={vault.t('vault.search_placeholder')}
          class="flex h-10 w-full rounded-lg border border-border/45 bg-background/80 py-2 pl-10 pr-36 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring sm:bg-background"
        />
        <div class="absolute right-1 top-1/2 -translate-y-1/2">
          <Select.Root
            type="single"
            value={vault.secretTypeFilter === NookSecretTypeFilter.All
              ? 'all'
              : String(vault.secretTypeFilter)}
            onValueChange={selectTypeFilter}
          >
            <Select.Trigger
              class="h-8 max-w-32 border-transparent bg-muted/45 px-2 text-xs hover:bg-muted/70 {vault.secretTypeFilter !==
              NookSecretTypeFilter.All
                ? 'border-primary/40 bg-primary/10 text-foreground'
                : 'text-muted-foreground'}"
              data-testid="secret-type-filter"
              aria-label={vault.t('vault.filter_by_type')}
              title={vault.t('vault.filter_by_type')}
            >
              <ListFilter class="size-3.5" />
              <span class="truncate">{activeTypeFilterLabel}</span>
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="all" data-testid="secret-type-filter-all">
                {vault.t('vault.filter_all_types')}
              </Select.Item>
              {#each typeFilters as filter (filter.filter)}
                <Select.Item
                  value={String(filter.filter)}
                  data-testid={`secret-type-filter-${filter.testId}`}
                >
                  {vault.t(filter.labelKey)}
                </Select.Item>
              {/each}
            </Select.Content>
          </Select.Root>
        </div>
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
              (group.items[0].type === SecretType.SecureNote ||
                group.items[0].type === SecretType.FileAttachment ||
                group.items[0].type === SecretType.Login ||
                group.items[0].type === SecretType.CreditCard)}
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
                    reveal={secretReveal(item.id)}
                    authenticatorCode={authenticatorCodePresentation(item.id)}
                    copiedNotice={copiedKey}
                    onToggleExpand={toggleExpand}
                    onToggleReveal={toggleReveal}
                    onEditItem={openEditItem}
                    {editRestriction}
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
