<script lang="ts">
  import {
    I18N_KEYS,
    type I18nKey,
  } from '../../../generated/i18n-keys'
  import { Check, KeyRound, ShieldCheck } from '@lucide/svelte'
  import {
    ExtensionPairingApprovedMessageType,
    ExtensionPairingVaultType,
    type ExtensionEventLogRecord,
    type ExtensionPairingApprovedMessage,
  } from '$web-shared/extension/runtime-messages'
  import {
    activeVaultScope,
    providerBelongsToVault,
    sealAuthProvidersForDevicePublicKey,
    type StorageProvider,
  } from '$lib/auth/providers'
  import { Button } from '$lib/components/ui/button'
  import {
    deliverExtensionPairingApproval,
    ExtensionConnectScope,
    ExtensionPairingDeliveryKind,
    type ExtensionConnectRequest,
  } from '$lib/extension/connect'
  import type { VaultState } from '$lib/vault.svelte'
  import { approveExtensionDevice } from '$app-wasm'
  import { ActiveVaultKind } from '$lib/vault/state/provider.svelte'

  let {
    vault,
    request,
    onClose,
  }: {
    vault: VaultState
    request: ExtensionConnectRequest
    onClose: (approved: boolean) => void
  } = $props()

  let isApproving = $state(false)
  let approved = $state(false)
  let error = $state('')
  let handoffError = $state('')

  const scopeTranslationKeys: Record<ExtensionConnectScope, I18nKey> = {
    [ExtensionConnectScope.VaultAccess]:
      I18N_KEYS.ExtensionConsentScopeVaultAccess,
    [ExtensionConnectScope.PasswordFilling]:
      I18N_KEYS.ExtensionConsentScopePasswordFilling,
    [ExtensionConnectScope.PasskeyManagement]:
      I18N_KEYS.ExtensionConsentScopePasskeyManagement,
    [ExtensionConnectScope.SyncProviderCredentials]:
      I18N_KEYS.ExtensionConsentScopeSyncProviderCredentials,
  }

  const canApprove = $derived(
    vault.isAuthenticated &&
      !vault.isVerifying &&
      !isApproving &&
      !vault.isSaving &&
      !approved,
  )

  function truncate({ value, head, tail }: { readonly value: string; readonly head: number; readonly tail: number }) {
    if (value.length <= head + tail + 3) return value
    return `${value.slice(0, head)}...${value.slice(-tail)}`
  }

  function activeVaultName(): string {
    if (vault.activeVault.kind === ActiveVaultKind.Open) {
      for (const entry of vault.localVaults) {
        if (entry.storeId === vault.activeVault.storeId) {
          return entry.displayLabel(vault.t(I18N_KEYS.LoginVaultPickerUnnamed))
        }
      }
    }
    return vault.t(I18N_KEYS.LoginVaultPickerUnnamed)
  }

  function sendGrantToExtension(
    { providers, vaultStoreId, vaultName, eventLogRecords }: { readonly providers: StorageProvider[]; readonly vaultStoreId: string; readonly vaultName: string; readonly eventLogRecords: ExtensionEventLogRecord[] },
  ): Promise<void> {
    const message: ExtensionPairingApprovedMessage = {
      type: ExtensionPairingApprovedMessageType.NookExtensionPairingApproved,
      payload: {
        vaultType: ExtensionPairingVaultType.Simple,
        deviceId: request.deviceId,
        devicePublicKey: request.devicePublicKey,
        deviceSigningPublicKey: request.deviceSigningPublicKey,
        deviceLabel: request.deviceLabel,
        vaultStoreId,
        vaultName,
        approvedAt: new Date().toISOString(),
        scopes: request.scopes,
        providers,
      },
      eventLogRecords,
    }
    return (async () => {
      const deliveryArgs: Parameters<
        typeof deliverExtensionPairingApproval
      >[0] = { request, message }
      const delivery = await deliverExtensionPairingApproval(deliveryArgs)
      if (delivery.kind === ExtensionPairingDeliveryKind.Delivered) return
      if (
        delivery.kind === ExtensionPairingDeliveryKind.MessagingUnavailable
      ) {
        throw new Error(
          vault.t(I18N_KEYS.ExtensionConsentMessagingUnavailable),
        )
      }
      const detail =
        delivery.kind ===
        ExtensionPairingDeliveryKind.PlaintextProviderMigrationRequired
          ? ` (${vault.t(I18N_KEYS.ExtensionConsentPlaintextProviderMigrationRequired)})`
          : ''
      throw new Error(
        `${vault.t(I18N_KEYS.ExtensionConsentGrantRejected)}${detail}`,
      )
    })()
  }

  async function approveExtension() {
    if (!vault.hasManager || !canApprove) return

    isApproving = true
    vault.isSaving = true
    error = ''
    handoffError = ''
    vault.errorMsg = ''
    try {
      await vault.enqueueStorage(() =>
        approveExtensionDevice(
          vault.requireManager(),
          request.deviceId,
          request.devicePublicKey,
          request.deviceSigningPublicKey,
          request.deviceLabel,
        ),
      )
      const vaultStoreId =
        vault.activeVault.kind === ActiveVaultKind.Open
          ? vault.activeVault.storeId
          : await vault.enqueueStorage(
              () => vault.requireManager().vaultStoreId,
            )
      let grantedProviders: StorageProvider[] = []
      if (
        request.scopes.includes(ExtensionConnectScope.SyncProviderCredentials)
      ) {
        const authProviders = await vault.enqueueStorage(() =>
          vault.requireManager().loadAuthProviders(),
        )
        const matchingProviders = authProviders.providers.filter(
          (provider) => (() => { const providerBelongsToVaultArgs: Parameters<typeof providerBelongsToVault>[0] = { provider, storeId: vaultStoreId }; return providerBelongsToVault(providerBelongsToVaultArgs); })(),
        )
        const sealAuthProvidersForDevicePublicKeyArgs: Parameters<typeof sealAuthProvidersForDevicePublicKey>[1] = {
            providers: matchingProviders,
            activeVaultStoreId: activeVaultScope(vaultStoreId),
          };
        grantedProviders = sealAuthProvidersForDevicePublicKey(
          request.devicePublicKey,
          sealAuthProvidersForDevicePublicKeyArgs,
        ).providers
      }
      const eventLogRecordValues = await vault.enqueueStorage(() =>
        vault.requireManager().exportEventLogRecords(),
      )
      try {
        const sendGrantToExtensionArgs: Parameters<typeof sendGrantToExtension>[0] = { providers: grantedProviders, vaultStoreId, vaultName: activeVaultName(), eventLogRecords: eventLogRecordValues.toArray() as ExtensionEventLogRecord[] };
        await sendGrantToExtension(
          sendGrantToExtensionArgs,
        )
      } catch (caught) {
        handoffError =
          caught instanceof Error
            ? (() => { const tArgs: Parameters<typeof vault.t>[0] = { key: I18N_KEYS.ExtensionConsentHandoffFailedDetail, replacements: {
                error: caught.message,
              } }; return vault.t(tArgs); })()
            : vault.t(I18N_KEYS.ExtensionConsentHandoffFailed)
      } finally {
        eventLogRecordValues.free()
      }
      await vault.refreshDeviceState()
      vault.showSuccess(
        handoffError
          ? vault.t(I18N_KEYS.ExtensionConsentApprovedReopen)
          : vault.t(I18N_KEYS.ExtensionConsentApproved),
      )
      approved = true
    } catch (caught) {
      error =
        caught instanceof Error
          ? vault.resolveErrorMessage(caught.message)
          : vault.t(I18N_KEYS.ExtensionConsentApprovalFailed)
      vault.errorMsg = error
    } finally {
      vault.isSaving = false
      isApproving = false
    }
  }
