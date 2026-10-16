<!--
Reset this browser's device identity when its passkey or PIN cannot be used,
or its protected key cannot be read. Local encrypted vaults stay; saved sync
connections go. Shown where unlocking happens.
-->
<script lang="ts">
  import { CircleHelp } from '@lucide/svelte'
  import { I18N_KEYS } from '../../../generated/i18n-keys'
  import { Button } from '$lib/components/ui/button'
  import { DeviceProtectionRecoveryActions } from '$lib/vault/device-protection.svelte'
  import type { VaultState } from '$lib/vault.svelte'
  import { DeviceRecoveryKind } from './device-recovery'

  let {
    vault,
    kind,
    recoveryAppId,
  }: {
    vault: VaultState
    kind: Exclude<DeviceRecoveryKind, DeviceRecoveryKind.None>
    /** The app key the reset expects to replace. */
    recoveryAppId: string
  } = $props()

  const warning = $derived(
    kind === DeviceRecoveryKind.Pin
      ? I18N_KEYS.DeviceProtectionPinRecoveryWarning
      : kind === DeviceRecoveryKind.Unavailable
        ? I18N_KEYS.DeviceProtectionUnavailableRecoveryWarning
        : I18N_KEYS.DeviceProtectionRecoveryWarning,
  )
  const action = $derived(
    kind === DeviceRecoveryKind.Pin
      ? I18N_KEYS.DeviceProtectionPinRecoveryAction
      : kind === DeviceRecoveryKind.Unavailable
        ? I18N_KEYS.DeviceProtectionUnavailableRecoveryAction
        : I18N_KEYS.DeviceProtectionRecoveryAction,
  )

  function recover(): void {
    if (!confirm(vault.t(I18N_KEYS.DeviceProtectionRecoveryConfirm))) return
    const recoveryRequest: Parameters<
      DeviceProtectionRecoveryActions['resetDeviceProtectionForRecovery']
    >[0] = { expectedAppId: recoveryAppId }
    void new DeviceProtectionRecoveryActions(
      vault,
    ).resetDeviceProtectionForRecovery(recoveryRequest)
  }
</script>

<div
  class="rounded-md border border-border/60 bg-muted/20 p-3"
  data-testid="device-recovery"
  data-kind={kind}
>
  <div class="flex gap-2 text-xs text-muted-foreground">
    <CircleHelp class="mt-0.5 size-4 shrink-0" />
    <p>{vault.t(warning)}</p>
  </div>
  <Button
    class="mt-2 h-auto px-0 text-xs"
    variant="link"
    disabled={vault.isVerifying}
    data-testid="device-protection-recovery-btn"
    onclick={recover}
  >
    {vault.t(action)}
  </Button>
</div>
