<script lang="ts">
  import {
    Globe,
    Braces,
    Sprout,
    StickyNote,
    Eye,
    EyeOff,
    Pencil,
    Trash2,
    Copy,
    Check,
    ChevronDown,
  } from '@lucide/svelte'
  import type { VaultItem } from '$lib/nook'
  import type { VaultState } from '$lib/vault.svelte'
  import MarkdownContent from './MarkdownContent.svelte'
  import SeedPhraseGrid from './SeedPhraseGrid.svelte'

  let {
    item,
    index,
    expanded,
    revealSecrets,
    copiedKey,
    onToggleExpand,
    onToggleReveal,
    onEditItem,
    onDeleteSecret,
    onCopyToClipboard,
    vault,
    titleAsHeader = false,
  }: {
    item: VaultItem
    index: number
    expanded: boolean
    revealSecrets: Record<string, boolean>
    copiedKey: string | null
    onToggleExpand: (id: string) => void
    onToggleReveal: (id: string) => void
    onEditItem: (item: VaultItem) => void
    onDeleteSecret: (id: string) => Promise<void>
    onCopyToClipboard: (
      text: string,
      id: string,
      field: string,
    ) => Promise<void>
    vault: VaultState
    /** Secure note: use the title row as the card header (no duplicate group header). */
    titleAsHeader?: boolean
  } = $props()

  const summary = $derived.by(() => {
    if (item.type === 'login') {
      return (
        item.username.trim() ||
        item.websiteUrl.trim() ||
        vault.t('vault.types.login')
      )
    }
    if (item.type === 'api-key') {
      return item.websiteUrl.trim() || vault.t('vault.types.api_key')
    }
    if (item.type === 'seed-phrase') {
      const name = item.name.trim()
      const words = item.seed.trim().split(/\s+/).filter(Boolean).length
      const label = name || vault.t('vault.fields.unnamed_seed_phrase')
      if (words === 12 || words === 24) {
        return `${label} · ${vault.t('vault.fields.words_count', { count: String(words) })}`
      }
      return label
    }
    return item.title.trim() || vault.t('vault.fields.no_title')
  })
</script>

