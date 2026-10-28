<!--
A recovery provider that holds several vaults, grouped by the identity that
files them. Passkeys belong to identities, so the identity is what the user
recovers: recovering one of its vaults with its passkey opens the identity,
and its other vaults then sync through it. "Which passkey opens it?" proves,
by decrypting in memory, which identity a passkey opens. An identity this
browser cannot recover can only be joined with a code from one of its
devices. A vault a backup password opens is recovered on its own.
-->
<script lang="ts">
  import { ArrowRight, KeyRound, RefreshCw, UserPlus } from '@lucide/svelte'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import type { CredentialCheckReport, ProviderVaultSummary } from '$app-wasm'
  import { Button } from '$lib/components/ui/button'
  import ProviderVaultList from '$lib/components/provider-vaults/ProviderVaultList.svelte'
  import {
    identityLocked,
    IdentityStandingKind,
    IdentityStandings,
    type IdentityStanding,
    type ProviderIdentityGroup,
  } from '$lib/components/provider-vaults/provider-identity-groups'
  import type { VaultState } from '$lib/vault.svelte'
  import {
    AccessCheckActions,
    recoveryCheckTarget,
  } from '$lib/vault/access-check'

  let {
    vault,
    busy,
    onChoose,
  }: {
    vault: VaultState
    busy: boolean
    onChoose: (storeId: string) => void | Promise<void>
  } = $props()

  let checks = $state<CredentialCheckReport[]>([])
  let checking = $state(false)
  let joinHelp = $state<string[]>([])
  const standings = $derived(new IdentityStandings(checks))
  const disabled = $derived(busy || checking)

  /** One passkey tap: which listed identity it opens. */
  async function checkPasskey(): Promise<void> {
    checking = true
    try {
      const result = await new AccessCheckActions(vault).checkPasskey(
        recoveryCheckTarget(vault),
      )
      if (result.isErr()) {
        vault.errorMsg = vault.t(result.error.translationKey)
        return
      }
      checks = [...checks, result.value]
    } finally {
      checking = false
    }
  }

  function recoverLabel(standing: IdentityStanding): string {
    return standing.kind === IdentityStandingKind.OpenedByPasskey
      ? vault.t(I18N_KEYS.AccessCheckRecoverWithPasskey)
      : vault.t(I18N_KEYS.ProviderVaultsRecoverIdentity)
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
    {#snippet identityActions(
      group: ProviderIdentityGroup,
      standing: IdentityStanding,
    )}
      {#each standings.openingVaults(group) as opening (opening.storeId)}
        <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button
            type="button"
            size="sm"
            data-testid="remote-vault-choice-item"
            data-store-id={opening.storeId}
            {disabled}
            onclick={() => void onChoose(opening.storeId)}
          >
            {recoverLabel(standing)}
            <ArrowRight class="size-4" aria-hidden="true" />
          </Button>
          {#if standing.kind === IdentityStandingKind.Unchecked}
            <button
              type="button"
              class="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground disabled:opacity-60"
              data-testid="provider-identity-find-passkey"
              {disabled}
              onclick={() => void checkPasskey()}
            >
              {checking
                ? vault.t(I18N_KEYS.AccessCheckChecking)
                : vault.t(I18N_KEYS.AccessCheckWhichPasskey)}
            </button>
          {/if}
        </div>
      {:else}
        {#if identityLocked(standing)}
          <div class="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="provider-identity-find-passkey"
              {disabled}
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
              {disabled}
              onclick={() =>
                (joinHelp = [...joinHelp, group.identity.identityId])}
            >
              <UserPlus class="size-4" aria-hidden="true" />
              {vault.t(I18N_KEYS.AccessCheckAskToJoin)}
            </Button>
          </div>
        {/if}
      {/each}
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
      <!-- A backup password opens one vault on its own. -->
      {#if standings.vaultActions(summary).includes('importSeparately')}
        <button
          type="button"
          class="text-xs text-foreground underline underline-offset-4 disabled:opacity-60"
          data-testid="remote-vault-choice-password"
          data-store-id={summary.storeId}
          {disabled}
          onclick={() => void onChoose(summary.storeId)}
        >
          {vault.t(I18N_KEYS.AccessCheckRecoverWithPassword)}
        </button>
      {/if}
    {/snippet}
  </ProviderVaultList>
</section>
