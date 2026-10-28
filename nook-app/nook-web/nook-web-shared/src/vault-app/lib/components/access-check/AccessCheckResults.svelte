<!--
What each checked passkey or backup password opens. Each check is listed
with the identity a passkey belongs to; each vault then says, check by
check, whether it opened. A vault opens only when Rust decrypted its key and
name, so its name shows once any check opened it.
-->
<script lang="ts">
  import { FolderKey } from '@lucide/svelte'
  import type {
    CheckedCredential,
    CheckedIdentity,
    CredentialCheckReport,
    VaultCheck,
    VaultCheckOutcome,
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
  const vaults = $derived(checked.vaults())

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

  function identityLine(report: CredentialCheckReport): string {
    const identity: CheckedIdentity = report.identity
    switch (identity.state) {
      case 'member': {
        const name =
          identity.name.state === 'named'
            ? `${identity.name.name} (${identity.words.join('-')})`
            : identity.words.join('-')
        const request: Parameters<typeof vault.t>[0] = {
          key: I18N_KEYS.AccessCheckPasskeyIdentity,
          replacements: { identity: name },
        }
        return vault.t(request)
      }
      case 'notAMember':
        return report.credential.kind === 'passkey'
          ? vault.t(I18N_KEYS.AccessCheckPasskeyNotMember)
          : ''
    }
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

  function outcomeLabel(outcome: VaultCheckOutcome): string {
    switch (outcome.state) {
      case 'opens':
        return vault.t(I18N_KEYS.AccessCheckOpens)
      case 'doesNotOpen':
        return vault.t(I18N_KEYS.AccessCheckDoesNotOpen)
      case 'noBackupPassword':
        return vault.t(I18N_KEYS.AccessCheckNoBackupPassword)
    }
  }

  /** One report's outcome for one vault. */
  type CellRequest = {
    report: CredentialCheckReport
    storeId: string
  }

  function cell({ report, storeId }: CellRequest): VaultCheckOutcome {
    const found = report.vaults.find((checked) => checked.storeId === storeId)
    return found ? found.outcome : { state: 'doesNotOpen' }
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
        {#if identityLine(report)}
          <span class="text-muted-foreground"> · {identityLine(report)}</span>
        {/if}
      </li>
    {/each}
  </ul>
  {#if vaults.length === 0}
    <p class="text-xs text-muted-foreground" data-testid="access-check-empty">
      {vault.t(I18N_KEYS.AccessCheckNoVaults)}
    </p>
  {:else}
    <ul class="nk-list" data-testid="access-check-vaults">
      {#each vaults as vaultCheck (vaultCheck.storeId)}
        {@const filedRequest: Parameters<typeof vault.t>[0] = {
          key: I18N_KEYS.ProviderVaultsFiledUnder,
          replacements: { identity: vaultCheck.filedUnder.join('-') },
        }}
        <li
          class="nk-row"
          data-testid="access-check-vault"
          data-store-id={vaultCheck.storeId}
        >
          <span class="nk-tile nk-tile-sm" aria-hidden="true">
            <FolderKey class="size-4" />
          </span>
          <div class="min-w-0 space-y-1">
            <p class="nk-row-title">
              <span class="font-mono text-sm" title={vaultCheck.storeId}
                >{vaultLabel(vaultCheck)}</span
              >
            </p>
            <p class="nk-spec">{vault.t(filedRequest)}</p>
            <ul class="flex flex-wrap gap-2">
              {#each reports as report, index (index)}
                {@const cellRequest: CellRequest = {
                  report,
                  storeId: vaultCheck.storeId,
                }}
                {@const outcome = cell(cellRequest)}
                <li
                  class={outcome.state === 'opens'
                    ? 'nk-tag nk-tag-success'
                    : 'nk-tag'}
                  data-testid="access-check-cell"
                  data-outcome={outcome.state}
                >
                  {checkNumber(index)}: {outcomeLabel(outcome)}
                </li>
              {/each}
            </ul>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
  <p class="text-[11px] text-muted-foreground" role="status">
    {vault.t(I18N_KEYS.AccessCheckResultsNote)}
  </p>
</div>