<div data-testid="vault-group-{item.type}">
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
        {#if item.type === 'secure-note' && titleAsHeader}
          <div
            class="flex size-6 shrink-0 items-center justify-center rounded-md border border-border/35 bg-muted/35 text-muted-foreground sm:border-border/60"
          >
            <StickyNote class="size-3.5" />
          </div>
          <h3
            class="truncate text-sm font-semibold tracking-wide text-foreground"
          >
            {summary}
          </h3>
        {:else}
          <span
            class="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80"
          >
            {#if item.type === 'login'}
              <Globe class="size-3 text-primary/70" />
              {vault.t('vault.types.login')}
            {:else if item.type === 'api-key'}
              <Braces class="size-3 text-primary/70" />
              {vault.t('vault.types.api_key')}
            {:else if item.type === 'seed-phrase'}
              <Sprout class="size-3 text-primary/70" />
              {vault.t('vault.types.seed_phrase')}
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
        <button
          type="button"
          onclick={() => onToggleReveal(item.id)}
          aria-label={revealSecrets[item.id] ? 'Hide secret' : 'Show secret'}
          class="rounded-md p-1.5 text-muted-foreground/80 hover:bg-accent hover:text-foreground transition-colors"
        >
          {#if revealSecrets[item.id]}<EyeOff class="size-3.5" />{:else}<Eye
              class="size-3.5"
            />{/if}
        </button>
        <button
          type="button"
          onclick={() => onEditItem(item)}
          aria-label="Edit item"
          data-testid="edit-secret-btn"
          class="rounded-md p-1.5 text-muted-foreground/80 hover:bg-accent hover:text-foreground transition-colors"
        >
          <Pencil class="size-3.5" />
        </button>
        <button
          type="button"
          onclick={() => void onDeleteSecret(item.id)}
          aria-label="Delete item"
          class="rounded-md p-1.5 text-muted-foreground/80 hover:bg-destructive/10 hover:text-destructive transition-colors"
        >
          <Trash2 class="size-3.5" />
        </button>
      </div>
    </div>

    <!-- Item Structured Details -->
    {#if expanded}
      <div class="space-y-1.5 {titleAsHeader ? 'px-3 py-3' : ''}">
        {#if item.type === 'login'}
          <div class="grid grid-cols-[85px_1fr] items-center gap-2 text-xs">
            <span class="text-muted-foreground/70 font-medium"
              >{vault.t('vault.fields.website_label')}</span
            >
            <div
              class="flex items-center justify-between gap-2 min-w-0 bg-muted/20 hover:bg-muted/40 rounded-md px-2 py-1 transition-colors border border-border/20"
            >
              <span class="truncate font-mono text-foreground"
                >{item.websiteUrl || vault.t('vault.fields.no_website')}</span
              >
              {#if item.websiteUrl}
                <button
                  type="button"
                  onclick={() =>
                    void onCopyToClipboard(item.websiteUrl, item.id, 'website')}
                  aria-label="Copy website URL"
                  class="text-muted-foreground hover:text-foreground p-0.5 rounded-sm transition-colors"
                >
                  {#if copiedKey === `${item.id}-website`}<Check
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
              <span class="truncate font-mono text-foreground"
                >{item.username || vault.t('vault.fields.no_username')}</span
              >
              {#if item.username}
                <button
                  type="button"
                  onclick={() =>
                    void onCopyToClipboard(item.username, item.id, 'username')}
                  aria-label="Copy username"
                  class="text-muted-foreground hover:text-foreground p-0.5 rounded-sm transition-colors"
                >
                  {#if copiedKey === `${item.id}-username`}<Check
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
                {revealSecrets[item.id] ? item.password : '••••••••••••••••'}
              </code>
              <button
                type="button"
                onclick={() =>
                  void onCopyToClipboard(item.password, item.id, 'secret')}
                aria-label="Copy secret"
                class="text-muted-foreground hover:text-foreground p-0.5 rounded-sm transition-colors shrink-0"
              >
                {#if copiedKey === `${item.id}-secret`}<Check
                    class="size-3 text-emerald-500"
                  />{:else}<Copy class="size-3" />{/if}
              </button>
            </div>
          </div>

          {#if item.notes}
            <div class="grid grid-cols-[85px_1fr] items-start gap-2 text-xs">
              <span class="text-muted-foreground/70 font-medium pt-1"
                >{vault.t('vault.fields.notes')}</span
              >
              <div
                class="text-muted-foreground whitespace-pre-wrap font-sans bg-muted/10 rounded-md px-2.5 py-1.5 text-[11px] leading-relaxed border border-border/20"
              >
                {item.notes}
              </div>
            </div>
          {/if}
        {:else if item.type === 'api-key'}
          <div class="grid grid-cols-[85px_1fr] items-center gap-2 text-xs">
            <span class="text-muted-foreground/70 font-medium"
              >{vault.t('vault.fields.website_label')}</span
            >
            <div
              class="flex items-center justify-between gap-2 min-w-0 bg-muted/20 hover:bg-muted/40 rounded-md px-2 py-1 transition-colors border border-border/20"
            >
              <span class="truncate font-mono text-foreground"
                >{item.websiteUrl || vault.t('vault.fields.no_website')}</span
              >
              {#if item.websiteUrl}
                <button
                  type="button"
                  onclick={() =>
                    void onCopyToClipboard(item.websiteUrl, item.id, 'website')}
                  aria-label="Copy website URL"
                  class="text-muted-foreground hover:text-foreground p-0.5 rounded-sm transition-colors"
                >
                  {#if copiedKey === `${item.id}-website`}<Check
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
                {revealSecrets[item.id] ? item.key : '••••••••••••••••'}
              </code>
              <button
                type="button"
                onclick={() =>
                  void onCopyToClipboard(item.key, item.id, 'secret')}
                aria-label="Copy secret"
                class="text-muted-foreground hover:text-foreground p-0.5 rounded-sm transition-colors shrink-0"
              >
                {#if copiedKey === `${item.id}-secret`}<Check
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
                  aria-label="Copy expiration date"
                  class="text-muted-foreground hover:text-foreground p-0.5 rounded-sm transition-colors"
                >
                  {#if copiedKey === `${item.id}-expires`}<Check
                      class="size-3 text-emerald-500"
                    />{:else}<Copy class="size-3" />{/if}
                </button>
              </div>
            </div>
          {/if}
        {:else if item.type === 'seed-phrase'}
          <div class="grid grid-cols-[85px_1fr] items-center gap-2 text-xs">
            <span class="text-muted-foreground/70 font-medium"
              >{vault.t('vault.fields.account')}</span
            >
            <div
              class="flex items-center justify-between gap-2 min-w-0 bg-muted/20 hover:bg-muted/40 rounded-md px-2 py-1 transition-colors border border-border/20"
            >
              <span class="truncate font-mono text-foreground"
                >{item.name || vault.t('vault.fields.no_account_name')}</span
              >
              {#if item.name}
                <button
                  type="button"
                  onclick={() =>
                    void onCopyToClipboard(item.name, item.id, 'name')}
                  aria-label="Copy account name"
                  class="text-muted-foreground hover:text-foreground p-0.5 rounded-sm transition-colors"
                >
                  {#if copiedKey === `${item.id}-name`}<Check
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
                onclick={() =>
                  void onCopyToClipboard(item.seed, item.id, 'secret')}
                aria-label="Copy secret"
                class="text-muted-foreground hover:text-foreground p-0.5 rounded-sm transition-colors shrink-0"
              >
                {#if copiedKey === `${item.id}-secret`}<Check
                    class="size-3 text-emerald-500"
                  />{:else}<Copy class="size-3" />{/if}
              </button>
            </div>
            <SeedPhraseGrid
              {vault}
              value={item.seed}
              readonly
              revealed={Boolean(revealSecrets[item.id])}
            />
          </div>
        {:else}
          <div class="grid grid-cols-[85px_1fr] items-start gap-2 text-xs">
            <span class="text-muted-foreground/70 font-medium pt-1"
              >{vault.t('vault.fields.note')}</span
            >
            <div
              class="flex items-start justify-between gap-2 min-w-0 bg-muted/20 hover:bg-muted/40 rounded-md px-2.5 py-1.5 transition-colors border border-border/20"
            >
              {#if revealSecrets[item.id]}
                <div
                  class="min-w-0 flex-1 text-[11px] leading-relaxed text-foreground"
                  data-testid="revealed-secret"
                >
                  <MarkdownContent source={item.note} />
                </div>
              {:else}
                <span
                  class="font-mono text-foreground"
                  data-testid="revealed-secret">••••••••••••••••</span
                >
              {/if}
              <button
                type="button"
                onclick={() =>
                  void onCopyToClipboard(item.note, item.id, 'secret')}
                aria-label="Copy note"
                class="text-muted-foreground hover:text-foreground p-0.5 rounded-sm transition-colors shrink-0"
              >
                {#if copiedKey === `${item.id}-secret`}<Check
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
