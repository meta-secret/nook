<!--
What each checked passkey or backup password opens. Passkeys belong to
identities, so the grid has one row per identity and one column per check:
a passkey opens an identity, and with it every vault the identity keeps; a
backup password opens single vaults, never the identity. An identity or
vault opens only when Rust decrypted its key, so its name shows once any
check opened it.
-->
<script lang="ts">
  import { FolderKey, UserRound } from '@lucide/svelte'
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
  const identities = $derived(checked.identities())

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

  /** The identity's name once a passkey opened it, beside its words. */
  function identityLabel(identity: IdentityCheck): string {
    const words = identity.words.join('-')
    const name = checked.identityName(identity.identityId)
    return name ? `${name} (${words})` : words
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

  /** One report's outcome for one identity. */
  type CellRequest = {
    report: CredentialCheckReport
    identityId: string
  }

  function cell({ report, identityId }: CellRequest): IdentityCheckOutcome {
    const found = report.identities.find(
      (identity) => identity.identityId === identityId,
    )
    return found ? found.outcome : 'doesNotOpen'
  }
</script>

<div class="space-y-3" data-testid="access-check-results">
  <p class="nk-subpanel-head">{vault.t(I18N_KEYS.AccessCheckResultsTitle)}</p>
  <ul class="space-y-1" data-testid="access-check-credentials">
    {#each reports as report, index (index)}
      <li class="text-xs text-pretty" data-testid="access-check-credential">
        <span class="font-mono text-foreground"
          >{checkNumber(index)} · {credentialLabel(report.credential)}</span
        >
      </li>
    {/each}
  </ul>
  {#if identities.length === 0}
    <p class="text-xs text-muted-foreground" data-testid="access-check-empty">
      {vault.t(I18N_KEYS.AccessCheckNoVaults)}
    </p>
  {:else}
    <!-- Checks are columns and identities are rows; the grid scrolls on its
         own so a narrow screen never scrolls the page sideways. -->
    <div class="overflow-x-auto" data-testid="access-check-grid">
      <table class="w-full border-collapse text-left text-xs">
        <thead>
          <tr class="border-b border-border/60">
            <th class="py-2 pr-4 font-medium text-muted-foreground" scope="col">
              {vault.t(I18N_KEYS.AccessCheckIdentityColumn)}
            </th>
            {#each reports as report, index (index)}
              <th
                class="py-2 pr-4 font-mono font-medium whitespace-nowrap text-muted-foreground"
                scope="col"
                title={credentialLabel(report.credential)}
              >
                {checkNumber(index)}
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each identities as identity (identity.identityId)}
            <tr
              class="border-b border-border/40 align-top"
              data-testid="access-check-identity"
              data-identity-id={identity.identityId}
            >
              <th class="py-2 pr-4 font-normal" scope="row">
                <span class="flex items-center gap-2">
                  <UserRound
                    class="size-3.5 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span
                    class="text-sm font-medium text-foreground"
                    title={identity.identityId}>{identityLabel(identity)}</span
                  >
                </span>
                <ul class="mt-1 space-y-0.5">
                  {#each identity.vaults as vaultCheck (vaultCheck.storeId)}
                    <li
                      class="nk-spec flex items-center gap-1.5"
                      data-testid="access-check-vault"
                      data-store-id={vaultCheck.storeId}
                    >
                      <FolderKey class="size-3 shrink-0" aria-hidden="true" />
                      <span class="font-mono" title={vaultCheck.storeId}
                        >{vaultLabel(vaultCheck)}</span
                      >
                    </li>
                  {/each}
                </ul>
              </th>
              {#each reports as report, index (index)}
                {@const cellRequest: CellRequest = {
                  report,
                  identityId: identity.identityId,
                }}
                {@const outcome = cell(cellRequest)}
                <td
                  class="py-2 pr-4 whitespace-nowrap"
                  data-testid="access-check-cell"
                  data-outcome={outcome}
                >
                  <span
                    class={outcome === 'opens'
                      ? 'nk-tag nk-tag-success'
                      : outcome === 'vaultsOnly'
                        ? 'nk-tag nk-tag-warning'
                        : 'nk-tag'}>{outcomeLabel(outcome)}</span
                  >
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
  <p class="text-[11px] text-muted-foreground" role="status">
    {vault.t(I18N_KEYS.AccessCheckResultsNote)}
  </p>
</div>
