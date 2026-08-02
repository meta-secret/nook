<!--
Evidence for the middle link: the browser-local age device key. It carries one
identifier and the boundary a backup password does not cross.
-->
<script lang="ts">
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { LockKeyhole } from '@lucide/svelte'
  import { DeviceAccessProtectionKind } from '$app-wasm'
  import type { VaultState } from '$lib/vault.svelte'
  import type { DashboardText } from '../devices-access-dashboard-state'
  import { knownText, protectionLabel, textValue } from './access-chain'

  let {
    vault,
    protection,
    deviceId,
  }: {
    vault: VaultState
    protection: DeviceAccessProtectionKind
    deviceId: DashboardText
  } = $props()

  // A companion session's authority belongs to the paired device, so the
  // boundary is drawn around that identity rather than around local storage.
  const boundaryNote = $derived(
    protection === DeviceAccessProtectionKind.CompanionSession
      ? vault.t(I18N_KEYS.DevicesAccessBackupPasswordBoundaryCompanion)
      : vault.t(I18N_KEYS.DevicesAccessBackupPasswordBoundary),
  )
</script>

<div class="space-y-5">
  <dl class="grid gap-x-6 gap-y-4 sm:grid-cols-2">
    <div>
      <dt class="access-micro-label text-muted-foreground">
        {vault.t(I18N_KEYS.DevicesAccessDeviceId)}
      </dt>
      <dd
        class="mt-1.5 font-mono text-xs break-all text-foreground"
        data-testid="devices-access-device-id"
      >
        {knownText(deviceId)
          ? textValue(deviceId)
          : vault.t(I18N_KEYS.DevicesAccessUnknown)}
      </dd>
    </div>
    <div>
      <dt class="access-micro-label text-muted-foreground">
        {vault.t(I18N_KEYS.DevicesAccessProtectionLabel)}
      </dt>
      <dd class="mt-1.5 text-sm text-foreground">
        {protectionLabel(vault, protection)}
      </dd>
    </div>
  </dl>

  <p
    class="flex gap-2 rounded-lg bg-muted/40 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground"
  >
    <LockKeyhole class="mt-0.5 size-3.5 shrink-0" />
    <span>{boundaryNote}</span>
  </p>
</div>
