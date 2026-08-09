<script lang="ts">
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import {
    JoinEnrollmentState,
    NookLocalFolderHealthState,
    NookSyncConflictReviewState,
  } from '$app-wasm'
  import JoinEnrollmentDialog from '$lib/components/JoinEnrollmentDialog.svelte'
  import { JoinEnrollmentDialogVariant } from '$lib/components/join-enrollment-dialog-state'
  import LocalFolderMultipleVaultsDialog from '$lib/components/LocalFolderMultipleVaultsDialog.svelte'
  import VaultSyncConflictDialog from '$lib/components/VaultSyncConflictDialog.svelte'
  import { Button } from '$lib/components/ui/button'
  import * as multiDeviceActions from '$lib/vault/multi-device'
  import type { VaultState } from '$lib/vault.svelte'

  let { vault }: { vault: VaultState } = $props()

  function shortId(id: string): string {
    return id.length > 18 ? `${id.slice(0, 18)}...` : id
  }

  function conflictReasons(reasons: string[]): string {
    return reasons.length > 0 ? reasons.join(', ') : 'key epoch rotation'
  }
</script>

<JoinEnrollmentDialog
  {vault}
  open={vault.joinEnrollmentPrompt !== JoinEnrollmentState.None}
  variant={vault.joinEnrollmentPrompt === JoinEnrollmentState.Pending
    ? JoinEnrollmentDialogVariant.Pending
    : JoinEnrollmentDialogVariant.NeedsRequest}
  deviceId={vault.deviceId}
  isBusy={vault.isVerifying}
  bind:enrollSecretsKey={vault.enrollSecretsKey}
  bind:enrollMembersKey={vault.enrollMembersKey}
  onConfirm={() => multiDeviceActions.confirmJoinRequest(vault)}
  onEnrollWithKeys={() => vault.enrollAndConnect()}
  onCreateFreshVault={() => vault.createFreshVault()}
  onCancel={() => multiDeviceActions.dismissJoinEnrollment(vault)}
/>

{#if vault.syncConflictReview.state === NookSyncConflictReviewState.RequiresDecision}
  <VaultSyncConflictDialog
    {vault}
    conflict={vault.syncConflictReview}
    isBusy={vault.isVerifying}
    onKeepLocal={() => vault.resolveSyncConflictKeepLocal()}
    onKeepRemote={() => vault.resolveSyncConflictKeepRemote()}
    onImportAsNewVault={() => vault.resolveSyncConflictImportRemote()}
    onCancel={() => vault.clearPendingSyncConflict()}
  />
{/if}

{#if vault.localFolderHealth.state === NookLocalFolderHealthState.MultipleVaults}
  <LocalFolderMultipleVaultsDialog
    {vault}
    health={vault.localFolderHealth}
    onChooseFolder={() => vault.chooseReplacementLocalFolderForIssue()}
    onDisconnect={() => vault.disconnectLocalFolderMultipleVaultsProvider()}
    onDismiss={() => vault.dismissLocalFolderMultipleVaultsIssue()}
  />
{/if}

{#if vault.replacementConflicts.length > 0}
  <div
    class={`fixed left-4 right-4 z-50 mx-auto max-w-2xl rounded-lg border border-amber-500/40 bg-amber-950/95 p-4 text-sm text-amber-50 shadow-lg ${
      vault.securityConflicts.length > 0 ? 'bottom-32' : 'bottom-4'
    }`}
  >
    <p class="font-medium">{vault.t(I18N_KEYS.AppSecretSyncConflicts)}</p>
    <div class="mt-3 space-y-3">
      {#each vault.replacementConflicts as conflict (conflict.oldSecretId)}
        <div class="rounded border border-amber-400/30 p-3">
          <p class="text-amber-100">
            {(() => { const translationRequest: Parameters<typeof vault.t>[0] = {
  key: I18N_KEYS.AppConflictOriginal,
  replacements: {
              id: shortId(conflict.oldSecretId),
            },
}; return vault.t(translationRequest); })()}
          </p>
          <div class="mt-2 flex flex-wrap gap-2">
            {#each conflict.candidateSecretIds as candidateSecretId (candidateSecretId)}
              <Button
                size="sm"
                variant="secondary"
                disabled={vault.isSaving}
                onclick={() => {
                  const resolutionRequest: Parameters<
                    typeof vault.resolveReplacementConflict
                  >[0] = {
                    oldSecretId: conflict.oldSecretId,
                    chosenSecretId: candidateSecretId,
                  }
                  vault.resolveReplacementConflict(resolutionRequest)
                }}
              >
                {(() => { const translationRequest2: Parameters<typeof vault.t>[0] = {
  key: I18N_KEYS.AppConflictKeep,
  replacements: {
                  id: shortId(candidateSecretId),
                },
}; return vault.t(translationRequest2); })()}
              </Button>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  </div>
{/if}

{#if vault.securityConflicts.length > 0}
  <div
    class="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-2xl rounded-lg border border-red-500/50 bg-red-950/95 p-4 text-sm text-red-50 shadow-lg"
  >
    <p class="font-medium">{vault.t(I18N_KEYS.AppSecurityConflict)}</p>
    <div class="mt-2 space-y-2 text-red-100">
      {#each vault.securityConflicts as conflict (conflict.events.join(':'))}
        <p>{conflictReasons(conflict.reasons)}</p>
      {/each}
    </div>
  </div>
{/if}
