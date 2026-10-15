<!--
Passphrase unlock beside a locked identity card: what a passphrase is for,
which one (when the vault has several) and its field. A passphrase opens
the selected vault directly, without this device's passkey; Passphrase on
the card's footer opens it.
-->
<script lang="ts">
  import { RefreshCw } from "@lucide/svelte";
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
    /** Backup passwords of the selected vault; one is chosen if several. */
    entries: readonly PasswordEntryChoice[];
    isVerifying: boolean;
    onUnlock: (request: CardPasswordUnlockRequest) => void | Promise<void>;
  } = $props();

  let password = $state("");
  let chosenId = $state("");
  const entryId = $derived(
    entries.some((entry) => entry.id === chosenId)
      ? chosenId
      : ((v) => (v ? v.id : ""))(entries[0]),
  );
  const fieldLabel = $derived.by(() => {
    const labelRequest: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.WorkspaceBackupPasswordLabel,
      replacements: { vault: vaultLabel },
    };
    return vault.t(labelRequest);
  });

  const body = $derived.by(() => {
    const bodyRequest: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.WorkspacePassphraseUnlockBody,
      replacements: { vault: vaultLabel },
    };
    return vault.t(bodyRequest);
  });

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    if (!entryId || !password.trim()) return;
    const request: CardPasswordUnlockRequest = {
      entryId,
      password: password.trim(),
    };
    void onUnlock(request);
  }
</script>

<div class="grid min-w-0 gap-5" data-testid="card-password-unlock">
  <div class="grid max-w-[60ch] gap-2">
    <p class="text-sm text-pretty text-foreground">{body}</p>
    <p class="text-xs text-pretty text-muted-foreground">
      {vault.t(I18N_KEYS.WorkspacePassphraseUnlockNote)}
    </p>
  </div>
  <form class="grid gap-3" onsubmit={submit}>
    {#if entries.length > 1}
      <label class="text-xs font-medium text-foreground" for="card-password-entry">
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
    <label class="text-xs font-medium text-foreground" for="card-password-input">
      {fieldLabel}
    </label>
    <div class="flex gap-2">
      <!-- svelte-ignore a11y_autofocus -->
      <input
        id="card-password-input"
        type="password"
        class="h-10 min-w-0 flex-1 border border-border bg-card px-3 text-sm text-foreground outline-none focus-visible:border-foreground/50 focus-visible:ring-2 focus-visible:ring-ring"
        autocomplete="current-password"
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
</div>
