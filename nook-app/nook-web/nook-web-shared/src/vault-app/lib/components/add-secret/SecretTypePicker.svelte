<script lang="ts">
  import {
    Globe,
    Braces,
    Sprout,
    StickyNote,
    ShieldCheck,
    KeyRound,
    ChevronRight,
    CreditCard,
    Paperclip,
  } from "@lucide/svelte";
  import type { VaultItemType } from "$lib/nook";
  import type { VaultState } from "$lib/vault.svelte";

  let {
    vault,
    onSelect,
  }: {
    vault: VaultState;
    onSelect: (type: VaultItemType) => void;
  } = $props();
</script>

<div class="space-y-5">
    <div class="space-y-1">
      <h3 class="text-base font-semibold text-foreground">
        {vault.t('add_secret.what_saving')}
      </h3>
      <p class="text-sm text-muted-foreground text-pretty">
        {vault.t('add_secret.choose_type_desc')}
      </p>
    </div>
    <div
      class="grid grid-cols-1 gap-2 sm:grid-cols-2"
      data-testid="item-type-picker"
    >
      <button
        type="button"
        class="group flex min-h-20 items-center gap-3 rounded-xl border border-border/55 bg-muted/10 px-3.5 py-3 text-left transition-colors hover:border-primary/35 hover:bg-primary/5 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring sm:px-4"
        data-testid="item-type-login"
        onclick={() => onSelect('login')}
      >
        <div
          class="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-background/70 text-primary shadow-xs"
        >
          <Globe class="size-5" />
        </div>
        <span class="min-w-0 flex-1">
          <span class="block text-sm font-semibold text-foreground"
            >{vault.t('vault.types.login')}</span
          >
          <span class="mt-0.5 block text-xs text-muted-foreground"
            >{vault.t('add_secret.website_account_desc')}</span
          >
        </span>
        <ChevronRight
          class="size-4 shrink-0 text-muted-foreground/55 transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
        />
      </button>
      <button
        type="button"
        class="group flex min-h-20 items-center gap-3 rounded-xl border border-border/55 bg-muted/10 px-3.5 py-3 text-left transition-colors hover:border-primary/35 hover:bg-primary/5 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring sm:px-4"
        data-testid="item-type-authenticator"
        onclick={() => onSelect('authenticator')}
      >
        <div
          class="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-background/70 text-primary shadow-xs"
        >
          <ShieldCheck class="size-5" />
        </div>
        <span class="min-w-0 flex-1">
          <span class="block text-sm font-semibold text-foreground"
            >{vault.t('vault.types.authenticator')}</span
          >
          <span class="mt-0.5 block text-xs text-muted-foreground"
            >{vault.t('add_secret.authenticator_desc')}</span
          >
        </span>
        <ChevronRight
          class="size-4 shrink-0 text-muted-foreground/55 transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
        />
      </button>
      <button
        type="button"
        class="group flex min-h-20 items-center gap-3 rounded-xl border border-border/55 bg-muted/10 px-3.5 py-3 text-left transition-colors hover:border-primary/35 hover:bg-primary/5 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring sm:px-4"
        data-testid="item-type-api-key"
        onclick={() => onSelect('api-key')}
      >
        <div
          class="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-background/70 text-primary shadow-xs"
        >
          <Braces class="size-5" />
        </div>
        <span class="min-w-0 flex-1">
          <span class="block text-sm font-semibold text-foreground"
            >{vault.t('vault.types.api_key')}</span
          >
          <span class="mt-0.5 block text-xs text-muted-foreground"
            >{vault.t('add_secret.token_desc')}</span
          >
        </span>
        <ChevronRight
          class="size-4 shrink-0 text-muted-foreground/55 transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
        />
      </button>
      <button
        type="button"
        class="group flex min-h-20 items-center gap-3 rounded-xl border border-border/55 bg-muted/10 px-3.5 py-3 text-left transition-colors hover:border-primary/35 hover:bg-primary/5 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring sm:px-4"
        data-testid="item-type-seed-phrase"
        onclick={() => onSelect('seed-phrase')}
      >
        <div
          class="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-background/70 text-primary shadow-xs"
        >
          <Sprout class="size-5" />
        </div>
        <span class="min-w-0 flex-1">
          <span class="block text-sm font-semibold text-foreground"
            >{vault.t('vault.types.seed_phrase')}</span
          >
          <span class="mt-0.5 block text-xs text-muted-foreground"
            >{vault.t('add_secret.bip39_desc')}</span
          >
        </span>
        <ChevronRight
          class="size-4 shrink-0 text-muted-foreground/55 transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
        />
      </button>
      <button
        type="button"
        class="group flex min-h-20 items-center gap-3 rounded-xl border border-border/55 bg-muted/10 px-3.5 py-3 text-left transition-colors hover:border-primary/35 hover:bg-primary/5 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring sm:px-4"
        data-testid="item-type-secure-note"
        onclick={() => onSelect('secure-note')}
      >
        <div
          class="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-background/70 text-primary shadow-xs"
        >
          <StickyNote class="size-5" />
        </div>
        <span class="min-w-0 flex-1">
          <span class="block text-sm font-semibold text-foreground"
            >{vault.t('vault.types.secure_note')}</span
          >
          <span class="mt-0.5 block text-xs text-muted-foreground"
            >{vault.t('add_secret.private_text_desc')}</span
          >
        </span>
        <ChevronRight
          class="size-4 shrink-0 text-muted-foreground/55 transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
        />
      </button>
      <button
        type="button"
        class="group flex min-h-20 items-center gap-3 rounded-xl border border-border/55 bg-muted/10 px-3.5 py-3 text-left transition-colors hover:border-primary/35 hover:bg-primary/5 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring sm:px-4"
        data-testid="item-type-credit-card"
        onclick={() => onSelect('credit-card')}
      >
        <div
          class="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-background/70 text-primary shadow-xs"
        >
          <CreditCard class="size-5" />
        </div>
        <span class="min-w-0 flex-1">
          <span class="block text-sm font-semibold text-foreground"
            >{vault.t('vault.types.credit_card')}</span
          >
          <span class="mt-0.5 block text-xs text-muted-foreground"
            >{vault.t('add_secret.credit_card_desc')}</span
          >
        </span>
        <ChevronRight
          class="size-4 shrink-0 text-muted-foreground/55 transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
        />
      </button>
      <button
        type="button"
        class="group flex min-h-20 items-center gap-3 rounded-xl border border-border/55 bg-muted/10 px-3.5 py-3 text-left transition-colors hover:border-primary/35 hover:bg-primary/5 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring sm:px-4"
        data-testid="item-type-file-attachment"
        onclick={() => onSelect('file-attachment')}
      >
        <div
          class="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-background/70 text-primary shadow-xs"
        >
          <Paperclip class="size-5" />
        </div>
        <span class="min-w-0 flex-1">
          <span class="block text-sm font-semibold text-foreground"
            >{vault.t('vault.types.file_attachment')}</span
          >
          <span class="mt-0.5 block text-xs text-muted-foreground"
            >{vault.t('add_secret.file_attachment_desc')}</span
          >
        </span>
        <ChevronRight
          class="size-4 shrink-0 text-muted-foreground/55 transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
        />
      </button>
      <button
        type="button"
        class="group flex min-h-20 items-center gap-3 rounded-xl border border-border/55 bg-muted/10 px-3.5 py-3 text-left transition-colors hover:border-primary/35 hover:bg-primary/5 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring sm:px-4"
        data-testid="item-type-passkey"
        onclick={() => onSelect('passkey')}
      >
        <div
          class="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-background/70 text-primary shadow-xs"
        >
          <KeyRound class="size-5" />
        </div>
        <span class="min-w-0 flex-1">
          <span class="block text-sm font-semibold text-foreground"
            >{vault.t('vault.types.passkey')}</span
          >
          <span class="mt-0.5 block text-xs text-muted-foreground"
            >{vault.t('add_secret.passkey_desc')}</span
          >
        </span>
        <ChevronRight
          class="size-4 shrink-0 text-muted-foreground/55 transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
        />
      </button>
    </div>
</div>
