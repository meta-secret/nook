<script lang="ts">
  import * as Select from '$lib/components/ui/select'
  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
    kind,
    id,
    disabled = false,
  }: {
    vault: VaultState
    kind: 'vault' | 'replication'
    id: string
    disabled?: boolean
  } = $props()

  const modes = $derived(
    kind === 'vault'
      ? (['simple', 'nexus'] as const)
      : (['personal', 'shared'] as const),
  )
  const selectedMode = $derived(
    kind === 'vault' ? vault.draftVaultType : vault.draftReplicationType,
  )
  const keyPrefix = $derived(
    kind === 'vault'
      ? 'architecture_modes.vault_type'
      : 'architecture_modes.replication_type',
  )

  function selectMode(value: string | undefined) {
    if (kind === 'vault' && (value === 'simple' || value === 'nexus')) {
      vault.draftVaultType = value
    } else if (
      kind === 'replication' &&
      (value === 'personal' || value === 'shared')
    ) {
      vault.draftReplicationType = value
    }
  }
</script>

<div class="space-y-2" data-testid={`mode-group-${kind}`}>
  <label class="block text-sm font-medium text-foreground" for={id}>
    {vault.t(`${keyPrefix}_title`)}
  </label>
  <Select.Root
    type="single"
    value={selectedMode}
    onValueChange={selectMode}
    {disabled}
  >
    <Select.Trigger
      {id}
      class="h-10 w-full bg-background px-3"
      data-testid={`${kind}-mode-select`}
      aria-describedby={`${id}-description`}
    >
      {vault.t(`${keyPrefix}_${selectedMode}_title`)}
    </Select.Trigger>
    <Select.Content portalProps={{ disabled: true }}>
      {#each modes as mode (mode)}
        <Select.Item value={mode} data-testid={`mode-option-${mode}`}>
          {vault.t(`${keyPrefix}_${mode}_title`)}
        </Select.Item>
      {/each}
    </Select.Content>
  </Select.Root>
  <p id={`${id}-description`} class="text-xs text-pretty text-muted-foreground">
    {vault.t(`${keyPrefix}_${selectedMode}_description`)}
  </p>
</div>
