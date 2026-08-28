<script lang="ts">
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
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
      context.kind === LoginVaultIdentityContextKind.Empty ||
      context.kind === LoginVaultIdentityContextKind.LinkedWithoutCurrent ||
      (context.kind === LoginVaultIdentityContextKind.LinkedWithCurrent &&
        !deviceKeysCapable),
  )
  const currentIdentityGuidance = $derived.by(() => {
    if (context.kind !== LoginVaultIdentityContextKind.LinkedWithCurrent) {
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

<section
  class="space-y-2 border-y border-border/50 py-3"
  data-testid="login-vault-identity-context"
>
  <div class="flex items-center gap-2">
    <Fingerprint class="size-4 shrink-0 text-primary" />
    <h3 class="text-sm font-semibold text-foreground">
      {vault.t(I18N_KEYS.LoginIdentityContextTitle)}
    </h3>
  </div>

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
  {:else if context.kind === LoginVaultIdentityContextKind.Empty}
    <p
      class="text-sm text-pretty text-muted-foreground"
      data-testid="login-vault-identity-empty"
    >
      {vault.t(I18N_KEYS.LoginIdentityContextEmpty)}
    </p>
  {:else}
    <ul class="space-y-1.5" data-testid="login-vault-linked-identities">
      {#each context.identities as identity (identity.identityId)}
        <li
          class="flex min-h-9 items-center justify-between gap-3 rounded-md bg-muted/25 px-3 py-2 text-sm"
          data-testid="login-vault-linked-identity"
        >
          <span class="min-w-0 truncate font-medium text-foreground">
            {identity.label}
          </span>
          <span
            class="shrink-0 text-xs {context.kind ===
              LoginVaultIdentityContextKind.LinkedWithCurrent &&
            identity.identityId === context.currentIdentity.identityId
              ? 'font-medium text-primary'
              : 'text-muted-foreground'}"
          >
            {context.kind === LoginVaultIdentityContextKind.LinkedWithCurrent &&
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
      {#if context.kind === LoginVaultIdentityContextKind.LinkedWithCurrent}
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
      class="min-h-9 px-0 text-sm text-primary hover:bg-transparent hover:text-primary/80"
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
