<script lang="ts">
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
      text: string,
      id: string,
      field: string,
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
        vault.t('vault.types.login')
      )
    }
    if (item.type === SecretType.ApiKey) {
      return item.websiteUrl.trim() || vault.t('vault.types.api_key')
    }
    if (item.type === SecretType.SeedPhrase) {
      const name = item.name.trim()
      const words = item.seedWordCount
      const label = name || vault.t('vault.fields.unnamed_seed_phrase')
      if (words === 12 || words === 24) {
        return `${label} · ${vault.t('vault.fields.words_count', { count: String(words) })}`
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
        vault.t('vault.types.passkey')
      )
    }
    if (item.type === SecretType.CreditCard) {
      const last4 = item.last4.trim()
      if (last4) return `•••• ${last4}`
      return item.title.trim() || vault.t('vault.fields.unnamed_card')
    }
    if (item.type === SecretType.FileAttachment) {
      return (
        item.fileName.trim() ||
        item.title.trim() ||
        vault.t('vault.fields.no_title')
      )
    }
    return item.title.trim() || vault.t('vault.fields.no_title')
  })

  const headerTitle = $derived.by(() => {
    if (item.type === SecretType.Login) {
      return item.websiteHost || vault.t('vault.fields.no_website')
    }
    if (item.type === SecretType.CreditCard) {
      return (
        item.title.trim() || summary || vault.t('vault.fields.unnamed_card')
      )
    }
    if (item.type === SecretType.FileAttachment) {
      return (
        item.title.trim() ||
        item.fileName.trim() ||
        vault.t('vault.fields.no_title')
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
    const blob = new Blob([bytes], {
      type: reveal.record.mimeType || 'application/octet-stream',
    })
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
          ? vault.t('vault.collapse_secret')
          : vault.t('vault.expand_secret')}
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
              {vault.t('vault.types.login')}
            {:else if item.type === SecretType.ApiKey}
              <Braces class="size-3 text-primary/70" />
              {vault.t('vault.types.api_key')}
            {:else if item.type === SecretType.SeedPhrase}
              <Sprout class="size-3 text-primary/70" />
              {vault.t('vault.types.seed_phrase')}
            {:else if item.type === SecretType.Authenticator}
              <ShieldCheck class="size-3 text-primary/70" />
              {vault.t('vault.types.authenticator')}
            {:else if item.type === SecretType.Passkey}
              <KeyRound class="size-3 text-primary/70" />
              {vault.t('vault.types.passkey')}
            {:else if item.type === SecretType.CreditCard}
              <CreditCard class="size-3 text-primary/70" />
              {vault.t('vault.types.credit_card')}
            {:else if item.type === SecretType.FileAttachment}
              <Paperclip class="size-3 text-primary/70" />
              {vault.t('vault.types.file_attachment')}
            {:else}
              <StickyNote class="size-3 text-primary/70" />
              {vault.t('vault.types.secure_note')}
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
              ? vault.t('vault.hide_value')
              : vault.t('vault.show_value')}
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
            aria-label={vault.t('common.edit')}
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
          aria-label={vault.t('common.delete')}
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
              >{vault.t('vault.fields.website_label')}</span
            >
            <div
              class="flex items-center justify-between gap-2 min-w-0 bg-muted/20 hover:bg-muted/40 rounded-md px-2 py-1 transition-colors border border-border/20"
            >
              <span class="truncate text-foreground"
                >{item.websiteUrl || vault.t('vault.fields.no_website')}</span
              >
              {#if item.websiteUrl}
                <button
                  type="button"
                  onclick={() =>
                    void onCopyToClipboard(item.websiteUrl, item.id, 'website')}
                  aria-label={vault.t('vault.copy_website_url')}
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
              >{vault.t('vault.fields.username')}</span
            >
            <div
              class="flex items-center justify-between gap-2 min-w-0 bg-muted/20 hover:bg-muted/40 rounded-md px-2 py-1 transition-colors border border-border/20"
            >
              <span class="truncate text-foreground"
                >{item.username || vault.t('vault.fields.no_username')}</span
              >
              {#if item.username}
                <button
                  type="button"
                  onclick={() =>
                    void onCopyToClipboard(item.username, item.id, 'username')}
                  aria-label={vault.t('vault.copy_username')}
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
              >{vault.t('vault.fields.password')}</span
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
                aria-label={vault.t('vault.copy_secret')}
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
                >{vault.t('vault.fields.notes')}</span
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
              >{vault.t('vault.fields.website_label')}</span
            >
            <div
              class="flex items-center justify-between gap-2 min-w-0 bg-muted/20 hover:bg-muted/40 rounded-md px-2 py-1 transition-colors border border-border/20"
            >
              <span class="truncate text-foreground"
                >{item.websiteUrl || vault.t('vault.fields.no_website')}</span
              >
              {#if item.websiteUrl}
                <button
                  type="button"
                  onclick={() =>
                    void onCopyToClipboard(item.websiteUrl, item.id, 'website')}
                  aria-label={vault.t('vault.copy_website_url')}
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
              >{vault.t('vault.fields.key')}</span
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
                aria-label={vault.t('vault.copy_secret')}
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
                >{vault.t('vault.fields.expires')}</span
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
                    void onCopyToClipboard(item.expiresAt, item.id, 'expires')}
                  aria-label={vault.t('vault.copy_expiration_date')}
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
              >{vault.t('vault.fields.account')}</span
            >
            <div
              class="flex items-center justify-between gap-2 min-w-0 bg-muted/20 hover:bg-muted/40 rounded-md px-2 py-1 transition-colors border border-border/20"
            >
              <span class="truncate text-foreground"
                >{item.name || vault.t('vault.fields.no_account_name')}</span
              >
              {#if item.name}
                <button
                  type="button"
                  onclick={() =>
                    void onCopyToClipboard(item.name, item.id, 'name')}
                  aria-label={vault.t('vault.copy_account_name')}
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
                >{vault.t('vault.types.seed_phrase')}</span
              >
              <button
                type="button"
                onclick={() => void onCopySecret(item.id)}
                aria-label={vault.t('vault.copy_secret')}
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
              >{vault.t('vault.fields.relying_party')}</span
            >
            <div
              class="min-w-0 rounded-md border border-border/20 bg-muted/20 px-2 py-1"
            >
              <span class="truncate text-foreground">{item.rpId}</span>
            </div>
          </div>
          <div class="grid grid-cols-[85px_1fr] items-center gap-2 text-xs">
            <span class="text-muted-foreground/70 font-medium"
              >{vault.t('vault.fields.account')}</span
            >
            <div
              class="min-w-0 rounded-md border border-border/20 bg-muted/20 px-2 py-1"
            >
              <span class="truncate text-foreground"
                >{item.passkeyUserDisplayName ||
                  item.passkeyUserName ||
                  vault.t('common.none')}</span
              >
            </div>
          </div>
          {#if item.passkeyUserDisplayName && item.passkeyUserName}
            <div class="grid grid-cols-[85px_1fr] items-center gap-2 text-xs">
              <span class="text-muted-foreground/70 font-medium"
                >{vault.t('vault.fields.username')}</span
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
            {vault.t('vault.fields.passkey_managed_hint')}
          </p>
        {:else if item.type === SecretType.CreditCard}
          <div class="grid grid-cols-[85px_1fr] items-center gap-2 text-xs">
            <span class="text-muted-foreground/70 font-medium"
              >{vault.t('vault.fields.title')}</span
            >
            <div
              class="min-w-0 rounded-md border border-border/20 bg-muted/20 px-2 py-1"
            >
              <span class="truncate text-foreground"
                >{item.title.trim() ||
                  vault.t('vault.fields.unnamed_card')}</span
              >
            </div>
          </div>

          <div class="grid grid-cols-[85px_1fr] items-center gap-2 text-xs">
            <span class="text-muted-foreground/70 font-medium"
              >{vault.t('vault.fields.cardholder_name')}</span
            >
            <div
              class="flex items-center justify-between gap-2 min-w-0 bg-muted/20 hover:bg-muted/40 rounded-md px-2 py-1 transition-colors border border-border/20"
            >
              <span class="truncate text-foreground"
                >{item.cardholderName.trim() || vault.t('common.none')}</span
              >
              {#if item.cardholderName.trim()}
                <button
                  type="button"
                  onclick={() =>
                    void onCopyToClipboard(
                      item.cardholderName,
                      item.id,
                      'cardholder',
                    )}
                  aria-label={vault.t('vault.copy_cardholder_name')}
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
              >{vault.t('vault.fields.card_number')}</span
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
                    void onCopyToClipboard(
                      reveal.record.cardNumber,
                      item.id,
                      'card-number',
                    )}
                  aria-label={vault.t('vault.copy_card_number')}
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
                >{vault.t('vault.fields.expiration')}</span
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
                    void onCopyToClipboard(
                      cardExpiration,
                      item.id,
                      'expiration',
                    )}
                  aria-label={vault.t('vault.copy_expiration')}
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
              >{vault.t('vault.fields.cvv')}</span
            >
            <div
              class="flex items-center justify-between gap-2 min-w-0 bg-muted/20 hover:bg-muted/40 rounded-md px-2 py-1 transition-colors border border-border/20"
            >
              <code
                class="truncate font-mono text-foreground"
                data-testid="credit-card-cvv-value"
              >
                {reveal.kind === SecretRevealKind.Revealed
                  ? reveal.record.cvv || vault.t('common.none')
                  : '•••'}
              </code>
              {#if reveal.kind === SecretRevealKind.Revealed && reveal.record.cvv}
                <button
                  type="button"
                  onclick={() =>
                    void onCopyToClipboard(reveal.record.cvv, item.id, 'cvv')}
                  aria-label={vault.t('vault.copy_cvv')}
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
                >{vault.t('vault.fields.notes')}</span
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
              >{vault.t('vault.fields.file_name')}</span
            >
            <div
              class="min-w-0 rounded-md border border-border/20 bg-muted/20 px-2 py-1"
            >
              <span
                class="truncate text-foreground"
                data-testid="file-attachment-name"
                >{item.fileName || vault.t('vault.fields.no_title')}</span
              >
            </div>
          </div>
          <div class="grid grid-cols-[85px_1fr] items-center gap-2 text-xs">
            <span class="text-muted-foreground/70 font-medium"
              >{vault.t('vault.fields.file_size')}</span
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
                >{vault.t('vault.fields.mime_type')}</span
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
              {vault.t('vault.download_file')}
            </button>
            {#if reveal.kind !== SecretRevealKind.Revealed}
              <p class="mt-1 text-[11px] text-muted-foreground">
                {vault.t('vault.reveal_to_download')}
              </p>
            {/if}
          </div>
        {:else}
          <div class="grid grid-cols-[85px_1fr] items-start gap-2 text-xs">
            <span class="text-muted-foreground/70 font-medium pt-1"
              >{vault.t('vault.fields.note')}</span
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
                aria-label={vault.t('vault.copy_note')}
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
