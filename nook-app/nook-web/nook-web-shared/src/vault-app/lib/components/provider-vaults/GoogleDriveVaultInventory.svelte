<!--
What the signed-in Google account's Nook folder already holds, shown in
Connect & sync before anything is written, one card per identity.

With an identity in use (adding a sync provider to it), each card carries
the one action Rust decided from this browser's key, and it runs at once: a
member continues, anyone else asks to join, a join asked before is checked
again. Or "Create a new identity" saves the identity in use there as a new
one, and connects.

On the recovery screen, with no identity yet, each identity offers the
decisions Rust allows; picking one runs nothing, and the step's button runs
the plan, then Connect & sync. Checking which passkey opens an identity
decrypts in memory and changes nothing.
-->
<script lang="ts">
  import { untrack, type Snippet } from 'svelte'
  import { ok, type Result } from 'neverthrow'
  import { RefreshCw } from '@lucide/svelte'
  import type {
    CredentialCheckReport,
    IdentityDecision,
    NookProviderSource,
    ProviderIdentityChoice,
  } from '$app-wasm'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import ProviderIdentityList from '$lib/components/provider-vaults/ProviderIdentityList.svelte'
  import SetupIdentityList from '$lib/components/provider-vaults/SetupIdentityList.svelte'
  import OptionDivider from '$lib/components/provider-vaults/OptionDivider.svelte'
  import { FirstRunIdentityAction } from '$lib/vault/first-run'
  import { IdentityControlViewKind } from '$lib/vault/identity-control.svelte'
  import {
    IdentityPlan,
    identityChoices,
    type IdentityChoicesFailure,
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
    AccessCheckTargetKind,
    type AccessCheckTarget,
  } from '$lib/vault/access-check'
  import {
    ConnectButtonLook,
    DriveVaultInventoryKind,
    DriveVaultInventoryReader,
    listedVaults,
    type ConnectPlanButton,
    type DriveVaultInventory,
  } from '$lib/components/provider-vaults/drive-vault-inventory'

  let {
    vault,
    accessToken,
    busy,
    onConnect,
    connectButton,
  }: {
    vault: VaultState
    /** The signed-in account's token; a new sign-in lists again. */
    accessToken: string
    busy: boolean
    /** Connect & sync, after the plan ran. */
    onConnect: () => Promise<void>
    /** The step's one action button. */
    connectButton: Snippet<[ConnectPlanButton]>
  } = $props()

  let inventory = $state<DriveVaultInventory>({
    kind: DriveVaultInventoryKind.Loading,
  })
  // Passkey checks of this listing, newest last; they live with the page.
  let checks = $state<CredentialCheckReport[]>([])
  let checking = $state(false)
  let working = $state(false)
  const plan = new IdentityPlan()
  // A join waiting for its key keeps the step still: one action at a time.
  const joinIdle = $derived(
    vault.identityJoin.kind === IdentityJoinWaitKind.Idle,
  )
  const disabled = $derived(busy || working || !joinIdle)

  const choices = $derived.by(
    (): Result<readonly ProviderIdentityChoice[], IdentityChoicesFailure> => {
      if (inventory.kind !== DriveVaultInventoryKind.Loaded) return ok([])
      const request: IdentityChoicesRequest = {
        vaults: listedVaults(inventory.listing),
        checks,
        authenticated: vault.identityInUse,
      }
      return identityChoices(request)
    },
  )

  const planned = $derived(choices.isOk() ? plan.planned(choices.value) : [])
  const listedIdentities = $derived(choices.isOk() ? choices.value.length : 0)

  async function load(token: string): Promise<void> {
    inventory = { kind: DriveVaultInventoryKind.Loading }
    checks = []
    plan.clear()
    const read = await new DriveVaultInventoryReader(vault).read()
    if (token !== accessToken) return
    inventory = read
  }

  $effect(() => {
    const token = accessToken
    // Only a new sign-in lists again, not the state the listing reads.
    untrack(() => void load(token))
  })

  function driveTarget(): AccessCheckTarget {
    return {
      kind: AccessCheckTargetKind.Source,
      source: { kind: 'googleDrive', accessToken },
    }
  }

  /** One passkey tap: which listed identity it opens, decrypted in memory. */
  async function checkPasskey(): Promise<void> {
    checking = true
    try {
      const checked = await new AccessCheckActions(vault).checkPasskey(
        driveTarget(),
      )
      if (checked.isErr()) {
        vault.errorMsg = vault.t(checked.error.translationKey)
        return
      }
      checks = [...checks, checked.value]
    } finally {
      checking = false
    }
  }

  /** Run the picked decisions, one identity at a time, then connect. A
   * decision that fails stops the plan and says so; Connect & sync waits. */
  async function runPlan(): Promise<void> {
    if (planned.length > 0) {
      working = true
      try {
        const source: NookProviderSource = { kind: 'googleDrive', accessToken }
        const run: IdentityPlanRun = { source, planned }
        const ran = await new IdentityPlanActions(vault).run(run)
        if (ran.isErr()) {
          vault.errorMsg = vault.t(ran.error.translationKey)
          await load(accessToken)
          return
        }
        plan.clear()
        switch (ran.value.kind) {
          case IdentityPlanOutcomeKind.Applied:
            break
          // A join waits for a new key of its own; its ceremony asks, and
          // Connect & sync waits for the identity that ceremony adopts.
          case IdentityPlanOutcomeKind.WaitsForKey:
            return
        }
      } finally {
        working = false
      }
    }
    await onConnect()
  }

  /** Adding a sync provider to the identity in use: each identity runs its
   * one setup action at once, and nothing is planned. */
  const setupMode = $derived(vault.identityInUse)
  /** The identity a setup action runs for; empty while none runs. */
  let workingOn = $state('')

  /** The decision a picked setup action runs for one identity. */
  function decisionFor(
    action: FirstRunIdentityAction,
  ): (choice: ProviderIdentityChoice) => IdentityDecision {
    return (choice) => {
      switch (action) {
        case FirstRunIdentityAction.Continue:
          return choice.setup.kind === 'continue'
            ? choice.setup.decision
            : 'leave'
        case FirstRunIdentityAction.AskToJoin:
          return 'askToJoin'
        case FirstRunIdentityAction.CheckJoin:
          return 'finishJoining'
      }
    }
  }

  /** The handler of one setup action: it runs for the identity picked. An
   * identity brought here (Continue, or a join found approved) completes the
   * step as first run does: the provider connects and syncs. Otherwise the
   * folder is read again unless a join waits for its own key. */
  function act(
    action: FirstRunIdentityAction,
  ): (choice: ProviderIdentityChoice) => Promise<void> {
    const decide = decisionFor(action)
    return async (choice) => {
      workingOn = choice.identity.identityId
      try {
        const source: NookProviderSource = { kind: 'googleDrive', accessToken }
        const run: IdentityPlanRun = {
          source,
          planned: [{ choice, decision: decide(choice) }],
        }
        const ran = await new IdentityPlanActions(vault).run(run)
        if (ran.isErr()) vault.errorMsg = vault.t(ran.error.translationKey)
        else if (ran.value.kind === IdentityPlanOutcomeKind.WaitsForKey) return
        else if (action !== FirstRunIdentityAction.AskToJoin) {
          await onConnect()
          return
        }
        await load(accessToken)
      } finally {
        workingOn = ''
      }
    }
  }

  /** The name of the identity in use, which the new-identity option saves. */
  const identityInUse = $derived(
    vault.identityControl.view.kind === IdentityControlViewKind.Ready
      ? vault.identityControl.view.snapshot.identityLabel
      : '',
  )

  const button = $derived.by((): ConnectPlanButton => {
    const busy =
      inventory.kind === DriveVaultInventoryKind.Loading ||
      working ||
      checking ||
      workingOn !== ''
    if (setupMode) {
      const detail: Parameters<typeof vault.t>[0] = {
        key: I18N_KEYS.ProviderIdentitiesNewIdentityDetail,
        replacements: { identity: identityInUse },
      }
      return {
        busy,
        label: vault.t(I18N_KEYS.FirstRunSyncCreateTitle),
        detail: identityInUse
          ? vault.t(detail)
          : vault.t(I18N_KEYS.FirstRunSyncCreateBody),
        look: ConnectButtonLook.NewIdentity,
        run: runPlan,
      }
    }
    return {
      busy,
      label:
        planned.length > 0
          ? vault.t(I18N_KEYS.ProviderIdentitiesConnectApply)
          : '',
      detail: '',
      look: ConnectButtonLook.Primary,
      run: runPlan,
    }
  })
