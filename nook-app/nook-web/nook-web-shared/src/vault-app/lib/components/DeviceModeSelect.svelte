<script lang="ts">
  type DeviceModeTranslation = { readonly mode: DeviceMode; readonly suffix: DeviceModeTranslationPart }

  import { I18N_KEYS } from '../../../generated/i18n-keys'
  import { DeviceMode } from '$app-wasm'
  import * as Select from '$lib/components/ui/select'
  import type { VaultState } from '$lib/vault.svelte'
  import { DeviceModeTranslationPart } from './device-mode-select-state'

  let {
    vault,
    id,
    disabled = false,
  }: {
    vault: VaultState
    id: string
    disabled?: boolean
  } = $props()

  const deviceModes = [DeviceMode.Standard, DeviceMode.AntiHacker]

  function modeTranslationKey(
    { mode, suffix }: DeviceModeTranslation,
  ) {
    if (mode === DeviceMode.AntiHacker) {
      return suffix === DeviceModeTranslationPart.Title
        ? I18N_KEYS.DeviceProtectionModeAntiHackerTitle
        : I18N_KEYS.DeviceProtectionModeAntiHackerDescription
    }
    return suffix === DeviceModeTranslationPart.Title
      ? I18N_KEYS.DeviceProtectionModeStandardTitle
      : I18N_KEYS.DeviceProtectionModeStandardDescription
  }

  function selectMode(value: string) {
    const selectedMode = Number(value)
    if (selectedMode === DeviceMode.Standard)
      vault.draftDeviceMode = DeviceMode.Standard
    if (selectedMode === DeviceMode.AntiHacker)
      vault.draftDeviceMode = DeviceMode.AntiHacker
  }
</script>

<div class="space-y-2" data-testid="mode-group-device">
  <label class="block text-sm font-medium text-foreground" for={id}>
    {vault.t(I18N_KEYS.DeviceProtectionModeGroupLabel)}
  </label>
  <Select.Root
    type="single"
    value={String(vault.draftDeviceMode)}
    onValueChange={selectMode}
    {disabled}
  >
    <Select.Trigger
      {id}
      class="h-10 w-full bg-background px-3"
      data-testid="device-mode-select"
      aria-describedby={`${id}-description`}
    >
      {vault.t(
        (() => { const modeTranslationKeyArgs: Parameters<typeof modeTranslationKey>[0] = { mode: vault.draftDeviceMode, suffix: DeviceModeTranslationPart.Title }; return modeTranslationKey(
          modeTranslationKeyArgs,
        ); })(),
      )}
    </Select.Trigger>
    <Select.Content portalProps={{ disabled: true }}>
      {#each deviceModes as mode (mode)}
        <Select.Item value={String(mode)}>
          {vault.t((() => { const modeTranslationKeyArgs2: Parameters<typeof modeTranslationKey>[0] = { mode, suffix: DeviceModeTranslationPart.Title }; return modeTranslationKey(modeTranslationKeyArgs2); })())}
        </Select.Item>
      {/each}
    </Select.Content>
  </Select.Root>
  <p id={`${id}-description`} class="text-xs text-pretty text-muted-foreground">
    {vault.t(
      (() => { const modeTranslationKeyArgs3: Parameters<typeof modeTranslationKey>[0] = { mode: vault.draftDeviceMode, suffix: DeviceModeTranslationPart.Description }; return modeTranslationKey(
        modeTranslationKeyArgs3,
      ); })(),
    )}
  </p>
</div>
