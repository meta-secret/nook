<!--
PIN unlock on a locked identity card. An identity whose key on this browser
is a PIN (passkeys were unavailable when it was made) unlocks here instead of
with a passkey ceremony. The prompt takes the vault panel's place, so a wrong
PIN and this browser's PIN recovery show here too.
-->
<script lang="ts">
  import { RefreshCw } from "@lucide/svelte";
  import { I18N_KEYS } from "../../../../generated/i18n-keys";
  import { Button } from "$lib/components/ui/button";
  import DeviceRecoveryAction from "$lib/components/DeviceRecoveryAction.svelte";
  import {
    DeviceRecoveryKind,
    DeviceRecoveryOffer,
    type DeviceRecoveryRequest,
  } from "$lib/components/device-recovery";
  import type { VaultState } from "$lib/vault.svelte";

  let {
    vault,
    isVerifying,
    onUnlock,
    onCancel,
  }: {
    vault: VaultState;
    isVerifying: boolean;
    onUnlock: (pin: string) => void | Promise<void>;
    onCancel: () => void;
  } = $props();

  let pin = $state("");

  /** Why the last PIN did not unlock this browser's key. */
  const unlockError = $derived(isVerifying ? "" : vault.errorMsg);
  const recovery = $derived.by(() => {
    const request: DeviceRecoveryRequest = {
      status: vault.deviceProtectionStatus,
      unlockFailed: Boolean(unlockError),
    };
    return new DeviceRecoveryOffer(request).kind;
  });

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    if (!pin) return;
    void onUnlock(pin);
  }
</script>

<form class="grid gap-2" data-testid="card-pin-unlock" onsubmit={submit}>
  <label class="text-xs font-medium text-foreground" for="card-pin-input">
    {vault.t(I18N_KEYS.DeviceProtectionPinLabel)}
  </label>
  <div class="flex gap-2">
    <input
      id="card-pin-input"
      type="password"
      class="h-9 min-w-0 flex-1 border border-border bg-card px-3 text-sm text-foreground outline-none focus-visible:border-foreground/50 focus-visible:ring-2 focus-visible:ring-ring"
      autocomplete="current-password"
      bind:value={pin}
      disabled={isVerifying}
      data-testid="card-pin-input"
    />
    <Button
      type="submit"
      size="sm"
      class="h-9"
      disabled={isVerifying || !pin}
      data-testid="card-pin-submit"
    >
      {#if isVerifying}
        <RefreshCw class="size-3.5 animate-spin" />
      {/if}
      {vault.t(I18N_KEYS.DeviceProtectionPinUnlockAction)}
    </Button>
  </div>
  <button
    type="button"
    class="justify-self-start text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
    disabled={isVerifying}
    onclick={onCancel}
  >
    {vault.t(I18N_KEYS.CommonCancel)}
  </button>
  {#if unlockError}
    <p
      class="text-sm text-pretty text-destructive"
      role="alert"
      data-testid="card-pin-error"
    >
      {unlockError}
    </p>
  {/if}
  {#if recovery !== DeviceRecoveryKind.None}
    <DeviceRecoveryAction
      {vault}
      kind={recovery}
      recoveryAppId={vault.deviceId}
    />
  {/if}
</form>
