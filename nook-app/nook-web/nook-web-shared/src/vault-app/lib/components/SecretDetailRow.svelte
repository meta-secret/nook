<script lang="ts">
  import { I18N_KEYS } from '../../../generated/i18n-keys'
  import {
    Globe,
    Braces,
    Sprout,
    StickyNote,
    ShieldCheck,
    KeyRound,
    CreditCard,
    Paperclip,
    Download,
    Eye,
    EyeOff,
    Pencil,
    Trash2,
    Copy,
    Check,
    ChevronDown,
  } from '@lucide/svelte'
  import type { NookSecretListItem } from '$lib/nook'
  import { SecretType } from '$lib/nook'
  import { VaultEditDecision } from '$app-wasm'
  import type { VaultEditRestriction, VaultState } from '$lib/vault.svelte'
  import AuthenticatorSecretDetail from './AuthenticatorSecretDetail.svelte'
  import MarkdownContent from './MarkdownContent.svelte'
  import SeedPhraseGrid from './SeedPhraseGrid.svelte'
  import {
    AuthenticatorCodePresentationKind,
    ClipboardNoticeKind,
    SecretRevealKind,
    type AuthenticatorCodePresentation,
    type ClipboardNotice,
    type SecretReveal,
  } from './secret-vault-state'

  let {
    item,
    index,
    expanded,
    reveal = { kind: SecretRevealKind.Hidden },
    authenticatorCode = { kind: AuthenticatorCodePresentationKind.Hidden },
    copiedNotice = { kind: ClipboardNoticeKind.Hidden },
    onToggleExpand,
    onToggleReveal,
    onEditItem,
    onDeleteSecret,
    onCopyToClipboard,
    onCopySecret,
    vault,
    editRestriction = { decision: VaultEditDecision.Allowed },
    titleAsHeader = false,
  }: {
    item: NookSecretListItem
    index: number
    expanded: boolean
    reveal?: SecretReveal
    authenticatorCode?: AuthenticatorCodePresentation
    copiedNotice?: ClipboardNotice
    onToggleExpand: (id: string) => void
    onToggleReveal: (id: string) => Promise<void>
    onEditItem: (item: NookSecretListItem) => Promise<void>
    onDeleteSecret: (id: string) => Promise<void>
    onCopyToClipboard: (
      args: { readonly text: string; readonly id: string; readonly field: string },
    ) => Promise<void>
    onCopySecret: (id: string) => Promise<void>
    vault: VaultState
    editRestriction?: VaultEditRestriction
    /** Use the title row as the card header (no duplicate group header). */
    titleAsHeader?: boolean
  } = $props()

  function isCopied(fieldKey: string): boolean {
    return (
      copiedNotice.kind === ClipboardNoticeKind.Visible &&
      copiedNotice.fieldKey === fieldKey
    )
  }

  const summary = $derived.by(() => {
    if (item.type === SecretType.Login) {
      return (
        item.username.trim() ||
        item.websiteUrl.trim() ||
        vault.t(I18N_KEYS.VaultTypesLogin)
      )
    }
    if (item.type === SecretType.ApiKey) {
      return item.websiteUrl.trim() || vault.t(I18N_KEYS.VaultTypesApiKey)
    }
    if (item.type === SecretType.SeedPhrase) {
      const name = item.name.trim()
      const words = item.seedWordCount
      const label = name || vault.t(I18N_KEYS.VaultFieldsUnnamedSeedPhrase)
      if (words === 12 || words === 24) {
        const tArgs: Parameters<typeof vault.t>[0] = { key: I18N_KEYS.VaultFieldsWordsCount, replacements: { count: String(words) } };
        return `${label} · ${vault.t(tArgs)}`
      }
      return label
    }
    if (item.type === SecretType.Authenticator) {
      return item.account.trim() || item.issuer.trim()
    }
    if (item.type === SecretType.Passkey) {
      return (
        item.passkeyUserDisplayName.trim() ||
        item.passkeyUserName.trim() ||
        item.rpId.trim() ||
        vault.t(I18N_KEYS.VaultTypesPasskey)
      )
    }
    if (item.type === SecretType.CreditCard) {
      const last4 = item.last4.trim()
      if (last4) return `•••• ${last4}`
      return item.title.trim() || vault.t(I18N_KEYS.VaultFieldsUnnamedCard)
    }
    if (item.type === SecretType.FileAttachment) {
      return (
        item.fileName.trim() ||
        item.title.trim() ||
        vault.t(I18N_KEYS.VaultFieldsNoTitle)
      )
    }
    return item.title.trim() || vault.t(I18N_KEYS.VaultFieldsNoTitle)
  })

  const headerTitle = $derived.by(() => {
    if (item.type === SecretType.Login) {
      return item.websiteHost || vault.t(I18N_KEYS.VaultFieldsNoWebsite)
    }
    if (item.type === SecretType.CreditCard) {
      return (
        item.title.trim() || summary || vault.t(I18N_KEYS.VaultFieldsUnnamedCard)
      )
    }
    if (item.type === SecretType.FileAttachment) {
      return (
        item.title.trim() ||
        item.fileName.trim() ||
        vault.t(I18N_KEYS.VaultFieldsNoTitle)
      )
    }
    return summary
  })

  const accountSubtitle = $derived(
    item.type === SecretType.Login
      ? item.username.trim()
      : item.type === SecretType.CreditCard &&
          item.title.trim() &&
          item.last4.trim()
        ? `•••• ${item.last4.trim()}`
        : '',
  )

  const cardExpiration = $derived.by(() => {
    const month =
      reveal.kind === SecretRevealKind.Revealed
        ? reveal.record.expirationMonth.trim()
        : item.expirationMonth.trim()
    const year =
      reveal.kind === SecretRevealKind.Revealed
        ? reveal.record.expirationYear.trim()
        : item.expirationYear.trim()
    if (!month && !year) return ''
    if (month && year) return `${month.padStart(2, '0')}/${year}`
    return month || year
  })

  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  function downloadFileAttachment() {
    if (
      reveal.kind !== SecretRevealKind.Revealed ||
      item.type !== SecretType.FileAttachment
    ) {
      return
    }
    const binary = atob(reveal.record.contentBase64)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }
    const BlobArgs: ConstructorParameters<typeof Blob>[1] = {
      type: reveal.record.mimeType || 'application/octet-stream',
    };
    const blob = new Blob([bytes], BlobArgs)
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = reveal.record.fileName || item.fileName || 'secret-file'
    link.click()
    URL.revokeObjectURL(url)
  }
