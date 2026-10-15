<script lang="ts">
  import {
    WorkspaceLocation,
    WorkspacePath,
    WorkspaceRouteLookupKind,
  } from '$lib/app/workspace-route'
  import type {
    IdentitySectionTarget,
    IdentityVaultTarget,
  } from '$lib/components/identities/identity-card-model'
  import type { SentinelActionResult } from '$lib/vault/sentinel-genesis'
  type EnrollmentCodeUnlock = {
    readonly code: string
    readonly password: string
  }

  type VaultPasswordUnlock = {
    readonly entryId: string
    readonly password: string
  }

  import { I18N_KEYS } from '../../../generated/i18n-keys'
  import { ArrowLeft, RefreshCw, ShieldCheck } from '@lucide/svelte'
  import { onMount, tick, untrack, type ComponentProps } from 'svelte'
  import type { VaultState } from '$lib/vault.svelte'
  import IdentitiesHub from '$lib/components/identities/IdentitiesHub.svelte'
  import {
    DeviceProtectionStatus,
    type StartSentinelGenesisArgs,
  } from '$app-wasm'
  import { Button } from '$lib/components/ui/button'
  import type {
    OAuthFilePreset,
    ProviderSetupRequest,
    StorageProvider,
    StorageProviderType,
  } from '$lib/auth/providers'
  import {
    DEFAULT_GITHUB_REPO,
    LocalFolderPresentation,
    LocalFolderHandleKind,
    oauth_access_token,
  } from '$lib/auth/providers'
  import { WorkspaceRoute } from '$lib/app/workspace-route'
  import { WorkspaceSectionRoute } from '$lib/vault/ui'
  import { VaultWorkspaceActions } from '$lib/vault/ui'
  import ProviderSetupFields from '$lib/components/ProviderSetupFields.svelte'
  import OAuthProviderSetupWizard from '$lib/components/OAuthProviderSetupWizard.svelte'
  import GitHubProviderSetupWizard from '$lib/components/GitHubProviderSetupWizard.svelte'
  import LocalFolderProviderSetupWizard from '$lib/components/LocalFolderProviderSetupWizard.svelte'
  import {
    LoginVaultEntryKind,
    type LoginVaultEntry,
  } from '$lib/components/login/login-unlock-state'
  import LoginCreateVaultChooser from '$lib/components/login/LoginCreateVaultChooser.svelte'
  import type { SentinelGenesisParticipation } from '$lib/components/login/login-create-vault-chooser-contract'
  import {
    LoginVaultExtensionPairingStatusLookup,
    type LoginVaultExtensionPairingStatusEntry,
  } from '$lib/components/login/login-vault-extension-pairing-status'
  import LoginVaultPicker from '$lib/components/login/LoginVaultPicker.svelte'
  import LoginNewVaultPanel from '$lib/components/login/LoginNewVaultPanel.svelte'
  import LoginProviderManagement from '$lib/components/login/LoginProviderManagement.svelte'
  import { LoginProviderManagementVariant } from '$lib/components/login/login-provider-management-state'
  import JoinThisDevice from '$lib/components/join/JoinThisDevice.svelte'
  import { NewIdentityStage } from '$lib/vault/state/ui.svelte'
  import CardPasswordUnlock from '$lib/components/identities/CardPasswordUnlock.svelte'
  import CardPinUnlock from '$lib/components/identities/CardPinUnlock.svelte'
  import {
    PinPromptKind,
    UnlockPageKind,
    type PinPrompt,
    type UnlockDestination,
    type UnlockPage,
  } from '$lib/components/identities/card-unlock'
  import {
    IdentitySwitch,
    IdentitySwitchOutcome,
  } from '$lib/components/identities/identity-switch'
  import { DeviceProtectionActions } from '$lib/vault/device-protection.svelte'
  import SentinelCeremonyPanel from '$lib/components/login/SentinelCeremonyPanel.svelte'
  import { SentinelCeremonyVisibility } from '$lib/vault/sentinel-unlock'
  import {
    SentinelLoginPresentationReader,
    SentinelLoginPresentationKind,
  } from '$lib/vault/sentinel-login-presentation.svelte'
  import RemoteVaultRecoveryPanel from '$lib/components/login/RemoteVaultRecoveryPanel.svelte'
  import RemoteVaultChoice from '$lib/components/login/RemoteVaultChoice.svelte'
  import * as sentinelGenesisActions from '$lib/vault/sentinel-genesis'
  import { SentinelGenesisPhase, type VaultApplication } from '$app-wasm'
  import {
    ActiveVaultKind,
    LocalFolderDraftKind,
    LoginSetupKind,
    LoginVaultSelectionKind,
    OAuthFileDraftKind,
    OAuthSetupPresetKind,
    RecoveryDiscoveryKind,
    type LoginSetup,
  } from '$lib/vault/state/provider.svelte'

  let {
    vault,
    appKind,
    providers,
    loginSetup,
    githubPat = $bindable(''),
    githubRepo = $bindable(DEFAULT_GITHUB_REPO),
    isVerifying,
    isInitializing,
    addProviderOpen = false,
    onUnlock,
    onBeginAddProvider,
    onCancelAddProvider,
    onBeginSetup,
    onCancelSetup,
    onUseEnrollmentCode,
    onUnlockWithPassword,
    onSentinelUnlocked,
    onCreateDeviceVault,
    onStartSentinelGenesis,
    onCreateSentinelGenesisPublicKeyAnnouncement,
    onCreateSentinelGenesisParticipantResponse,
    onRemoveProvider,
    prefillEnrollmentCode = '',
    enrollmentFromUrlPending = false,
    deviceAuthorizationPending = false,
    usesExtensionDeviceIdentity = false,
    sentinelInvitationRequest = '',
    sentinelParticipantResponsePending = false,
    sentinelParticipantResponse = '',
    sentinelOnboardingPackage = '',
    extensionConnectPairingStatusEntries,
    onAcceptSentinelOnboardingPackage,
  }: {
    vault: VaultState
    appKind: VaultApplication
    providers: StorageProvider[]
    loginSetup: LoginSetup
    githubPat: string
    githubRepo: string
    isVerifying: boolean
    isInitializing: boolean
    addProviderOpen?: boolean
    onUnlock: () => void | Promise<void>
    onBeginAddProvider?: () => void
    onCancelAddProvider?: () => void
    onBeginSetup: (request: ProviderSetupRequest) => void
    onCancelSetup: () => void
    onUseEnrollmentCode?: (args: EnrollmentCodeUnlock) => void | Promise<void>
    onUnlockWithPassword: (args: VaultPasswordUnlock) => void | Promise<void>
    onSentinelUnlocked?: () => void | Promise<void>
    onCreateDeviceVault: (label: string) => void | Promise<void>
    onStartSentinelGenesis: (args: StartSentinelGenesisArgs) => Promise<boolean>
    onCreateSentinelGenesisPublicKeyAnnouncement?: () => Promise<
      SentinelActionResult<string>
    >
    onCreateSentinelGenesisParticipantResponse?: (
      requestPayload: string,
    ) => Promise<SentinelActionResult<string>>
    onRemoveProvider?: (id: string) => void | Promise<void>
    prefillEnrollmentCode?: string
    enrollmentFromUrlPending?: boolean
    deviceAuthorizationPending?: boolean
    usesExtensionDeviceIdentity?: boolean
    sentinelInvitationRequest?: string
    sentinelParticipantResponsePending?: boolean
    sentinelParticipantResponse?: string
    sentinelOnboardingPackage?: string
    extensionConnectPairingStatusEntries: LoginVaultExtensionPairingStatusEntry[]
    onAcceptSentinelOnboardingPackage?: (
      packageJson: string,
    ) => void | Promise<void>
  } = $props()

  type CreateVaultChooserOptionalProps = Partial<
    Pick<
      ComponentProps<typeof LoginCreateVaultChooser>,
      | 'onAcceptSentinelOnboardingPackage'
      | 'onFinishSentinelInvitation'
      | 'onUseEnrollmentCode'
    >
  >
  type CreateVaultChooserProps = ComponentProps<typeof LoginCreateVaultChooser>
  type LoginVaultPickerProps = ComponentProps<typeof LoginVaultPicker>
  type SentinelCeremonyOptionalProps = Partial<
    Pick<ComponentProps<typeof SentinelCeremonyPanel>, 'onUnlocked'>
  >
  type ProviderManagementOptionalProps = Partial<
    Pick<
      ComponentProps<typeof LoginProviderManagement>,
      'onBeginAddProvider' | 'onCancelAddProvider' | 'onRemoveProvider'
    >
  >
  const createVaultChooserOptionalProps = $derived.by(() => {
    const props: CreateVaultChooserOptionalProps = {}
    if (onUseEnrollmentCode) props.onUseEnrollmentCode = onUseEnrollmentCode
    if (onAcceptSentinelOnboardingPackage)
      props.onAcceptSentinelOnboardingPackage =
        onAcceptSentinelOnboardingPackage
    if (onSentinelUnlocked)
      props.onFinishSentinelInvitation = onSentinelUnlocked
    return props
  })
  const sentinelCeremonyOptionalProps = $derived.by(() => {
    const props: SentinelCeremonyOptionalProps = {}
    if (onSentinelUnlocked) props.onUnlocked = onSentinelUnlocked
    return props
  })
  const providerManagementOptionalProps = $derived.by(() => {
    const props: ProviderManagementOptionalProps = {}
    if (onBeginAddProvider) props.onBeginAddProvider = onBeginAddProvider
    if (onCancelAddProvider) props.onCancelAddProvider = onCancelAddProvider
    if (onRemoveProvider) props.onRemoveProvider = onRemoveProvider
    return props
  })

  /** Back from restore returns to the first screen even with saved rows. */
  let firstScreenRequested = $state(false)
  let newVaultOpen = $state(false)

  /** Close what is open beside the card (New vault, an import, provider
   * setup) when another panel opens there. */
  function closeSidePanels(): void {
    newVaultOpen = false
    if (vault.vaultImportOpen) {
      vault.cancelExistingVaultOpen()
      vault.vaultImportOpen = false
    }
    if (addProviderOpen) onCancelAddProvider?.()
    if (showSetup) onCancelSetup()
  }

  /** Select the vault a card row names, closing any open setup panel. */
  async function openVaultFromCard(storeId: string): Promise<void> {
    closeSidePanels()
    await vault.chooseLoginVault(storeId)
  }

  // An import started from the unlocked workspace locked the identity to
  // continue here.
  onMount(() => {
    if (vault.vaultImportOpen && !vault.loginRequiresExistingVault)
      vault.beginExistingVaultOpen()
  })

  /** The vault opened beside its card; its passphrase unlock shows even
   * when it has none, to say so. */
  let passphraseStoreId = $state('')

  /** Opening a locked vault's row selects that vault, which reads its
   * passphrases, without unlocking it. */
  async function chooseRemoteVault(storeId: string): Promise<void> {
    const chosen = vault.chooseRemoteVault(storeId)
    if (chosen.isErr()) {
      vault.errorMsg = vault.t(chosen.error.translationKey)
      return
    }
    await onUnlock()
  }

  async function selectVault(storeId: string): Promise<void> {
    passphraseStoreId = storeId
    if (selectedCardStoreId === storeId) return
    await openVaultFromCard(storeId)
  }

  /** "New vault" on the identity card: create one here or import one. */
  function openNewVault(): void {
    newVaultOpen = true
  }

  function importExistingVault(): void {
    newVaultOpen = false
    vault.beginExistingVaultOpen()
    vault.vaultImportOpen = true
  }

  /** "Add a device" on a locked card unlocks the identity, then opens the
   * add-device flow. */
  function addDevice(target: IdentityVaultTarget): void {
    if (!target.storeId) return
    const destination: UnlockDestination = {
      storeId: target.storeId,
      page: { kind: UnlockPageKind.Route, route: WorkspaceRoute.AddDevice },
    }
    void unlockTo(destination)
  }

  /** A page chosen from Manage on a locked card: unlock, then open it. */
  function manageSection(target: IdentitySectionTarget): void {
    if (!target.storeId) return
    const destination: UnlockDestination = {
      storeId: target.storeId,
      page: {
        kind: UnlockPageKind.Route,
        route: new WorkspaceSectionRoute(target.section).route,
      },
    }
    void unlockTo(destination)
  }

  let pinPrompt = $state<PinPrompt>({ kind: PinPromptKind.Closed })
  const pinProtected = $derived(
    vault.deviceProtectionStatus === DeviceProtectionStatus.Pin,
  )

  /** Unlock on a locked card unlocks the identity: this device's passkey
   * (or PIN) opens its key, and no vault is opened. A vault opens from its
   * row. */
  async function unlockIdentity(): Promise<void> {
    if (vault.deviceProtectionReady || isVerifying) return
    if (pinProtected) {
      pinPrompt = { kind: PinPromptKind.Identity }
      return
    }
    const identityOnly: Parameters<
      DeviceProtectionActions['unlockDeviceProtection']
    >[0] = { initializeSession: false }
    await new DeviceProtectionActions(vault).unlockDeviceProtection(
      identityOnly,
    )
    await loadUnlockedIdentityProviders()
  }

  /** "Use identity" left the identity locked (a PIN, or a dismissed
   * passkey prompt), so its providers are still unread. */
  let providersAwaitUnlock = false

  async function useIdentity(target: IdentityVaultTarget): Promise<void> {
    const outcome = await new IdentitySwitch(vault).to(target.identityId)
    providersAwaitUnlock = outcome === IdentitySwitchOutcome.Locked
  }

  /** Read the providers of an identity switched to while locked, now that
   * its key is unlocked. */
  async function loadUnlockedIdentityProviders(): Promise<void> {
    if (!providersAwaitUnlock || !vault.deviceProtectionReady) return
    providersAwaitUnlock = false
    await new IdentitySwitch(vault).loadProviders()
  }

  async function unlockWithPin(pin: string): Promise<void> {
    const prompt = pinPrompt
    const pinRequest: Parameters<
      DeviceProtectionActions['unlockPinDeviceProtection']
    >[0] = { pin, initializeSession: false }
    await new DeviceProtectionActions(vault).unlockPinDeviceProtection(
      pinRequest,
    )
    if (!vault.deviceProtectionReady) return
    pinPrompt = { kind: PinPromptKind.Closed }
    await loadUnlockedIdentityProviders()
    if (prompt.kind === PinPromptKind.Vault) {
      await openSelectedVault(prompt.destination)
    }
  }

  /** Lock on a card whose identity is unlocked without an open vault. */
  function lockIdentity(): void {
    void vault.lockDeviceProtection()
  }

  /** A vault row on a locked card unlocks that vault. Locking keeps the
   * page the URL names, so a management page resumes; otherwise the vault
   * opens. */
  function unlockVault(storeId: string): void {
    const current = new WorkspacePath(window.location.pathname).route
    const page: UnlockPage =
      current.kind === WorkspaceRouteLookupKind.Unknown
        ? { kind: UnlockPageKind.Stay }
        : {
            kind: UnlockPageKind.Route,
            route: vault.unlockReturn.routeFrom(current.route),
          }
    const destination: UnlockDestination = { storeId, page }
    void unlockTo(destination)
  }

  /** Unlock from a vault's panel: stay on the identities page, where the
   * panel then offers Open vault and the vault's own pages. */
  function unlockVaultInPlace(storeId: string): void {
    const current = new WorkspacePath(window.location.pathname).route
    if (current.kind === WorkspaceRouteLookupKind.Unknown)
      vault.unlockReturn.forget()
    else vault.unlockReturn.remember(current.route)
    const page: UnlockPage =
      current.kind === WorkspaceRouteLookupKind.Unknown
        ? { kind: UnlockPageKind.Stay }
        : { kind: UnlockPageKind.Route, route: WorkspaceRoute.Identities }
    const destination: UnlockDestination = { storeId, page }
    void unlockTo(destination)
  }

  /** Unlock a vault right away, as its Unlock button would, and open the
   * workspace on `route` once it is unlocked. */
  async function unlockTo(destination: UnlockDestination): Promise<void> {
    if (destination.page.kind === UnlockPageKind.Route) {
      const navigation = new WorkspaceLocation(
        destination.page.route,
      ).navigate()
      if (navigation.isErr()) {
        vault.errorMsg = vault.t(navigation.error.translationKey)
        return
      }
      const routeRequest: Parameters<
        VaultWorkspaceActions['applyWorkspaceRoute']
      >[0] = { route: destination.page.route }
      new VaultWorkspaceActions(vault).applyWorkspaceRoute(routeRequest)
    }
    // Choosing a vault reads it with the device key, so the identity is
    // unlocked first: passkey (or PIN), then the vault, then open it.
    if (destination.storeId !== selectedCardStoreId) {
      if (pinProtected && !vault.deviceProtectionReady) {
        pinPrompt = { kind: PinPromptKind.Vault, destination }
        return
      }
      await unlockIdentity()
      if (!vault.deviceProtectionReady) return
    }
    await openSelectedVault(destination)
  }

  /** With the identity unlocked, select the destination's vault and open it. */
  async function openSelectedVault(
    destination: UnlockDestination,
  ): Promise<void> {
    if (destination.storeId !== selectedCardStoreId) {
      await openVaultFromCard(destination.storeId)
      await tick()
    }
    if (vault.errorMsg || isVerifying) return
    await onUnlock()
  }

  function newIdentity(): void {
    vault.newIdentity = NewIdentityStage.Name
  }

  const hasProviders = $derived(providers.length > 0)
  /** Identity cards carry the vaults; the storage sheet then opens only
   * when asked for (New vault, Add provider). */
  let identityCardsShown = $state(false)
  const showSetup = $derived(loginSetup.kind === LoginSetupKind.Active)
  function setupIs(type: StorageProviderType): boolean {
    return (
      loginSetup.kind === LoginSetupKind.Active &&
      loginSetup.providerType === type
    )
  }
  const showVaultPicker = $derived(
    vault.showLoginVaultPicker && !vault.vaultImportOpen,
  )
  const sentinelPresentation = $derived(
    new SentinelLoginPresentationReader(vault),
  )
  $effect(() => sentinelPresentation.start())
  const showSentinelCeremony = $derived(
    sentinelPresentation.presentation.kind ===
      SentinelLoginPresentationKind.Ready &&
      sentinelPresentation.presentation.projection.ceremonyVisibility ===
        SentinelCeremonyVisibility.Visible,
  )
  const hasKnownLocalVault = $derived(
    vault.localVaultPresent || vault.localVaults.length > 0,
  )
  const showLocalUnlock = $derived(
    hasKnownLocalVault &&
      vault.sentinelGenesisPhase !== SentinelGenesisPhase.DeliveringShares &&
      !showSetup &&
      !addProviderOpen &&
      !vault.vaultImportOpen &&
      !showVaultPicker,
  )
  const activeLoginVault = $derived.by((): LoginVaultEntry => {
    const selectedStoreId =
      vault.selectedLoginVault.kind === LoginVaultSelectionKind.Selected
        ? vault.selectedLoginVault.storeId
        : vault.activeVault.kind === ActiveVaultKind.Open
          ? vault.activeVault.storeId
          : ''
    for (const entry of vault.localVaults) {
      if (entry.storeId === selectedStoreId) {
        return { kind: LoginVaultEntryKind.Available, entry }
      }
    }
    for (const entry of vault.localVaults) {
      return { kind: LoginVaultEntryKind.Available, entry }
    }
    return { kind: LoginVaultEntryKind.Unavailable }
  })
  const selectedCardStoreId = $derived(
    showLocalUnlock && activeLoginVault.kind === LoginVaultEntryKind.Available
      ? activeLoginVault.entry.storeId
      : '',
  )
  const pairingStatusLookup = $derived(
    new LoginVaultExtensionPairingStatusLookup(
      extensionConnectPairingStatusEntries,
    ),
  )
  const showQrOnboarding = $derived(
    Boolean(
      enrollmentFromUrlPending && prefillEnrollmentCode && onUseEnrollmentCode,
    ),
  )
  const showCreateVault = $derived(
    (vault.sentinelGenesisPhase === SentinelGenesisPhase.DeliveringShares ||
      (!vault.localVaultPresent &&
        vault.localVaults.length === 0 &&
        (!hasProviders || firstScreenRequested))) &&
      !showQrOnboarding &&
      !showSetup &&
      !addProviderOpen &&
      !vault.vaultImportOpen &&
      !showVaultPicker,
  )
  const showProviderSetup = $derived(
    (vault.vaultImportOpen ||
      addProviderOpen ||
      (hasProviders && !vault.localVaultPresent && !identityCardsShown)) &&
      !showSetup &&
      !showLocalUnlock &&
      !showCreateVault,
  )
  const showAccessSheet = $derived(
    (showSentinelCeremony && !showLocalUnlock && !showVaultPicker) ||
      showSetup ||
      showProviderSetup,
  )
  /** With identity cards on screen, storage setup and restore open beside
   * the current card instead of as a sheet of their own. */
  const accessBesideCard = $derived(
    identityCardsShown && showAccessSheet && (showSetup || showProviderSetup),
  )
  const isUnlocking = $derived(
    isVerifying && (showLocalUnlock || showSetup) && !showSetup,
  )
  const setupCanConnect = $derived(
    setupIs('local') ||
      (setupIs('local-folder') &&
        vault.localFolderDraft.kind === LocalFolderDraftKind.Configured &&
        new LocalFolderPresentation(
          vault.localFolderDraft.config,
        ).localFolderHandle().kind === LocalFolderHandleKind.Selected) ||
      (setupIs('oauth-file') &&
        vault.oauthFileDraft.kind === OAuthFileDraftKind.Configured &&
        oauth_access_token(vault.oauthFileDraft.config).kind === 'available') ||
      (setupIs('github') && Boolean(githubPat.trim())),
  )
  const recoveryPasswordEntries = $derived(
    vault.recoveryDiscovery.kind === RecoveryDiscoveryKind.Found
      ? vault.recoveryDiscovery.summary.passwordEntries
      : [],
  )
  /** Backup passwords of the selected vault, offered on its locked card. */
  const cardPasswordEntries = $derived(
    vault.passwordEntries.length > 0
      ? vault.passwordEntries
      : recoveryPasswordEntries,
  )
  const oauthPreset = $derived<OAuthFilePreset>(
    vault.oauthFileDraft.kind === OAuthFileDraftKind.Configured
      ? vault.oauthFileDraft.config.preset
      : vault.oauthSetupSelection.kind === OAuthSetupPresetKind.Selected
        ? vault.oauthSetupSelection.preset
        : 'google-drive',
  )

  function handleFirstConnectSubmit(e: Event) {
    e.preventDefault()
    void onUnlock()
  }

  $effect(() => {
    if (
      vault.sentinelGenesisPhase === SentinelGenesisPhase.DeliveringShares &&
      vault.syncProviders.length > 0 &&
      !showSetup &&
      !addProviderOpen
    ) {
      vault.vaultImportOpen = false
    }
    if (showLocalUnlock && !vault.isInitializing) {
      untrack(() => void vault.prepareLocalLogin())
    }
    if (
      vault.deviceProtectionReady &&
      !deviceAuthorizationPending &&
      !vault.isAuthenticated &&
      (vault.syncProviders.length > 0 || vault.localVaultPresent)
    ) {
      untrack(() => void vault.refreshSentinelUnlockStatus())
    }
  })
