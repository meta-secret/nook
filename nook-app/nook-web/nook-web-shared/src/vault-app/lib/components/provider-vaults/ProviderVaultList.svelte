<!--
The vaults a provider already holds, grouped by the identity that files
them. Passkeys belong to identities, so the identity is the unit: its card
says once whether it opens here (this browser is one of its devices, another
identity here was granted it, or a passkey checked on this page belongs to
it) and carries what the user can do with it. Its vaults are listed as quiet
one-line rows: a name once a check decrypted it, else the short id, and when
it was last written. Only what opens a single vault (a backup password, a
granted key, a merge) sits on a vault row.
-->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import { FolderKey, UserRound } from '@lucide/svelte'
  import type {
    CredentialCheckReport,
    FilingIdentity,
    ProviderIdentityLog,
    ProviderVaultSummary,
    ProviderVaultTime,
  } from '$app-wasm'
  import { I18N_KEYS, type I18nKey } from '../../../../generated/i18n-keys'
  import type { VaultState } from '$lib/vault.svelte'
  import {
    groupByIdentity,
    IdentityStandingKind,
    IdentityStandings,
    type IdentityStanding,
    type ProviderIdentityGroup,
  } from '$lib/components/provider-vaults/provider-identity-groups'

  let {
    vault,
    vaults,
    action,
    identityActions,
    checks = [],
  }: {
    vault: VaultState
    vaults: readonly ProviderVaultSummary[]
    /** Checks run on this page; what one opened shows its name. */
    checks?: readonly CredentialCheckReport[]
    /** What opens one vault on its own, under that vault's row. */
    action?: Snippet<[ProviderVaultSummary]>
    /** What the user can do with the identity, at the foot of its card. */
    identityActions?: Snippet<[ProviderIdentityGroup, IdentityStanding]>
  } = $props()

  const groups = $derived(groupByIdentity(vaults))
  const standings = $derived(new IdentityStandings(checks))

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
    const opened = standings.vaultName(summary.storeId)
    if (opened) return opened
    const request: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.FirstRunRestoreVaultItem,
      replacements: { id: summary.shortId },
    }
    return vault.t(request)
  }

  /** The identity: its name when this browser holds it or a passkey opened
   * it, else its three words. */
  function identityLine(identity: FilingIdentity): string {
    let label = identity.words.join('-')
    switch (identity.name.state) {
      case 'named':
        label = identity.name.name
        break
      case 'unknown': {
        const opened = standings.name(identity)
        if (opened) label = opened
        break
      }
    }
    const request: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.ProviderVaultsFiledUnder,
      replacements: { identity: label },
    }
    return vault.t(request)
  }

  function standingLine(standing: IdentityStanding): string {
    switch (standing.kind) {
      case IdentityStandingKind.ThisBrowser:
        return vault.t(I18N_KEYS.AccessCheckIdentityThisBrowser)
      case IdentityStandingKind.OtherIdentityHere: {
        const request: Parameters<typeof vault.t>[0] = {
          key: I18N_KEYS.AccessCheckIdentityOtherHere,
          replacements: { identity: standing.identityLabel },
        }
        return vault.t(request)
      }
      case IdentityStandingKind.OpenedByPasskey: {
        const request: Parameters<typeof vault.t>[0] = {
          key: I18N_KEYS.AccessCheckIdentityOpenedBy,
          replacements: { id: standing.passkey },
        }
        return vault.t(request)
      }
      case IdentityStandingKind.Requested:
        return vault.t(I18N_KEYS.AccessCheckIdentityRequested)
      case IdentityStandingKind.NotOpened:
        return vault.t(I18N_KEYS.AccessCheckIdentityNotOpened)
      case IdentityStandingKind.Unchecked:
        return vault.t(I18N_KEYS.AccessCheckIdentityUnchecked)
    }
  }

  function standingTag(standing: IdentityStanding): string {
    switch (standing.kind) {
      case IdentityStandingKind.ThisBrowser:
      case IdentityStandingKind.OtherIdentityHere:
      case IdentityStandingKind.OpenedByPasskey:
        return 'nk-tag nk-tag-success'
      case IdentityStandingKind.NotOpened:
        return 'nk-tag nk-tag-warning'
      case IdentityStandingKind.Requested:
      case IdentityStandingKind.Unchecked:
        return 'nk-tag'
    }
  }

  /** What the identity's public control log tells, where it was read. */
  function identityLogLines(log: ProviderIdentityLog): readonly string[] {
    switch (log.state) {
      case 'absent':
        return []
      case 'read': {
        const devices: Parameters<typeof vault.t>[0] = {
          key: I18N_KEYS.ProviderVaultsDevices,
          replacements: { count: String(log.devices) },
        }
        const newest: TimeLineRequest = {
          key: I18N_KEYS.ProviderVaultsNewestDevice,
          time: log.newestDevice,
        }
        const vaults: Parameters<typeof vault.t>[0] = {
          key: I18N_KEYS.ProviderVaultsIdentityVaults,
          replacements: { count: String(log.vaults) },
        }
        return [vault.t(devices), vault.t(vaults), timeLine(newest)].filter(
          (line) => line.length > 0,
        )
      }
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

<div class="space-y-3" data-testid="provider-vault-list">
  {#each groups as group (group.identity.identityId)}
    {@const standing = standings.of(group)}
    <section
      class="nk-frame"
      data-testid="provider-identity"
      data-identity-id={group.identity.identityId}
      data-standing={standing.kind}
    >
      <header class="flex items-start gap-3 px-4 pt-3 pb-2">
        <span class="nk-tile nk-tile-sm" aria-hidden="true">
          <UserRound class="size-4" />
        </span>
        <div class="min-w-0 flex-1 space-y-1">
          <div
            class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"
          >
            <p
              class="min-w-0 truncate text-sm font-semibold text-foreground"
              data-testid="provider-vault-identity"
              title={group.identity.identityId}
            >
              {identityLine(group.identity)}
            </p>
            <span
              class={standingTag(standing)}
              data-testid="provider-identity-standing"
            >
              {standingLine(standing)}
            </span>
          </div>
          <p class="nk-spec" data-testid="provider-identity-facts">
            {#each identityLogLines(group.identity.log) as line (line)}
              <span data-testid="provider-vault-identity-log">{line}</span>
            {/each}
          </p>
        </div>
      </header>
      <ul class="border-t border-border/60">
        {#each group.vaults as summary (summary.storeId)}
          {@const activeRequest: TimeLineRequest = {
            key: I18N_KEYS.ProviderVaultsLastActivity,
            time: summary.lastActivity,
          }}
          {@const createdRequest: TimeLineRequest = {
            key: I18N_KEYS.ProviderVaultsCreated,
            time: summary.created,
          }}
          {@const active = timeLine(activeRequest)}
          <li
            class="border-b border-border/40 px-4 py-2 last:border-b-0"
            data-testid="provider-vault-row"
            data-store-id={summary.storeId}
            data-access={summary.access.state}
            title={timeLine(createdRequest)}
          >
            <div class="flex flex-wrap items-center gap-x-3 gap-y-0.5">
              <FolderKey
                class="size-3.5 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <span
                class="min-w-0 flex-1 truncate font-mono text-sm text-foreground"
                title={summary.storeId}>{nameLine(summary)}</span
              >
              {#if standings.opensWithBackupPassword(summary.storeId)}
                <span
                  class="nk-tag nk-tag-success"
                  data-testid="provider-vault-verification"
                >
                  {vault.t(I18N_KEYS.AccessCheckVaultVerifiedPassword)}
                </span>
              {/if}
              <span class="nk-spec" data-testid="provider-vault-meta">
                <span>{eventLine(summary)}</span>
                {#if active}<span>{active}</span>{/if}
              </span>
            </div>
            {#if action}
              <div class="mt-1.5 pl-6.5 empty:hidden">
                {@render action(summary)}
              </div>
            {/if}
          </li>
        {/each}
      </ul>
      {#if identityActions}
        <footer
          class="space-y-2 border-t border-border/60 px-4 py-3 empty:hidden"
          data-testid="provider-identity-actions"
        >
          {@render identityActions(group, standing)}
        </footer>
      {/if}
    </section>
  {/each}
</div>
