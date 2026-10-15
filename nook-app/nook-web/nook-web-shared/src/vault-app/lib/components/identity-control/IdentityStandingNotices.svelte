<!--
What blocks this installation from adding devices: removed from the
identity. Shown above the Devices page and the add-device flow.
-->
<script lang="ts">
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import type { VaultState } from '$lib/vault.svelte'
  import { IdentityStandingPresentation } from './identity-standing'

  let { vault }: { vault: VaultState } = $props()

  const standing = $derived(
    new IdentityStandingPresentation(vault.identityControl.snapshot),
  )
</script>

{#if standing.isRevoked()}
  <div
    class="nk-banner nk-banner-warning p-3 text-sm text-foreground"
    data-testid="identity-revoked-banner"
  >
    {vault.t(I18N_KEYS.IdentityControlRevoked)}
  </div>
{/if}
