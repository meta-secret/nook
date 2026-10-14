<!--
Backup-password fallback on a locked identity card: a quiet link that opens
one password field for the selected vault. A backup password opens that
vault directly, without this device's passkey.
-->
<script lang="ts">
  import { KeyRound, RefreshCw } from "@lucide/svelte";
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

  let open = $state(false);
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

<div class="border-t border-border px-4 py-3 sm:px-5" data-testid="card-password-unlock">
  {#if !open}
    <button
      type="button"
      class="inline-flex items-center gap-1.5 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      data-testid="card-password-unlock-open"
      disabled={isVerifying}
      onclick={() => (open = true)}
    >
      <KeyRound class="size-3.5" aria-hidden="true" />
      {vault.t(I18N_KEYS.WorkspaceUseBackupPassword)}
    </button>
  {:else}
    <form class="grid gap-2" onsubmit={submit}>
      <label class="text-xs font-medium text-foreground" for="card-password-input">
        {fieldLabel}
      </label>
      {#if entries.length > 1}
        <select
          class="h-9 w-full border border-border bg-card px-2 text-sm text-foreground"
          bind:value={chosenId}
          data-testid="card-password-entry"
        >
          {#each entries as entry (entry.id)}
            <option value={entry.id}>{entry.label}</option>
          {/each}
        </select>
      {/if}
      <div class="flex gap-2">
        <input
          id="card-password-input"
          type="password"
          class="h-9 min-w-0 flex-1 border border-border bg-card px-3 text-sm text-foreground outline-none focus-visible:border-foreground/50 focus-visible:ring-2 focus-visible:ring-ring"
          autocomplete="current-password"
          bind:value={password}
          data-testid="card-password-input"
        />
        <Button
          type="submit"
          size="sm"
          class="h-9"
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
