<script lang="ts">
  import { Check, Copy } from '@lucide/svelte'
  import type { NookSecretListItem } from '$lib/nook'
  import type { VaultState } from '$lib/vault.svelte'
  import {
    AuthenticatorCodePresentationKind,
    SecretRevealKind,
    type AuthenticatorCodePresentation,
    type SecretReveal,
  } from './secret-vault-state'

  let {
    item,
    reveal,
    authenticatorCode,
    isCopied,
    onCopyToClipboard,
    onCopySecret,
    vault,
  }: {
    item: NookSecretListItem
    reveal: SecretReveal
    authenticatorCode: AuthenticatorCodePresentation
    isCopied: (fieldKey: string) => boolean
    onCopyToClipboard: (
      text: string,
      id: string,
      field: string,
    ) => Promise<void>
    onCopySecret: (id: string) => Promise<void>
    vault: VaultState
  } = $props()
</script>

<div class="grid grid-cols-[85px_1fr] items-center gap-2 text-xs">
  <span class="text-muted-foreground/70 font-medium"
    >{vault.t('vault.fields.current_code')}</span
  >
  <div
    class="flex items-center justify-between gap-2 min-w-0 rounded-md border border-primary/25 bg-primary/5 px-2.5 py-2"
  >
    <div class="min-w-0">
      <code
        class="font-mono text-xl font-semibold tracking-[0.2em] text-foreground"
        data-testid="authenticator-current-code"
        data-period={authenticatorCode.kind ===
        AuthenticatorCodePresentationKind.Visible
          ? authenticatorCode.code.period
          : 0}
        >{authenticatorCode.kind === AuthenticatorCodePresentationKind.Visible
          ? authenticatorCode.code.code
          : '••••••'}</code
      >
      {#if authenticatorCode.kind === AuthenticatorCodePresentationKind.Visible}
        <p class="mt-0.5 text-[10px] text-muted-foreground">
          {vault.t('vault.fields.code_expires_in', {
            count: String(authenticatorCode.code.secondsRemaining),
          })}
        </p>
      {/if}
    </div>
    {#if authenticatorCode.kind === AuthenticatorCodePresentationKind.Visible}
      <button
        type="button"
        onclick={() =>
          void onCopyToClipboard(
            authenticatorCode.code.code,
            item.id,
            'current-code',
          )}
        aria-label={vault.t('vault.copy_current_code')}
        class="shrink-0 rounded-sm p-1 text-muted-foreground transition-colors hover:text-foreground"
      >
        {#if isCopied(`${item.id}-current-code`)}<Check
            class="size-3.5 text-emerald-500"
          />{:else}<Copy class="size-3.5" />{/if}
      </button>
    {/if}
  </div>
</div>

<div class="grid grid-cols-[85px_1fr] items-center gap-2 text-xs">
  <span class="text-muted-foreground/70 font-medium"
    >{vault.t('vault.fields.account')}</span
  >
  <div class="min-w-0 rounded-md border border-border/20 bg-muted/20 px-2 py-1">
    <span class="truncate text-foreground"
      >{item.account || vault.t('common.none')}</span
    >
  </div>
</div>

<div
  class="grid grid-cols-[85px_1fr] items-center gap-2 text-xs"
  data-testid="authenticator-website"
>
  <span class="text-muted-foreground/70 font-medium"
    >{vault.t('vault.fields.website_label')}</span
  >
  <div
    class="flex items-center justify-between gap-2 min-w-0 bg-muted/20 hover:bg-muted/40 rounded-md px-2 py-1 transition-colors border border-border/20"
  >
    <span class="truncate text-foreground"
      >{item.websiteUrl || vault.t('vault.fields.no_website')}</span
    >
    {#if item.websiteUrl}
      <button
        type="button"
        onclick={() =>
          void onCopyToClipboard(item.websiteUrl, item.id, 'website')}
        aria-label={vault.t('vault.copy_website_url')}
        class="text-muted-foreground hover:text-foreground p-0.5 rounded-sm transition-colors"
      >
        {#if isCopied(`${item.id}-website`)}<Check
            class="size-3 text-emerald-500"
          />{:else}<Copy class="size-3" />{/if}
      </button>
    {/if}
  </div>
</div>

<div class="grid grid-cols-[85px_1fr] items-center gap-2 text-xs">
  <span class="text-muted-foreground/70 font-medium"
    >{vault.t('vault.fields.authenticator_secret')}</span
  >
  <div
    class="flex min-w-0 items-center justify-between gap-2 rounded-md border border-border/20 bg-muted/20 px-2 py-1"
  >
    <code
      class="break-all font-mono text-foreground"
      data-testid="revealed-secret"
      >{reveal.kind === SecretRevealKind.Revealed
        ? reveal.record.totpSecret
        : '••••••••••••••••'}</code
    >
    <button
      type="button"
      onclick={() => void onCopySecret(item.id)}
      aria-label={vault.t('vault.copy_authenticator_secret')}
      class="shrink-0 rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-foreground"
    >
      {#if isCopied(`${item.id}-secret`)}<Check
          class="size-3 text-emerald-500"
        />{:else}<Copy class="size-3" />{/if}
    </button>
  </div>
</div>

{#if item.backupCodeCount > 0}
  <div class="grid grid-cols-[85px_1fr] items-start gap-2 text-xs">
    <span class="pt-1 text-muted-foreground/70 font-medium"
      >{vault.t('vault.fields.backup_codes')}</span
    >
    <div
      class="space-y-1 rounded-md border border-border/20 bg-muted/20 px-2 py-1.5"
      data-testid="authenticator-backup-codes"
    >
      {#if reveal.kind === SecretRevealKind.Revealed}
        {#if reveal.record.backupCodes.length > 0}
          {#each reveal.record.backupCodes as backupCode, backupIndex (`${backupCode}-${backupIndex}`)}
            <div class="flex items-center justify-between gap-2">
              <code class="break-all font-mono text-foreground"
                >{backupCode}</code
              >
              <button
                type="button"
                onclick={() =>
                  void onCopyToClipboard(
                    backupCode,
                    item.id,
                    `backup-${backupIndex}`,
                  )}
                aria-label={vault.t('vault.copy_backup_code')}
                class="shrink-0 rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-foreground"
              >
                {#if isCopied(`${item.id}-backup-${backupIndex}`)}<Check
                    class="size-3 text-emerald-500"
                  />{:else}<Copy class="size-3" />{/if}
              </button>
            </div>
          {/each}
        {:else}
          <span class="text-muted-foreground">{vault.t('common.none')}</span>
        {/if}
      {:else}
        <span class="font-mono text-foreground">••••••••</span>
      {/if}
    </div>
  </div>
{/if}
