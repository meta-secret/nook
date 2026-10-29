<!--
What each checked passkey or backup password opens, one card per check in
the order they ran. The card starts at the key that was checked and a line
runs down from it to each keyring found there, marked by what the key does
to it: a passkey opens a keyring, and with it every vault the keyring
keeps; a backup password opens single vaults, never the keyring itself. A
keyring shows its name once a passkey opened it, and always its ID (its
three words, as on its card); a vault shows its name once a check opened
it.
-->
<script lang="ts">
  import {
    Check,
    Fingerprint,
    FolderKey,
    Lock,
    RectangleEllipsis,
    X,
  } from '@lucide/svelte'
  import type {
    CheckedCredential,
    CredentialCheckReport,
    IdentityCheck,
    IdentityCheckOutcome,
    VaultCheck,
  } from '$app-wasm'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import type { VaultState } from '$lib/vault.svelte'
  import { CheckReports, shortPasskeyId } from '$lib/vault/access-check'

  let {
    vault,
    reports,
  }: {
    vault: VaultState
    reports: readonly CredentialCheckReport[]
  } = $props()

  const checked = $derived(new CheckReports(reports))

  function credentialLabel(credential: CheckedCredential): string {
    switch (credential.kind) {
      case 'passkey': {
        const request: Parameters<typeof vault.t>[0] = {
          key: I18N_KEYS.AccessCheckCredentialPasskey,
          replacements: { id: shortPasskeyId(credential.fingerprint) },
        }
        return vault.t(request)
      }
      case 'backupPassword':
        return vault.t(I18N_KEYS.AccessCheckCredentialPassword)
    }
  }

  function checkNumber(index: number): string {
    const request: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.AccessCheckCheckNumber,
      replacements: { n: String(index + 1) },
    }
    return vault.t(request)
  }

  function vaultLabel({ storeId, shortId }: VaultCheck): string {
    const name = checked.vaultName(storeId)
    if (name) return name
    const request: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.FirstRunRestoreVaultItem,
      replacements: { id: shortId },
    }
    return vault.t(request)
  }

  function outcomeLabel(outcome: IdentityCheckOutcome): string {
    switch (outcome) {
      case 'opens':
        return vault.t(I18N_KEYS.AccessCheckOpens)
      case 'vaultsOnly':
        return vault.t(I18N_KEYS.AccessCheckOpensVaultsOnly)
      case 'doesNotOpen':
        return vault.t(I18N_KEYS.AccessCheckDoesNotOpen)
    }
  }

  const outcomeOrder: readonly IdentityCheckOutcome[] = [
    'opens',
    'vaultsOnly',
    'doesNotOpen',
  ]

  /** What the key opened leads; keyrings it does not open follow. */
  function byOutcome(
    identities: readonly IdentityCheck[],
  ): readonly IdentityCheck[] {
    return outcomeOrder.flatMap((outcome) =>
      identities.filter((identity) => identity.outcome === outcome),
    )
  }

  /** The vaults a keyring's row lists: those the key opened, by name. A
   * keyring it does not open lists none. */
  function openedVaults(identity: IdentityCheck): readonly VaultCheck[] {
    switch (identity.outcome) {
      case 'opens':
        return identity.vaults
      case 'vaultsOnly':
        return identity.vaults.filter(
          (vaultCheck) => vaultCheck.outcome.state === 'opens',
        )
      case 'doesNotOpen':
        return []
    }
  }
</script>

