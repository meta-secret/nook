<script lang="ts">
  import { onMount } from "svelte";
  import type { VaultState } from "$lib/vault.svelte";
  import {
    CompanionProviderPresence,
    ExternalDeviceIdentityAuthorizationMode,
    VaultCompanionUnlockDecision,
    VaultStartupUnlockDecision,
  } from "$app-wasm";
  import { extensionConnectionBrowser as browser } from "$lib/extension/connect";
  import { ExtensionPairedVaultIdentityStatusMessageStatus as Status } from "$web-shared/extension/paired-vault-identity-status";
  import { I18N_KEYS as K } from "../../../generated/i18n-keys";
  let { vault, storeId }: { vault: VaultState; storeId: string } = $props();
  let busy = $state(false);
  let active = true;
  let reading = false;
  let stopWatch = () => {};
  function stop() {
    stopWatch();
    stopWatch = () => {};
    busy = false;
  }
  async function refresh() {
    if (
      !active ||
      reading ||
      vault.isVerifying ||
      vault.deviceAuthorizationInProgress
    )
      return;
    reading = true;
    try {
      const admission =
        await browser.discoverAdmittedPairedExtensionIdentity(storeId);
      if (
        !active ||
        vault.isAuthenticated ||
        vault.isVerifying ||
        vault.deviceAuthorizationInProgress
      )
        return;
      if (admission.isErr()) {
        vault.errorMsg = vault.t(admission.error.translationKey);
        stop();
        return;
      }
      const decision = vault.clientPolicy.companion_unlock_decision(
        admission.value.canonicalStatus,
      );
      const discovery = admission.value.discovery;
      if (
        decision !== VaultCompanionUnlockDecision.CompanionDevice ||
        discovery.status !== Status.Unlocked
      )
        return;
      const authorization: Parameters<
        VaultState["authorizeWithExternalDeviceIdentity"]
      >[0] = {
        mode: ExternalDeviceIdentityAuthorizationMode.ContinueInitialization,
        adopt: (manager) => {
          const handoff: Parameters<typeof browser.adoptExtensionIdentity>[0] =
            { manager, request: discovery.request };
          return browser.adoptExtensionIdentity(handoff);
        },
      };
      const adopted =
        await vault.authorizeWithExternalDeviceIdentity(authorization);
      if (active && adopted) await vault.loadDb();
      stop();
    } finally {
      reading = false;
    }
  }
  function watch() {
    stop();
    void refresh();
    const timer = setInterval(() => void refresh(), 500);
    const expiry = setTimeout(stop, 30000);
    stopWatch = () => {
      clearInterval(timer);
      clearTimeout(expiry);
    };
  }
  async function unlock() {
    watch();
    busy = true;
    const requested = await browser.requestPairedExtensionUnlock(storeId);
    if (!requested && active && !vault.isAuthenticated) {
      vault.errorMsg = vault.t(K.ExtensionCompanionUnavailable);
      stop();
    }
  }
  onMount(() => {
    if (
      vault.shouldAutoUnlock() &&
      vault.startupUnlockDecision(browser.companionProviderPresence()) ===
        VaultStartupUnlockDecision.DiscoverCompanion
    )
      watch();
    return () => {
      active = false;
      stop();
    };
  });
</script>

{#if browser.companionProviderPresence() === CompanionProviderPresence.Present}
  <button
    disabled={busy || vault.deviceAuthorizationInProgress || vault.isVerifying}
    onclick={unlock}
    data-testid="unlock-vault-btn"
    >{vault.t(
      busy ? K.ExtensionSetupUnlockPending : K.ExtensionConnectContinue,
    )}</button
  >
{/if}