</script>

{#snippet vaultSetupPanel()}
  <LoginCreateVaultChooser
    {vault}
    {appKind}
    {isVerifying}
    {isInitializing}
    {usesExtensionDeviceIdentity}
    {onCreateDeviceVault}
    {onStartSentinelGenesis}
    onAddSentinelGenesisParticipantResponse={({
      payload,
      participantLabel,
    }: SentinelGenesisParticipation) => {
      const participantRequest: Parameters<
        sentinelGenesisActions.SentinelGenesisActions['addParticipantResponse']
      >[0] = {
        payload,
        participantLabel: participantLabel ? participantLabel : '',
      }
      return new sentinelGenesisActions.SentinelGenesisActions(
        vault,
      ).addParticipantResponse(participantRequest)
    }}
    onFinalizeSentinelGenesis={() =>
      new sentinelGenesisActions.SentinelGenesisActions(vault).finalize()}
    onCreateSentinelGenesisParticipantResponse={((
      ...[
        v = (payload) =>
          (() => {
            const createParticipantResponseArgs: Parameters<
              sentinelGenesisActions.SentinelGenesisActions['createParticipantResponse']
            >[0] = { requestPayload: payload }
            return new sentinelGenesisActions.SentinelGenesisActions(
              vault,
            ).createParticipantResponse(createParticipantResponseArgs)
          })(),
      ]
    ) => v)(onCreateSentinelGenesisParticipantResponse)}
    onCreateSentinelGenesisPublicKeyAnnouncement={((
      ...[
        v = () =>
          new sentinelGenesisActions.SentinelGenesisActions(
            vault,
          ).createPublicKeyAnnouncement(),
      ]
    ) => v)(onCreateSentinelGenesisPublicKeyAnnouncement)}
    onRememberSentinelGenesisRequest={(
      payload: Parameters<
        NonNullable<CreateVaultChooserProps['onRememberSentinelGenesisRequest']>
      >[0],
    ) =>
      (() => {
        const rememberRequestArgs: Parameters<
          sentinelGenesisActions.SentinelGenesisActions['rememberRequest']
        >[0] = { requestPayload: payload }
        return new sentinelGenesisActions.SentinelGenesisActions(
          vault,
        ).rememberRequest(rememberRequestArgs)
      })()}
    onReceiveSentinelGenesisShare={(
      payload: Parameters<
        NonNullable<CreateVaultChooserProps['onReceiveSentinelGenesisShare']>
      >[0],
    ) =>
      (() => {
        const acceptShareDeliveryArgs: Parameters<
          sentinelGenesisActions.SentinelGenesisActions['acceptShareDelivery']
        >[0] = { payload }
        return new sentinelGenesisActions.SentinelGenesisActions(
          vault,
        ).acceptShareDelivery(acceptShareDeliveryArgs)
      })()}
    onCompleteSentinelGenesisDelivery={() =>
      new sentinelGenesisActions.SentinelGenesisActions(
        vault,
      ).completeDelivery()}
    sentinelGenesisPhase={vault.sentinelGenesisPhase}
    sentinelGenesisRequest={vault.sentinelGenesisRequest}
    sentinelGenesisParticipants={vault.sentinelGenesisParticipants}
    sentinelGenesisDeliveries={vault.sentinelGenesisDeliveries}
    {sentinelInvitationRequest}
    {sentinelParticipantResponsePending}
    {sentinelParticipantResponse}
    {sentinelOnboardingPackage}
    {...createVaultChooserOptionalProps}
    onConnectStorage={() => {
      vault.beginExistingVaultOpen()
      vault.vaultImportOpen = true
      firstScreenRequested = false
    }}
  />
{/snippet}
{#snippet newVaultPanel()}
  <LoginNewVaultPanel
    {vault}
    {isVerifying}
    {isInitializing}
    onCreateVault={onCreateDeviceVault}
    onImportVault={importExistingVault}
    onClose={() => (newVaultOpen = false)}
  />
{/snippet}
{#snippet sentinelCeremony()}
  <SentinelCeremonyPanel {vault} {isVerifying} {isInitializing} />
{/snippet}
{#snippet cardPinUnlock()}
  <CardPinUnlock
    {vault}
    {isVerifying}
    onUnlock={unlockWithPin}
    onCancel={() => (pinPrompt = { kind: PinPromptKind.Closed })}
  />
{/snippet}
{#snippet cardPasswordUnlock()}
  <CardPasswordUnlock
    {vault}
    vaultLabel={activeLoginVault.kind === LoginVaultEntryKind.Available
      ? activeLoginVault.entry.display_label(
          vault.t(I18N_KEYS.LoginVaultPickerUnnamed),
        )
      : ''}
    entries={cardPasswordEntries}
    {isVerifying}
    onUnlock={onUnlockWithPassword}
  />
{/snippet}
{#snippet vaultPicker()}
  <LoginVaultPicker
    {vault}
    vaults={vault.localVaults}
    {extensionConnectPairingStatusEntries}
    {isVerifying}
    {isInitializing}
    onChooseVault={(
      storeId: Parameters<LoginVaultPickerProps['onChooseVault']>[0],
    ) => unlockVault(storeId)}
  />
{/snippet}

<!-- Storage setup and restore. With identity cards it sits beside the
     current card (framed by it); otherwise it is its own sheet. -->
{#snippet accessSheet(framed: boolean)}
  <section
    class="min-w-0 {framed ? 'nk-frame-sheet' : ''}"
    data-testid="login-access-sheet"
  >
    <header
      class="border-b border-border pb-4 {framed ? 'px-5 pt-5 sm:px-6' : ''}"
    >
      <div class="space-y-1">
        <h2 class="text-lg font-semibold tracking-tight text-foreground">
          {#if showSentinelCeremony && !showSetup && !showProviderSetup}
            {vault.t(I18N_KEYS.LoginUnlockVault)}
          {:else if showSetup}
            {(() => {
              const tArgs: Parameters<typeof vault.t>[0] = {
                key: I18N_KEYS.OnboardingConnectTo,
                replacements: {
                  provider: setupIs('github')
                    ? 'GitHub'
                    : setupIs('local-folder')
                      ? vault.t(I18N_KEYS.ProviderPickerLocalFolder)
                      : vault.t(I18N_KEYS.OnboardingLocalStorage),
                },
              }
              return vault.t(tArgs)
            })()}
          {:else if addProviderOpen}
            {vault.t(I18N_KEYS.OnboardingAddProvider)}
          {:else if vault.loginRequiresExistingVault}
            {vault.t(I18N_KEYS.FirstRunRestoreTitle)}
          {:else}
            {vault.t(I18N_KEYS.OnboardingSetupStorage)}
          {/if}
        </h2>
        {#if isUnlocking}
          <p class="text-sm text-pretty text-muted-foreground">
            {vault.t(I18N_KEYS.LoginUnlocking)}
          </p>
        {:else if showSetup && setupIs('github')}
          <p class="text-sm text-pretty text-muted-foreground">
            {vault.t(I18N_KEYS.OnboardingGithubDescription)}
          </p>
        {:else if showSetup}
          <p class="text-sm text-pretty text-muted-foreground">
            {vault.t(I18N_KEYS.OnboardingLocalDescription)}
          </p>
        {:else if addProviderOpen}
          <p class="text-sm text-pretty text-muted-foreground">
            {vault.t(I18N_KEYS.OnboardingAnotherProvider)}
          </p>
        {/if}
      </div>
    </header>

    <div class="pt-4 {framed ? 'px-5 pb-5 sm:px-6 sm:pb-6' : ''}">
      {#if showSentinelCeremony && !showSetup && !showProviderSetup}
        <SentinelCeremonyPanel
          {vault}
          {isVerifying}
          {isInitializing}
          {...sentinelCeremonyOptionalProps}
        />
      {:else if showSetup}
        {#if vault.remoteVaultChoices.length > 0}
          <RemoteVaultChoice
            {vault}
            busy={isVerifying}
            onChoose={chooseRemoteVault}
          />
        {:else if setupIs('oauth-file')}
          <OAuthProviderSetupWizard
            {vault}
            bind:githubRepo
            idPrefix="login"
            preset={oauthPreset}
            {isVerifying}
            {isInitializing}
            {onCancelSetup}
            onConnect={onUnlock}
          />
        {:else if setupIs('github')}
          <GitHubProviderSetupWizard
            {vault}
            bind:githubPat
            bind:githubRepo
            idPrefix="login"
            {isVerifying}
            {isInitializing}
            connectDisabled={vault.clientPolicy.remote_recovery_prompt_visible(
              vault.remoteVaultRecoveryState,
            )}
            {onCancelSetup}
            onConnect={onUnlock}
          >
            {#snippet beforeConnect()}
              {#if vault.clientPolicy.remote_recovery_prompt_visible(vault.remoteVaultRecoveryState)}
                <RemoteVaultRecoveryPanel
                  {vault}
                  state={vault.remoteVaultRecoveryState}
                  isBusy={isVerifying}
                  onRecover={() => vault.confirmRecoverRemoteVault()}
                  onCreateFresh={() => vault.confirmCreateFreshRemoteVault()}
                  onDismiss={() => {
                    const cleared = vault.clearRemoteVaultRecovery()
                    if (cleared.isErr())
                      vault.errorMsg = vault.t(cleared.error.translationKey)
                  }}
                />
              {/if}
            {/snippet}
          </GitHubProviderSetupWizard>
        {:else if setupIs('local-folder')}
          <LocalFolderProviderSetupWizard
            {vault}
            idPrefix="login"
            {isVerifying}
            {isInitializing}
            {onCancelSetup}
            onConnect={onUnlock}
          />
        {:else}
          <form
            novalidate
            onsubmit={handleFirstConnectSubmit}
            class="space-y-4"
          >
            <ProviderSetupFields {vault} {onCancelSetup} />
            <div class="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button
                type="submit"
                class="sm:min-w-[180px]"
                data-testid="connect-provider-btn"
                disabled={!setupCanConnect}
              >
                {#if isInitializing}
                  <RefreshCw class="size-4 animate-spin" />
                  {vault.t(I18N_KEYS.OnboardingLoadingEngine)}
                {:else if isVerifying}
                  <RefreshCw class="size-4 animate-spin" />
                  {vault.t(I18N_KEYS.CommonConnecting)}
                {:else}
                  <ShieldCheck class="size-4" />
                  {vault.t(I18N_KEYS.CommonConnect)}
                {/if}
              </Button>
            </div>
          </form>
        {/if}
      {:else if showProviderSetup}
        {#if (vault.vaultImportOpen || !vault.localVaultPresent) && !addProviderOpen}
          <button
            type="button"
            class="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            data-testid="login-back-to-get-started"
            onclick={() => {
              vault.cancelExistingVaultOpen()
              vault.vaultImportOpen = false
              firstScreenRequested = true
            }}
          >
            <ArrowLeft class="size-4" />
            {vault.t(I18N_KEYS.FirstRunBack)}
          </button>
        {/if}
        <LoginProviderManagement
          {vault}
          variant={LoginProviderManagementVariant.Setup}
          {providers}
          {isVerifying}
          {isInitializing}
          addingProvider={addProviderOpen}
          {...providerManagementOptionalProps}
          {onBeginSetup}
        />
      {/if}
    </div>
  </section>
{/snippet}

{#snippet accessSheetBeside()}
  {@render accessSheet(false)}
{/snippet}

<div
  class="w-full animate-in fade-in duration-300"
  data-testid="login-gate"
  data-local-vault={vault.localVaultPresent ? 'true' : 'false'}
>
  <IdentitiesHub
    {vault}
    selectedStoreId={selectedCardStoreId}
    showCards={!showQrOnboarding}
    busy={isVerifying || isInitializing}
    canAddVault={!showCreateVault && !showQrOnboarding}
    onOpenVault={unlockVault}
    onNewVault={openNewVault}
    onSelectVault={(storeId: string) => void selectVault(storeId)}
    onUnlockVault={unlockVaultInPlace}
    onManageVault={manageSection}
    onAddDevice={addDevice}
    onManageSection={manageSection}
    onUnlock={() => void unlockIdentity()}
    onLock={lockIdentity}
    onNewIdentity={newIdentity}
    onUseIdentity={(target: IdentityVaultTarget) => void useIdentity(target)}
    onCardsShown={(shown: boolean) => (identityCardsShown = shown)}
    onClosePanels={closeSidePanels}
    {...accessBesideCard ? { accessPanel: accessSheetBeside } : {}}
    pairingStatusFor={(storeId: string) =>
      pairingStatusLookup.statusForStore(storeId)}
    {...showLocalUnlock && !newVaultOpen && showSentinelCeremony
      ? { unlockPanel: sentinelCeremony }
      : {}}
    {...showLocalUnlock &&
    !newVaultOpen &&
    (cardPasswordEntries.length > 0 ||
      (passphraseStoreId && passphraseStoreId === selectedCardStoreId))
      ? { passwordFallback: cardPasswordUnlock }
      : {}}
    {...pinPrompt.kind !== PinPromptKind.Closed && !vault.deviceProtectionReady
      ? { identityPrompt: cardPinUnlock }
      : {}}
    {...showVaultPicker && !newVaultOpen ? { vaultPicker } : {}}
    {...(showCreateVault || sentinelInvitationRequest.trim()) &&
    !showQrOnboarding
      ? { vaultSetup: vaultSetupPanel }
      : newVaultOpen &&
          (showLocalUnlock || showVaultPicker || identityCardsShown)
        ? { vaultSetup: newVaultPanel }
        : {}}
    vaultSetupOpen={newVaultOpen ||
      Boolean(sentinelInvitationRequest.trim()) ||
      vault.sentinelGenesisPhase === SentinelGenesisPhase.DeliveringShares}
  >
    <div class="grid min-w-0 grid-cols-1 gap-3 [&:not(:has(*))]:hidden">
      {#if vault.sessionExpiredByIdle}
        <p
          class="nk-banner nk-banner-warning px-4 py-3 text-sm text-foreground"
          data-testid="login-session-expired"
          role="status"
        >
          {vault.t(I18N_KEYS.SessionExpiredIdle)}
        </p>
      {/if}

      {#if showQrOnboarding && onUseEnrollmentCode}
        <JoinThisDevice
          {vault}
          {isVerifying}
          code={prefillEnrollmentCode}
          {onUseEnrollmentCode}
        />
      {:else if !showCreateVault && !sentinelInvitationRequest.trim()}
        {#if showAccessSheet && !accessBesideCard}
          {@render accessSheet(true)}
        {/if}
      {/if}
    </div>
  </IdentitiesHub>
</div>