</script>

<div data-testid="vault-group-{item.typeName}">
  <div
    class="first:pt-0"
    class:pt-3={!titleAsHeader}
    class:border-t={index > 0 && !titleAsHeader}
    role="listitem"
    data-testid="secret-row"
  >
    <div
      class="flex items-center justify-between gap-2 {titleAsHeader
        ? 'border-b border-border/30 bg-muted/10 px-3 py-2.5 sm:border-border/50'
        : 'pb-1'}"
    >
      <button
        type="button"
        class="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left transition-colors {titleAsHeader
          ? 'py-0 hover:opacity-90'
          : 'py-1 hover:bg-accent/40'}"
        aria-expanded={expanded}
        aria-label={expanded
          ? vault.t(I18N_KEYS.VaultCollapseSecret)
          : vault.t(I18N_KEYS.VaultExpandSecret)}
        data-testid="secret-row-toggle"
        onclick={() => onToggleExpand(item.id)}
      >
        <ChevronDown
          class="size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 {expanded
            ? 'rotate-180'
            : ''}"
        />
        {#if titleAsHeader}
          <div
            class="flex size-6 shrink-0 items-center justify-center rounded-md border border-border/35 bg-muted/35 text-muted-foreground sm:border-border/60"
          >
            {#if item.type === SecretType.Login}
              <Globe class="size-3.5" />
            {:else if item.type === SecretType.Authenticator}
              <ShieldCheck class="size-3.5" />
            {:else if item.type === SecretType.Passkey}
              <KeyRound class="size-3.5" />
            {:else if item.type === SecretType.CreditCard}
              <CreditCard class="size-3.5" />
            {:else if item.type === SecretType.FileAttachment}
              <Paperclip class="size-3.5" />
            {:else}
              <StickyNote class="size-3.5" />
            {/if}
          </div>
          <div class="min-w-0 flex-1">
            <h3
              data-testid="secret-row-heading"
              class="truncate text-sm font-semibold tracking-wide text-foreground"
            >
              {headerTitle}
            </h3>
            {#if accountSubtitle}
              <span
                data-testid="secret-row-account"
                class="block truncate text-xs text-muted-foreground"
                >{accountSubtitle}</span
              >
            {/if}
          </div>
        {:else}
          <span
            class="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80"
          >
            {#if item.type === SecretType.Login}
              <Globe class="size-3 text-primary/70" />
              {vault.t(I18N_KEYS.VaultTypesLogin)}
            {:else if item.type === SecretType.ApiKey}
              <Braces class="size-3 text-primary/70" />
              {vault.t(I18N_KEYS.VaultTypesApiKey)}
            {:else if item.type === SecretType.SeedPhrase}
              <Sprout class="size-3 text-primary/70" />
              {vault.t(I18N_KEYS.VaultTypesSeedPhrase)}
            {:else if item.type === SecretType.Authenticator}
              <ShieldCheck class="size-3 text-primary/70" />
              {vault.t(I18N_KEYS.VaultTypesAuthenticator)}
            {:else if item.type === SecretType.Passkey}
              <KeyRound class="size-3 text-primary/70" />
              {vault.t(I18N_KEYS.VaultTypesPasskey)}
            {:else if item.type === SecretType.CreditCard}
              <CreditCard class="size-3 text-primary/70" />
              {vault.t(I18N_KEYS.VaultTypesCreditCard)}
            {:else if item.type === SecretType.FileAttachment}
              <Paperclip class="size-3 text-primary/70" />
              {vault.t(I18N_KEYS.VaultTypesFileAttachment)}
            {:else}
              <StickyNote class="size-3 text-primary/70" />
              {vault.t(I18N_KEYS.VaultTypesSecureNote)}
            {/if}
          </span>
          {#if !expanded}
            <span class="truncate text-xs text-muted-foreground">{summary}</span
            >
          {/if}
        {/if}
      </button>
      <div
        class="flex shrink-0 items-center gap-0.5 {titleAsHeader ? 'pr-1' : ''}"
      >
        {#if item.type !== SecretType.Passkey}
          <button
            type="button"
            onclick={() => void onToggleReveal(item.id)}
            aria-label={reveal.kind === SecretRevealKind.Revealed
              ? vault.t(I18N_KEYS.VaultHideValue)
              : vault.t(I18N_KEYS.VaultShowValue)}
            aria-pressed={reveal.kind === SecretRevealKind.Revealed}
            data-testid="reveal-secret-btn"
            class="rounded-md p-1.5 text-muted-foreground/80 hover:bg-accent hover:text-foreground transition-colors"
          >
            {#if reveal.kind === SecretRevealKind.Revealed}<EyeOff
                class="size-3.5"
              />{:else}<Eye class="size-3.5" />{/if}
          </button>
          <button
            type="button"
            onclick={() => void onEditItem(item)}
            aria-label={vault.t(I18N_KEYS.CommonEdit)}
            data-testid="edit-secret-btn"
            disabled={editRestriction.decision !== VaultEditDecision.Allowed}
            {...editRestriction.decision !== VaultEditDecision.Allowed
              ? { title: editRestriction.reason }
              : {}}
            class="rounded-md p-1.5 text-muted-foreground/80 hover:bg-accent hover:text-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
          >
            <Pencil class="size-3.5" />
          </button>
        {/if}
        <button
          type="button"
          onclick={() => void onDeleteSecret(item.id)}
          aria-label={vault.t(I18N_KEYS.CommonDelete)}
          data-testid="delete-secret-btn"
          class="rounded-md p-1.5 text-muted-foreground/80 hover:bg-destructive/10 hover:text-destructive transition-colors"
        >
          <Trash2 class="size-3.5" />
        </button>
      </div>
    </div>

    <!-- Item Structured Details -->
    {#if expanded}
      <div class="space-y-1.5 {titleAsHeader ? 'px-3 py-3' : ''}">
        {#if item.type === SecretType.Login}
          <div class="grid grid-cols-[85px_1fr] items-center gap-2 text-xs">
            <span class="text-muted-foreground/70 font-medium"
              >{vault.t(I18N_KEYS.VaultFieldsWebsiteLabel)}</span
            >
            <div
              class="flex items-center justify-between gap-2 min-w-0 bg-muted/20 hover:bg-muted/40 rounded-md px-2 py-1 transition-colors border border-border/20"
            >
              <span class="truncate text-foreground"
                >{item.websiteUrl || vault.t(I18N_KEYS.VaultFieldsNoWebsite)}</span
              >
              {#if item.websiteUrl}
                <button
                  type="button"
                  onclick={() =>
                    void (() => { const onCopyToClipboardArgs: Parameters<typeof onCopyToClipboard>[0] = { text: item.websiteUrl, id: item.id, field: 'website' }; return onCopyToClipboard(onCopyToClipboardArgs); })()}
                  aria-label={vault.t(I18N_KEYS.VaultCopyWebsiteUrl)}
                  class="text-muted-foreground hover:text-foreground p-0.5 rounded-sm transition-colors"
                >
                  {#if isCopied(`${item.id}-website`)}<Check
                      class="size-3 text-emerald-500"
                    />{:else}<Copy class="size-3" />{/if}
                </button>
              {/if}
            </div>
          </div>

          <div class="grid grid-cols-[85px_1fr] items-center gap-2 text-xs">
            <span class="text-muted-foreground/70 font-medium"
              >{vault.t(I18N_KEYS.VaultFieldsUsername)}</span
            >
            <div
              class="flex items-center justify-between gap-2 min-w-0 bg-muted/20 hover:bg-muted/40 rounded-md px-2 py-1 transition-colors border border-border/20"
            >
              <span class="truncate text-foreground"
                >{item.username || vault.t(I18N_KEYS.VaultFieldsNoUsername)}</span
              >
              {#if item.username}
                <button
                  type="button"
                  onclick={() =>
                    void (() => { const onCopyToClipboardArgs2: Parameters<typeof onCopyToClipboard>[0] = { text: item.username, id: item.id, field: 'username' }; return onCopyToClipboard(onCopyToClipboardArgs2); })()}
                  aria-label={vault.t(I18N_KEYS.VaultCopyUsername)}
                  class="text-muted-foreground hover:text-foreground p-0.5 rounded-sm transition-colors"
                >
                  {#if isCopied(`${item.id}-username`)}<Check
                      class="size-3 text-emerald-500"
                    />{:else}<Copy class="size-3" />{/if}
                </button>
              {/if}
            </div>
          </div>

          <div class="grid grid-cols-[85px_1fr] items-center gap-2 text-xs">
            <span class="text-muted-foreground/70 font-medium"
              >{vault.t(I18N_KEYS.VaultFieldsPassword)}</span
            >
            <div
              class="flex items-center justify-between gap-2 min-w-0 bg-muted/20 hover:bg-muted/40 rounded-md px-2 py-1 transition-colors border border-border/20"
            >
              <code
                class="truncate font-mono text-foreground"
                data-testid="revealed-secret"
              >
                {reveal.kind === SecretRevealKind.Revealed
                  ? reveal.record.password
                  : '••••••••••••••••'}
              </code>
              <button
                type="button"
                onclick={() => void onCopySecret(item.id)}
                aria-label={vault.t(I18N_KEYS.VaultCopySecret)}
                class="text-muted-foreground hover:text-foreground p-0.5 rounded-sm transition-colors shrink-0"
              >
                {#if isCopied(`${item.id}-secret`)}<Check
                    class="size-3 text-emerald-500"
                  />{:else}<Copy class="size-3" />{/if}
              </button>
            </div>
          </div>

          {#if reveal.kind === SecretRevealKind.Revealed && reveal.record.notes}
            <div class="grid grid-cols-[85px_1fr] items-start gap-2 text-xs">
              <span class="text-muted-foreground/70 font-medium pt-1"
                >{vault.t(I18N_KEYS.VaultFieldsNotes)}</span
              >
              <div
                class="text-muted-foreground whitespace-pre-wrap font-sans bg-muted/10 rounded-md px-2.5 py-1.5 text-[11px] leading-relaxed border border-border/20"
              >
                {reveal.record.notes}
              </div>
            </div>
          {/if}
        {:else if item.type === SecretType.ApiKey}
          <div class="grid grid-cols-[85px_1fr] items-center gap-2 text-xs">
            <span class="text-muted-foreground/70 font-medium"
              >{vault.t(I18N_KEYS.VaultFieldsWebsiteLabel)}</span
            >
            <div
              class="flex items-center justify-between gap-2 min-w-0 bg-muted/20 hover:bg-muted/40 rounded-md px-2 py-1 transition-colors border border-border/20"
            >
              <span class="truncate text-foreground"
                >{item.websiteUrl || vault.t(I18N_KEYS.VaultFieldsNoWebsite)}</span
              >
              {#if item.websiteUrl}
                <button
                  type="button"
                  onclick={() =>
                    void (() => { const onCopyToClipboardArgs3: Parameters<typeof onCopyToClipboard>[0] = { text: item.websiteUrl, id: item.id, field: 'website' }; return onCopyToClipboard(onCopyToClipboardArgs3); })()}
                  aria-label={vault.t(I18N_KEYS.VaultCopyWebsiteUrl)}
                  class="text-muted-foreground hover:text-foreground p-0.5 rounded-sm transition-colors"
                >
                  {#if isCopied(`${item.id}-website`)}<Check
                      class="size-3 text-emerald-500"
                    />{:else}<Copy class="size-3" />{/if}
                </button>
              {/if}
            </div>
          </div>

          <div class="grid grid-cols-[85px_1fr] items-center gap-2 text-xs">
            <span class="text-muted-foreground/70 font-medium"
              >{vault.t(I18N_KEYS.VaultFieldsKey)}</span
            >
            <div
              class="flex items-center justify-between gap-2 min-w-0 bg-muted/20 hover:bg-muted/40 rounded-md px-2 py-1 transition-colors border border-border/20"
            >
              <code
                class="break-all font-mono text-foreground"
                data-testid="revealed-secret"
              >
                {reveal.kind === SecretRevealKind.Revealed
                  ? reveal.record.primaryCredential
                  : '••••••••••••••••'}
              </code>
              <button
                type="button"
                onclick={() => void onCopySecret(item.id)}
                aria-label={vault.t(I18N_KEYS.VaultCopySecret)}
                class="text-muted-foreground hover:text-foreground p-0.5 rounded-sm transition-colors shrink-0"
              >
                {#if isCopied(`${item.id}-secret`)}<Check
                    class="size-3 text-emerald-500"
                  />{:else}<Copy class="size-3" />{/if}
              </button>
            </div>
          </div>

          {#if item.expiresAt}
            <div class="grid grid-cols-[85px_1fr] items-center gap-2 text-xs">
              <span class="text-muted-foreground/70 font-medium"
                >{vault.t(I18N_KEYS.VaultFieldsExpiresAt)}</span
              >
              <div
                class="flex items-center justify-between gap-2 min-w-0 bg-muted/20 hover:bg-muted/40 rounded-md px-2 py-1 transition-colors border border-border/20"
              >
                <span class="truncate font-mono text-foreground"
                  >{item.expiresAt}</span
                >
                <button
                  type="button"
                  onclick={() =>
                    void (() => { const onCopyToClipboardArgs4: Parameters<typeof onCopyToClipboard>[0] = { text: item.expiresAt, id: item.id, field: 'expires' }; return onCopyToClipboard(onCopyToClipboardArgs4); })()}
                  aria-label={vault.t(I18N_KEYS.VaultCopyExpirationDate)}
                  class="text-muted-foreground hover:text-foreground p-0.5 rounded-sm transition-colors"
                >
                  {#if isCopied(`${item.id}-expires`)}<Check
                      class="size-3 text-emerald-500"
                    />{:else}<Copy class="size-3" />{/if}
                </button>
              </div>
            </div>
          {/if}
        {:else if item.type === SecretType.SeedPhrase}
          <div class="grid grid-cols-[85px_1fr] items-center gap-2 text-xs">
            <span class="text-muted-foreground/70 font-medium"
              >{vault.t(I18N_KEYS.VaultFieldsAccount)}</span
            >
            <div
              class="flex items-center justify-between gap-2 min-w-0 bg-muted/20 hover:bg-muted/40 rounded-md px-2 py-1 transition-colors border border-border/20"
            >
              <span class="truncate text-foreground"
                >{item.name || vault.t(I18N_KEYS.VaultFieldsNoAccountName)}</span
              >
              {#if item.name}
                <button
                  type="button"
                  onclick={() =>
                    void (() => { const onCopyToClipboardArgs5: Parameters<typeof onCopyToClipboard>[0] = { text: item.name, id: item.id, field: 'name' }; return onCopyToClipboard(onCopyToClipboardArgs5); })()}
                  aria-label={vault.t(I18N_KEYS.VaultCopyAccountName)}
                  class="text-muted-foreground hover:text-foreground p-0.5 rounded-sm transition-colors"
                >
                  {#if isCopied(`${item.id}-name`)}<Check
                      class="size-3 text-emerald-500"
                    />{:else}<Copy class="size-3" />{/if}
                </button>
              {/if}
            </div>
          </div>

          <div class="space-y-2 text-xs">
            <div class="flex items-center justify-between gap-2">
              <span class="text-muted-foreground/70 font-medium"
                >{vault.t(I18N_KEYS.VaultTypesSeedPhrase)}</span
              >
              <button
                type="button"
                onclick={() => void onCopySecret(item.id)}
                aria-label={vault.t(I18N_KEYS.VaultCopySecret)}
                class="text-muted-foreground hover:text-foreground p-0.5 rounded-sm transition-colors shrink-0"
              >
                {#if isCopied(`${item.id}-secret`)}<Check
                    class="size-3 text-emerald-500"
                  />{:else}<Copy class="size-3" />{/if}
              </button>
            </div>
            <SeedPhraseGrid
              {vault}
              value={reveal.kind === SecretRevealKind.Revealed
                ? reveal.record.seed
                : ''}
              readonly
              revealed={reveal.kind === SecretRevealKind.Revealed}
            />
          </div>
        {:else if item.type === SecretType.Authenticator}
          <AuthenticatorSecretDetail
            {item}
            {reveal}
            {authenticatorCode}
            {isCopied}
            {onCopyToClipboard}
            {onCopySecret}
            {vault}
          />
        {:else if item.type === SecretType.Passkey}
          <div class="grid grid-cols-[85px_1fr] items-center gap-2 text-xs">
            <span class="text-muted-foreground/70 font-medium"
              >{vault.t(I18N_KEYS.VaultFieldsRelyingParty)}</span
            >
            <div
              class="min-w-0 rounded-md border border-border/20 bg-muted/20 px-2 py-1"
            >
              <span class="truncate text-foreground">{item.rpId}</span>
            </div>
          </div>
          <div class="grid grid-cols-[85px_1fr] items-center gap-2 text-xs">
            <span class="text-muted-foreground/70 font-medium"
              >{vault.t(I18N_KEYS.VaultFieldsAccount)}</span
            >
            <div
              class="min-w-0 rounded-md border border-border/20 bg-muted/20 px-2 py-1"
            >
              <span class="truncate text-foreground"
                >{item.passkeyUserDisplayName ||
                  item.passkeyUserName ||
                  vault.t(I18N_KEYS.CommonNone)}</span
              >
            </div>
          </div>
          {#if item.passkeyUserDisplayName && item.passkeyUserName}
            <div class="grid grid-cols-[85px_1fr] items-center gap-2 text-xs">
              <span class="text-muted-foreground/70 font-medium"
                >{vault.t(I18N_KEYS.VaultFieldsUsername)}</span
              >
              <div
                class="min-w-0 rounded-md border border-border/20 bg-muted/20 px-2 py-1"
              >
                <span class="truncate text-foreground"
                  >{item.passkeyUserName}</span
                >
              </div>
            </div>
          {/if}
          <p class="text-[11px] leading-relaxed text-muted-foreground">
            {vault.t(I18N_KEYS.VaultFieldsPasskeyManagedHint)}
          </p>
        {:else if item.type === SecretType.CreditCard}
          <div class="grid grid-cols-[85px_1fr] items-center gap-2 text-xs">
            <span class="text-muted-foreground/70 font-medium"
              >{vault.t(I18N_KEYS.VaultFieldsTitle)}</span
            >
            <div
              class="min-w-0 rounded-md border border-border/20 bg-muted/20 px-2 py-1"
            >
              <span class="truncate text-foreground"
                >{item.title.trim() ||
                  vault.t(I18N_KEYS.VaultFieldsUnnamedCard)}</span
              >
            </div>
          </div>

          <div class="grid grid-cols-[85px_1fr] items-center gap-2 text-xs">
            <span class="text-muted-foreground/70 font-medium"
              >{vault.t(I18N_KEYS.VaultFieldsCardholderName)}</span
            >
            <div
              class="flex items-center justify-between gap-2 min-w-0 bg-muted/20 hover:bg-muted/40 rounded-md px-2 py-1 transition-colors border border-border/20"
            >
              <span class="truncate text-foreground"
                >{item.cardholderName.trim() || vault.t(I18N_KEYS.CommonNone)}</span
              >
              {#if item.cardholderName.trim()}
                <button
                  type="button"
                  onclick={() =>
                    void (() => { const onCopyToClipboardArgs6: Parameters<typeof onCopyToClipboard>[0] = { text: item.cardholderName, id: item.id, field: 'cardholder' }; return onCopyToClipboard(
                      onCopyToClipboardArgs6,
                    ); })()}
                  aria-label={vault.t(I18N_KEYS.VaultCopyCardholderName)}
                  class="text-muted-foreground hover:text-foreground p-0.5 rounded-sm transition-colors"
                >
                  {#if isCopied(`${item.id}-cardholder`)}<Check
                      class="size-3 text-emerald-500"
                    />{:else}<Copy class="size-3" />{/if}
                </button>
              {/if}
            </div>
          </div>

          <div class="grid grid-cols-[85px_1fr] items-center gap-2 text-xs">
            <span class="text-muted-foreground/70 font-medium"
              >{vault.t(I18N_KEYS.VaultFieldsCardNumber)}</span
            >
            <div
              class="flex items-center justify-between gap-2 min-w-0 bg-muted/20 hover:bg-muted/40 rounded-md px-2 py-1 transition-colors border border-border/20"
            >
              <code
                class="truncate font-mono text-foreground"
                data-testid="credit-card-number-value"
              >
                {reveal.kind === SecretRevealKind.Revealed
                  ? reveal.record.cardNumber
                  : item.last4.trim()
                    ? `•••• ${item.last4}`
                    : '••••••••••••••••'}
              </code>
              {#if reveal.kind === SecretRevealKind.Revealed && reveal.record.cardNumber}
                <button
                  type="button"
                  onclick={() =>
                    void (() => { const onCopyToClipboardArgs7: Parameters<typeof onCopyToClipboard>[0] = { text: reveal.record.cardNumber, id: item.id, field: 'card-number' }; return onCopyToClipboard(
                      onCopyToClipboardArgs7,
                    ); })()}
                  aria-label={vault.t(I18N_KEYS.VaultCopyCardNumber)}
                  class="text-muted-foreground hover:text-foreground p-0.5 rounded-sm transition-colors shrink-0"
                >
                  {#if isCopied(`${item.id}-card-number`)}<Check
                      class="size-3 text-emerald-500"
                    />{:else}<Copy class="size-3" />{/if}
                </button>
              {/if}
            </div>
          </div>

          {#if cardExpiration}
            <div class="grid grid-cols-[85px_1fr] items-center gap-2 text-xs">
              <span class="text-muted-foreground/70 font-medium"
                >{vault.t(I18N_KEYS.VaultFieldsExpiration)}</span
              >
              <div
                class="flex items-center justify-between gap-2 min-w-0 bg-muted/20 hover:bg-muted/40 rounded-md px-2 py-1 transition-colors border border-border/20"
              >
                <span class="truncate font-mono text-foreground"
                  >{cardExpiration}</span
                >
                <button
                  type="button"
                  onclick={() =>
                    void (() => { const onCopyToClipboardArgs8: Parameters<typeof onCopyToClipboard>[0] = { text: cardExpiration, id: item.id, field: 'expiration' }; return onCopyToClipboard(
                      onCopyToClipboardArgs8,
                    ); })()}
                  aria-label={vault.t(I18N_KEYS.VaultCopyExpiration)}
                  class="text-muted-foreground hover:text-foreground p-0.5 rounded-sm transition-colors"
                >
                  {#if isCopied(`${item.id}-expiration`)}<Check
                      class="size-3 text-emerald-500"
                    />{:else}<Copy class="size-3" />{/if}
                </button>
              </div>
            </div>
          {/if}

          <div class="grid grid-cols-[85px_1fr] items-center gap-2 text-xs">
            <span class="text-muted-foreground/70 font-medium"
              >{vault.t(I18N_KEYS.VaultFieldsCvv)}</span
            >
            <div
              class="flex items-center justify-between gap-2 min-w-0 bg-muted/20 hover:bg-muted/40 rounded-md px-2 py-1 transition-colors border border-border/20"
            >
              <code
                class="truncate font-mono text-foreground"
                data-testid="credit-card-cvv-value"
              >
                {reveal.kind === SecretRevealKind.Revealed
                  ? reveal.record.cvv || vault.t(I18N_KEYS.CommonNone)
                  : '•••'}
              </code>
              {#if reveal.kind === SecretRevealKind.Revealed && reveal.record.cvv}
                <button
                  type="button"
                  onclick={() =>
                    void (() => { const onCopyToClipboardArgs9: Parameters<typeof onCopyToClipboard>[0] = { text: reveal.record.cvv, id: item.id, field: 'cvv' }; return onCopyToClipboard(onCopyToClipboardArgs9); })()}
                  aria-label={vault.t(I18N_KEYS.VaultCopyCvv)}
                  class="text-muted-foreground hover:text-foreground p-0.5 rounded-sm transition-colors shrink-0"
                >
                  {#if isCopied(`${item.id}-cvv`)}<Check
                      class="size-3 text-emerald-500"
                    />{:else}<Copy class="size-3" />{/if}
                </button>
              {/if}
            </div>
          </div>

          {#if reveal.kind === SecretRevealKind.Revealed && reveal.record.notes}
            <div class="grid grid-cols-[85px_1fr] items-start gap-2 text-xs">
              <span class="text-muted-foreground/70 font-medium pt-1"
                >{vault.t(I18N_KEYS.VaultFieldsNotes)}</span
              >
              <div
                class="text-muted-foreground whitespace-pre-wrap font-sans bg-muted/10 rounded-md px-2.5 py-1.5 text-[11px] leading-relaxed border border-border/20"
              >
                {reveal.record.notes}
              </div>
            </div>
          {/if}
        {:else if item.type === SecretType.FileAttachment}
          <div class="grid grid-cols-[85px_1fr] items-center gap-2 text-xs">
            <span class="text-muted-foreground/70 font-medium"
              >{vault.t(I18N_KEYS.VaultFieldsFileName)}</span
            >
            <div
              class="min-w-0 rounded-md border border-border/20 bg-muted/20 px-2 py-1"
            >
              <span
                class="truncate text-foreground"
                data-testid="file-attachment-name"
                >{item.fileName || vault.t(I18N_KEYS.VaultFieldsNoTitle)}</span
              >
            </div>
          </div>
          <div class="grid grid-cols-[85px_1fr] items-center gap-2 text-xs">
            <span class="text-muted-foreground/70 font-medium"
              >{vault.t(I18N_KEYS.VaultFieldsFileSize)}</span
            >
            <div
              class="min-w-0 rounded-md border border-border/20 bg-muted/20 px-2 py-1"
            >
              <span
                class="truncate text-foreground"
                data-testid="file-attachment-size"
                >{formatFileSize(item.sizeBytes)}</span
              >
            </div>
          </div>
          {#if item.mimeType}
            <div class="grid grid-cols-[85px_1fr] items-center gap-2 text-xs">
              <span class="text-muted-foreground/70 font-medium"
                >{vault.t(I18N_KEYS.VaultFieldsMimeType)}</span
              >
              <div
                class="min-w-0 rounded-md border border-border/20 bg-muted/20 px-2 py-1"
              >
                <span class="truncate text-foreground">{item.mimeType}</span>
              </div>
            </div>
          {/if}
          <div class="pt-1">
            <button
              type="button"
              data-testid="download-file-attachment-btn"
              disabled={reveal.kind !== SecretRevealKind.Revealed}
              onclick={downloadFileAttachment}
              class="inline-flex items-center gap-1.5 rounded-md border border-border/40 bg-muted/20 px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download class="size-3.5" />
              {vault.t(I18N_KEYS.VaultDownloadFile)}
            </button>
            {#if reveal.kind !== SecretRevealKind.Revealed}
              <p class="mt-1 text-[11px] text-muted-foreground">
                {vault.t(I18N_KEYS.VaultRevealToDownload)}
              </p>
            {/if}
          </div>
        {:else}
          <div class="grid grid-cols-[85px_1fr] items-start gap-2 text-xs">
            <span class="text-muted-foreground/70 font-medium pt-1"
              >{vault.t(I18N_KEYS.VaultFieldsNote)}</span
            >
            <div
              class="flex items-start justify-between gap-2 min-w-0 bg-muted/20 hover:bg-muted/40 rounded-md px-2.5 py-1.5 transition-colors border border-border/20"
            >
              {#if reveal.kind === SecretRevealKind.Revealed}
                <div
                  class="min-w-0 flex-1 text-[11px] leading-relaxed text-foreground"
                  data-testid="revealed-secret"
                >
                  <MarkdownContent source={reveal.record.note} />
                </div>
              {:else}
                <span
                  class="font-mono text-foreground"
                  data-testid="revealed-secret">••••••••••••••••</span
                >
              {/if}
              <button
                type="button"
                onclick={() => void onCopySecret(item.id)}
                aria-label={vault.t(I18N_KEYS.VaultCopyNote)}
                class="text-muted-foreground hover:text-foreground p-0.5 rounded-sm transition-colors shrink-0"
              >
                {#if isCopied(`${item.id}-secret`)}<Check
                    class="size-3 text-emerald-500"
                  />{:else}<Copy class="size-3" />{/if}
              </button>
            </div>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>
