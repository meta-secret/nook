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

<header class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
  <div class="min-w-0">
    <p class="nk-label">{vault.t(I18N_KEYS.DevicesAccessSelectedIdentity)}</p>
    <h2
      class="mt-1 truncate text-xl font-semibold tracking-tight text-foreground"
    >
      {identityLabel}
    </h2>
  </div>
  <div
    class="nk-chips self-start sm:self-auto"
    role="group"
    aria-label={vault.t(I18N_KEYS.DevicesAccessLayoutGroup)}
    data-testid="devices-access-representation-switch"
  >
    <button
      type="button"
      class="nk-chip h-9"
      aria-pressed={selectedRepresentation ===
        DevicesAccessRepresentationKind.List}
      data-testid="devices-access-layout-list"
      onclick={() =>
        onSelectRepresentation(DevicesAccessRepresentationKind.List)}
    >
      <List class="size-3.5" aria-hidden="true" />
      {vault.t(I18N_KEYS.DevicesAccessLayoutList)}
    </button>
    <button
      type="button"
      class="nk-chip h-9 disabled:cursor-not-allowed disabled:opacity-50"
      aria-pressed={selectedRepresentation ===
        DevicesAccessRepresentationKind.Graph}
      disabled={graphDisabled}
      data-testid="devices-access-layout-graph"
      onclick={() =>
        onSelectRepresentation(DevicesAccessRepresentationKind.Graph)}
    >
      <Network class="size-3.5" aria-hidden="true" />
      {vault.t(I18N_KEYS.DevicesAccessLayoutGraph)}
    </button>
  </div>
</header>
