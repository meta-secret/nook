<!--
Passphrase unlock beside a locked identity card, for one of its vaults: the
passphrase (by the title it was saved with) opening that vault, drawn
rather than explained, then its field. The key button on a vault row
opens it; a vault without a passphrase says so instead.
-->
<script lang="ts">
  import { FolderKey, KeyRound, RefreshCw } from "@lucide/svelte";
  import { I18N_KEYS } from "../../../../generated/i18n-keys";
  import { Button } from "$lib/components/ui/button";
  import type { VaultState } from "$lib/vault.svelte";

  type PasswordEntryChoice = { readonly id: string; readonly label: string };
  type CardPasswordUnlockRequest = {
    readonly entryId: string;
    readonly password: string;
  };

  let {
    vault,
    vaultLabel,
    entries,
    isVerifying,
    onUnlock,
  }: {
    vault: VaultState;
    vaultLabel: string;
    /** Passphrases of the selected vault; one is chosen if several. */
    entries: readonly PasswordEntryChoice[];
    isVerifying: boolean;
    onUnlock: (request: CardPasswordUnlockRequest) => void | Promise<void>;
  } = $props();

  let password = $state("");
  let chosenId = $state("");
  const noEntry: PasswordEntryChoice = { id: "", label: "" };
  const chosen = $derived(
    entries.find((entry) => entry.id === chosenId) ||
      entries.find(() => true) ||
      noEntry,
  );
  const title = $derived(
    chosen.label || vault.t(I18N_KEYS.WorkspacePassphraseNode),
  );

  function vaultText(key: string): string {
    const request: Parameters<typeof vault.t>[0] = {
      key,
      replacements: { vault: vaultLabel },
    };
    return vault.t(request);
  }

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    if (!chosen.id || !password.trim()) return;
    const request: CardPasswordUnlockRequest = {
      entryId: chosen.id,
      password: password.trim(),
    };
    void onUnlock(request);
  }
</script>

{#snippet node(label: string, state: string, strong: boolean, icon: "key" | "vault")}
  <div class="flex min-w-0 flex-col items-center gap-2">
    <span class="nk-pair-node" data-state={state}>
      {#if icon === "key"}
        <KeyRound class="size-5" aria-hidden="true" />
      {:else}
        <FolderKey class="size-5" aria-hidden="true" />
      {/if}
    </span>
    <span
      class="max-w-28 truncate text-center text-[11px] leading-tight {strong
        ? 'font-semibold text-foreground'
        : 'text-muted-foreground'}"
    >
      {label}
    </span>
  </div>
{/snippet}

<div class="grid min-w-0 gap-5" data-testid="card-password-unlock">
  <figure class="grid justify-items-start gap-3">
    <div class="flex items-start gap-1 sm:gap-2" aria-hidden="true">
      {@render node(
        title,
        entries.length > 0 ? "on" : "missing",
        entries.length > 0,
        "key",
      )}
      <span
        class="nk-pair-link"
        data-state={isVerifying ? "live" : entries.length > 0 ? "on" : "off"}
      ></span>
      {@render node(vaultLabel, "on", false, "vault")}
    </div>
    <figcaption
      class="text-sm text-pretty text-muted-foreground"
      data-testid="card-password-caption"
    >
      {entries.length > 0
        ? vaultText(I18N_KEYS.WorkspacePassphraseUnlockCaption)
        : vaultText(I18N_KEYS.WorkspacePassphraseUnlockNone)}
    </figcaption>
  </figure>

  {#if entries.length > 0}
    <form class="grid gap-3" onsubmit={submit}>
      {#if entries.length > 1}
        <label
          class="text-xs font-medium text-foreground"
          for="card-password-entry"
        >
          {vault.t(I18N_KEYS.WorkspacePassphraseUnlockChoose)}
        </label>
        <select
          id="card-password-entry"
          class="h-10 w-full border border-border bg-card px-2 text-sm text-foreground"
          bind:value={chosenId}
          data-testid="card-password-entry"
        >
          {#each entries as entry (entry.id)}
            <option value={entry.id}>{entry.label}</option>
          {/each}
        </select>
      {/if}
      <div class="flex gap-2">
        <!-- svelte-ignore a11y_autofocus -->
        <input
          type="password"
          class="h-10 min-w-0 flex-1 border border-border bg-card px-3 text-sm text-foreground outline-none focus-visible:border-foreground/50 focus-visible:ring-2 focus-visible:ring-ring"
          autocomplete="current-password"
          aria-label={title}
          placeholder={vault.t(I18N_KEYS.WorkspacePassphraseUnlockPlaceholder)}
          autofocus
          bind:value={password}
          data-testid="card-password-input"
        />
        <Button
          type="submit"
          class="h-10"
          disabled={isVerifying || !password.trim()}
          data-testid="card-password-submit"
        >
          {#if isVerifying}
            <RefreshCw class="size-3.5 animate-spin" />
          {/if}
          {vault.t(I18N_KEYS.WorkspaceUnlock)}
        </Button>
      </div>
    </form>
  {/if}
</div>
