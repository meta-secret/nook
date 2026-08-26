<script lang="ts">
  import type { ComponentProps } from 'svelte'
  import type { VaultState } from '$lib/vault.svelte'
  import { ColorMode } from '$lib/app/theme'
  import {
    ExtensionConnectIntentKind,
    LegalRouteKind,
    type ExtensionConnectIntent,
    type LegalRoute,
  } from '$lib/app/route-state'
  import type { ExtensionSetupOffer } from '$lib/app/extension-setup'
  import LegalDocumentPage from '$lib/components/LegalDocumentPage.svelte'
  import LogsPage from '$lib/components/LogsPage.svelte'
  import AppLogsApiPage from '$lib/components/AppLogsApiPage.svelte'
  import AppHelpWorkspace from '$lib/components/app/AppHelpWorkspace.svelte'
  import AppPersistentChrome from '$lib/components/app/AppPersistentChrome.svelte'
  import ExtensionConnectConsentWorkspace from '$lib/components/app/ExtensionConnectConsentWorkspace.svelte'
  import InvalidExtensionConnectWorkspace from '$lib/components/app/InvalidExtensionConnectWorkspace.svelte'
  import AppHeader from '$lib/components/app/AppHeader.svelte'
  import AuthenticatedVaultWorkspace from '$lib/components/app/AuthenticatedVaultWorkspace.svelte'
  import VaultAccessGate from '$lib/components/app/VaultAccessGate.svelte'

  type AccessGateProps = ComponentProps<typeof VaultAccessGate>
  type AuthenticatedWorkspaceProps = ComponentProps<
    typeof AuthenticatedVaultWorkspace
  >

  let {
    vault,
    appLogsPage,
    colorMode,
    shellWidth,
    shellSpacing,
    legalPageState,
    logsPage,
    extensionConnectRoute,
    extensionSetupState,
    appVersion,
    extensionConnectRequestState,
    preserveAccessGate,
    accessGateProps,
    authenticatedWorkspaceProps,
    onNavigateHome,
    onToggleColorMode,
    onExtensionConnect,
    onFinishExtensionConnect,
  }: {
    vault: VaultState
    appLogsPage: boolean
    colorMode: ColorMode
    shellWidth: string
    shellSpacing: string
    legalPageState: LegalRoute
    logsPage: boolean
    extensionConnectRoute: boolean
    extensionSetupState: ExtensionSetupOffer
    appVersion: string
    extensionConnectRequestState: ExtensionConnectIntent
    preserveAccessGate: boolean
    accessGateProps: AccessGateProps
    authenticatedWorkspaceProps: AuthenticatedWorkspaceProps
    onNavigateHome: () => void
    onToggleColorMode: () => void
    onExtensionConnect: () => Promise<void>
    onFinishExtensionConnect: (approved?: boolean) => void
  } = $props()
</script>

{#if appLogsPage}
  <AppLogsApiPage />
{:else}
  <main
    class="min-h-svh min-w-0 max-w-full overflow-x-clip bg-background text-foreground"
    class:dark={colorMode === ColorMode.Dark}
  >
    <AppHeader
      {vault}
      {colorMode}
      {shellWidth}
      legalPageOpen={legalPageState.kind === LegalRouteKind.Legal}
      {logsPage}
      {extensionConnectRoute}
      {extensionSetupState}
      {onNavigateHome}
      {onToggleColorMode}
      onPairExtension={() => void onExtensionConnect()}
    />

    <div
      class="mx-auto px-4 sm:px-6 {shellWidth} {shellSpacing}"
      data-testid="app-shell-content"
    >
      {#if logsPage}
        <LogsPage onClose={onNavigateHome} />
      {:else if legalPageState.kind === LegalRouteKind.Legal}
        <LegalDocumentPage
          {vault}
          pageId={legalPageState.page}
          onClose={onNavigateHome}
        />
      {:else if vault.helpOpen}
        <AppHelpWorkspace {vault} {colorMode} {appVersion} />
      {:else if extensionConnectRoute && extensionConnectRequestState.kind === ExtensionConnectIntentKind.Absent}
        <InvalidExtensionConnectWorkspace {vault} onClose={onNavigateHome} />
      {:else if !vault.isAuthenticated || preserveAccessGate}
        <VaultAccessGate {...accessGateProps} />
      {:else if extensionConnectRequestState.kind === ExtensionConnectIntentKind.Requested}
        <ExtensionConnectConsentWorkspace
          {vault}
          request={extensionConnectRequestState.request}
          {appVersion}
          onClose={onFinishExtensionConnect}
        />
      {:else if vault.isAuthenticated}
        <AuthenticatedVaultWorkspace {...authenticatedWorkspaceProps} />
      {/if}
    </div>

    <AppPersistentChrome
      {vault}
      showFooter={legalPageState.kind === LegalRouteKind.Application &&
        !logsPage &&
        !extensionConnectRoute}
    />
  </main>
{/if}
