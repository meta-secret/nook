<!--
The vaults a provider already holds, as its listing tells without
decryption: a short id, how this device can open the vault, when its files
were created and last written, how many events it holds, and the identity
whose folder files it. A vault this browser keeps a name for is listed by it;
any other vault's name is sealed under its key, so it shows its short id.
Times a transport does not report are left out.
-->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import { FolderKey } from '@lucide/svelte'
  import type {
    ProviderVaultAccess,
    ProviderVaultSummary,
    ProviderVaultTime,
  } from '$app-wasm'
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
    switch (summary.name.state) {
      case 'named':
        return summary.name.name
      case 'unknown':
        break
    }
    const request: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.FirstRunRestoreVaultItem,
      replacements: { id: summary.shortId },
    }
    return vault.t(request)
  }

  /** The identity whose folder files the vault: its label when this browser
   * holds it, else its short id. */
  function identityLine(summary: ProviderVaultSummary): string {
    let identity = summary.identity.shortId
    switch (summary.identity.name.state) {
      case 'named':
        identity = summary.identity.name.name
        break
      case 'unknown':
        break
    }
    const request: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.ProviderVaultsFiledUnder,
      replacements: { identity },
    }
    return vault.t(request)
  }

  /** The access label and the line that says what it means. */
  function accessLines(access: ProviderVaultAccess): readonly [string, string] {
    switch (access.state) {
      case 'syncs':
        return [
          vault.t(I18N_KEYS.ProviderVaultsAccessSyncs),
          vault.t(I18N_KEYS.ProviderVaultsHintSyncs),
        ]
      case 'otherIdentityHere': {
        const label: Parameters<typeof vault.t>[0] = {
          key: I18N_KEYS.ProviderVaultsAccessOtherIdentity,
          replacements: { identity: access.identityLabel },
        }
        const hint: Parameters<typeof vault.t>[0] = {
          key: I18N_KEYS.ProviderVaultsHintOtherIdentity,
          replacements: { identity: access.identityLabel },
        }
        return [vault.t(label), vault.t(hint)]
      }
      case 'granted':
        return [
          vault.t(I18N_KEYS.ProviderVaultsAccessGranted),
          vault.t(I18N_KEYS.ProviderVaultsHintGranted),
        ]
      case 'backupPassword':
        return [
          vault.t(I18N_KEYS.ProviderVaultsAccessBackupPassword),
          vault.t(I18N_KEYS.ProviderVaultsHintBackupPassword),
        ]
      case 'unchecked':
        return [
          vault.t(I18N_KEYS.ProviderVaultsAccessUnchecked),
          vault.t(I18N_KEYS.ProviderVaultsHintUnchecked),
        ]
      case 'requested':
        return [
          vault.t(I18N_KEYS.ProviderVaultsAccessRequested),
          vault.t(I18N_KEYS.ProviderVaultsHintRequested),
        ]
      case 'locked':
        return [
          vault.t(I18N_KEYS.ProviderVaultsAccessLocked),
          vault.t(I18N_KEYS.ProviderVaultsHintLocked),
        ]
    }
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
    {@const access = accessLines(summary.access)}
    <li
      class="nk-row"
      data-testid="provider-vault-row"
      data-store-id={summary.storeId}
      data-access={summary.access.state}
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
            class={summary.access.state === 'locked'
              ? 'nk-tag nk-tag-warning'
              : summary.access.state === 'syncs' ||
                  summary.access.state === 'granted'
                ? 'nk-tag nk-tag-success'
                : 'nk-tag'}
            data-testid="provider-vault-access"
          >
            {access[0]}
          </span>
        </p>
        <p
          class="mt-1 text-xs text-pretty text-muted-foreground"
          data-testid="provider-vault-access-hint"
        >
          {access[1]}
        </p>
        <p class="nk-spec mt-1" data-testid="provider-vault-meta">
          <span
            data-testid="provider-vault-identity"
            title={summary.identity.identityId}>{identityLine(summary)}</span
          >
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
