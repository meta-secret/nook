<!--
Reading this as: Operate-mode identity representation control, preserving the
selected identity context while making List and Graph mutually exclusive.
-->
<script lang="ts">
  import { List, Network } from '@lucide/svelte'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import type { VaultState } from '$lib/vault.svelte'
  import { DevicesAccessRepresentationKind } from '../devices-access-dashboard-state'

  let {
    vault,
    identityLabel,
    selectedRepresentation,
    graphDisabled,
    onSelectRepresentation,
  }: {
    vault: VaultState
    identityLabel: string
    selectedRepresentation: DevicesAccessRepresentationKind
    graphDisabled: boolean
    onSelectRepresentation: (
      representation: DevicesAccessRepresentationKind,
    ) => void
  } = $props()
</script>

<header
  class="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between"
>
  <div class="min-w-0">
    <h2 class="truncate text-xl font-semibold tracking-tight text-foreground">
      {identityLabel}
    </h2>
    <p class="mt-1 text-sm text-muted-foreground">
      {vault.t(I18N_KEYS.DevicesAccessSelectedIdentity)}
    </p>
  </div>
  <div
    class="inline-flex self-start rounded-lg border border-border p-1 sm:self-auto"
    role="group"
    aria-label={vault.t(I18N_KEYS.DevicesAccessLayoutGroup)}
    data-testid="devices-access-representation-switch"
  >
    <button
      type="button"
      class="flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors {selectedRepresentation ===
      DevicesAccessRepresentationKind.List
        ? 'bg-muted text-foreground'
        : 'text-muted-foreground hover:text-foreground'}"
      aria-pressed={selectedRepresentation ===
        DevicesAccessRepresentationKind.List}
      data-testid="devices-access-layout-list"
      onclick={() =>
        onSelectRepresentation(DevicesAccessRepresentationKind.List)}
    >
      <List class="size-4" aria-hidden="true" />
      {vault.t(I18N_KEYS.DevicesAccessLayoutList)}
    </button>
    <button
      type="button"
      class="flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors {selectedRepresentation ===
      DevicesAccessRepresentationKind.Graph
        ? 'bg-muted text-foreground'
        : 'text-muted-foreground hover:text-foreground'}"
      aria-pressed={selectedRepresentation ===
        DevicesAccessRepresentationKind.Graph}
      disabled={graphDisabled}
      data-testid="devices-access-layout-graph"
      onclick={() =>
        onSelectRepresentation(DevicesAccessRepresentationKind.Graph)}
    >
      <Network class="size-4" aria-hidden="true" />
      {vault.t(I18N_KEYS.DevicesAccessLayoutGraph)}
    </button>
  </div>
</header>
