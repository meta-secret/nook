<!--
Second step of setup: this browser's key exists, and the sync provider shows
the identities in its Nook folder. Before sign-in, one line and a small
diagram say what the provider is for. Rust decides each one's single action from
that key: a member continues and syncs, anyone else asks to join. A new
identity can be created there instead, or kept on this browser only. S3 storage
is the quiet second row: its form takes the place of the providers, and once
its location lists, its keyrings show the same way.
-->
<script lang="ts">
  import { tick, untrack } from 'svelte'
  import { ok, type Result } from 'neverthrow'
  import {
    Archive,
    ArrowRight,
    MonitorSmartphone,
    Plus,
    RefreshCw,
  } from '@lucide/svelte'
  import GoogleDriveMark from '$lib/components/provider-marks/GoogleDriveMark.svelte'
  import {
    provider_draft_label,
    s3_provider_draft,
    staged_s3_provider_detail,
    type ProviderIdentityChoice,
    type S3Connection,
  } from '$app-wasm'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { Button } from '$lib/components/ui/button'
  import {
    DraftDriveSignInKind,
    ProviderDraftReads,
  } from '$lib/vault/provider-draft-reads'
  import {
    BrowserOAuthProvider,
    resolveCurrentOAuthOriginSupport,
  } from '$lib/auth/oauth-origin'
  import SetupIdentityList from '$lib/components/provider-vaults/SetupIdentityList.svelte'
  import NewIdentityOption from '$lib/components/provider-vaults/NewIdentityOption.svelte'
  import OptionDivider from '$lib/components/provider-vaults/OptionDivider.svelte'
  import {
    SetupRecoveryKind,
    type SetupRecovery,
  } from '$lib/components/provider-vaults/setup-identity-offer'
  import S3ConnectionPanel from '$lib/components/S3ConnectionPanel.svelte'
  import {
    identityChoices,
    type IdentityChoicesFailure,
    type IdentityChoicesRequest,
  } from '$lib/components/provider-vaults/identity-plan.svelte'
  import FirstRunBackLink from './FirstRunBackLink.svelte'
  import FirstRunDiagram from './FirstRunDiagram.svelte'
  import {
    firstRunSyncDiagram,
    FirstRunSyncDiagramProvider,
    type FirstRunSyncDiagramRequest,
  } from './first-run-diagram'
  import FirstRunProgress from './FirstRunProgress.svelte'
  import type { VaultState } from '$lib/vault.svelte'
  import {
    FirstRunActions,
    FirstRunConnectionKind,
    FirstRunIdentityAction,
    FirstRunInventoryKind,
    FirstRunS3LocationKind,
    type FirstRunIdentity,
    type FirstRunIdentityRun,
    type FirstRunInventory,
    type FirstRunProviderSource,
  } from '$lib/vault/first-run'
  import { VaultOAuthActions } from '$lib/vault/oauth'
  import {
    FirstRunPlace,
    FirstRunStage,
    FirstRunSyncSource,
  } from '$lib/vault/state/ui.svelte'

  let { vault }: { vault: VaultState } = $props()

  const actions = $derived(new FirstRunActions(vault))
  let inventory = $state.raw<FirstRunInventory>({
    kind: FirstRunInventoryKind.Loading,
  })
  /** The identity an action runs for; empty while none runs. */
  let working = $state('')
  /** The S3 form's Connect runs: the location lists before it is staged. */
  let s3Connecting = $state(false)
  /** Why the S3 location did not list, said on the form; empty if it did. */
  let s3Error = $state('')

  // Google Drive is the provider setup offers; it is staged once, here,
  // unless S3 already is (Back from naming keeps it).
  untrack(() => actions.stageOnEntry())

  /** The signed-in Drive account the step names. */
  const driveSignIn = $derived(
    ProviderDraftReads.driveSignIn(vault.providerDraft),
  )
  const syncSource = $derived(actions.syncSource())
  /** Where the keyrings are read from: the staged S3 location, or the
   * signed-in Google account, once the picked provider can list. */
  const connection = $derived(actions.connection())
  const s3Location = $derived(FirstRunActions.s3Location(connection))
  const onS3 = $derived(s3Location.kind === FirstRunS3LocationKind.Shown)
  const connected = $derived(
    connection.kind === FirstRunConnectionKind.Connected,
  )
  const diagram = $derived.by(() => {
    const request: FirstRunSyncDiagramRequest = {
      vault,
      provider: FirstRunSyncDiagramProvider.Any,
    }
    return firstRunSyncDiagram(request)
  })
  const originSupport = resolveCurrentOAuthOriginSupport(
    BrowserOAuthProvider.GoogleDrive,
  )
  const busy = $derived(working !== '' || vault.isVerifying || s3Connecting)

  /** Read the provider's keyrings; a failed read says why on the vault.
   * Keyrings read for a source that changed meanwhile are not shown. */
  async function load(listing: FirstRunProviderSource): Promise<void> {
    inventory = { kind: FirstRunInventoryKind.Loading }
    const read = await actions.listVaults(listing)
    if (read.kind === FirstRunInventoryKind.Failed)
      vault.errorMsg = vault.t(read.failure)
    const current = actions.connection()
    if (
      current.kind === FirstRunConnectionKind.Connected &&
      current.source.kind === listing.kind
    )
      inventory = read
  }

  $effect(() => {
    // Only a new sign-in reads the folder again.
    const current = connection
    if (
      current.kind === FirstRunConnectionKind.Connected &&
      current.source.kind === 'googleDrive'
    ) {
      const listing = current.source
      untrack(() => void load(listing))
    }
  })

  // Back from naming or a join keeps the S3 location: read it again.
  untrack(() => {
    const current = actions.connection()
    if (
      current.kind === FirstRunConnectionKind.Connected &&
      current.source.kind === 's3'
    )
      void load(current.source)
  })

  const choices = $derived.by(
    (): Result<readonly ProviderIdentityChoice[], IdentityChoicesFailure> => {
      if (inventory.kind !== FirstRunInventoryKind.Loaded) return ok([])
      const request: IdentityChoicesRequest = {
        vaults: inventory.listing.vaults,
        identities: inventory.listing.identities,
        checks: [],
        authenticated: false,
      }
      return identityChoices(request)
    },
  )
  const listed = $derived(choices.isOk() ? choices.value : [])

  /** The handler of one action: it runs for the identity picked, then the
   * folder is read again while setup stays on this step. */
  function act(
    action: FirstRunIdentityAction,
  ): (choice: ProviderIdentityChoice) => Promise<void> {
    return async (choice) => {
      // Identities list only from a connected provider.
      const current = actions.connection()
      if (current.kind !== FirstRunConnectionKind.Connected) return
      working = choice.identity.identityId
      try {
        const run: FirstRunIdentityRun = {
          choice,
          source: { kind: 'remote', source: current.source },
          action,
        }
        await actions.runOn(run)
      } finally {
        working = ''
      }
      if (vault.firstRun === FirstRunStage.Sync) await load(current.source)
    }
  }

  /** A keyring with recovery passphrases can be joined with one: setup
   * moves to the recover step for it. */
  const recovery: SetupRecovery = {
    kind: SetupRecoveryKind.Offered,
    onRecover: (choice) => {
      const current = actions.connection()
      if (current.kind !== FirstRunConnectionKind.Connected) return
      const identity: FirstRunIdentity = {
        choice,
        source: { kind: 'remote', source: current.source },
      }
      actions.recover(identity)
    },
  }

  /** S3 is staged once its location lists; a refused key or a failed
   * listing stays on the form, said there. */
  async function connectS3(configuration: S3Connection): Promise<void> {
    s3Error = ''
    s3Connecting = true
    try {
      const location: FirstRunProviderSource = { kind: 's3', configuration }
      const read = await actions.listVaults(location)
      switch (read.kind) {
        case FirstRunInventoryKind.Loaded:
          vault.stageProviderDraft(s3_provider_draft(configuration))
          inventory = read
          return
        case FirstRunInventoryKind.Failed:
          s3Error = vault.t(read.failure)
          return
      }
    } finally {
      s3Connecting = false
    }
  }

  /** Back to Google Drive: the S3 draft and its secret go, and focus
   * returns to the S3 row. */
  async function changeProvider(): Promise<void> {
    s3Error = ''
    actions.beginGoogleDrive()
    await tick()
    const row = document.getElementById('first-run-s3-option')
    if (row instanceof HTMLButtonElement) row.focus()
  }

  function leave(): void {
    vault.cancelProviderSetup()
    vault.firstRun = FirstRunStage.Off
  }
