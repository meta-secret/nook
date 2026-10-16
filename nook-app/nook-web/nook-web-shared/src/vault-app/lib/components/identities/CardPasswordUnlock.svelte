<!--
Passphrase unlock for one locked vault, under its passkey in the vault's
panel: the passphrase by the title it was saved with (a choice when there
are several) and its field. A vault without a passphrase says so.
-->
<script lang="ts">
  import { ArrowRight, Check, KeyRound, RefreshCw } from "@lucide/svelte";
  import { I18N_KEYS } from "../../../../generated/i18n-keys";
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

<div class="grid min-w-0 gap-2" data-testid="card-password-unlock">
  {#if entries.length === 0}
    <p
      class="flex items-center gap-2 text-sm text-muted-foreground"
      data-testid="card-password-caption"
    >
      <KeyRound class="size-4 flex-none opacity-60" aria-hidden="true" />
      {vault.t(I18N_KEYS.WorkspacePassphraseUnlockNone)}
    </p>
  {:else}
    <form class="grid gap-2" aria-label={vaultLabel} onsubmit={submit}>
      {#if entries.length > 1}
        <!-- One row per passphrase, the first chosen: radios keep arrow keys
             and screen readers, styled like the panel's other rows. -->
        <fieldset class="grid gap-1" data-testid="card-password-entry">
          <legend class="sr-only">
            {vault.t(I18N_KEYS.WorkspacePassphraseUnlockChoose)}
          </legend>
          {#each entries as entry (entry.id)}
            {@const selected = entry.id === chosen.id}
            <label
              class="flex h-9 min-w-0 cursor-pointer items-center gap-2 border px-3 text-sm transition-colors has-[input:focus-visible]:border-foreground/60 {selected
                ? 'border-foreground/40 bg-accent text-foreground'
                : 'border-border text-muted-foreground hover:bg-accent/50 hover:text-foreground'}"
            >
              <input
                type="radio"
                class="sr-only"
                name="card-password-entry"
                value={entry.id}
                checked={selected}
                disabled={isVerifying}
                onchange={() => (chosenId = entry.id)}
              />
              <KeyRound class="size-4 flex-none opacity-70" aria-hidden="true" />
              <span class="min-w-0 flex-1 truncate">{entry.label}</span>
              {#if selected}
                <Check class="size-3.5 flex-none" aria-hidden="true" />
              {/if}
            </label>
          {/each}
        </fieldset>
      {:else}
        <span
          class="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground"
        >
          <KeyRound
            class="size-4 flex-none text-muted-foreground"
            aria-hidden="true"
          />
          <span class="truncate">{title}</span>
        </span>
      {/if}
      <div
        class="flex h-11 min-w-0 border border-border bg-background transition-colors focus-within:border-foreground/50"
      >
        <input
          type="password"
          class="min-w-0 flex-1 bg-transparent px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground/70"
          autocomplete="current-password"
          aria-label={title}
          placeholder={vault.t(I18N_KEYS.WorkspacePassphraseUnlockPlaceholder)}
          bind:value={password}
          data-testid="card-password-input"
        />
        <button
          type="submit"
          class="inline-flex flex-none items-center gap-2 border-l border-border px-4 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-default disabled:text-muted-foreground disabled:hover:bg-transparent"
          disabled={isVerifying || !password.trim()}
          data-testid="card-password-submit"
        >
          {#if isVerifying}
            <RefreshCw class="size-3.5 animate-spin" aria-hidden="true" />
          {/if}
          {vault.t(I18N_KEYS.WorkspaceUnlock)}
          <ArrowRight class="size-3.5" aria-hidden="true" />
        </button>
      </div>
    </form>
  {/if}
</div>