</script>

<section
  class="rounded-xl border border-border/60 bg-card p-4 shadow-sm sm:p-5"
  data-testid="extension-connect-consent"
>
  <div class="flex items-start gap-3">
    <div
      class="flex size-10 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary"
    >
      <ShieldCheck class="size-5" />
    </div>
    <div class="min-w-0 space-y-1">
      <h2 class="text-lg font-semibold text-foreground">
        {vault.t(I18N_KEYS.ExtensionConsentTitle)}
      </h2>
      <p class="text-sm leading-relaxed text-muted-foreground">
        {vault.t(I18N_KEYS.ExtensionConsentDescription)}
      </p>
    </div>
  </div>

  <div
    class="mt-4 grid gap-3 rounded-lg border border-border/50 bg-background/60 p-3"
  >
    <div>
      <p
        class="text-xs font-medium uppercase tracking-wide text-muted-foreground"
      >
        {vault.t(I18N_KEYS.ExtensionConsentDevice)}
      </p>
      <p class="mt-1 text-sm font-semibold text-foreground">
        {request.deviceLabel}
      </p>
      <p class="mt-1 break-all font-mono text-[11px] text-muted-foreground">
        {request.deviceId}
      </p>
    </div>
    <div class="rounded-md border border-border/40 bg-muted/20 px-3 py-2">
      <p class="flex items-center gap-2 text-xs font-medium text-foreground">
        <KeyRound class="size-3.5 text-muted-foreground" />
        {vault.t(I18N_KEYS.ExtensionConsentEncryptionKey)}
      </p>
      <p
        class="mt-1 truncate font-mono text-[11px] text-muted-foreground"
        title={request.devicePublicKey}
      >
        {(() => { const truncateArgs: Parameters<typeof truncate>[0] = { value: request.devicePublicKey, head: 14, tail: 10 }; return truncate(truncateArgs); })()}
      </p>
    </div>
    <div class="rounded-md border border-border/40 bg-muted/20 px-3 py-2">
      <p class="flex items-center gap-2 text-xs font-medium text-foreground">
        <KeyRound class="size-3.5 text-muted-foreground" />
        {vault.t(I18N_KEYS.ExtensionConsentSigningKey)}
      </p>
      <p
        class="mt-1 truncate font-mono text-[11px] text-muted-foreground"
        title={request.deviceSigningPublicKey}
      >
        {(() => { const truncateArgs2: Parameters<typeof truncate>[0] = { value: request.deviceSigningPublicKey, head: 14, tail: 10 }; return truncate(truncateArgs2); })()}
      </p>
    </div>
  </div>

  <div class="mt-4 space-y-2">
    <p class="text-sm font-medium text-foreground">
      {vault.t(I18N_KEYS.ExtensionConsentRequestedAccess)}
    </p>
    <ul class="grid gap-2" data-testid="extension-connect-scopes">
      {#each request.scopes as scope (scope)}
        <li
          class="flex items-center gap-2 rounded-md border border-border/40 bg-background/70 px-3 py-2 text-sm text-foreground"
        >
          <Check class="size-3.5 text-primary" />
          {vault.t(scopeTranslationKeys[scope])}
        </li>
      {/each}
    </ul>
  </div>

  {#if !vault.isAuthenticated}
    <p
      class="mt-4 rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300"
      data-testid="extension-connect-locked"
    >
      {vault.t(I18N_KEYS.ExtensionConsentUnlockFirst)}
    </p>
  {/if}

  {#if error}
    <p
      class="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
      role="alert"
    >
      {error}
    </p>
  {/if}

  {#if handoffError}
    <p
      class="mt-4 rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300"
      role="alert"
    >
      {handoffError}
    </p>
  {/if}

  {#if approved && !handoffError}
    <p
      class="mt-4 rounded-md border border-primary/25 bg-primary/10 px-3 py-2 text-sm text-primary"
      data-testid="extension-connect-approved"
    >
      {vault.t(I18N_KEYS.ExtensionConsentApprovedReturn)}
    </p>
  {/if}

  <div class="mt-4 flex flex-wrap justify-end gap-2">
    <Button type="button" variant="outline" onclick={() => onClose(approved)}>
      {approved ? vault.t(I18N_KEYS.CommonDone) : vault.t(I18N_KEYS.CommonCancel)}
    </Button>
    <Button
      type="button"
      disabled={!canApprove}
      data-testid="approve-extension-device-btn"
      onclick={() => void approveExtension()}
    >
      {isApproving
        ? vault.t(I18N_KEYS.ExtensionConsentApproving)
        : vault.t(I18N_KEYS.ExtensionConsentApprove)}
    </Button>
  </div>
</section>
