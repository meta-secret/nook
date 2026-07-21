<script lang="ts">
  import {
    Globe,
    Braces,
    Sprout,
    StickyNote,
    ShieldCheck,
    KeyRound,
    CreditCard,
    Eye,
    EyeOff,
    Pencil,
    Trash2,
    Copy,
    Check,
    ChevronDown,
  } from "@lucide/svelte";
  import type {
    AuthenticatorCodeView,
    NookSecretListItem,
    NookSecretRecord,
  } from "$lib/nook";
  import type { VaultState } from "$lib/vault.svelte";
  import MarkdownContent from "./MarkdownContent.svelte";
  import SeedPhraseGrid from "./SeedPhraseGrid.svelte";

  let {
    item,
    index,
    expanded,
    decrypted,
    authenticatorCode = undefined,
    copiedKey,
    onToggleExpand,
    onToggleReveal,
    onEditItem,
    onDeleteSecret,
    onCopyToClipboard,
    onCopySecret,
    vault,
    editDisabled = false,
    editDisabledReason = undefined,
    titleAsHeader = false,
  }: {
    item: NookSecretListItem;
    index: number;
    expanded: boolean;
    decrypted: NookSecretRecord | undefined;
    authenticatorCode?: AuthenticatorCodeView | undefined;
    copiedKey: string | undefined;
    onToggleExpand: (id: string) => void;
    onToggleReveal: (id: string) => Promise<void>;
    onEditItem: (item: NookSecretListItem) => Promise<void>;
    onDeleteSecret: (id: string) => Promise<void>;
    onCopyToClipboard: (
      text: string,
      id: string,
      field: string,
    ) => Promise<void>;
    onCopySecret: (id: string) => Promise<void>;
    vault: VaultState;
    editDisabled?: boolean;
    editDisabledReason?: string | undefined;
    /** Use the title row as the card header (no duplicate group header). */
    titleAsHeader?: boolean;
  } = $props();

  const summary = $derived.by(() => {
    if (item.type === "login") {
      return (
        item.username.trim() ||
        item.websiteUrl.trim() ||
        vault.t("vault.types.login")
      );
    }
    if (item.type === "api-key") {
      return item.websiteUrl.trim() || vault.t("vault.types.api_key");
    }
    if (item.type === "seed-phrase") {
      const name = item.name.trim();
      const words = item.seedWordCount;
      const label = name || vault.t("vault.fields.unnamed_seed_phrase");
      if (words === 12 || words === 24) {
        return `${label} · ${vault.t("vault.fields.words_count", { count: String(words) })}`;
      }
      return label;
    }
    if (item.type === "authenticator") {
      return item.account.trim() || item.issuer.trim();
    }
    if (item.type === "passkey") {
      return (
        item.passkeyUserDisplayName.trim() ||
        item.passkeyUserName.trim() ||
        item.rpId.trim() ||
        vault.t("vault.types.passkey")
      );
    }
    if (item.type === "credit-card") {
      const last4 = item.last4.trim();
      if (last4) return `•••• ${last4}`;
      return item.title.trim() || vault.t("vault.fields.unnamed_card");
    }
    return item.title.trim() || vault.t("vault.fields.no_title");
  });

  const headerTitle = $derived.by(() => {
    if (item.type === "login") {
      return item.websiteHost || vault.t("vault.fields.no_website");
    }
    if (item.type === "credit-card") {
      return (
        item.title.trim() ||
        summary ||
        vault.t("vault.fields.unnamed_card")
      );
    }
    return summary;
  });

  const accountSubtitle = $derived(
    item.type === "login"
      ? item.username.trim()
      : item.type === "credit-card" && item.title.trim() && item.last4.trim()
        ? `•••• ${item.last4.trim()}`
        : "",
  );

  const cardExpiration = $derived.by(() => {
    const month =
      decrypted?.expirationMonth?.trim() || item.expirationMonth.trim();
    const year =
      decrypted?.expirationYear?.trim() || item.expirationYear.trim();
    if (!month && !year) return "";
    if (month && year) return `${month.padStart(2, "0")}/${year}`;
    return month || year;
  });
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
          ? vault.t("vault.collapse_secret")
          : vault.t("vault.expand_secret")}
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
            {#if item.type === "login"}
              <Globe class="size-3.5" />
            {:else if item.type === "authenticator"}
              <ShieldCheck class="size-3.5" />
            {:else if item.type === "passkey"}
              <KeyRound class="size-3.5" />
            {:else if item.type === "credit-card"}
              <CreditCard class="size-3.5" />
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
              >{accountSubtitle}</span>
            {/if}
          </div>
        {:else}
          <span
            class="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80"
          >
            {#if item.type === "login"}
              <Globe class="size-3 text-primary/70" />
              {vault.t("vault.types.login")}
            {:else if item.type === "api-key"}
              <Braces class="size-3 text-primary/70" />
              {vault.t("vault.types.api_key")}
            {:else if item.type === "seed-phrase"}
              <Sprout class="size-3 text-primary/70" />
              {vault.t("vault.types.seed_phrase")}
            {:else if item.type === "authenticator"}
              <ShieldCheck class="size-3 text-primary/70" />
              {vault.t("vault.types.authenticator")}
            {:else if item.type === "passkey"}
              <KeyRound class="size-3 text-primary/70" />
              {vault.t("vault.types.passkey")}
            {:else if item.type === "credit-card"}
              <CreditCard class="size-3 text-primary/70" />
              {vault.t("vault.types.credit_card")}
            {:else}
              <StickyNote class="size-3 text-primary/70" />
              {vault.t("vault.types.secure_note")}
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
        {#if item.type !== "passkey"}
          <button
            type="button"
            onclick={() => void onToggleReveal(item.id)}
            aria-label={decrypted
              ? vault.t("vault.hide_value")
              : vault.t("vault.show_value")}
            aria-pressed={Boolean(decrypted)}
            data-testid="reveal-secret-btn"
            class="rounded-md p-1.5 text-muted-foreground/80 hover:bg-accent hover:text-foreground transition-colors"
          >
            {#if decrypted}<EyeOff class="size-3.5" />{:else}<Eye
                class="size-3.5"
              />{/if}
          </button>
          <button
            type="button"
            onclick={() => void onEditItem(item)}
            aria-label={vault.t("common.edit")}
            data-testid="edit-secret-btn"
            disabled={editDisabled}
            title={editDisabled ? editDisabledReason : undefined}
            class="rounded-md p-1.5 text-muted-foreground/80 hover:bg-accent hover:text-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
          >
            <Pencil class="size-3.5" />
          </button>
        {/if}
        <button
          type="button"
          onclick={() => void onDeleteSecret(item.id)}
          aria-label={vault.t("common.delete")}
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
        {#if item.type === "login"}
          <div class="grid grid-cols-[85px_1fr] items-center gap-2 text-xs">
            <span class="text-muted-foreground/70 font-medium"
              >{vault.t("vault.fields.website_label")}</span
            >
            <div
              class="flex items-center justify-between gap-2 min-w-0 bg-muted/20 hover:bg-muted/40 rounded-md px-2 py-1 transition-colors border border-border/20"
            >
              <span class="truncate text-foreground"
                >{item.websiteUrl || vault.t("vault.fields.no_website")}</span
              >
              {#if item.websiteUrl}
                <button
                  type="button"
                  onclick={() =>
                    void onCopyToClipboard(item.websiteUrl, item.id, "website")}
                  aria-label={vault.t("vault.copy_website_url")}
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
              >{vault.t("vault.fields.username")}</span
            >
            <div
              class="flex items-center justify-between gap-2 min-w-0 bg-muted/20 hover:bg-muted/40 rounded-md px-2 py-1 transition-colors border border-border/20"
            >
              <span class="truncate text-foreground"
                >{item.username || vault.t("vault.fields.no_username")}</span
              >
              {#if item.username}
                <button
                  type="button"
                  onclick={() =>
                    void onCopyToClipboard(item.username, item.id, "username")}
                  aria-label={vault.t("vault.copy_username")}
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
              >{vault.t("vault.fields.password")}</span
            >
            <div
              class="flex items-center justify-between gap-2 min-w-0 bg-muted/20 hover:bg-muted/40 rounded-md px-2 py-1 transition-colors border border-border/20"
            >
              <code
                class="truncate font-mono text-foreground"
                data-testid="revealed-secret"
              >
                {decrypted ? decrypted.password : "••••••••••••••••"}
              </code>
              <button
                type="button"
                onclick={() => void onCopySecret(item.id)}
                aria-label={vault.t("vault.copy_secret")}
                class="text-muted-foreground hover:text-foreground p-0.5 rounded-sm transition-colors shrink-0"
              >
                {#if copiedKey === `${item.id}-secret`}<Check
                    class="size-3 text-emerald-500"
                  />{:else}<Copy class="size-3" />{/if}
              </button>
            </div>
          </div>

          {#if decrypted?.notes}
            <div class="grid grid-cols-[85px_1fr] items-start gap-2 text-xs">
              <span class="text-muted-foreground/70 font-medium pt-1"
                >{vault.t("vault.fields.notes")}</span
              >
              <div
                class="text-muted-foreground whitespace-pre-wrap font-sans bg-muted/10 rounded-md px-2.5 py-1.5 text-[11px] leading-relaxed border border-border/20"
              >
                {decrypted.notes}
              </div>
            </div>
          {/if}
        {:else if item.type === "api-key"}
          <div class="grid grid-cols-[85px_1fr] items-center gap-2 text-xs">
            <span class="text-muted-foreground/70 font-medium"
              >{vault.t("vault.fields.website_label")}</span
            >
            <div
              class="flex items-center justify-between gap-2 min-w-0 bg-muted/20 hover:bg-muted/40 rounded-md px-2 py-1 transition-colors border border-border/20"
            >
              <span class="truncate text-foreground"
                >{item.websiteUrl || vault.t("vault.fields.no_website")}</span
              >
              {#if item.websiteUrl}
                <button
                  type="button"
                  onclick={() =>
                    void onCopyToClipboard(item.websiteUrl, item.id, "website")}
                  aria-label={vault.t("vault.copy_website_url")}
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
              >{vault.t("vault.fields.key")}</span
            >
            <div
              class="flex items-center justify-between gap-2 min-w-0 bg-muted/20 hover:bg-muted/40 rounded-md px-2 py-1 transition-colors border border-border/20"
            >
              <code
                class="break-all font-mono text-foreground"
                data-testid="revealed-secret"
              >
                {decrypted ? decrypted.primaryCredential : "••••••••••••••••"}
              </code>
              <button
                type="button"
                onclick={() => void onCopySecret(item.id)}
                aria-label={vault.t("vault.copy_secret")}
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
                >{vault.t("vault.fields.expires")}</span
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
                    void onCopyToClipboard(item.expiresAt, item.id, "expires")}
                  aria-label={vault.t("vault.copy_expiration_date")}
                  class="text-muted-foreground hover:text-foreground p-0.5 rounded-sm transition-colors"
                >
                  {#if copiedKey === `${item.id}-expires`}<Check
                      class="size-3 text-emerald-500"
                    />{:else}<Copy class="size-3" />{/if}
                </button>
              </div>
            </div>
          {/if}
        {:else if item.type === "seed-phrase"}
          <div class="grid grid-cols-[85px_1fr] items-center gap-2 text-xs">
            <span class="text-muted-foreground/70 font-medium"
              >{vault.t("vault.fields.account")}</span
            >
            <div
              class="flex items-center justify-between gap-2 min-w-0 bg-muted/20 hover:bg-muted/40 rounded-md px-2 py-1 transition-colors border border-border/20"
            >
              <span class="truncate text-foreground"
                >{item.name || vault.t("vault.fields.no_account_name")}</span
              >
              {#if item.name}
                <button
                  type="button"
                  onclick={() =>
                    void onCopyToClipboard(item.name, item.id, "name")}
                  aria-label={vault.t("vault.copy_account_name")}
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
                >{vault.t("vault.types.seed_phrase")}</span
              >
              <button
                type="button"
                onclick={() => void onCopySecret(item.id)}
                aria-label={vault.t("vault.copy_secret")}
                class="text-muted-foreground hover:text-foreground p-0.5 rounded-sm transition-colors shrink-0"
              >
                {#if copiedKey === `${item.id}-secret`}<Check
                    class="size-3 text-emerald-500"
                  />{:else}<Copy class="size-3" />{/if}
              </button>
            </div>
            <SeedPhraseGrid
              {vault}
              value={decrypted?.seed ?? ""}
              readonly
              revealed={Boolean(decrypted)}
            />
          </div>
        {:else if item.type === "authenticator"}
          <div class="grid grid-cols-[85px_1fr] items-center gap-2 text-xs">
            <span class="text-muted-foreground/70 font-medium"
              >{vault.t("vault.fields.current_code")}</span
            >
            <div
              class="flex items-center justify-between gap-2 min-w-0 rounded-md border border-primary/25 bg-primary/5 px-2.5 py-2"
            >
              <div class="min-w-0">
                <code
                  class="font-mono text-xl font-semibold tracking-[0.2em] text-foreground"
                  data-testid="authenticator-current-code"
                  data-period={authenticatorCode?.period}
                  >{authenticatorCode?.code ?? "••••••"}</code
                >
                {#if authenticatorCode}
                  <p class="mt-0.5 text-[10px] text-muted-foreground">
                    {vault.t("vault.fields.code_expires_in", {
                      count: String(authenticatorCode.secondsRemaining),
                    })}
                  </p>
                {/if}
              </div>
              {#if authenticatorCode}
                <button
                  type="button"
                  onclick={() =>
                    void onCopyToClipboard(
                      authenticatorCode.code,
                      item.id,
                      "current-code",
                    )}
                  aria-label={vault.t("vault.copy_current_code")}
                  class="shrink-0 rounded-sm p-1 text-muted-foreground transition-colors hover:text-foreground"
                >
                  {#if copiedKey === `${item.id}-current-code`}<Check
                      class="size-3.5 text-emerald-500"
                    />{:else}<Copy class="size-3.5" />{/if}
                </button>
              {/if}
            </div>
          </div>

          <div class="grid grid-cols-[85px_1fr] items-center gap-2 text-xs">
            <span class="text-muted-foreground/70 font-medium"
              >{vault.t("vault.fields.account")}</span
            >
            <div
              class="min-w-0 rounded-md border border-border/20 bg-muted/20 px-2 py-1"
            >
              <span class="truncate text-foreground"
                >{item.account || vault.t("common.none")}</span
              >
            </div>
          </div>

          <div
            class="grid grid-cols-[85px_1fr] items-center gap-2 text-xs"
            data-testid="authenticator-website"
          >
            <span class="text-muted-foreground/70 font-medium"
              >{vault.t("vault.fields.website_label")}</span
            >
            <div
              class="flex items-center justify-between gap-2 min-w-0 bg-muted/20 hover:bg-muted/40 rounded-md px-2 py-1 transition-colors border border-border/20"
            >
              <span class="truncate text-foreground"
                >{item.websiteUrl || vault.t("vault.fields.no_website")}</span
              >
              {#if item.websiteUrl}
                <button
                  type="button"
                  onclick={() =>
                    void onCopyToClipboard(item.websiteUrl, item.id, "website")}
                  aria-label={vault.t("vault.copy_website_url")}
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
              >{vault.t("vault.fields.authenticator_secret")}</span
            >
            <div
              class="flex min-w-0 items-center justify-between gap-2 rounded-md border border-border/20 bg-muted/20 px-2 py-1"
            >
              <code
                class="break-all font-mono text-foreground"
                data-testid="revealed-secret"
                >{decrypted ? decrypted.totpSecret : "••••••••••••••••"}</code
              >
              <button
                type="button"
                onclick={() => void onCopySecret(item.id)}
                aria-label={vault.t("vault.copy_authenticator_secret")}
                class="shrink-0 rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-foreground"
              >
                {#if copiedKey === `${item.id}-secret`}<Check
                    class="size-3 text-emerald-500"
                  />{:else}<Copy class="size-3" />{/if}
              </button>
            </div>
          </div>

          {#if item.backupCodeCount > 0}
          <div class="grid grid-cols-[85px_1fr] items-start gap-2 text-xs">
            <span class="pt-1 text-muted-foreground/70 font-medium"
              >{vault.t("vault.fields.backup_codes")}</span
            >
            <div
              class="space-y-1 rounded-md border border-border/20 bg-muted/20 px-2 py-1.5"
              data-testid="authenticator-backup-codes"
            >
              {#if decrypted}
                {#if decrypted.backupCodes.length > 0}
                  {#each decrypted.backupCodes as backupCode, backupIndex (`${backupCode}-${backupIndex}`)}
                    <div class="flex items-center justify-between gap-2">
                      <code class="break-all font-mono text-foreground"
                        >{backupCode}</code
                      >
                      <button
                        type="button"
                        onclick={() =>
                          void onCopyToClipboard(
                            backupCode,
                            item.id,
                            `backup-${backupIndex}`,
                          )}
                        aria-label={vault.t("vault.copy_backup_code")}
                        class="shrink-0 rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {#if copiedKey === `${item.id}-backup-${backupIndex}`}<Check
                            class="size-3 text-emerald-500"
                          />{:else}<Copy class="size-3" />{/if}
                      </button>
                    </div>
                  {/each}
                {:else}
                  <span class="text-muted-foreground"
                    >{vault.t("common.none")}</span
                  >
                {/if}
              {:else}
                <span class="font-mono text-foreground"
                  >••••••••</span
                >
              {/if}
            </div>
          </div>
          {/if}
        {:else if item.type === "passkey"}
          <div class="grid grid-cols-[85px_1fr] items-center gap-2 text-xs">
            <span class="text-muted-foreground/70 font-medium"
              >{vault.t("vault.fields.relying_party")}</span
            >
            <div
              class="min-w-0 rounded-md border border-border/20 bg-muted/20 px-2 py-1"
            >
              <span class="truncate text-foreground">{item.rpId}</span>
            </div>
          </div>
          <div class="grid grid-cols-[85px_1fr] items-center gap-2 text-xs">
            <span class="text-muted-foreground/70 font-medium"
              >{vault.t("vault.fields.account")}</span
            >
            <div
              class="min-w-0 rounded-md border border-border/20 bg-muted/20 px-2 py-1"
            >
              <span class="truncate text-foreground"
                >{item.passkeyUserDisplayName ||
                  item.passkeyUserName ||
                  vault.t("common.none")}</span
              >
            </div>
          </div>
          {#if item.passkeyUserDisplayName && item.passkeyUserName}
            <div class="grid grid-cols-[85px_1fr] items-center gap-2 text-xs">
              <span class="text-muted-foreground/70 font-medium"
                >{vault.t("vault.fields.username")}</span
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
            {vault.t("vault.fields.passkey_managed_hint")}
          </p>
        {:else if item.type === "credit-card"}
          <div class="grid grid-cols-[85px_1fr] items-center gap-2 text-xs">
            <span class="text-muted-foreground/70 font-medium"
              >{vault.t("vault.fields.title")}</span
            >
            <div
              class="min-w-0 rounded-md border border-border/20 bg-muted/20 px-2 py-1"
            >
              <span class="truncate text-foreground"
                >{item.title.trim() ||
                  vault.t("vault.fields.unnamed_card")}</span
              >
            </div>
          </div>

          <div class="grid grid-cols-[85px_1fr] items-center gap-2 text-xs">
            <span class="text-muted-foreground/70 font-medium"
              >{vault.t("vault.fields.cardholder_name")}</span
            >
            <div
              class="flex items-center justify-between gap-2 min-w-0 bg-muted/20 hover:bg-muted/40 rounded-md px-2 py-1 transition-colors border border-border/20"
            >
              <span class="truncate text-foreground"
                >{item.cardholderName.trim() ||
                  vault.t("common.none")}</span
              >
              {#if item.cardholderName.trim()}
                <button
                  type="button"
                  onclick={() =>
                    void onCopyToClipboard(
                      item.cardholderName,
                      item.id,
                      "cardholder",
                    )}
                  aria-label={vault.t("vault.copy_cardholder_name")}
                  class="text-muted-foreground hover:text-foreground p-0.5 rounded-sm transition-colors"
                >
                  {#if copiedKey === `${item.id}-cardholder`}<Check
                      class="size-3 text-emerald-500"
                    />{:else}<Copy class="size-3" />{/if}
                </button>
              {/if}
            </div>
          </div>

          <div class="grid grid-cols-[85px_1fr] items-center gap-2 text-xs">
            <span class="text-muted-foreground/70 font-medium"
              >{vault.t("vault.fields.card_number")}</span
            >
            <div
              class="flex items-center justify-between gap-2 min-w-0 bg-muted/20 hover:bg-muted/40 rounded-md px-2 py-1 transition-colors border border-border/20"
            >
              <code
                class="truncate font-mono text-foreground"
                data-testid="credit-card-number-value"
              >
                {decrypted
                  ? decrypted.cardNumber
                  : item.last4.trim()
                    ? `•••• ${item.last4}`
                    : "••••••••••••••••"}
              </code>
              {#if decrypted?.cardNumber}
                <button
                  type="button"
                  onclick={() =>
                    void onCopyToClipboard(
                      decrypted.cardNumber,
                      item.id,
                      "card-number",
                    )}
                  aria-label={vault.t("vault.copy_card_number")}
                  class="text-muted-foreground hover:text-foreground p-0.5 rounded-sm transition-colors shrink-0"
                >
                  {#if copiedKey === `${item.id}-card-number`}<Check
                      class="size-3 text-emerald-500"
                    />{:else}<Copy class="size-3" />{/if}
                </button>
              {/if}
            </div>
          </div>

          {#if cardExpiration}
            <div class="grid grid-cols-[85px_1fr] items-center gap-2 text-xs">
              <span class="text-muted-foreground/70 font-medium"
                >{vault.t("vault.fields.expiration")}</span
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
                      "expiration",
                    )}
                  aria-label={vault.t("vault.copy_expiration")}
                  class="text-muted-foreground hover:text-foreground p-0.5 rounded-sm transition-colors"
                >
                  {#if copiedKey === `${item.id}-expiration`}<Check
                      class="size-3 text-emerald-500"
                    />{:else}<Copy class="size-3" />{/if}
                </button>
              </div>
            </div>
          {/if}

          <div class="grid grid-cols-[85px_1fr] items-center gap-2 text-xs">
            <span class="text-muted-foreground/70 font-medium"
              >{vault.t("vault.fields.cvv")}</span
            >
            <div
              class="flex items-center justify-between gap-2 min-w-0 bg-muted/20 hover:bg-muted/40 rounded-md px-2 py-1 transition-colors border border-border/20"
            >
              <code
                class="truncate font-mono text-foreground"
                data-testid="credit-card-cvv-value"
              >
                {decrypted ? decrypted.cvv || vault.t("common.none") : "•••"}
              </code>
              {#if decrypted?.cvv}
                <button
                  type="button"
                  onclick={() =>
                    void onCopyToClipboard(decrypted.cvv, item.id, "cvv")}
                  aria-label={vault.t("vault.copy_cvv")}
                  class="text-muted-foreground hover:text-foreground p-0.5 rounded-sm transition-colors shrink-0"
                >
                  {#if copiedKey === `${item.id}-cvv`}<Check
                      class="size-3 text-emerald-500"
                    />{:else}<Copy class="size-3" />{/if}
                </button>
              {/if}
            </div>
          </div>

          {#if decrypted?.notes}
            <div class="grid grid-cols-[85px_1fr] items-start gap-2 text-xs">
              <span class="text-muted-foreground/70 font-medium pt-1"
                >{vault.t("vault.fields.notes")}</span
              >
              <div
                class="text-muted-foreground whitespace-pre-wrap font-sans bg-muted/10 rounded-md px-2.5 py-1.5 text-[11px] leading-relaxed border border-border/20"
              >
                {decrypted.notes}
              </div>
            </div>
          {/if}
        {:else}
          <div class="grid grid-cols-[85px_1fr] items-start gap-2 text-xs">
            <span class="text-muted-foreground/70 font-medium pt-1"
              >{vault.t("vault.fields.note")}</span
            >
            <div
              class="flex items-start justify-between gap-2 min-w-0 bg-muted/20 hover:bg-muted/40 rounded-md px-2.5 py-1.5 transition-colors border border-border/20"
            >
              {#if decrypted}
                <div
                  class="min-w-0 flex-1 text-[11px] leading-relaxed text-foreground"
                  data-testid="revealed-secret"
                >
                  <MarkdownContent source={decrypted.note} />
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
                aria-label={vault.t("vault.copy_note")}
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
