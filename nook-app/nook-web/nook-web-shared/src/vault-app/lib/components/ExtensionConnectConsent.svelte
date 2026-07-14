<script lang="ts">
  import { Check, KeyRound, ShieldCheck } from '@lucide/svelte'
  import type { ExtensionPairingApprovedMessage } from '$web-shared/extension/runtime-messages'
  import {
    loadAuthProviders,
    sealAuthProvidersForDevicePublicKey,
    type StorageProvider,
  } from '$lib/auth-providers'
  import { Button } from '$lib/components/ui/button'
  import type { ExtensionConnectRequest } from '$lib/extension-connect'
  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
    request,
    onClose,
  }: {
    vault: VaultState
    request: ExtensionConnectRequest
    onClose: () => void
  } = $props()

  let isApproving = $state(false)
  let approved = $state(false)
  let error = $state('')
  let handoffError = $state('')

  const canApprove = $derived(
    vault.isAuthenticated && !isApproving && !vault.isSaving && !approved,
  )

  function truncate(value: string, head = 14, tail = 10) {
    if (value.length <= head + tail + 3) return value
    return `${value.slice(0, head)}...${value.slice(-tail)}`
  }

  function activeVaultName(): string {
    const active = vault.localVaults.find(
      (entry) => entry.storeId === vault.activeVaultStoreId,
    )
    return (
      active?.displayLabel(vault.t('login.vault_picker_unnamed')) ??
      vault.t('login.vault_picker_unnamed')
    )
  }

  function sendGrantToExtension(
    providers: StorageProvider[],
    vaultStoreId: string,
    vaultName: string,
  ): Promise<void> {
    const runtime = (
      globalThis as typeof globalThis & {
        chrome?: {
          runtime?: {
            sendMessage?: (
              extensionId: string,
              message: unknown,
              callback: (response?: unknown) => void,
            ) => void
            lastError?: { message?: string }
          }
        }
      }
    ).chrome?.runtime

    if (!runtime?.sendMessage) {
      return Promise.reject(
        new Error(vault.t('extension.consent.messaging_unavailable')),
      )
    }

    const message: ExtensionPairingApprovedMessage = {
      type: 'nook:extension-pairing-approved',
      payload: {
        vaultType: 'simple',
        deviceId: request.deviceId,
        deviceLabel: request.deviceLabel,
        vaultStoreId,
        vaultName,
        approvedAt: new Date().toISOString(),
        scopes: request.scopes,
        providers,
      },
    }

    return new Promise((resolve, reject) => {
      runtime.sendMessage?.(request.extensionRuntimeId, message, (response) => {
        const runtimeError = runtime.lastError?.message
        if (runtimeError) {
          reject(new Error(runtimeError))
          return
        }
        if (
          typeof response === 'object' &&
          response !== null &&
          'ok' in response &&
          (response as { ok?: unknown }).ok === true
        ) {
          resolve()
          return
        }
        reject(new Error(vault.t('extension.consent.grant_rejected')))
      })
    })
  }

  async function approveExtension() {
    if (!vault.manager || !canApprove) return

    isApproving = true
    vault.isSaving = true
    error = ''
    handoffError = ''
    vault.errorMsg = ''
    try {
      await vault.enqueueStorage(() =>
        vault.manager!.approveExtensionDevice(
          request.deviceId,
          request.devicePublicKey,
          request.deviceSigningPublicKey,
          request.deviceLabel,
        ),
      )
      const authProviders = await vault.enqueueStorage(() =>
        loadAuthProviders(vault.manager!),
      )
      const vaultStoreId =
        vault.activeVaultStoreId ??
        (await vault.enqueueStorage(() => vault.manager!.vaultStoreId))
      const grantedProviders = authProviders.providers.filter(
        (provider) => !provider.storeId || provider.storeId === vaultStoreId,
      )
      const sealedGrant = sealAuthProvidersForDevicePublicKey(
        request.devicePublicKey,
        {
          providers: grantedProviders,
          activeVaultStoreId: vaultStoreId,
        },
      )
      try {
        await sendGrantToExtension(
          sealedGrant.providers,
          vaultStoreId,
          activeVaultName(),
        )
      } catch (caught) {
        handoffError =
          caught instanceof Error
            ? vault.t('extension.consent.handoff_failed_detail', {
                error: caught.message,
              })
            : vault.t('extension.consent.handoff_failed')
      }
      await vault.refreshDeviceState()
      vault.showSuccess(
        handoffError
          ? vault.t('extension.consent.approved_reopen')
          : vault.t('extension.consent.approved'),
      )
      approved = true
    } catch (caught) {
      error =
        caught instanceof Error
          ? vault.resolveErrorMessage(caught.message)
          : vault.t('extension.consent.approval_failed')
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
        {vault.t('extension.consent.title')}
      </h2>
      <p class="text-sm leading-relaxed text-muted-foreground">
        {vault.t('extension.consent.description')}
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
        {vault.t('extension.consent.device')}
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
        {vault.t('extension.consent.encryption_key')}
      </p>
      <p
        class="mt-1 truncate font-mono text-[11px] text-muted-foreground"
        title={request.devicePublicKey}
      >
        {truncate(request.devicePublicKey)}
      </p>
    </div>
    <div class="rounded-md border border-border/40 bg-muted/20 px-3 py-2">
      <p class="flex items-center gap-2 text-xs font-medium text-foreground">
        <KeyRound class="size-3.5 text-muted-foreground" />
        {vault.t('extension.consent.signing_key')}
      </p>
      <p
        class="mt-1 truncate font-mono text-[11px] text-muted-foreground"
        title={request.deviceSigningPublicKey}
      >
        {truncate(request.deviceSigningPublicKey)}
      </p>
    </div>
  </div>

  <div class="mt-4 space-y-2">
    <p class="text-sm font-medium text-foreground">
      {vault.t('extension.consent.requested_access')}
    </p>
    <ul class="grid gap-2" data-testid="extension-connect-scopes">
      {#each request.scopes as scope (scope)}
        <li
          class="flex items-center gap-2 rounded-md border border-border/40 bg-background/70 px-3 py-2 text-sm text-foreground"
        >
          <Check class="size-3.5 text-primary" />
          {vault.t(`extension.consent.scope_${scope.replaceAll('-', '_')}`)}
        </li>
      {/each}
    </ul>
  </div>

  {#if !vault.isAuthenticated}
    <p
      class="mt-4 rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300"
      data-testid="extension-connect-locked"
    >
      {vault.t('extension.consent.unlock_first')}
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

  {#if approved}
    <p
      class="mt-4 rounded-md border border-primary/25 bg-primary/10 px-3 py-2 text-sm text-primary"
      data-testid="extension-connect-approved"
    >
      {vault.t('extension.consent.approved_return')}
    </p>
  {/if}

  <div class="mt-4 flex flex-wrap justify-end gap-2">
    <Button type="button" variant="outline" onclick={onClose}>
      {approved
        ? vault.t('common.done')
        : vault.t('common.cancel')}
    </Button>
    <Button
      type="button"
      disabled={!canApprove}
      data-testid="approve-extension-device-btn"
      onclick={() => void approveExtension()}
    >
      {isApproving
        ? vault.t('extension.consent.approving')
        : vault.t('extension.consent.approve')}
    </Button>
  </div>
</section>
