<script lang="ts">
  import * as Select from '$lib/components/ui/select'
  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
    id,
    disabled = false,
  }: {
    vault: VaultState
    id: string
    disabled?: boolean
  } = $props()

  const deviceModes = ['standard', 'anti-hacker'] as const

  function modeTranslationKey(
    mode: (typeof deviceModes)[number],
    suffix: 'title' | 'description',
  ) {
    return `device_protection.mode_${mode.replace('-', '_')}_${suffix}`
  }

  function selectMode(value: string | undefined) {
    if (value === 'standard' || value === 'anti-hacker') {
      vault.draftDeviceMode = value
    }
  }
</script>

<div class="space-y-2" data-testid="mode-group-device">
  <label class="block text-sm font-medium text-foreground" for={id}>
    {vault.t('device_protection.mode_group_label')}
  </label>
  <Select.Root
    type="single"
    value={vault.draftDeviceMode}
    onValueChange={selectMode}
    {disabled}
  >
    <Select.Trigger
      {id}
      class="h-10 w-full bg-background px-3"
      data-testid="device-mode-select"
      aria-describedby={`${id}-description`}
    >
      {vault.t(modeTranslationKey(vault.draftDeviceMode, 'title'))}
    </Select.Trigger>
    <Select.Content portalProps={{ disabled: true }}>
      {#each deviceModes as mode (mode)}
        <Select.Item value={mode}>
          {vault.t(modeTranslationKey(mode, 'title'))}
        </Select.Item>
      {/each}
    </Select.Content>
  </Select.Root>
  <p id={`${id}-description`} class="text-xs text-pretty text-muted-foreground">
    {vault.t(modeTranslationKey(vault.draftDeviceMode, 'description'))}
  </p>
</div>
