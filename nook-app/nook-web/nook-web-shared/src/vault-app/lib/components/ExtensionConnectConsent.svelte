<script lang="ts">
  type IdentityTextTruncation = {
    readonly value: string
    readonly head: number
    readonly tail: number
  }

  import { I18N_KEYS, type I18nKey } from '../../../generated/i18n-keys'
  import { Check, KeyRound, ShieldCheck } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import {
    ExtensionConnectScope,
    ExtensionPairingDeliveryKind,
    type ExtensionConnectRequest,
  } from '$lib/extension/connect'
  import type { VaultState } from '$lib/vault.svelte'
  import { ExtensionVaultApproval } from '$lib/extension/vault-approval'

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
  let handoffRejectionReason = $state('')

  function scopeTranslationKey(scope: ExtensionConnectScope): I18nKey {
    switch (scope) {
      case ExtensionConnectScope.VaultAccess:
        return I18N_KEYS.ExtensionConsentScopeVaultAccess
      case ExtensionConnectScope.PasswordFilling:
        return I18N_KEYS.ExtensionConsentScopePasswordFilling
      case ExtensionConnectScope.PasskeyManagement:
        return I18N_KEYS.ExtensionConsentScopePasskeyManagement
      case ExtensionConnectScope.SyncProviderCredentials:
        return I18N_KEYS.ExtensionConsentScopeSyncProviderCredentials
    }
  }

  const canApprove = $derived(
    vault.isAuthenticated &&
      !vault.isVerifying &&
      !isApproving &&
      !vault.isSaving &&
      !approved,
  )

  function truncate({ value, head, tail }: IdentityTextTruncation) {
    if (value.length <= head + tail + 3) return value
    return `${value.slice(0, head)}...${value.slice(-tail)}`
  }

  async function approveExtension() {
    if (!vault.hasManager || !canApprove) return

    isApproving = true
    vault.isSaving = true
    error = ''
    handoffError = ''
    handoffRejectionReason = ''
    vault.errorMsg = ''
    try {
      const approval = new ExtensionVaultApproval(vault, request)
      const prepared = await approval.prepare()
      if (prepared.isErr()) {
        error = vault.t(prepared.error.translationKey)
        vault.errorMsg = error
        return
      }
      let delivery: Awaited<ReturnType<typeof approval.deliver>>
      try {
        delivery = await approval.deliver(prepared.value)
      } catch {
        handoffError = vault.t(I18N_KEYS.ExtensionConnectIdentityHandoffFailed)
        return
      }
      if (delivery.isErr()) {
        handoffError = vault.t(delivery.error.translationKey)
        return
      }
      switch (delivery.value.kind) {
        case ExtensionPairingDeliveryKind.Delivered:
          break
        case ExtensionPairingDeliveryKind.MessagingUnavailable:
          handoffError = vault.t(I18N_KEYS.ExtensionConsentMessagingUnavailable)
          break
        case ExtensionPairingDeliveryKind.PlaintextProviderMigrationRequired:
          handoffError = vault.t(
            I18N_KEYS.ExtensionConsentPlaintextProviderMigrationRequired,
          )
          break
        case ExtensionPairingDeliveryKind.Rejected:
          handoffRejectionReason =
            'reason' in delivery.value && delivery.value.reason
              ? delivery.value.reason
              : ''
          handoffError = vault.t(I18N_KEYS.ExtensionConsentGrantRejected)
          break
      }
      const devices = await vault.refreshDeviceState()
      if (devices.isErr()) {
        error = vault.t(devices.error.translationKey)
        vault.errorMsg = error
        return
      }
      const completion = approval.admitCompletion()
      if (completion.isErr()) {
        handoffError = vault.t(completion.error.translationKey)
        return
      }
      vault.showSuccess(
        vault.t(
          handoffError
            ? I18N_KEYS.ExtensionConsentApprovedReopen
            : I18N_KEYS.ExtensionConsentApproved,
        ),
      )
      approved = true
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
        {(() => {
          const truncateArgs: Parameters<typeof truncate>[0] = {
            value: request.devicePublicKey,
            head: 14,
            tail: 10,
          }
          return truncate(truncateArgs)
        })()}
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
        {(() => {
          const truncateArgs2: Parameters<typeof truncate>[0] = {
            value: request.deviceSigningPublicKey,
            head: 14,
            tail: 10,
          }
          return truncate(truncateArgs2)
        })()}
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
          {vault.t(scopeTranslationKey(scope))}
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
      data-extension-pairing-rejection-reason={handoffRejectionReason}
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
      {approved
        ? vault.t(I18N_KEYS.CommonDone)
        : vault.t(I18N_KEYS.CommonCancel)}
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
