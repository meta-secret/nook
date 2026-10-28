<!--
A recovery provider that holds several vaults: the user picks the one to
recover here from what the provider tells about each, grouped by the identity
that files them. Passkeys belong to identities, so "Find the passkey that
opens it" proves, by decrypting in memory, which identity a passkey opens;
its vaults then recover with that passkey. An identity no passkey opens can
only be joined with a code from one of its devices.
-->
<script lang="ts">
  import { ArrowRight, KeyRound, RefreshCw, UserPlus } from "@lucide/svelte";
  import { I18N_KEYS } from "../../../../generated/i18n-keys";
  import type { CredentialCheckReport, ProviderVaultSummary } from "$app-wasm";
  import { Button } from "$lib/components/ui/button";
  import ProviderVaultList from "$lib/components/provider-vaults/ProviderVaultList.svelte";
  import {
    IdentityStandingKind,
    IdentityStandings,
    type ProviderIdentityGroup,
  } from "$lib/components/provider-vaults/provider-identity-groups";
  import type { VaultState } from "$lib/vault.svelte";
  import {
    AccessCheckActions,
    recoveryCheckTarget,
  } from "$lib/vault/access-check";

  let {
    vault,
    busy,
    onChoose,
  }: {
    vault: VaultState;
    busy: boolean;
    onChoose: (storeId: string) => void | Promise<void>;
  } = $props();

  let checks = $state<CredentialCheckReport[]>([]);
  let checking = $state(false);
  let joinHelp = $state<string[]>([]);
  const standings = $derived(new IdentityStandings(checks));

  /** One passkey tap: which listed identity it opens. */
  async function checkPasskey(): Promise<void> {
    checking = true;
    try {
      const result = await new AccessCheckActions(vault).checkPasskey(
        recoveryCheckTarget(vault),
      );
      if (result.isErr()) {
        vault.errorMsg = vault.t(result.error.translationKey);
        return;
      }
      checks = [...checks, result.value];
    } finally {
      checking = false;
    }
  }
</script>

<section class="grid gap-3" data-testid="remote-vault-choice">
  <div class="space-y-1">
    <p class="text-sm font-medium text-foreground">
      {vault.t(I18N_KEYS.FirstRunRestoreChooseVault)}
    </p>
    <p class="text-sm text-pretty text-muted-foreground">
      {vault.t(I18N_KEYS.FirstRunRestoreChooseVaultBody)}
    </p>
  </div>
  <ProviderVaultList {vault} vaults={vault.remoteVaultChoices} {checks}>
    {#snippet identityActions(group: ProviderIdentityGroup)}
      <div class="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-testid="provider-identity-find-passkey"
          disabled={busy || checking}
          onclick={() => void checkPasskey()}
        >
          {#if checking}
            <RefreshCw class="size-4 animate-spin" aria-hidden="true" />
            {vault.t(I18N_KEYS.AccessCheckChecking)}
          {:else}
            <KeyRound class="size-4" aria-hidden="true" />
            {vault.t(I18N_KEYS.AccessCheckFindPasskey)}
          {/if}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-testid="provider-identity-ask-to-join"
          disabled={busy || checking}
          onclick={() => (joinHelp = [...joinHelp, group.identity.identityId])}
        >
          <UserPlus class="size-4" aria-hidden="true" />
          {vault.t(I18N_KEYS.AccessCheckAskToJoin)}
        </Button>
      </div>
      {#if joinHelp.includes(group.identity.identityId)}
        <p
          class="text-xs text-pretty text-muted-foreground"
          role="status"
          data-testid="provider-identity-join-help"
        >
          {vault.t(I18N_KEYS.AccessCheckJoinWithCode)}
        </p>
      {/if}
    {/snippet}
    {#snippet action(summary: ProviderVaultSummary)}
      <!-- Only a vault this device may open can be recovered here. -->
      {#if summary.actions.includes("importSeparately")}
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-testid="remote-vault-choice-item"
          disabled={busy || checking}
          onclick={() => void onChoose(summary.storeId)}
        >
          {standings.of(summary.identity).kind ===
          IdentityStandingKind.OpenedByPasskey
            ? vault.t(I18N_KEYS.AccessCheckRecoverWithPasskey)
            : vault.t(I18N_KEYS.ProviderVaultsRecover)}
          <ArrowRight class="size-4" aria-hidden="true" />
        </Button>
      {/if}
    {/snippet}
  </ProviderVaultList>
</section>
