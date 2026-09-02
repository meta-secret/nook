<script lang="ts">
  import { I18N_KEYS } from '../../../generated/i18n-keys'
  import type { I18nKey } from '../../../generated/i18n-keys'
  import {
    ProviderVaultDecision,
    ProviderVaultDecisionReason,
    ProviderVaultIdentityEligibility,
  } from '$app-wasm'
  import {
    CheckCircle2,
    CircleHelp,
    Fingerprint,
    RefreshCw,
  } from '@lucide/svelte'
  import { onMount } from 'svelte'
  import { Button } from '$lib/components/ui/button'
  import type { VaultState } from '$lib/vault.svelte'
  import {
    loadProviderVaultEvidence,
    preparedProviderVaultIdentities,
    ProviderVaultEvidenceKind,
    ProviderVaultIdentityCurrentKind,
    ProviderVaultIdentitySelectionKind,
    type ProviderVaultEvidence,
    type ProviderVaultIdentitySelection,
  } from '$lib/vault/provider-vault-decision'

  let {
    vault,
    providerLabel,
    localStoreId,
    remoteStoreId,
    isBusy,
    onImport,
    onCancel,
  }: {
    vault: VaultState
    providerLabel: string
    localStoreId: string
    remoteStoreId: string
    isBusy: boolean
    onImport: (
      selection: ProviderVaultIdentitySelection,
    ) => void | Promise<void>
    onCancel: () => void | Promise<void>
  } = $props()

  let evidence = $state<ProviderVaultEvidence>({
    kind: ProviderVaultEvidenceKind.Loading,
  })
  let identitySelection = $state<ProviderVaultIdentitySelection>({
    kind: ProviderVaultIdentitySelectionKind.NotSelected,
  })

  const preparedIdentities = $derived(
    evidence.kind === ProviderVaultEvidenceKind.Ready
      ? preparedProviderVaultIdentities(evidence.identities)
      : [],
  )
  const identitySelectionRequired = $derived(preparedIdentities.length > 1)
  const importIdentitySelection = $derived.by(
    (): ProviderVaultIdentitySelection => {
      if (
        identitySelection.kind ===
          ProviderVaultIdentitySelectionKind.Selected ||
        preparedIdentities.length !== 1
      ) {
        return identitySelection
      }
      return {
        kind: ProviderVaultIdentitySelectionKind.Selected,
        identityId: preparedIdentities[0]!.identityId,
      }
    },
  )
  const importDisabled = $derived(
    isBusy ||
      evidence.kind !== ProviderVaultEvidenceKind.Ready ||
      (identitySelectionRequired &&
        identitySelection.kind ===
          ProviderVaultIdentitySelectionKind.NotSelected),
  )

  function selectIdentity(identityId: string): void {
    identitySelection = {
      kind: ProviderVaultIdentitySelectionKind.Selected,
      identityId,
    }
  }

  function identityStatusKey(
    eligibility: ProviderVaultIdentityEligibility,
  ): I18nKey {
    switch (eligibility) {
      case ProviderVaultIdentityEligibility.LinkedAndPrepared:
        return I18N_KEYS.AuthStorageProviderVaultIdentityReady
      case ProviderVaultIdentityEligibility.LinkedButUnavailable:
        return I18N_KEYS.AuthStorageProviderVaultIdentityUnavailable
      case ProviderVaultIdentityEligibility.NotLinked:
        return I18N_KEYS.AuthStorageProviderVaultIdentityNotLinked
    }
  }

  function reasonKey(reason: ProviderVaultDecisionReason): I18nKey {
    switch (reason) {
      case ProviderVaultDecisionReason.ReadyToAdopt:
        return I18N_KEYS.AuthStorageProviderVaultReasonReady
      case ProviderVaultDecisionReason.CurrentVaultContainsUserData:
        return I18N_KEYS.AuthStorageProviderVaultReasonLocalData
      case ProviderVaultDecisionReason.CurrentVaultStateUnavailable:
        return I18N_KEYS.AuthStorageProviderVaultReasonUnknown
      case ProviderVaultDecisionReason.LinkedIdentityUnavailable:
        return I18N_KEYS.AuthStorageProviderVaultReasonIdentityUnavailable
      case ProviderVaultDecisionReason.NoLinkedIdentity:
        return I18N_KEYS.AuthStorageProviderVaultReasonNoIdentity
    }
  }

  onMount(() => {
    void vault
      .enqueueStorage(() => {
        const request: Parameters<typeof loadProviderVaultEvidence>[0] = {
          manager: vault.requireManager(),
          providerStoreId: remoteStoreId,
        }
        return loadProviderVaultEvidence(request)
      })
      .then((result) => {
        evidence = result
      })
      .catch(() => {
        evidence = { kind: ProviderVaultEvidenceKind.Failed }
      })
  })
</script>

