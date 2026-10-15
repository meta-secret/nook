<!--
What blocks this installation from adding devices: removed from the
identity, vaults made on another app, or an identity not yet replicated.
Shown above the Devices page and the add-device flow.
-->
<script lang="ts">
  import { I18N_KEYS } from "../../../../generated/i18n-keys";
  import { Button } from "$lib/components/ui/button";
  import type { VaultState } from "$lib/vault.svelte";
  import { IdentityUpgradeKind } from "$lib/vault/identity-control.svelte";
  import { IdentityStandingPresentation } from "./identity-standing";

  let { vault }: { vault: VaultState } = $props();

  const control = $derived(vault.identityControl);
  const standing = $derived(new IdentityStandingPresentation(control.snapshot));
  const isBusy = $derived(control.busy || vault.isSaving || vault.isVerifying);
</script>

  {#if standing.isRevoked()}
    <div
      class="nk-banner nk-banner-warning p-3 text-sm text-foreground"
      data-testid="identity-revoked-banner"
    >
      {vault.t(I18N_KEYS.IdentityControlRevoked)}
    </div>
  {/if}

  {#if control.upgrade.kind === IdentityUpgradeKind.AwaitingFounder}
    <div
      class="nk-banner nk-banner-warning space-y-2 p-3 text-sm text-foreground"
      data-testid="identity-awaiting-founder-banner"
    >
      <p class="font-medium">
        {vault.t(I18N_KEYS.IdentityControlAwaitingFounderTitle)}
      </p>
      <p class="text-xs text-muted-foreground">
        {vault.t(I18N_KEYS.IdentityControlAwaitingFounderDescription)}
      </p>
      <div class="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isBusy}
          data-testid="identity-check-providers-btn"
          onclick={() => void control.adoptFromProviders()}
        >
          {vault.t(I18N_KEYS.IdentityControlCheckProviders)}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={isBusy}
          data-testid="identity-upgrade-here-btn"
          onclick={() => void control.upgradeHere()}
        >
          {vault.t(I18N_KEYS.IdentityControlUpgradeHere)}
        </Button>
      </div>
    </div>
  {:else if standing.isNotReplicated()}
    <div
      class="nk-banner nk-banner-warning space-y-2 p-3 text-sm text-foreground"
      data-testid="identity-not-replicated-banner"
    >
      <p class="font-medium">
        {vault.t(I18N_KEYS.IdentityControlNotReplicatedTitle)}
      </p>
      <p class="text-xs text-muted-foreground">
        {vault.t(I18N_KEYS.IdentityControlNotReplicatedDescription)}
      </p>
      <Button
        type="button"
        size="sm"
        disabled={isBusy}
        data-testid="identity-upgrade-btn"
        onclick={() => void control.upgradeHere()}
      >
        {vault.t(I18N_KEYS.IdentityControlUpgrade)}
      </Button>
    </div>
  {/if}
