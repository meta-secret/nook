<script lang="ts">
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { FolderKey } from '@lucide/svelte'
  import type { NookLocalVaultEntry } from '$app-wasm'
  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
    entry,
  }: {
    vault: VaultState
    entry: NookLocalVaultEntry
  } = $props()
</script>

<div
  class="flex min-w-0 items-start gap-3"
  data-testid="login-vault-card"
  data-store-id={entry.storeId}
>
  <span class="nk-tile nk-tile-sm" aria-hidden="true">
    <FolderKey class="size-4" />
  </span>
  <span class="grid min-w-0 gap-1">
    <span class="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
      <span class="truncate text-[0.9375rem] font-semibold text-foreground">
        {entry.display_label(vault.t(I18N_KEYS.LoginVaultPickerUnnamed))}
      </span>
      <span class="truncate font-mono text-xs text-muted-foreground">
        {entry.storeId}
      </span>
    </span>
  </span>
</div>
