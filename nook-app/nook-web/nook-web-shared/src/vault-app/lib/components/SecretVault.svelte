<script lang="ts">
  import { type SecretOperationResult } from '$lib/vault/secret-operation-failure'
  import type { SecretMutationOutcome } from '$lib/vault/secrets'
  import { err, ok } from 'neverthrow'
  import {
    VaultStorageFailure,
    VaultStorageFailureKind,
  } from '$lib/runtime/storage-failure'
  import {
    VaultOperationStale,
    VaultOperationStaleKind,
  } from '$lib/runtime/vault-operation-stale'
  import { Match } from 'effect'
  import type { SecretPageRefreshSnapshot } from '$lib/vault/action-contexts'
  type SecretFieldCopy = {
    readonly text: string
    readonly id: string
    readonly field: string
  }

  type SecretCreationSubmission = {
    readonly id: string
    readonly type: SecretType
    readonly data: string
  }

  type SecretReplacementSubmission = {
    readonly oldId: string
    readonly type: SecretType
    readonly data: string
  }

  type SecretAddModeChange = {
    readonly open: boolean
    readonly selection: SecretTypeSelection
  }

  type SecretListItemComparison = readonly [
    left: NookSecretListItem,
    right: NookSecretListItem,
  ]

  type SecretGroup = {
    readonly site: string
    readonly items: NookSecretListItem[]
  }

  type VaultListEntry = {
    readonly item: NookSecretListItem
    readonly row: number
    readonly first: boolean
  }

  type VaultListGroup = {
    readonly site: string
    readonly heading: boolean
    readonly headRow: number
    readonly entries: readonly VaultListEntry[]
  }

  type VaultListLayout = {
    readonly groups: readonly VaultListGroup[]
    readonly rows: number
  }

  type SecretGroupComparison = readonly [left: SecretGroup, right: SecretGroup]

  import { I18N_KEYS } from '../../../generated/i18n-keys'
  import {
    NookSecretTypeFilter,
    SecretCategory,
    VaultEditDecision,
  } from '$app-wasm'

  import {
    ArrowLeft,
    SearchX,
    TriangleAlert,
    Vault,
    MousePointerClick,
  } from '@lucide/svelte'
  import type { VaultEditRestriction, VaultState } from '$lib/vault.svelte'
  import AddSecretForm from './AddSecretForm.svelte'
  import SecretDetailRow from './SecretDetailRow.svelte'
  import VaultListPagination from './vault/VaultListPagination.svelte'
  import VaultListToolbar from './vault/VaultListToolbar.svelte'
  import { VaultSections } from '$lib/vault/secret-sections'
  import type {
    AuthenticatorCodeView,
    NookSecretListItem,
    PasswordGenerationOptions,
  } from '$lib/nook'
  import { SecretType } from '$lib/nook'
  import {
    type DecryptedSecrets,
    SecretExposure,
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
    SecretPageInteractionKind,
    SecretSelectionKind,
    type SecretSelection,
    type AuthenticatorCodePresentation,
    type ClipboardNotice,
    type SecretEditor,
    type SecretReveal,
  } from './secret-vault-state'
  import { PasskeyDetailSelection } from './passkey-detail-selection.svelte'

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
    onAddSecret: (
      args: SecretCreationSubmission,
    ) => Promise<SecretOperationResult<SecretMutationOutcome.Added>>
    onReplaceSecret: (
      args: SecretReplacementSubmission,
    ) => Promise<SecretOperationResult<SecretMutationOutcome.Replaced>>
    onDeleteSecret: (
      id: string,
    ) => Promise<SecretOperationResult<SecretMutationOutcome.Deleted>>
    onGeneratePassword: (options: PasswordGenerationOptions) => string
    onAddModeChange?: (args: SecretAddModeChange) => void
  } = $props()

  const editsBlocked = $derived(
    editRestriction.decision !== VaultEditDecision.Allowed,
  )
  let searchPattern = $derived(vault.secretQuery)
  let pageInteraction = $state(SecretPageInteractionKind.Ready)
  let searchLoadSequence = 0
  type SecretSearchCompletion = {
    readonly sequence: number
    readonly result: Awaited<ReturnType<VaultState['loadSecretPage']>>
  }
  type SecretStalePagePattern = {
    readonly kind: Match.SafeRefinement<
      | VaultOperationStaleKind.RequestSuperseded
      | VaultOperationStaleKind.ContextReplaced
      | VaultOperationStaleKind.OwnerReleased
    >
  }
  type SecretCommittedPagePattern = {
    readonly query: typeof Match.string
  }
  let decryptedSecrets = $state<DecryptedSecrets>({})
  const initialDecryptedSecrets: DecryptedSecrets = {}
  let secretExposure = new SecretExposure(initialDecryptedSecrets)
  let selection = $state<SecretSelection>({ kind: SecretSelectionKind.None })
  let copiedKey = $state<ClipboardNotice>({ kind: ClipboardNoticeKind.Hidden })
  let addSecretOpen = $state(false)
  let formSelectedType = $state<SecretTypeSelection>({
    kind: SecretTypeSelectionKind.ChoosingType,
  })
  let editingItem = $state<SecretEditor>({ kind: SecretEditorKind.Creating })
  let editLoadSequence = 0
  let authenticatorCodes = $state<Record<string, AuthenticatorCodeView>>({})
  const passkeySelection = new PasskeyDetailSelection(() => vault)

  class SecretVaultOrdering {
    static byType(...[left, right]: SecretListItemComparison): number {
      return left.type - right.type
    }

    static bySite(...[left, right]: SecretGroupComparison): number {
      return left.site.localeCompare(right.site)
    }
  }

  const filteredItems = $derived(secrets)

  const visibleItemCount = $derived(secrets.length)
  const sectionDefinition = $derived(
    VaultSections.definition(vault.secretSection),
  )

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
        items: items.sort(SecretVaultOrdering.byType),
      }))
      .sort(SecretVaultOrdering.bySite)
  })

  const listLayout = $derived.by((): VaultListLayout => {
    let row = 1
    const laidOut: VaultListGroup[] = []
    for (const group of groups) {
      const heading = group.items.length > 1
      const headRow = row
      if (heading) row += 1
      const entries = group.items.map((item) => {
        const entry: VaultListEntry = { item, row, first: row === 1 }
        row += 1
        return entry
      })
      const laidOutGroup: VaultListGroup = {
        site: group.site,
        heading,
        headRow,
        entries,
      }
      laidOut.push(laidOutGroup)
    }
    return { groups: laidOut, rows: Math.max(1, row - 1) }
  })

  const filtersNarrowed = $derived(
    vault.secretQuery.trim() !== '' ||
      vault.secretTypeFilter !== sectionDefinition.allFilter,
  )

  function isSelected(id: string): boolean {
    return (
      selection.kind === SecretSelectionKind.Selected && selection.id === id
    )
  }

  function notifyAddMode() {
    const onAddModeChangeArgs: Parameters<
      NonNullable<typeof onAddModeChange>
    >[0] = {
      open: addSecretOpen,
      selection: formSelectedType,
    }
    onAddModeChange?.(onAddModeChangeArgs)
  }

  function reloadFirstPage(): void {
    const pageRequest: Parameters<typeof vault.loadSecretPage>[0] = {
      query: searchPattern.trim(),
      requestedOffset: 0,
    }
    loadInteractionPage(pageRequest)
  }

  function selectTypeFilter(filter: NookSecretTypeFilter): void {
    vault.secretTypeFilter = filter
    reloadFirstPage()
  }

  function selectSection(section: SecretCategory): void {
    vault.selectSecretSection(section)
    reloadFirstPage()
  }

  function resetTransientSecretViews() {
    secretExposure.free()
    const clearedSecrets: DecryptedSecrets = {}
    secretExposure = new SecretExposure(clearedSecrets)
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
    const decrypted = await vault.decryptSecret(item.id)
    if (decrypted.isErr()) {
      if (sequence === editLoadSequence)
        vault.errorMsg = vault.t(decrypted.error.translationKey)
      return
    }
    const record = decrypted.value
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

  function settleSearchPage({
    sequence,
    result,
  }: SecretSearchCompletion): void {
    switch (sequence) {
      case searchLoadSequence:
        break
      default:
        return
    }
    result.match(settleCommittedSearchPage, (failure) => {
      pageInteraction = SecretPageInteractionKind.Failed
      vault.errorMsg = vault.t(failure.translationKey)
    })
  }

  function settleCommittedSearchPage(
    snapshot: SecretPageRefreshSnapshot | VaultOperationStale,
  ): void {
    const stalePattern: SecretStalePagePattern = {
      kind: Match.is(
        VaultOperationStaleKind.RequestSuperseded,
        VaultOperationStaleKind.ContextReplaced,
        VaultOperationStaleKind.OwnerReleased,
      ),
    }
    const committedPattern: SecretCommittedPagePattern = {
      query: Match.string,
    }
    Match.value(snapshot).pipe(
      Match.when(stalePattern, () => {
        return
      }),
      Match.when(committedPattern, () => {
        pageInteraction = SecretPageInteractionKind.Ready
      }),
      Match.exhaustive,
    )
  }

  function loadInteractionPage(
    request: Parameters<typeof vault.loadSecretPage>[0],
  ): void {
    const sequence = ++searchLoadSequence
    pageInteraction = SecretPageInteractionKind.Loading
    void vault.loadSecretPage(request).then((result) => {
      const completion: SecretSearchCompletion = { sequence, result }
      settleSearchPage(completion)
    })
  }

  $effect(() => {
    const query = searchPattern.trim()
    switch (query) {
      case untrack(() => vault.secretQuery):
        switch (untrack(() => pageInteraction)) {
          case SecretPageInteractionKind.Ready:
          case SecretPageInteractionKind.Loading:
            return
          case SecretPageInteractionKind.Debouncing:
          case SecretPageInteractionKind.Failed:
            break
        }
    }
    const sequence = ++searchLoadSequence
    pageInteraction = SecretPageInteractionKind.Debouncing
    const timer = setTimeout(() => {
      switch (sequence) {
        case searchLoadSequence:
          break
        default:
          return
      }
      const pageRequest: Parameters<typeof vault.loadSecretPage>[0] = {
        query,
        requestedOffset: 0,
      }
      loadInteractionPage(pageRequest)
    }, 200)
    return () => clearTimeout(timer)
  })

  const isSecureNoteEditor = $derived(
    addSecretOpen &&
      formSelectedType.kind === SecretTypeSelectionKind.EditingFields &&
      formSelectedType.itemType === SecretType.SecureNote,
  )

  async function copyToClipboard({ text, id, field }: SecretFieldCopy) {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      return err(
        new VaultStorageFailure(VaultStorageFailureKind.OperationFailed),
      )
    }
    const notice: ClipboardNotice = {
      kind: ClipboardNoticeKind.Visible,
      fieldKey: `${id}-${field}`,
    }
    return ok(notice)
  }

  async function copySecretField(request: SecretFieldCopy): Promise<void> {
    const copied = await copyToClipboard(request)
    if (copied.isErr()) {
      vault.errorMsg = vault.t(copied.error.translationKey)
      return
    }
    const notice = copied.value
    copiedKey = notice
    setTimeout(() => {
      if (
        copiedKey.kind === ClipboardNoticeKind.Visible &&
        copiedKey.fieldKey === notice.fieldKey
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
    const toggleSecretExposureArgs: Parameters<SecretExposure['toggle']>[0] = {
      id,
      load: (secretId) => vault.decryptSecret(secretId),
    }
    const toggled = await secretExposure.toggle(toggleSecretExposureArgs)
    if (toggled.isErr()) {
      vault.errorMsg = vault.t(toggled.error.translationKey)
      return
    }
    if (toggled.value instanceof VaultOperationStale) return
    decryptedSecrets = toggled.value
    if (revealing) {
      selection = { kind: SecretSelectionKind.Selected, id }
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
    const revealed = decryptedSecrets[id]
    if (revealed) {
      const copyRequest: Parameters<typeof copyToClipboard>[0] = {
        text: revealed.primaryCredential,
        id,
        field: 'secret',
      }
      const copied = await copyToClipboard(copyRequest)
      if (copied.isErr()) vault.errorMsg = vault.t(copied.error.translationKey)
      return
    }
    const exposureRequest: Parameters<
      SecretExposure['withTransientRecord']
    >[0] = {
      id,
      load: (secretId) => vault.decryptSecret(secretId),
      action: (record) =>
        (() => {
          const copyToClipboardArgs: Parameters<typeof copyToClipboard>[0] = {
            text: record.primaryCredential,
            id,
            field: 'secret',
          }
          return copyToClipboard(copyToClipboardArgs)
        })(),
    }
    const copied = await secretExposure.withTransientRecord(exposureRequest)
    if (copied.isErr()) vault.errorMsg = vault.t(copied.error.translationKey)
  }

  async function refreshAuthenticatorCode(id: string) {
    const code = await vault.currentAuthenticatorCode(id)
    if (code.isErr()) {
      vault.errorMsg = vault.t(code.error.translationKey)
      return
    }
    if (!(id in decryptedSecrets)) return
    authenticatorCodes = { ...authenticatorCodes, [id]: code.value }
  }

  /** Select an item for the detail sheet; selecting it again closes it. */
  function toggleExpand(id: string) {
    const previous = selection
    selection = isSelected(id)
      ? { kind: SecretSelectionKind.None }
      : { kind: SecretSelectionKind.Selected, id }
    if (
      selection.kind === SecretSelectionKind.Selected &&
      filteredItems.find((item) => item.id === id)?.type === SecretType.Passkey
    ) {
      passkeySelection.select(id)
    } else {
      passkeySelection.clear()
    }
    if (
      previous.kind === SecretSelectionKind.Selected &&
      previous.id in decryptedSecrets
    ) {
      void toggleReveal(previous.id)
    }
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
    // These reads intentionally make the reset reactive to page changes.
    void vault.secretQuery
    void vault.secretPageOffset
    void vault.secretTypeFilter
    resetTransientSecretViews()
  })

  onDestroy(() => {
    editLoadSequence += 1
    releaseEditingItem()
    secretExposure.free()
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
            {vault.t(I18N_KEYS.CommonBack)}
          </button>
        </div>
      {/if}

      <AddSecretForm
        {vault}
        {isSaving}
        section={vault.secretSection}
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
      <VaultListToolbar
        {vault}
        definition={sectionDefinition}
        {editRestriction}
        {visibleItemCount}
        bind:searchPattern
        onSelectSection={selectSection}
        onSelectTypeFilter={selectTypeFilter}
        onAdd={openAddSecret}
      />

      {#if editRestriction.decision !== VaultEditDecision.Allowed}
        <div
          class="nk-banner nk-banner-warning flex items-start gap-2 p-3 text-sm text-foreground"
          data-testid="secret-edit-blocked-banner"
        >
          <TriangleAlert class="mt-0.5 size-4 shrink-0 text-warning" />
          <p class="text-pretty text-xs text-muted-foreground">
            {editRestriction.reason}
          </p>
        </div>
      {/if}

      {#if filteredItems.length === 0}
        <div
          class="nk-empty flex-1 content-center"
          data-testid="vault-empty-search"
        >
          <span class="nk-tile nk-tile-lg">
            {#if filtersNarrowed}<SearchX class="size-5" />{:else}<Vault
                class="size-5"
              />{/if}
          </span>
          <strong>
            {filtersNarrowed
              ? vault.t(sectionDefinition.copy.noMatchTitleKey)
              : vault.t(sectionDefinition.copy.emptyTitleKey)}
          </strong>
          <span class="max-w-sm text-sm">
            {filtersNarrowed
              ? vault.t(I18N_KEYS.VaultDetailNoMatchBody)
              : vault.t(sectionDefinition.copy.emptyBodyKey)}
          </span>
        </div>
      {:else}
        <div
          class="nk-vault-grid"
          style:--nk-vault-rows={String(listLayout.rows)}
          aria-label={vault.t(sectionDefinition.copy.listKey)}
          data-testid="vault-secret-list"
        >
          {#each listLayout.groups as group (group.site)}
            <div class="contents" data-testid="vault-site-group">
              {#if group.heading}
                <div
                  class="nk-vault-group-head"
                  style:grid-row={String(group.headRow)}
                  data-edge={group.headRow === 1 ? 'first' : 'inner'}
                >
                  <span class="truncate">{group.site}</span>
                  <span class="nk-tag">{group.entries.length}</span>
                </div>
              {/if}
              {#each group.entries as entry (entry.item.id)}
                <SecretDetailRow
                  item={entry.item}
                  row={entry.row}
                  first={entry.first}
                  {pageInteraction}
                  expanded={isSelected(entry.item.id)}
                  reveal={secretReveal(entry.item.id)}
                  authenticatorCode={authenticatorCodePresentation(
                    entry.item.id,
                  )}
                  passkeyDetails={passkeySelection.detailsFor(entry.item.id)}
                  secretHistory={passkeySelection.historyFor(entry.item.id)}
                  copiedNotice={copiedKey}
                  onToggleExpand={toggleExpand}
                  onToggleReveal={toggleReveal}
                  onEditItem={openEditItem}
                  {editRestriction}
                  {onDeleteSecret}
                  onCopyToClipboard={copySecretField}
                  onCopySecret={copySecret}
                  {vault}
                />
              {/each}
            </div>
          {/each}
          {#if !filteredItems.some((item) => isSelected(item.id))}
            <div
              class="nk-frame-sheet nk-secret-detail-pane nk-secret-detail-idle nk-empty"
              data-testid="secret-detail-idle"
            >
              <span class="nk-tile nk-tile-lg"
                ><MousePointerClick class="size-5" /></span
              >
              <strong>{vault.t(I18N_KEYS.VaultDetailPickTitle)}</strong>
              <span class="max-w-xs text-sm"
                >{vault.t(I18N_KEYS.VaultDetailPickBody)}</span
              >
            </div>
          {/if}
        </div>
        {#if vault.secretTotal > vault.secretPageSize}
          <VaultListPagination {vault} />
        {/if}
      {/if}
    </div>
  {/if}
</div>
