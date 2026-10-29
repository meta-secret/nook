<!--
The current identity's overview, opened beside its card on the hub: actions
first, details after. The same panel serves an identity with a vault open
and one unlocked without any.
-->
<script lang="ts">
  import { X } from '@lucide/svelte'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import type { NookIdentityHealth } from '$app-wasm'
  import type { VaultState } from '$lib/vault.svelte'
  import type { WorkspaceSection } from '$lib/vault/state/ui.svelte'
  import IdentityPanel from './IdentityPanel.svelte'

  let {
    vault,
    health,
    onOpen,
    onAddSyncProvider,
    onClose,
  }: {
    vault: VaultState
    health: NookIdentityHealth
    onOpen: (section: WorkspaceSection) => void
    onAddSyncProvider: () => void
    onClose: () => void
  } = $props()
</script>

<div class="grid gap-4">
  <header class="flex items-center justify-between gap-3">
    <h2 class="text-lg font-semibold tracking-tight text-foreground">
      {vault.t(I18N_KEYS.IdentityOverviewEyebrow)}
    </h2>
    <button
      type="button"
      class="grid size-8 place-items-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      aria-label={vault.t(I18N_KEYS.IdentityOverviewClosePanel)}
      title={vault.t(I18N_KEYS.IdentityOverviewClosePanel)}
      data-testid="identity-overview-close"
      onclick={onClose}
    >
      <X class="size-4" aria-hidden="true" />
    </button>
  </header>
  <IdentityPanel {vault} {health} {onOpen} {onAddSyncProvider} />
</div>