</script>

<section
  class="mx-auto grid w-full max-w-md gap-6 py-6 sm:py-10"
  data-testid="first-run-sync-step"
>
  <div class="grid gap-4">
    <FirstRunBackLink
      {vault}
      testId="first-run-sync-back"
      disabled={busy}
      onBack={leave}
    />
    <FirstRunProgress {vault} current={FirstRunStage.Sync} />
  </div>

  <div class="space-y-2 text-center">
    <h1
      class="text-[1.75rem] leading-tight font-semibold tracking-[-0.02em] text-foreground"
    >
      {vault.t(
        connected ? I18N_KEYS.FirstRunSyncChooseTitle : I18N_KEYS.FirstRunSyncTitle,
      )}
    </h1>
    {#if connected}
      <p class="text-sm text-pretty text-muted-foreground">
        {vault.t(I18N_KEYS.FirstRunSyncChooseBody)}
      </p>
    {/if}
  </div>

  {#if !connected}
    <FirstRunDiagram {diagram} />
  {/if}

  {#if syncSource === FirstRunSyncSource.S3 && !connected}
    <div class="space-y-4" data-testid="first-run-s3-setup">
      <div class="flex items-center gap-2 text-sm">
        <Archive
          class="size-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <span class="font-medium text-foreground"
          >{vault.t(I18N_KEYS.ProviderPickerS3)}</span
        >
        <button
          type="button"
          class="ml-auto text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground disabled:opacity-60"
          data-testid="cancel-provider-setup"
          disabled={s3Connecting}
          onclick={() => void changeProvider()}
        >
          {vault.t(I18N_KEYS.ProviderSetupChangeProvider)}
        </button>
      </div>
      <S3ConnectionPanel
        {vault}
        idPrefix="first-run"
        framed
        submitLabel={vault.t(I18N_KEYS.CommonConnect)}
        submitTestId="first-run-s3-connect"
        busy={s3Connecting}
        busyLabel={vault.t(I18N_KEYS.CommonConnecting)}
        error={s3Error}
        onConnect={connectS3}
      />
    </div>
  {:else if !connected}
    <div
      class="nk-frame divide-y divide-border"
      data-testid="first-run-providers"
    >
      <div class="flex flex-wrap items-center gap-3 px-4 py-3">
        <span class="nk-tile nk-tile-sm" aria-hidden="true">
          <GoogleDriveMark class="size-4" />
        </span>
        <span class="min-w-0 flex-1 text-sm font-semibold text-foreground">
          {vault.t(I18N_KEYS.ProviderPickerGoogleDrive)}
        </span>
        <Button
          type="button"
          size="sm"
          data-testid="first-run-google-sign-in"
          disabled={vault.googleOAuthBusy || !originSupport.supported}
          onclick={() => void new VaultOAuthActions(vault).signInWithGoogle()}
        >
          {#if vault.googleOAuthBusy}
            <RefreshCw class="size-4 animate-spin" />
            {vault.t(I18N_KEYS.ProviderSetupGoogleSigningIn)}
          {:else}
            {vault.t(I18N_KEYS.ProviderSetupSignInWithGoogle)}
          {/if}
        </Button>
      </div>
      <button
        type="button"
        id="first-run-s3-option"
        class="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60"
        data-testid="first-run-s3-option"
        disabled={vault.googleOAuthBusy}
        onclick={() => actions.beginS3()}
      >
        <span class="nk-tile nk-tile-sm" aria-hidden="true">
          <Archive class="size-4" />
        </span>
        <span class="min-w-0 flex-1 text-sm font-medium text-foreground">
          {vault.t(I18N_KEYS.ProviderPickerS3)}
        </span>
        <ArrowRight
          class="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      </button>
    </div>
  {:else}
    {#if s3Location.kind === FirstRunS3LocationKind.Shown}
      {@const label = provider_draft_label(vault.providerDraft)}
      <p
        class="nk-spec flex min-w-0 items-baseline gap-2"
        data-testid="first-run-s3-location"
      >
        <span class="min-w-0 truncate text-foreground" title={label}
          >{label}</span
        >
        <span class="shrink-0 text-muted-foreground"
          >{staged_s3_provider_detail(s3Location.configuration)}</span
        >
      </p>
    {:else}
      <p class="nk-spec" data-testid="first-run-google-account">
        {#if driveSignIn.kind === DraftDriveSignInKind.SignedIn && driveSignIn.access.account.state === 'email'}
          {driveSignIn.access.account.email}
        {/if}
      </p>
    {/if}
    {#if inventory.kind === FirstRunInventoryKind.Loading}
      <p
        class="flex items-center gap-2 text-xs text-muted-foreground"
        role="status"
        data-testid="first-run-identities-loading"
      >
        <RefreshCw class="size-3.5 animate-spin" aria-hidden="true" />
        {vault.t(
          onS3
            ? I18N_KEYS.ProviderVaultsLoadingS3
            : I18N_KEYS.ProviderVaultsLoading,
        )}
      </p>
    {:else}
      {#if choices.isErr()}
        <p class="text-xs text-destructive" role="alert">
          {vault.t(choices.error.translationKey)}
        </p>
      {:else if listed.length > 0}
        <SetupIdentityList
          {vault}
          choices={listed}
          {working}
          onContinue={act(FirstRunIdentityAction.Continue)}
          onAskToJoin={act(FirstRunIdentityAction.AskToJoin)}
          onCheck={act(FirstRunIdentityAction.CheckJoin)}
          {recovery}
        />
        <OptionDivider {vault} />
      {:else}
        <p
          class="text-sm text-muted-foreground"
          data-testid="first-run-identities-empty"
        >
          {vault.t(
            onS3 ? I18N_KEYS.FirstRunSyncEmptyS3 : I18N_KEYS.FirstRunSyncEmpty,
          )}
        </p>
      {/if}
      {#if onS3 && choices.isOk() && listed.length === 0}
        <!-- An empty location: creating the keyring is the one thing to do. -->
        <Button
          type="button"
          class="justify-self-start"
          data-testid="first-run-create-new-identity"
          disabled={busy}
          onclick={() => actions.nameNew(FirstRunPlace.SyncProvider)}
        >
          <Plus class="size-4" />
          {vault.t(I18N_KEYS.FirstRunSyncCreateTitle)}
        </Button>
      {:else}
        <NewIdentityOption
          title={vault.t(I18N_KEYS.FirstRunSyncCreateTitle)}
          detail={vault.t(
            onS3
              ? I18N_KEYS.FirstRunSyncCreateBodyS3
              : I18N_KEYS.FirstRunSyncCreateBody,
          )}
          testId="first-run-create-new-identity"
          disabled={busy}
          onCreate={() => actions.nameNew(FirstRunPlace.SyncProvider)}
        />
      {/if}
      {#if onS3 && vault.errorMsg}
        <p
          class="text-xs text-destructive"
          role="alert"
          data-testid="first-run-sync-error"
        >
          {vault.errorMsg}
        </p>
      {/if}
    {/if}
  {/if}

  <div class="flex justify-center">
    <Button
      type="button"
      class="min-w-44 bg-accent/50 text-foreground hover:bg-accent"
      variant="ghost"
      size="sm"
      data-testid="first-run-sync-skip"
      disabled={busy}
      onclick={() => actions.nameNew(FirstRunPlace.ThisBrowser)}
    >
      <MonitorSmartphone class="size-4" aria-hidden="true" />
      {vault.t(I18N_KEYS.FirstRunSyncSkip)}
    </Button>
  </div>
</section>