{#snippet credentialIcon(credential: CheckedCredential)}
  {#if credential.kind === 'passkey'}
    <Fingerprint class="size-4" />
  {:else}
    <RectangleEllipsis class="size-4" />
  {/if}
{/snippet}

{#snippet outcomeIcon(outcome: IdentityCheckOutcome)}
  {#if outcome === 'opens'}
    <Check class="size-3.5" />
  {:else if outcome === 'vaultsOnly'}
    <FolderKey class="size-3.5" />
  {:else}
    <X class="size-3.5" />
  {/if}
{/snippet}

<div class="space-y-3" data-testid="access-check-results">
  <p class="nk-subpanel-head">{vault.t(I18N_KEYS.AccessCheckResultsTitle)}</p>
  <ol class="grid gap-3" data-testid="access-check-checks">
    {#each reports as report, index (index)}
      <li
        class="nk-subpanel-recessed grid gap-3 p-4"
        data-testid="access-check-credential"
        data-credential={report.credential.kind}
      >
        <header class="flex items-center gap-3">
          <span class="nk-vault-icon text-foreground" aria-hidden="true">
            {@render credentialIcon(report.credential)}
          </span>
          <span
            class="min-w-0 flex-1 truncate text-sm font-medium text-foreground"
            >{credentialLabel(report.credential)}</span
          >
          <span class="nk-label">{checkNumber(index)}</span>
        </header>

        <!-- The line from the key down to what it was tried on. -->
        <div class="ml-3.5 border-l border-border/70 pl-5">
          {#if report.identities.length === 0}
            <p
              class="py-1 text-xs text-muted-foreground"
              data-testid="access-check-empty"
            >
              {vault.t(I18N_KEYS.AccessCheckNoVaults)}
            </p>
          {:else}
            <ul class="grid gap-2">
              {#each byOutcome(report.identities) as identity (identity.identityId)}
                {@const name = checked.identityName(identity.identityId)}
                {@const vaults = openedVaults(identity)}
                <li
                  class="grid gap-1.5 {identity.outcome === 'doesNotOpen'
                    ? 'opacity-60'
                    : ''}"
                  data-testid="access-check-identity"
                  data-identity-id={identity.identityId}
                  data-outcome={identity.outcome}
                >
                  <div class="flex min-w-0 items-center gap-2.5">
                    <span
                      class="grid size-5 flex-none place-items-center border {identity.outcome ===
                      'opens'
                        ? 'border-success/50 text-success'
                        : identity.outcome === 'vaultsOnly'
                          ? 'border-warning/50 text-warning'
                          : 'border-border text-muted-foreground'}"
                      aria-hidden="true"
                    >
                      {@render outcomeIcon(identity.outcome)}
                    </span>
                    <span
                      class="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-0.5"
                      title={identity.identityId}
                    >
                      {#if name}
                        <span
                          class="truncate text-sm font-medium text-foreground"
                          >{name}</span
                        >
                      {/if}
                      <span class="nk-fingerprint flex items-center gap-1.5">
                        <span class="nk-fingerprint-label"
                          >{vault.t(I18N_KEYS.WorkspaceFingerprintLabel)}</span
                        >
                        <span class="truncate">{identity.words.join('-')}</span>
                      </span>
                    </span>
                    <span
                      class={identity.outcome === 'opens'
                        ? 'nk-tag nk-tag-success'
                        : identity.outcome === 'vaultsOnly'
                          ? 'nk-tag nk-tag-warning'
                          : 'nk-tag'}>{outcomeLabel(identity.outcome)}</span
                    >
                  </div>
                  {#if vaults.length > 0}
                    <ul class="ml-7.5 flex flex-wrap gap-1.5">
                      {#each vaults as vaultCheck (vaultCheck.storeId)}
                        <li
                          class="inline-flex min-w-0 items-center gap-1.5 border border-border/60 px-2 py-0.5 text-xs text-foreground"
                          data-testid="access-check-vault"
                          data-store-id={vaultCheck.storeId}
                          title={vaultCheck.storeId}
                        >
                          {#if vaultCheck.outcome.state === 'opens'}
                            <FolderKey
                              class="size-3 flex-none text-muted-foreground"
                              aria-hidden="true"
                            />
                          {:else}
                            <Lock
                              class="size-3 flex-none text-muted-foreground"
                              aria-hidden="true"
                            />
                          {/if}
                          <span class="truncate">{vaultLabel(vaultCheck)}</span>
                        </li>
                      {/each}
                    </ul>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      </li>
    {/each}
  </ol>
  <p class="text-[11px] text-muted-foreground" role="status">
    {vault.t(I18N_KEYS.AccessCheckResultsNote)}
  </p>
</div>
