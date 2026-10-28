<!--
Second step of setup: this browser's key exists, and the sync provider shows
the identities in its Nook folder. Rust decides each one's single action from
that key: a member continues and syncs, anyone else asks to join. A new
identity can be created there instead, or kept on this browser only.
-->
<script lang="ts">
  import { untrack } from 'svelte'
  import { ok, type Result } from 'neverthrow'
  import { Plus, RefreshCw } from '@lucide/svelte'
  import type { NookProviderSource, ProviderIdentityChoice } from '$app-wasm'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { Button } from '$lib/components/ui/button'
  import { OAuthFilePresentation, oauth_access_token } from '$lib/auth/providers'
  import {
    BrowserOAuthProvider,
    resolveCurrentOAuthOriginSupport,
  } from '$lib/auth/oauth-origin'
  import SetupIdentityList from '$lib/components/provider-vaults/SetupIdentityList.svelte'
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
  import FirstRunBackLink from './FirstRunBackLink.svelte'
  import FirstRunProgress from './FirstRunProgress.svelte'
  import type { VaultState } from '$lib/vault.svelte'
  import {
    FirstRunActions,
    FirstRunIdentityAction,
    type FirstRunIdentityRun,
  } from '$lib/vault/first-run'
  import { VaultOAuthActions } from '$lib/vault/oauth'
  import { OAuthFileDraftKind } from '$lib/vault/state/provider.svelte'
  import { FirstRunPlace, FirstRunStage } from '$lib/vault/state/ui.svelte'

  let { vault }: { vault: VaultState } = $props()

  const actions = $derived(new FirstRunActions(vault))
  let inventory = $state<DriveVaultInventory>({
    kind: DriveVaultInventoryKind.Loading,
  })
  /** The identity an action runs for; empty while none runs. */
  let working = $state('')

  // Google Drive is the provider setup offers; it is staged once, here.
  untrack(() => {
    if (vault.oauthFileDraft.kind !== OAuthFileDraftKind.Configured)
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
  const originSupport = resolveCurrentOAuthOriginSupport(
    BrowserOAuthProvider.GoogleDrive,
  )

  async function load(token: string): Promise<void> {
    inventory = { kind: DriveVaultInventoryKind.Loading }
    const read = await new DriveVaultInventoryReader(vault).read()
    if (token === accessToken) inventory = read
  }

  $effect(() => {
    const token = accessToken
    // Only a new sign-in reads the folder again.
    if (token) untrack(() => void load(token))
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

  function source(): NookProviderSource {
    return { kind: 'googleDrive', accessToken }
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
      if (vault.firstRun === FirstRunStage.Sync) await load(accessToken)
    }
  }

  function leave(): void {
    vault.cancelProviderSetup()
    vault.firstRun = FirstRunStage.Off
  }
</script>

<section
  class="mx-auto grid w-full max-w-2xl gap-6 py-6 sm:py-10"
  data-testid="first-run-sync-step"
>
  <div class="grid gap-4">
    <FirstRunBackLink
      {vault}
      testId="first-run-sync-back"
      disabled={working !== '' || vault.isVerifying}
      onBack={leave}
    />
    <FirstRunProgress {vault} current={FirstRunStage.Sync} />
  </div>

  <div class="space-y-2">
    <h1
      class="text-[1.75rem] leading-tight font-semibold tracking-[-0.02em] text-foreground"
    >
      {vault.t(
        accessToken ? I18N_KEYS.FirstRunSyncChooseTitle : I18N_KEYS.FirstRunSyncTitle,
      )}
    </h1>
    <p class="max-w-[60ch] text-sm text-pretty text-muted-foreground">
      {vault.t(
        accessToken ? I18N_KEYS.FirstRunSyncChooseBody : I18N_KEYS.FirstRunSyncBody,
      )}
    </p>
  </div>

  {#if !accessToken}
    <div class="nk-frame flex flex-wrap items-center gap-3 px-4 py-3">
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
      {:else}
        <p class="text-sm text-muted-foreground" data-testid="first-run-identities-empty">
          {vault.t(I18N_KEYS.FirstRunSyncEmpty)}
        </p>
      {/if}
      <button
        type="button"
        class="group flex w-full items-center gap-3 border border-border bg-card p-4 text-left transition-colors hover:border-foreground/40 disabled:opacity-60"
        data-testid="first-run-create-new-identity"
        disabled={working !== '' || vault.isVerifying}
        onclick={() => actions.nameNew(FirstRunPlace.SyncProvider)}
      >
        <span class="nk-tile shrink-0" aria-hidden="true">
          <Plus class="size-4" />
        </span>
        <span class="min-w-0 flex-1">
          <span class="block text-sm font-semibold text-foreground">
            {vault.t(I18N_KEYS.FirstRunSyncCreateTitle)}
          </span>
          <span class="block text-xs text-pretty text-muted-foreground">
            {vault.t(I18N_KEYS.FirstRunSyncCreateBody)}
          </span>
        </span>
      </button>
    {/if}
  {/if}

  <div>
    <Button
      type="button"
      variant="ghost"
      data-testid="first-run-sync-skip"
      disabled={working !== '' || vault.isVerifying}
      onclick={() => actions.nameNew(FirstRunPlace.ThisBrowser)}
    >
      {vault.t(I18N_KEYS.FirstRunSyncSkip)}
    </Button>
  </div>
</section>
