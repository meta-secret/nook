<!--
A recovery provider's identities, one card each, on a browser with no
identity in use. Rust decides what each identity allows: recover it with
its passkey, ask one of its devices to let this browser join, or finish a
join a device approved. Asking needs this browser's own protected key, so
the device protection gate runs first when there is none. Picking a
decision runs nothing; Apply runs the plan. Checking which passkey opens an
identity decrypts in memory and changes nothing.
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
  import {
    IdentityPlanActions,
    IdentityPlanOutcomeKind,
    type IdentityPlanRun,
  } from '$lib/vault/identity-plan-actions'
  import type { VaultState } from '$lib/vault.svelte'
  import { IdentityJoinWaitKind } from '$lib/vault/identity-join-wait'
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
    /** After the plan ran: open what it recovered. */
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
      vaults: vault.remoteVaultChoices,
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
    // A keyring recovered here opens its vault next: the import continues
    // with that vault, as with one picked from a list of vaults.
    const recovered = planned.find((entry) => entry.decision === 'addToBrowser')
    const [recoveredVault] = recovered ? recovered.choice.vaults : []
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
          break
        // A join waits for a fresh key; its ceremony asks, then lists again.
        case IdentityPlanOutcomeKind.WaitsForKey:
          return
      }
      if (recoveredVault) {
        const chosen = vault.chooseRemoteVault(recoveredVault.storeId)
        if (chosen.isErr()) {
          vault.errorMsg = vault.t(chosen.error.translationKey)
          return
        }
      }
    } finally {
      working = false
    }
    await onApplied()
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
  {#if choices.isErr()}
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