</script>

{#if inventory.kind === DriveVaultInventoryKind.Loading}
  <p
    class="flex items-center gap-2 text-[11px] text-muted-foreground"
    role="status"
    data-testid="google-drive-vaults-loading"
  >
    <RefreshCw class="size-3.5 animate-spin" aria-hidden="true" />
    {vault.t(I18N_KEYS.ProviderVaultsLoading)}
  </p>
{:else if inventory.kind === DriveVaultInventoryKind.Loaded && inventory.listing.root === 'absent'}
  <p
    class="text-[11px] text-pretty text-muted-foreground"
    data-testid="google-folder-on-connect"
  >
    {vault.t(I18N_KEYS.ProviderVaultsRootAbsent)}
  </p>
{:else if inventory.kind === DriveVaultInventoryKind.Loaded && inventory.listing.root === 'found'}
  {#if choices.isErr()}
    <p class="text-xs text-destructive" role="alert">
      {vault.t(choices.error.translationKey)}
    </p>
  {:else if listedIdentities === 0}
    <p
      class="text-[11px] text-pretty text-muted-foreground"
      data-testid="google-drive-vaults-empty"
    >
      {vault.t(I18N_KEYS.ProviderVaultsRootEmpty)}
    </p>
  {:else}
    <div class="space-y-2" data-testid="google-drive-vaults">
      <p class="nk-subpanel-head">
        {vault.t(I18N_KEYS.ProviderVaultsListTitle)}
      </p>
      {#if setupMode}
        <SetupIdentityList
          {vault}
          choices={choices.value}
          working={workingOn}
          disabled={busy || !joinIdle}
          onContinue={act(FirstRunIdentityAction.Continue)}
          onAskToJoin={act(FirstRunIdentityAction.AskToJoin)}
          onCheck={act(FirstRunIdentityAction.CheckJoin)}
        />
      {:else}
        <ProviderIdentityList
          {vault}
          choices={choices.value}
          {plan}
          {disabled}
          {checking}
          onFindPasskey={checkPasskey}
        />
      {/if}
    </div>
  {/if}
{/if}
<IdentityJoinKeyGate {vault} onRequested={() => load(accessToken)} />
{#if setupMode && listedIdentities > 0}
  <OptionDivider {vault} />
{/if}
{@render connectButton(button)}
