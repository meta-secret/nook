<!--
Backup-password unlock beside a locked identity card: which password (when
the vault has several) and its field. A backup password opens the selected
vault directly, without this device's passkey. Backup password on the
card's footer opens it.
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

<div class="grid min-w-0 gap-2" data-testid="card-password-unlock">
  <form class="grid gap-3" onsubmit={submit}>
    {#if entries.length > 1}
      <select
        class="h-10 w-full border border-border bg-card px-2 text-sm text-foreground"
        bind:value={chosenId}
        aria-label={vault.t(I18N_KEYS.WorkspaceBackupPasswordButton)}
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
