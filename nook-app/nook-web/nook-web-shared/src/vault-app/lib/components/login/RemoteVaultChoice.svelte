<!--
A recovery provider's identities, one card each, on a browser with no
identity in use. Rust decides what each identity allows: recover it with
its passkey, ask one of its devices to let this browser join, or finish a
join a device approved, or join it with one of its recovery passphrases,
whose words are typed in place of the list. Asking and recovering need
this browser's own protected key, so the device protection gate runs first
when there is none. Picking a decision runs nothing; Apply runs the plan. A
keyring the plan brings here keeps this provider, and the page lands on the
keyrings page with it: its vaults come with it and open from its card.
Checking which passkey opens an identity decrypts in memory and changes
nothing.
-->
<script lang="ts">
  import { RefreshCw } from '@lucide/svelte'
  import type { CredentialCheckReport } from '$app-wasm'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { Button } from '$lib/components/ui/button'
  import ProviderIdentityList from '$lib/components/provider-vaults/ProviderIdentityList.svelte'
  import {
    IdentityPlan,
    identityChoices,
    type IdentityChoicesRequest,
  } from '$lib/components/provider-vaults/identity-plan.svelte'
  import IdentityJoinKeyGate from '$lib/components/provider-vaults/IdentityJoinKeyGate.svelte'
  import KeyringRecoveryWords from '$lib/components/provider-vaults/KeyringRecoveryWords.svelte'
  import {
    IdentityPlanActions,
    IdentityPlanOutcomeKind,
    type IdentityPlanRun,
  } from '$lib/vault/identity-plan-actions'
  import type { VaultState } from '$lib/vault.svelte'
  import {
    IdentityJoinWaitKind,
    KeyringRecoveryKind,
  } from '$lib/vault/identity-join-wait'
  import {
    FirstRunActions,
    ProviderFolderBinding,
  } from '$lib/vault/first-run'
  import {
    AccessCheckActions,
    recoveryCheckTarget,
    recoveryProviderSource,
  } from '$lib/vault/access-check'

  let {
    vault,
    busy,
    onApplied,
  }: {
    vault: VaultState
    busy: boolean
    /** After a plan that brought no keyring here, as after asking to join:
     * list the provider's keyrings again. */
    onApplied: () => void | Promise<void>
  } = $props()

  let checks = $state<CredentialCheckReport[]>([])
  let checking = $state(false)
  let working = $state(false)
  const plan = new IdentityPlan()
  // A join waiting for its key keeps the page still: one action at a time.
  const joinIdle = $derived(
    vault.identityJoin.kind === IdentityJoinWaitKind.Idle,
  )
  const disabled = $derived(busy || checking || working || !joinIdle)

  const choices = $derived.by(() => {
    const request: IdentityChoicesRequest = {
      vaults: vault.remoteVaultChoices.vaults,
      identities: vault.remoteVaultChoices.identities,
      checks,
      authenticated: vault.isAuthenticated,
    }
    return identityChoices(request)
  })
  const planned = $derived(choices.isOk() ? plan.planned(choices.value) : [])

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

  async function apply(): Promise<void> {
    working = true
    // A keyring the plan brings here keeps this provider, with its vaults.
    const brought = planned.some(
      (entry) =>
        entry.decision === 'addToBrowser' || entry.decision === 'finishJoining',
    )
    try {
      const run: IdentityPlanRun = {
        source: recoveryProviderSource(vault),
        planned,
      }
      const ran = await new IdentityPlanActions(vault).run(run)
      if (ran.isErr()) {
        vault.errorMsg = ran.error.message(vault)
        return
      }
      plan.clear()
      switch (ran.value.kind) {
        case IdentityPlanOutcomeKind.Applied:
        case IdentityPlanOutcomeKind.AddedBeside:
          break
        // A join waits for a fresh key; its ceremony asks, then lists again.
        // Or a recovery passphrase's words are typed next; they open it.
        case IdentityPlanOutcomeKind.WaitsForKey:
        case IdentityPlanOutcomeKind.RecoveryWordsNext:
          return
      }
      if (brought) {
        await connectRecovered()
        return
      }
    } finally {
      working = false
    }
    await onApplied()
  }
  /** A keyring recovered or joined here keeps this provider, and the page
   * lands on the keyrings page with it. The location names itself. */
  function connectRecovered(): Promise<boolean> {
    return new FirstRunActions(vault).connectRecoveredKeyring(
      ProviderFolderBinding.Named,
    )
  }
</script>

<section class="grid gap-3" data-testid="remote-vault-choice">
  <IdentityJoinKeyGate {vault} onRequested={onApplied} />
  <div class="space-y-1">
    <p class="text-sm font-medium text-foreground">
      {vault.t(I18N_KEYS.FirstRunRestoreChooseVault)}
    </p>
    <p class="text-sm text-pretty text-muted-foreground">
      {vault.t(I18N_KEYS.FirstRunRestoreChooseVaultBody)}
    </p>
  </div>
  {#if vault.keyringRecovery.kind === KeyringRecoveryKind.Words}
    <KeyringRecoveryWords
      {vault}
      join={vault.keyringRecovery.join}
      connect={connectRecovered}
    />
  {:else if choices.isErr()}
    <p class="text-xs text-destructive" role="alert">
      {vault.t(choices.error.translationKey)}
    </p>
  {:else}
    <ProviderIdentityList
      {vault}
      choices={choices.value}
      {plan}
      {disabled}
      {checking}
      onFindPasskey={checkPasskey}
    />
    {#if planned.length > 0}
      <div class="flex justify-end">
        <Button
          type="button"
          class="sm:min-w-[180px]"
          data-testid="remote-vault-choice-apply"
          {disabled}
          onclick={() => void apply()}
        >
          {#if working}
            <RefreshCw class="size-4 animate-spin" aria-hidden="true" />
            {vault.t(I18N_KEYS.ProviderIdentitiesApplying)}
          {:else}
            {vault.t(I18N_KEYS.ProviderIdentitiesApply)}
          {/if}
        </Button>
      </div>
    {/if}
  {/if}
</section>
