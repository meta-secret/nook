<script lang="ts">
  import { JoinEnrollmentState } from '$app-wasm'
  import JoinEnrollmentDialog from '$lib/components/JoinEnrollmentDialog.svelte'
  import LocalFolderMultipleVaultsDialog from '$lib/components/LocalFolderMultipleVaultsDialog.svelte'
  import VaultSyncConflictDialog from '$lib/components/VaultSyncConflictDialog.svelte'
  import { Button } from '$lib/components/ui/button'
  import * as multiDeviceActions from '$lib/vault/multi-device'
  import type { VaultState } from '$lib/vault.svelte'
  import { SyncConflictReviewKind } from '$lib/vault/state/sync.svelte'

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
    ? 'pending'
    : 'needs_request'}
  deviceId={vault.deviceId}
  isBusy={vault.isVerifying}
  bind:enrollSecretsKey={vault.enrollSecretsKey}
  bind:enrollMembersKey={vault.enrollMembersKey}
  onConfirm={() => multiDeviceActions.confirmJoinRequest(vault)}
  onEnrollWithKeys={() => vault.enrollAndConnect()}
  onCreateFreshVault={() => vault.createFreshVault()}
  onCancel={() => multiDeviceActions.dismissJoinEnrollment(vault)}
/>

{#if vault.syncConflictReview.kind === SyncConflictReviewKind.RequiresDecision}
  <VaultSyncConflictDialog
    {vault}
    conflict={vault.syncConflictReview.conflict}
    isBusy={vault.isVerifying}
    onKeepLocal={() => vault.resolveSyncConflictKeepLocal()}
    onKeepRemote={() => vault.resolveSyncConflictKeepRemote()}
    onImportAsNewVault={() => vault.resolveSyncConflictImportRemote()}
    onCancel={() => vault.clearPendingSyncConflict()}
  />
{/if}

{#if vault.localFolderMultipleVaultsIssue}
  <LocalFolderMultipleVaultsDialog
    {vault}
    issue={vault.localFolderMultipleVaultsIssue}
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
    <p class="font-medium">{vault.t('app.secret_sync_conflicts')}</p>
    <div class="mt-3 space-y-3">
      {#each vault.replacementConflicts as conflict (conflict.oldSecretId)}
        <div class="rounded border border-amber-400/30 p-3">
          <p class="text-amber-100">
            {vault.t('app.conflict_original', {
              id: shortId(conflict.oldSecretId),
            })}
          </p>
          <div class="mt-2 flex flex-wrap gap-2">
            {#each conflict.candidates as candidate (candidate.secretId)}
              <Button
                size="sm"
                variant="secondary"
                disabled={vault.isSaving}
                onclick={() =>
                  vault.resolveReplacementConflict(
                    conflict.oldSecretId,
                    candidate.secretId,
                  )}
              >
                {vault.t('app.conflict_keep', {
                  id: shortId(candidate.secretId),
                })}
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
    <p class="font-medium">{vault.t('app.security_conflict')}</p>
    <div class="mt-2 space-y-2 text-red-100">
      {#each vault.securityConflicts as conflict (conflict.events.join(':'))}
        <p>{conflictReasons(conflict.reasons)}</p>
      {/each}
    </div>
  </div>
{/if}
