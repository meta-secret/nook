<script lang="ts">
  import { Check, KeyRound, ShieldCheck } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import {
    scopeLabel,
    type ExtensionConnectRequest,
  } from '$lib/extension-connect'
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

  const canApprove = $derived(
    vault.isAuthenticated && !isApproving && !vault.isSaving && !approved,
  )

  function truncate(value: string, head = 14, tail = 10) {
    if (value.length <= head + tail + 3) return value
    return `${value.slice(0, head)}...${value.slice(-tail)}`
  }

  async function approveExtension() {
    if (!vault.manager || !canApprove) return

    isApproving = true
    vault.isSaving = true
    error = ''
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
      await vault.refreshDeviceState()
      vault.showSuccess('Extension device approved.')
      approved = true
    } catch (caught) {
      error =
        caught instanceof Error
          ? vault.resolveErrorMessage(caught.message)
          : 'Failed to approve extension device.'
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
        Approve Nook extension
      </h2>
      <p class="text-sm leading-relaxed text-muted-foreground">
        This adds a separate passkey-protected extension device to the unlocked
        vault. The extension remains a permissioned filling companion; nokey.sh
        stays the full settings and recovery surface.
      </p>
    </div>
  </div>

  <div
    class="mt-4 grid gap-3 rounded-lg border border-border/50 bg-background/60 p-3"
  >
    <div>
      <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Extension device
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
        Encryption public key
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
        Signing public key
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
    <p class="text-sm font-medium text-foreground">Requested access</p>
    <ul class="grid gap-2" data-testid="extension-connect-scopes">
      {#each request.scopes as scope}
        <li
          class="flex items-center gap-2 rounded-md border border-border/40 bg-background/70 px-3 py-2 text-sm text-foreground"
        >
          <Check class="size-3.5 text-primary" />
          {scopeLabel(scope)}
        </li>
      {/each}
    </ul>
  </div>

  {#if !vault.isAuthenticated}
    <p
      class="mt-4 rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300"
      data-testid="extension-connect-locked"
    >
      Unlock nokey.sh first, then approve this extension device.
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

  {#if approved}
    <p
      class="mt-4 rounded-md border border-primary/25 bg-primary/10 px-3 py-2 text-sm text-primary"
      data-testid="extension-connect-approved"
    >
      Extension approved. You can return to the browser extension.
    </p>
  {/if}

  <div class="mt-4 flex flex-wrap justify-end gap-2">
    <Button type="button" variant="outline" onclick={onClose}>
      {approved ? 'Done' : 'Cancel'}
    </Button>
    <Button
      type="button"
      disabled={!canApprove}
      data-testid="approve-extension-device-btn"
      onclick={() => void approveExtension()}
    >
      {isApproving ? 'Approving...' : 'Approve extension'}
    </Button>
  </div>
</section>
