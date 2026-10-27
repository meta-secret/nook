<!--
The vaults a provider already holds, as its listing tells without
decryption: a short id, how the vault relates to this identity, when its
files were created and last written, and how many events it holds. Vault
names appear only after unlock. Times a transport does not report are left
out.
-->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import { FolderKey } from '@lucide/svelte'
  import type { ProviderVaultSummary, ProviderVaultTime } from '$app-wasm'
  import { I18N_KEYS, type I18nKey } from '../../../../generated/i18n-keys'
  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
    vaults,
    action,
  }: {
    vault: VaultState
    vaults: readonly ProviderVaultSummary[]
    /** What the user can do with one listed vault. */
    action?: Snippet<[ProviderVaultSummary]>
  } = $props()

  /** One reported time and the line that names it. */
  interface TimeLineRequest {
    readonly key: I18nKey
    readonly time: ProviderVaultTime
  }

  const dateFormat = $derived.by(() => {
    const options: ConstructorParameters<typeof Intl.DateTimeFormat>[1] = {
      dateStyle: 'medium',
      timeStyle: 'short',
    }
    return new Intl.DateTimeFormat(vault.locale, options)
  })

  function timeLine({ key, time }: TimeLineRequest): string {
    if (time.state === 'unreported') return ''
    const request: Parameters<typeof vault.t>[0] = {
      key,
      replacements: { date: dateFormat.format(new Date(time.at)) },
    }
    return vault.t(request)
  }

  function nameLine(summary: ProviderVaultSummary): string {
    const request: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.FirstRunRestoreVaultItem,
      replacements: { id: summary.shortId },
    }
    return vault.t(request)
  }

  function eventLine(summary: ProviderVaultSummary): string {
    const request: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.ProviderVaultsEvents,
      replacements: { count: String(summary.eventCount) },
    }
    return vault.t(request)
  }
</script>

<ul class="nk-list" data-testid="provider-vault-list">
  {#each vaults as summary (summary.storeId)}
    {@const createdRequest: TimeLineRequest = {
      key: I18N_KEYS.ProviderVaultsCreated,
      time: summary.created,
    }}
    {@const activeRequest: TimeLineRequest = {
      key: I18N_KEYS.ProviderVaultsLastActivity,
      time: summary.lastActivity,
    }}
    {@const created = timeLine(createdRequest)}
    {@const active = timeLine(activeRequest)}
    <li
      class="nk-row"
      data-testid="provider-vault-row"
      data-store-id={summary.storeId}
      data-relation={summary.relation}
    >
      <span class="nk-tile nk-tile-sm" aria-hidden="true">
        <FolderKey class="size-4" />
      </span>
      <div class="min-w-0">
        <p class="nk-row-title">
          <span class="font-mono text-sm" title={summary.storeId}
            >{nameLine(summary)}</span
          >
          <span
            class={summary.relation === 'thisIdentity'
              ? 'nk-tag nk-tag-success'
              : 'nk-tag'}
            data-testid="provider-vault-relation"
          >
            {vault.t(
              summary.relation === 'thisIdentity'
                ? I18N_KEYS.ProviderVaultsThisIdentity
                : I18N_KEYS.ProviderVaultsOtherIdentity,
            )}
          </span>
        </p>
        <p class="nk-spec mt-1" data-testid="provider-vault-meta">
          {#if created}<span>{created}</span>{/if}
          {#if active}<span>{active}</span>{/if}
          <span>{eventLine(summary)}</span>
        </p>
      </div>
      {#if action}
        <div class="nk-row-actions">{@render action(summary)}</div>
      {/if}
    </li>
  {/each}
</ul>
