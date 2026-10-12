<script lang="ts">
  import type { VaultState } from "$lib/vault.svelte";
  import type { ExtensionConnectRequest } from "./extension-connect-disabled";
  import { ExtensionConsentCloseOutcome } from "$lib/components/extension-connect-consent-outcome";
  import { I18N_KEYS } from "$web-shared/generated/i18n-keys";
  interface UnavailableExtensionConsent {
    vault: VaultState;
    request: ExtensionConnectRequest;
    onClose: (outcome: ExtensionConsentCloseOutcome) => void;
  }
  let { vault, request, onClose }: UnavailableExtensionConsent = $props();
</script>

<p role="alert">
  {vault.t(I18N_KEYS.ErrorsValidationSentinelExtensionForbidden)}
</p>
<p>{request.deviceLabel}</p>
<button onclick={() => onClose(ExtensionConsentCloseOutcome.Cancelled)}
  >{vault.t(I18N_KEYS.CommonCancel)}</button
>