<div class="space-y-4" data-testid="provider-vault-decision-panel">
  <p class="text-sm text-muted-foreground">
    {vault.t(I18N_KEYS.AuthStorageProviderVaultPasskeyExplanation)}
  </p>
  {#if evidence.kind === ProviderVaultEvidenceKind.Loading}
    <p
      class="flex items-center gap-2 text-sm text-muted-foreground"
      role="status"
    >
      <RefreshCw class="size-4 animate-spin" />
      {vault.t(I18N_KEYS.AuthStorageProviderVaultChecking)}
    </p>
  {:else if evidence.kind === ProviderVaultEvidenceKind.Failed}
    <div class="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
      <p class="text-sm font-medium text-foreground">
        {vault.t(I18N_KEYS.AuthStorageProviderVaultReasonUnknown)}
      </p>
    </div>
  {:else}
    <div
      class="rounded-md border p-3 {evidence.decision ===
      ProviderVaultDecision.AdoptProviderVault
        ? 'border-primary/40 bg-primary/5'
        : 'border-border bg-muted/20'}"
      data-testid="provider-vault-recommendation"
    >
      <div class="flex items-start gap-2">
        {#if evidence.decision === ProviderVaultDecision.AdoptProviderVault}
          <CheckCircle2 class="mt-0.5 size-4 shrink-0 text-primary" />
        {:else}
          <CircleHelp class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        {/if}
        <div>
          <p class="text-sm font-semibold text-foreground">
            {evidence.decision === ProviderVaultDecision.AdoptProviderVault
              ? vault.t(I18N_KEYS.AuthStorageProviderVaultUseRecommended)
              : vault.t(I18N_KEYS.AuthStorageProviderVaultKeepBothRecommended)}
          </p>
          <p class="mt-1 text-sm text-muted-foreground">
            {vault.t(reasonKey(evidence.reason))}
          </p>
        </div>
      </div>
    </div>

    <section
      class="space-y-2"
      aria-labelledby="provider-vault-identities-title"
    >
      <div class="flex items-center gap-2">
        <Fingerprint class="size-4 text-primary" />
        <h3
          id="provider-vault-identities-title"
          class="text-sm font-semibold text-foreground"
        >
          {vault.t(I18N_KEYS.AuthStorageProviderVaultIdentitiesTitle)}
        </h3>
      </div>
      {#if evidence.identities.length > 0}
        <ul class="space-y-2" data-testid="provider-vault-identities">
          {#each evidence.identities as identity (identity.identityId)}
            <li>
              <label
                class="flex min-h-11 items-start gap-3 rounded-md border border-border px-3 py-2 {identity.eligibility ===
                ProviderVaultIdentityEligibility.LinkedAndPrepared
                  ? 'cursor-pointer hover:bg-muted/30'
                  : 'bg-muted/15'}"
              >
                <input
                  class="mt-1 size-4"
                  type="radio"
                  name="provider-vault-identity"
                  value={identity.identityId}
                  disabled={identity.eligibility !==
                    ProviderVaultIdentityEligibility.LinkedAndPrepared}
                  checked={importIdentitySelection.kind ===
                    ProviderVaultIdentitySelectionKind.Selected &&
                    importIdentitySelection.identityId === identity.identityId}
                  onchange={() => selectIdentity(identity.identityId)}
                />
                <span class="min-w-0 flex-1">
                  <span class="flex flex-wrap items-center gap-x-2">
                    <span class="font-medium text-foreground"
                      >{identity.label}</span
                    >
                    {#if identity.currentKind === ProviderVaultIdentityCurrentKind.Current}
                      <span class="text-xs text-primary">
                        {vault.t(
                          I18N_KEYS.AuthStorageProviderVaultCurrentIdentity,
                        )}
                      </span>
                    {/if}
                  </span>
                  <span
                    class="block text-xs text-muted-foreground"
                    data-testid="provider-vault-identity-status"
                  >
                    {vault.t(identityStatusKey(identity.eligibility))}
                  </span>
                </span>
              </label>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="text-sm text-muted-foreground">
          {vault.t(I18N_KEYS.AuthStorageProviderVaultReasonNoIdentity)}
        </p>
      {/if}
      {#if preparedIdentities.length > 1}
        <p class="text-xs text-muted-foreground">
          {vault.t(I18N_KEYS.AuthStorageProviderVaultChooseIdentity)}
        </p>
      {/if}
    </section>
  {/if}

  <p class="text-xs text-muted-foreground">
    {vault.t(I18N_KEYS.AuthStorageProviderVaultBackupPassword)}
  </p>

  <p
    class="text-sm text-muted-foreground"
    data-testid="provider-vault-preserve-both"
  >
    {vault.t(I18N_KEYS.AuthStorageProviderVaultNoMerge)}
  </p>

  <details class="rounded-md border border-border px-3 py-2 text-sm">
    <summary class="cursor-pointer font-medium text-foreground">
      {vault.t(I18N_KEYS.AuthStorageProviderVaultTechnicalDetails)}
    </summary>
    <dl
      class="mt-2 grid gap-2 text-xs text-muted-foreground"
      data-testid="provider-vault-technical-details"
    >
      <div>
        <dt>{vault.t(I18N_KEYS.AuthStorageSyncConflictLocalCopy)}</dt>
        <dd class="break-all font-mono">{localStoreId}</dd>
      </div>
      <div>
        <dt>{providerLabel}</dt>
        <dd class="break-all font-mono">{remoteStoreId}</dd>
      </div>
    </dl>
  </details>

  <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
    <Button
      type="button"
      variant="outline"
      class="sm:min-w-[160px]"
      data-testid="sync-conflict-cancel-btn"
      disabled={isBusy}
      onclick={() => void onCancel()}
    >
      {vault.t(I18N_KEYS.AuthStorageSyncConflictChooseDifferentProvider)}
    </Button>
    <Button
      type="button"
      class="sm:min-w-[180px]"
      data-testid="sync-conflict-import-new-vault-btn"
      disabled={importDisabled}
      onclick={() => void onImport(importIdentitySelection)}
    >
      {#if isBusy}
        <RefreshCw class="size-4 animate-spin" />
      {/if}
      {evidence.kind === ProviderVaultEvidenceKind.Ready &&
      evidence.decision === ProviderVaultDecision.AdoptProviderVault
        ? vault.t(I18N_KEYS.AuthStorageProviderVaultUseProvider)
        : vault.t(I18N_KEYS.AuthStorageSyncConflictImportNewVault)}
    </Button>
  </div>
</div>
