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
  } from '@lucide/svelte'
  import type { VaultItem } from '$lib/nook'
  import MarkdownContent from './MarkdownContent.svelte'

  let {
    item,
    index,
    revealSecrets,
    copiedKey,
    onToggleReveal,
    onEditItem,
    onDeleteSecret,
    onCopyToClipboard,
  }: {
    item: VaultItem
    index: number
    revealSecrets: Record<string, boolean>
    copiedKey: string | null
    onToggleReveal: (id: string) => void
    onEditItem: (item: VaultItem) => void
    onDeleteSecret: (id: string) => Promise<void>
    onCopyToClipboard: (
      text: string,
      id: string,
      field: string,
    ) => Promise<void>
  } = $props()
</script>

<div data-testid="vault-group-{item.type}">
  <div
    class="pt-3 first:pt-0"
    class:border-t={index > 0}
    role="listitem"
    data-testid="secret-row"
  >
    <!-- Item Section Header -->
    <div class="mb-1.5 flex items-center justify-between pb-1">
      <span
        class="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80"
      >
        {#if item.type === 'login'}
          <Globe class="size-3 text-primary/70" /> Login
        {:else if item.type === 'api-key'}
          <Braces class="size-3 text-primary/70" /> API key
        {:else if item.type === 'seed-phrase'}
          <Sprout class="size-3 text-primary/70" /> Seed phrase
        {:else}
          <StickyNote class="size-3 text-primary/70" /> Secure note
        {/if}
      </span>
      <div class="flex items-center gap-0.5">
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
    <div class="space-y-1.5">
      {#if item.type === 'login'}
        <div class="grid grid-cols-[85px_1fr] items-center gap-2 text-xs">
          <span class="text-muted-foreground/70 font-medium">Website</span>
          <div
            class="flex items-center justify-between gap-2 min-w-0 bg-muted/20 hover:bg-muted/40 rounded-md px-2 py-1 transition-colors border border-border/20"
          >
            <span class="truncate font-mono text-foreground"
              >{item.websiteUrl || 'No website'}</span
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
          <span class="text-muted-foreground/70 font-medium">Username</span>
          <div
            class="flex items-center justify-between gap-2 min-w-0 bg-muted/20 hover:bg-muted/40 rounded-md px-2 py-1 transition-colors border border-border/20"
          >
            <span class="truncate font-mono text-foreground"
              >{item.username || 'No username'}</span
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
          <span class="text-muted-foreground/70 font-medium">Password</span>
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
            <span class="text-muted-foreground/70 font-medium pt-1">Notes</span>
            <div
              class="text-muted-foreground whitespace-pre-wrap font-sans bg-muted/10 rounded-md px-2.5 py-1.5 text-[11px] leading-relaxed border border-border/20"
            >
              {item.notes}
            </div>
          </div>
        {/if}
      {:else if item.type === 'api-key'}
        <div class="grid grid-cols-[85px_1fr] items-center gap-2 text-xs">
          <span class="text-muted-foreground/70 font-medium">Website</span>
          <div
            class="flex items-center justify-between gap-2 min-w-0 bg-muted/20 hover:bg-muted/40 rounded-md px-2 py-1 transition-colors border border-border/20"
          >
            <span class="truncate font-mono text-foreground"
              >{item.websiteUrl || 'No website'}</span
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
          <span class="text-muted-foreground/70 font-medium">Key</span>
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
            <span class="text-muted-foreground/70 font-medium">Expires</span>
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
          <span class="text-muted-foreground/70 font-medium">Account</span>
          <div
            class="flex items-center justify-between gap-2 min-w-0 bg-muted/20 hover:bg-muted/40 rounded-md px-2 py-1 transition-colors border border-border/20"
          >
            <span class="truncate font-mono text-foreground"
              >{item.name || 'No account name'}</span
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

        <div class="grid grid-cols-[85px_1fr] items-center gap-2 text-xs">
          <span class="text-muted-foreground/70 font-medium">Seed phrase</span>
          <div
            class="flex items-center justify-between gap-2 min-w-0 bg-muted/20 hover:bg-muted/40 rounded-md px-2 py-1 transition-colors border border-border/20"
          >
            <code
              class="break-all font-mono text-foreground"
              data-testid="revealed-secret"
            >
              {revealSecrets[item.id] ? item.seed : '••••••••••••••••'}
            </code>
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
        </div>
      {:else}
        <div class="grid grid-cols-[85px_1fr] items-center gap-2 text-xs">
          <span class="text-muted-foreground/70 font-medium">Title</span>
          <div
            class="flex items-center justify-between gap-2 min-w-0 bg-muted/20 hover:bg-muted/40 rounded-md px-2 py-1 transition-colors border border-border/20"
          >
            <span class="truncate text-foreground"
              >{item.title || 'No title'}</span
            >
            {#if item.title}
              <button
                type="button"
                onclick={() =>
                  void onCopyToClipboard(item.title, item.id, 'title')}
                aria-label="Copy title"
                class="text-muted-foreground hover:text-foreground p-0.5 rounded-sm transition-colors"
              >
                {#if copiedKey === `${item.id}-title`}<Check
                    class="size-3 text-emerald-500"
                  />{:else}<Copy class="size-3" />{/if}
              </button>
            {/if}
          </div>
        </div>

        <div class="grid grid-cols-[85px_1fr] items-start gap-2 text-xs">
          <span class="text-muted-foreground/70 font-medium pt-1">Note</span>
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
  </div>
</div>
