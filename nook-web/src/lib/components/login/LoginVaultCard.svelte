<script lang="ts">
  import { FolderKey } from '@lucide/svelte'
  import type { LocalVaultEntry } from '$lib/local-vault'
  import { vaultDisplayLabel } from '$lib/vault-display'
  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
    entry,
    active = false,
    interactive = false,
  }: {
    vault: VaultState
    entry: LocalVaultEntry
    active?: boolean
    interactive?: boolean
  } = $props()
</script>

<div
  class="flex items-start gap-3 rounded-lg border px-4 py-3 {active
    ? 'border-primary/40 bg-primary/5'
    : interactive
      ? 'border-border/60 bg-muted/20 transition-colors hover:border-primary/40 hover:bg-muted/40'
      : 'border-border/60 bg-muted/20'}"
  data-testid="login-vault-card"
  data-store-id={entry.storeId}
>
  <FolderKey
    class="mt-0.5 size-5 shrink-0 {active
      ? 'text-primary'
      : 'text-muted-foreground'}"
  />
  <span class="min-w-0 space-y-0.5">
    <span class="block text-sm font-semibold text-foreground">
      {vaultDisplayLabel(entry, vault.t)}
    </span>
    <span class="block truncate font-mono text-xs text-muted-foreground">
      {entry.storeId}
    </span>
  </span>
</div>
