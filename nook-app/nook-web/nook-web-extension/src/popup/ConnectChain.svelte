<!--
What connects to what: the key (passkey or PIN) opens this extension now;
the identity and its vaults connect to it next. The Nook tab and the side
panel lead their key ceremonies with it.
-->
<script lang="ts">
  import { Asterisk, Fingerprint, FolderKey, Puzzle } from '@lucide/svelte'
  import {
    I18N_KEYS,
    type I18nKey,
  } from '../../../nook-web-shared/src/generated/i18n-keys'
  import { type ExtensionI18n, extensionLocaleCatalog } from '../lib/i18n'
  import type { DeviceProtectionStatus } from '../lib/nook-wasm'
  import {
    DeviceProtectionKeyKind,
    DeviceProtectionPhase,
    DeviceProtectionStageMap,
  } from './device-protection-ceremony'

  type ConnectChainProps = {
    readonly i18n: ExtensionI18n
    /** The status the ceremony beside the chain sets up or unlocks. */
    readonly status: DeviceProtectionStatus
  }

  let { i18n, status }: ConnectChainProps = $props()

  function translatePlain(key: I18nKey): string {
    return i18n.t(extensionLocaleCatalog.plainExtensionTranslation(key))
  }

  const stage = $derived(DeviceProtectionStageMap.from(status))
  /** The extension's key is a PIN rather than a passkey. */
  const keyKind = $derived(DeviceProtectionStageMap.keyKind(stage))
  /** First use: the key is being set up; the identity connects next. */
  const phase = $derived(DeviceProtectionStageMap.phase(stage))

  /** The chain's accessible summary for the key being set up or used. */
  function summaryKey(): I18nKey {
    switch (keyKind) {
      case DeviceProtectionKeyKind.Pin:
        return I18N_KEYS.ExtensionDeviceSetupChainPin
      case DeviceProtectionKeyKind.Passkey:
        return I18N_KEYS.ExtensionDeviceSetupChainPasskey
    }
  }

  function keyLabel(): I18nKey {
    switch (keyKind) {
      case DeviceProtectionKeyKind.Pin:
        return I18N_KEYS.ExtensionDeviceSetupNodePin
      case DeviceProtectionKeyKind.Passkey:
        return I18N_KEYS.ExtensionDeviceSetupNodePasskey
    }
  }
</script>

<div
  class="connect-chain"
  role="img"
  aria-label={translatePlain(summaryKey())}
  data-testid="device-setup-chain"
  data-key={keyKind}
>
  <div class="chain-node is-on" aria-hidden="true">
    <span class="chain-icon">
      {#if keyKind === DeviceProtectionKeyKind.Pin}
        <Asterisk size={18} />
      {:else}
        <Fingerprint size={18} />
      {/if}
    </span>
    <span class="chain-label">
      {translatePlain(keyLabel())}
    </span>
  </div>
  <span class="chain-link is-on" aria-hidden="true"></span>
  <div class="chain-node is-on" aria-hidden="true">
    <span class="chain-icon"><Puzzle size={18} /></span>
    <span class="chain-label">
      {translatePlain(I18N_KEYS.ExtensionDeviceSetupNodeExtension)}
    </span>
  </div>
  <span class="chain-link" aria-hidden="true"></span>
  <div class="chain-node" aria-hidden="true">
    <span class="chain-icon"><FolderKey size={18} /></span>
    <span class="chain-label">
      {translatePlain(I18N_KEYS.ExtensionDeviceSetupNodeIdentity)}
    </span>
    {#if phase === DeviceProtectionPhase.Setup}
      <span class="chain-tag">
        {translatePlain(I18N_KEYS.ExtensionDeviceSetupNodeNext)}
      </span>
    {/if}
  </div>
</div>
