<script lang="ts">
  import { untrack } from "svelte";
  import type { VaultState } from "$lib/vault.svelte";
  import { DeviceProtectionActions } from "$lib/vault/device-protection.svelte";
  import { DeviceProtectionStatus, DeviceMode } from "$app-wasm";
  import { I18N_KEYS as K } from "../../../generated/i18n-keys";
  let {
    vault,
    initializeSession = true,
  }: { vault: VaultState; initializeSession?: boolean } = $props();
  const actions = untrack(() => new DeviceProtectionActions(vault));
  let pin = $state("");
  let confirmPin = $state("");
  let busy = $state(false);
  let passkeyLabel = $state(
    untrack(() => vault.t(K.DeviceProtectionPasskeyDefaultLabel)),
  );
  const setup = $derived(
    vault.deviceProtectionStatus === DeviceProtectionStatus.Missing ||
      vault.deviceProtectionStatus === DeviceProtectionStatus.Plaintext,
  );
  async function authorize() {
    busy = true;
    try {
      if (setup) {
        const request: Parameters<
          DeviceProtectionActions["setupDeviceProtection"]
        >[0] = {
          passkeyLabel,
          deviceMode: DeviceMode.Standard,
          initializeSession,
        };
        await actions.setupDeviceProtection(request);
      } else if (
        vault.deviceProtectionStatus === DeviceProtectionStatus.PinSetup
      ) {
        const request: Parameters<
          DeviceProtectionActions["setupPinDeviceProtection"]
        >[0] = { pin, confirmPin, initializeSession };
        await actions.setupPinDeviceProtection(request);
      } else if (vault.deviceProtectionStatus === DeviceProtectionStatus.Pin) {
        const request: Parameters<
          DeviceProtectionActions["unlockPinDeviceProtection"]
        >[0] = { pin, initializeSession };
        await actions.unlockPinDeviceProtection(request);
      } else if (
        vault.deviceProtectionStatus === DeviceProtectionStatus.Passkey
      ) {
        const request: Parameters<
          DeviceProtectionActions["unlockDeviceProtection"]
        >[0] = { initializeSession };
        await actions.unlockDeviceProtection(request);
      }
    } finally {
      busy = false;
      pin = "";
      confirmPin = "";
    }
  }
</script>

<form
  class="stack"
  onsubmit={(event) => {
    event.preventDefault();
    void authorize();
  }}
>
  <h2>{vault.t(K.DeviceProtectionTitle)}</h2>
  <p class="muted">
    {vault.t(
      setup
        ? K.DeviceProtectionSetupDescription
        : K.DeviceProtectionUnlockDescription,
    )}
  </p>
  {#if setup}<label
      >{vault.t(K.DeviceProtectionPasskeyLabel)}<input
        bind:value={passkeyLabel}
        autocomplete="off"
      /></label
    >{/if}
  {#if vault.deviceProtectionStatus === DeviceProtectionStatus.Pin || vault.deviceProtectionStatus === DeviceProtectionStatus.PinSetup}
    <label
      >{vault.t(K.DeviceProtectionPinLabel)}<input
        type="password"
        bind:value={pin}
        autocomplete="current-password"
      /></label
    >
    {#if vault.deviceProtectionStatus === DeviceProtectionStatus.PinSetup}<label
        >{vault.t(K.DeviceProtectionPinConfirmLabel)}<input
          type="password"
          bind:value={confirmPin}
          autocomplete="new-password"
        /></label
      >{/if}
  {/if}
  {#if vault.deviceProtectionStatus === DeviceProtectionStatus.Error}<p
      role="alert"
    >
      {vault.t(K.DeviceProtectionUnavailableDescription)}
    </p>
  {:else}<button
      class="primary"
      disabled={busy ||
        vault.deviceProtectionStatus === DeviceProtectionStatus.Loading}
      >{vault.t(
        busy
          ? K.WorkspaceBusy
          : setup
            ? K.DeviceProtectionSetupAction
            : vault.deviceProtectionStatus === DeviceProtectionStatus.PinSetup
              ? K.DeviceProtectionPinSetupAction
              : vault.deviceProtectionStatus === DeviceProtectionStatus.Pin
                ? K.DeviceProtectionPinUnlockAction
                : K.DeviceProtectionUnlockAction,
      )}</button
    >{/if}
</form>
