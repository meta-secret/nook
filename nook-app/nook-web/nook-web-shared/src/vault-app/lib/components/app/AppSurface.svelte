<script lang="ts">
  import type { ComponentProps } from 'svelte'
  import type { VaultState } from '$lib/vault.svelte'
  import type { ExtensionConsentCloseOutcome } from '$lib/components/extension-connect-consent-outcome'
  import { ColorMode } from '$lib/app/theme'
  import {
    ExtensionConnectIntentKind,
    LegalRouteKind,
    type ExtensionConnectIntent,
    type LegalRoute,
  } from '$lib/app/route-state'
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
  import NewIdentityFlow from '$lib/components/identities/NewIdentityFlow.svelte'
  import { NewIdentityStage } from '$lib/vault/state/ui.svelte'
  import { extensionConnectProgress } from '$lib/extension/connect-progress'
  import { ExtensionIdentityRequestSource } from '$web-shared/extension/extension-connect-types'
  import {
    ExtensionConnectPageReportKind,
    ExtensionConnectPageSteps,
    type ExtensionConnectPageView,
  } from '$lib/components/extension-connect-progress-steps'

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
    appVersion,
    extensionConnectRequestState,
    preserveAccessGate,
    accessGateProps,
    authenticatedWorkspaceProps,
    onNavigateHome,
    onToggleColorMode,
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
    appVersion: string
    extensionConnectRequestState: ExtensionConnectIntent
    preserveAccessGate: boolean
    accessGateProps: AccessGateProps
    authenticatedWorkspaceProps: AuthenticatedWorkspaceProps
    onNavigateHome: () => void
    onToggleColorMode: () => void
    onFinishExtensionConnect: (outcome: ExtensionConsentCloseOutcome) => void
  } = $props()

  /** The connect route of a valid request opens the port to the extension
   * once; leaving the route closes it. */
  $effect(() => {
    switch (extensionConnectRequestState.kind) {
      case ExtensionConnectIntentKind.Requested: {
        switch (extensionConnectRoute) {
          case false:
            return
          case true:
            break
        }
        const { request } = extensionConnectRequestState
        // The connect route's request names the side panel that follows it.
        switch (request.source) {
          case ExtensionIdentityRequestSource.PairedVault:
            return
          case ExtensionIdentityRequestSource.ExtensionConnect:
            break
        }
        const progressBegin: Parameters<
          typeof extensionConnectProgress.begin
        >[0] = {
          extensionRuntimeId: request.extensionRuntimeId,
          follow: request.follow,
        }
        extensionConnectProgress.begin(progressBegin)
        return
      }
      case ExtensionConnectIntentKind.Absent:
        extensionConnectProgress.end()
    }
  })

  /** Before a vault is open, the access gate's step: unlock the identity
   * to connect, or create or join (the consent reports its own). */
  $effect(() => {
    const view: ExtensionConnectPageView = {
      connectRoute: extensionConnectRoute,
      intent: extensionConnectRequestState.kind,
      preserveAccessGate,
      localVaultCount: vault.localVaults.length,
      vault,
    }
    const report = ExtensionConnectPageSteps.page(view)
    switch (report.kind) {
      case ExtensionConnectPageReportKind.Silent:
        return
      case ExtensionConnectPageReportKind.Report:
        extensionConnectProgress.report(report.step)
    }
  })
</script>

{#if appLogsPage}
  <AppLogsApiPage />
{:else}
  <main
    class="nk-stage min-h-svh min-w-0 max-w-full overflow-x-clip bg-background text-foreground"
    class:dark={colorMode === ColorMode.Dark}
  >
    <AppHeader
      {vault}
      {colorMode}
      {shellWidth}
      legalPageOpen={legalPageState.kind === LegalRouteKind.Legal}
      {logsPage}
      {extensionConnectRoute}
      workspaceAvailable={!preserveAccessGate}
      {onNavigateHome}
      {onToggleColorMode}
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
      {:else if vault.newIdentity !== NewIdentityStage.Off}
        <NewIdentityFlow {vault} />
      {:else if !vault.isAuthenticated || preserveAccessGate}
        <VaultAccessGate
          {...accessGateProps}
          extensionConnectRequest={extensionConnectRequestState}
        />
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
