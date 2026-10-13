<script lang="ts">
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { NookSelectedVaultIdentityContextKind } from '$app-wasm'
  import { Fingerprint, RefreshCw } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import type { VaultState } from '$lib/vault.svelte'
  import {
    LoginVaultIdentityContextKind,
    type LoginVaultIdentityContext,
  } from './login-vault-identity-context'

  let {
    vault,
    context,
    deviceKeysCapable,
    onReviewIdentities,
  }: {
    vault: VaultState
    context: LoginVaultIdentityContext
    deviceKeysCapable: boolean
    onReviewIdentities: () => void | Promise<void>
  } = $props()

  const showReviewAction = $derived(
    context.kind === LoginVaultIdentityContextKind.Failed ||
      context.kind === NookSelectedVaultIdentityContextKind.Empty ||
      context.kind ===
        NookSelectedVaultIdentityContextKind.LinkedWithoutCurrent ||
      (context.kind ===
        NookSelectedVaultIdentityContextKind.LinkedWithCurrent &&
        !deviceKeysCapable),
  )
  const currentIdentityGuidance = $derived.by(() => {
    if (
      context.kind !== NookSelectedVaultIdentityContextKind.LinkedWithCurrent
    ) {
      return ''
    }
    const translationArgs: Parameters<typeof vault.t>[0] = {
      key: deviceKeysCapable
        ? I18N_KEYS.LoginIdentityContextCurrentUsesKeys
        : I18N_KEYS.LoginIdentityContextCurrentKeysUnavailable,
      replacements: { identity: context.currentIdentity.label },
    }
    return vault.t(translationArgs)
  })
</script>

<section class="grid gap-2" data-testid="login-vault-identity-context">
  <h3 class="nk-label inline-flex items-center gap-1.5">
    <Fingerprint class="size-3.5 shrink-0" aria-hidden="true" />
    {vault.t(I18N_KEYS.LoginIdentityContextTitle)}
  </h3>

  {#if context.kind === LoginVaultIdentityContextKind.Loading}
    <p
      class="flex items-center gap-2 text-sm text-muted-foreground"
      data-testid="login-vault-identity-loading"
      role="status"
    >
      <RefreshCw class="size-3.5 animate-spin" />
      {vault.t(I18N_KEYS.LoginIdentityContextLoading)}
    </p>
  {:else if context.kind === LoginVaultIdentityContextKind.Failed}
    <p
      class="text-sm text-pretty text-muted-foreground"
      data-testid="login-vault-identity-failed"
    >
      {vault.t(I18N_KEYS.LoginIdentityContextFailed)}
    </p>
  {:else if context.kind === NookSelectedVaultIdentityContextKind.Empty}
    <p
      class="text-sm text-pretty text-muted-foreground"
      data-testid="login-vault-identity-empty"
    >
      {vault.t(I18N_KEYS.LoginIdentityContextEmpty)}
    </p>
  {:else}
    <ul class="nk-list" data-testid="login-vault-linked-identities">
      {#each context.identities as identity (identity.identityId)}
        <li
          class="flex min-h-10 items-center justify-between gap-3 px-3.5 py-2 text-sm [&+&]:border-t [&+&]:border-border"
          data-testid="login-vault-linked-identity"
        >
          <span class="min-w-0 truncate font-medium text-foreground">
            {identity.label}
          </span>
          <span
            class="nk-tag shrink-0 {context.kind ===
              NookSelectedVaultIdentityContextKind.LinkedWithCurrent &&
            identity.identityId === context.currentIdentity.identityId
              ? 'nk-tag-success'
              : ''}"
          >
            {context.kind ===
              NookSelectedVaultIdentityContextKind.LinkedWithCurrent &&
            identity.identityId === context.currentIdentity.identityId
              ? vault.t(I18N_KEYS.LoginIdentityContextCurrent)
              : vault.t(I18N_KEYS.LoginIdentityContextLinked)}
          </span>
        </li>
      {/each}
    </ul>

    <p
      class="text-sm text-pretty text-muted-foreground"
      data-testid="login-vault-identity-guidance"
    >
      {#if context.kind === NookSelectedVaultIdentityContextKind.LinkedWithCurrent}
        {currentIdentityGuidance}
      {:else}
        {vault.t(I18N_KEYS.LoginIdentityContextMismatch)}
      {/if}
    </p>
  {/if}

  {#if showReviewAction}
    <Button
      type="button"
      variant="ghost"
      class="min-h-9 justify-self-start px-0 text-sm text-foreground underline underline-offset-4 hover:bg-transparent hover:text-foreground/80"
      data-testid="login-review-identities"
      onclick={onReviewIdentities}
    >
      {vault.t(I18N_KEYS.LoginIdentityContextReview)}
    </Button>
  {/if}

  <p class="text-xs text-pretty text-muted-foreground">
    {vault.t(I18N_KEYS.LoginIdentityContextBackupDirect)}
  </p>
</section>
