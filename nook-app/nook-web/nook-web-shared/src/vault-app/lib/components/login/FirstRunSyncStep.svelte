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
  import { Archive, ArrowRight, Cloud, Plus, RefreshCw } from '@lucide/svelte'
  import type {
    NookProviderSource,
    ProviderIdentityChoice,
    S3ProviderConfig,
  } from '$app-wasm'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { Button } from '$lib/components/ui/button'
  import {
    OAuthFilePresentation,
    oauth_access_token,
    S3_PROVIDER_TYPE,
  } from '$lib/auth/providers'
  import {
    BrowserOAuthProvider,
    resolveCurrentOAuthOriginSupport,
  } from '$lib/auth/oauth-origin'
  import SetupIdentityList from '$lib/components/provider-vaults/SetupIdentityList.svelte'
  import NewIdentityOption from '$lib/components/provider-vaults/NewIdentityOption.svelte'
  import OptionDivider from '$lib/components/provider-vaults/OptionDivider.svelte'
  import S3ConnectionPanel from '$lib/components/S3ConnectionPanel.svelte'
  import S3ProviderHeading from '$lib/components/S3ProviderHeading.svelte'
  import {
    identityChoices,
    type IdentityChoicesFailure,
    type IdentityChoicesRequest,
  } from '$lib/components/provider-vaults/identity-plan.svelte'
  import {
    DriveVaultInventoryKind,
    DriveVaultInventoryReader,
    listedVaults,
    type DriveVaultInventory,
  } from '$lib/components/provider-vaults/drive-vault-inventory'
  import {
    S3StagedLocation,
    S3VaultInventoryKind,
    S3VaultInventoryReader,
    type S3VaultInventory,
  } from '$lib/components/provider-vaults/s3-vault-inventory'
  import {
    S3ConnectAvailability,
    S3ConnectionAlertKind,
    S3ConnectionFrame,
    S3ConnectionProgress,
    S3ConnectionSubmit,
    type S3ConnectionAlert,
  } from '$lib/components/s3-connection-form'
  import FirstRunBackLink from './FirstRunBackLink.svelte'
  import FirstRunDiagram from './FirstRunDiagram.svelte'
  import {
    firstRunSyncDiagram,
    type FirstRunSyncDiagramRequest,
  } from './first-run-diagram'
  import FirstRunProgress from './FirstRunProgress.svelte'
  import type { VaultState } from '$lib/vault.svelte'
  import {
    FirstRunActions,
    FirstRunIdentityAction,
    type FirstRunIdentityRun,
  } from '$lib/vault/first-run'
  import { VaultOAuthActions } from '$lib/vault/oauth'
  import {
    LoginSetupKind,
    OAuthFileDraftKind,
    S3DraftKind,
  } from '$lib/vault/state/provider.svelte'
  import {
    FirstRunPlace,
    FirstRunStage,
    FirstRunSyncSource,
  } from '$lib/vault/state/ui.svelte'

  let { vault }: { vault: VaultState } = $props()

  const actions = $derived(new FirstRunActions(vault))
  let inventory = $state<DriveVaultInventory>({
    kind: DriveVaultInventoryKind.Loading,
  })
  let s3Inventory = $state.raw<S3VaultInventory>({
    kind: S3VaultInventoryKind.Loading,
  })
  /** The S3 form's Connect: the location lists before it is staged. */
  let s3Connect = $state<S3ConnectionProgress>(S3ConnectionProgress.Idle)
  let s3Alert = $state.raw<S3ConnectionAlert>({
    kind: S3ConnectionAlertKind.None,
  })
  /** The identity an action runs for; empty while none runs. */
  let working = $state('')

  // Google Drive is the provider setup offers; it is staged once, here,
  // unless S3 already is (Back from naming keeps it).
  untrack(() => {
    const s3Staged =
      vault.loginSetup.kind === LoginSetupKind.Active &&
      vault.loginSetup.providerType === S3_PROVIDER_TYPE
    if (!s3Staged && vault.oauthFileDraft.kind !== OAuthFileDraftKind.Configured)
      actions.beginGoogleDrive()
  })

  const accessToken = $derived.by(() => {
    if (vault.oauthFileDraft.kind !== OAuthFileDraftKind.Configured) return ''
    const credential = oauth_access_token(vault.oauthFileDraft.config)
    return credential.kind === 'available' ? credential.token : ''
  })
  const account = $derived(
    vault.oauthFileDraft.kind === OAuthFileDraftKind.Configured
      ? new OAuthFilePresentation(vault.oauthFileDraft.config).oauthAccountLabel()
      : '',
  )
  const syncSource = $derived(actions.syncSource())
  const connected = $derived.by(() => {
    switch (syncSource) {
      case FirstRunSyncSource.GoogleDrive:
        return Boolean(accessToken)
      case FirstRunSyncSource.S3:
        return vault.s3Draft.kind === S3DraftKind.Configured
    }
  })
  const diagram = $derived.by(() => {
    const request: FirstRunSyncDiagramRequest = {
      vault,
      provider: vault.t(I18N_KEYS.JoinNodeProvider),
    }
    return firstRunSyncDiagram(request)
  })
  const originSupport = resolveCurrentOAuthOriginSupport(
    BrowserOAuthProvider.GoogleDrive,
  )
  const busy = $derived(
    working !== '' ||
      vault.isVerifying ||
      s3Connect !== S3ConnectionProgress.Idle,
  )

  async function load(token: string): Promise<void> {
    inventory = { kind: DriveVaultInventoryKind.Loading }
    const read = await new DriveVaultInventoryReader(vault).read()
    if (token === accessToken) inventory = read
  }

  /** Read the staged S3 location again; a failure says why under the list. */
  async function loadS3(configuration: S3ProviderConfig): Promise<void> {
    s3Inventory = { kind: S3VaultInventoryKind.Loading }
    const read = await new S3VaultInventoryReader(vault).read(configuration)
    const staged = vault.s3Draft
    if (staged.kind !== S3DraftKind.Configured || staged.config !== configuration)
      return
    s3Inventory = read
    switch (read.kind) {
      case S3VaultInventoryKind.Failed:
        vault.errorMsg = vault.t(read.failure.translationKey)
        return
      case S3VaultInventoryKind.Loaded:
        return
    }
  }

  $effect(() => {
    const token = accessToken
    // Only a new sign-in reads the folder again.
    if (token) untrack(() => void load(token))
  })

  // Back from naming or a join keeps the S3 location: read it again.
  untrack(() => {
    const staged = vault.s3Draft
    if (staged.kind === S3DraftKind.Configured) void loadS3(staged.config)
  })

  const choices = $derived.by(
    (): Result<readonly ProviderIdentityChoice[], IdentityChoicesFailure> => {
      if (inventory.kind !== DriveVaultInventoryKind.Loaded) return ok([])
      const request: IdentityChoicesRequest = {
        vaults: listedVaults(inventory.listing),
        checks: [],
        authenticated: false,
      }
      return identityChoices(request)
    },
  )
  const listed = $derived(choices.isOk() ? choices.value : [])
  const s3Choices = $derived.by(
    (): Result<readonly ProviderIdentityChoice[], IdentityChoicesFailure> => {
      if (s3Inventory.kind !== S3VaultInventoryKind.Loaded) return ok([])
      const request: IdentityChoicesRequest = {
        vaults: s3Inventory.listing.vaults,
        checks: [],
        authenticated: false,
      }
      return identityChoices(request)
    },
  )
  const s3Listed = $derived(s3Choices.isOk() ? s3Choices.value : [])

  function source(): NookProviderSource {
    const s3 = vault.s3Draft
    switch (s3.kind) {
      case S3DraftKind.Configured:
        return { kind: 's3', configuration: s3.config }
      case S3DraftKind.NotConfigured:
        return { kind: 'googleDrive', accessToken }
    }
  }

  /** Read the provider's identities again after an action. */
  async function reload(): Promise<void> {
    const s3 = vault.s3Draft
    switch (s3.kind) {
      case S3DraftKind.Configured:
        return loadS3(s3.config)
      case S3DraftKind.NotConfigured:
        return load(accessToken)
    }
  }

  /** The handler of one action: it runs for the identity picked, then the
   * folder is read again while setup stays on this step. */
  function act(
    action: FirstRunIdentityAction,
  ): (choice: ProviderIdentityChoice) => Promise<void> {
    return async (choice) => {
      working = choice.identity.identityId
      try {
        const run: FirstRunIdentityRun = { choice, source: source(), action }
        await actions.runOn(run)
      } finally {
        working = ''
      }
      if (vault.firstRun === FirstRunStage.Sync) await reload()
    }
  }

  /** S3 is staged once its location lists; a refused key or a failed
   * listing stays on the form, said there. */
  async function connectS3(configuration: S3ProviderConfig): Promise<void> {
    s3Alert = { kind: S3ConnectionAlertKind.None }
    s3Connect = S3ConnectionProgress.Connecting
    try {
      const read = await new S3VaultInventoryReader(vault).read(configuration)
      switch (read.kind) {
        case S3VaultInventoryKind.Loaded:
          vault.configureS3(configuration)
          s3Inventory = read
          return
        case S3VaultInventoryKind.Failed:
          s3Alert = {
            kind: S3ConnectionAlertKind.Shown,
            failure: read.failure.kind,
            message: vault.t(read.failure.translationKey),
          }
          return
      }
    } finally {
      s3Connect = S3ConnectionProgress.Idle
    }
  }

  /** Back to Google Drive: the S3 draft and its secret go, and focus
   * returns to the S3 row. */
  async function changeProvider(): Promise<void> {
    s3Alert = { kind: S3ConnectionAlertKind.None }
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
    <p class="text-sm text-pretty text-muted-foreground">
      {vault.t(
        connected ? I18N_KEYS.FirstRunSyncChooseBody : I18N_KEYS.FirstRunSyncBody,
      )}
    </p>
  </div>

  {#if !connected}
    <FirstRunDiagram {diagram} />
  {/if}

  {#if syncSource === FirstRunSyncSource.S3}
    {#if vault.s3Draft.kind === S3DraftKind.Configured}
      {@const location = new S3StagedLocation(vault.s3Draft.config)}
      <p
        class="nk-spec flex min-w-0 items-baseline gap-2"
        data-testid="first-run-s3-location"
      >
        <span class="min-w-0 truncate text-foreground" title={location.label}
          >{location.label}</span
        >
        <span class="shrink-0 text-muted-foreground">{location.detail}</span>
      </p>
      {#if s3Inventory.kind === S3VaultInventoryKind.Loading}
        <p
          class="flex items-center gap-2 text-xs text-muted-foreground"
          role="status"
          data-testid="first-run-identities-loading"
        >
          <RefreshCw class="size-3.5 animate-spin" aria-hidden="true" />
          {vault.t(I18N_KEYS.ProviderVaultsLoadingS3)}
        </p>
      {:else}
        {#if s3Choices.isErr()}
          <p class="text-xs text-destructive" role="alert">
            {vault.t(s3Choices.error.translationKey)}
          </p>
        {:else if s3Listed.length > 0}
          <SetupIdentityList
            {vault}
            choices={s3Listed}
            {working}
            onContinue={act(FirstRunIdentityAction.Continue)}
            onAskToJoin={act(FirstRunIdentityAction.AskToJoin)}
            onCheck={act(FirstRunIdentityAction.CheckJoin)}
          />
          <OptionDivider {vault} />
          <NewIdentityOption
            title={vault.t(I18N_KEYS.FirstRunSyncCreateTitle)}
            detail={vault.t(I18N_KEYS.FirstRunSyncCreateBodyS3)}
            testId="first-run-create-new-identity"
            disabled={busy}
            onCreate={() => actions.nameNew(FirstRunPlace.SyncProvider)}
          />
        {:else}
          <!-- An empty location: creating the keyring is the one thing to do. -->
          <p
            class="text-sm text-muted-foreground"
            data-testid="first-run-identities-empty"
          >
            {vault.t(I18N_KEYS.FirstRunSyncEmptyS3)}
          </p>
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
        {/if}
        {#if vault.errorMsg}
          <p
            class="text-xs text-destructive"
            role="alert"
            data-testid="first-run-sync-error"
          >
            {vault.errorMsg}
          </p>
        {/if}
      {/if}
    {:else}
      <div class="space-y-4" data-testid="first-run-s3-setup">
        <S3ProviderHeading
          {vault}
          progress={s3Connect}
          onChangeProvider={() => void changeProvider()}
        />
        <S3ConnectionPanel
          {vault}
          idPrefix="first-run"
          frame={S3ConnectionFrame.Panel}
          submit={S3ConnectionSubmit.Connect}
          progress={s3Connect}
          availability={S3ConnectAvailability.Available}
          alert={s3Alert}
          onConnect={connectS3}
        />
      </div>
    {/if}
  {:else if !accessToken}
    <div
      class="nk-frame divide-y divide-border"
      data-testid="first-run-providers"
    >
      <div class="flex flex-wrap items-center gap-3 px-4 py-3">
        <span class="nk-tile nk-tile-sm" aria-hidden="true">
          <Cloud class="size-4" />
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
    <p class="nk-spec" data-testid="first-run-google-account">{account}</p>
    {#if inventory.kind === DriveVaultInventoryKind.Loading}
      <p
        class="flex items-center gap-2 text-xs text-muted-foreground"
        role="status"
        data-testid="first-run-identities-loading"
      >
        <RefreshCw class="size-3.5 animate-spin" aria-hidden="true" />
        {vault.t(I18N_KEYS.ProviderVaultsLoading)}
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
        />
        <OptionDivider {vault} />
      {:else}
        <p class="text-sm text-muted-foreground" data-testid="first-run-identities-empty">
          {vault.t(I18N_KEYS.FirstRunSyncEmpty)}
        </p>
      {/if}
      <NewIdentityOption
        title={vault.t(I18N_KEYS.FirstRunSyncCreateTitle)}
        detail={vault.t(I18N_KEYS.FirstRunSyncCreateBody)}
        testId="first-run-create-new-identity"
        disabled={working !== '' || vault.isVerifying}
        onCreate={() => actions.nameNew(FirstRunPlace.SyncProvider)}
      />
    {/if}
  {/if}

  <div class="flex justify-center">
    <Button
      type="button"
      variant="ghost"
      data-testid="first-run-sync-skip"
      disabled={busy}
      onclick={() => actions.nameNew(FirstRunPlace.ThisBrowser)}
    >
      {vault.t(I18N_KEYS.FirstRunSyncSkip)}
    </Button>
  </div>
</section>
