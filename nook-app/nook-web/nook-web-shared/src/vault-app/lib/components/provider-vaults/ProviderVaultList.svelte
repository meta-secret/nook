<!--
The vaults a provider already holds, grouped by the identity that files
them. Passkeys belong to identities, so each identity says whether it opens
here: this browser's own key is one of its devices, or a passkey checked on
this page belongs to it. An identity that does not open yet offers its
actions (find the passkey that opens it, or ask to join). Its card shows the
identity by three words derived from its id, or its name once opened, and
what its public control log tells without a key. Each vault under it shows
how this device can open it, when its files were created and last written,
and how many events it holds; its name shows once a check decrypted it.
-->
<script lang="ts">
  import type { Snippet } from "svelte";
  import { FolderKey, UserRound } from "@lucide/svelte";
  import type {
    CredentialCheckReport,
    FilingIdentity,
    ProviderIdentityLog,
    ProviderVaultAccess,
    ProviderVaultSummary,
    ProviderVaultTime,
  } from "$app-wasm";
  import { I18N_KEYS, type I18nKey } from "../../../../generated/i18n-keys";
  import type { VaultState } from "$lib/vault.svelte";
  import {
    groupByIdentity,
    identityOpened,
    IdentityStandingKind,
    IdentityStandings,
    type IdentityStanding,
    type ProviderIdentityGroup,
  } from "$lib/components/provider-vaults/provider-identity-groups";

  let {
    vault,
    vaults,
    action,
    identityActions,
    checks = [],
  }: {
    vault: VaultState;
    vaults: readonly ProviderVaultSummary[];
    /** Checks run on this page; what one opened shows its name. */
    checks?: readonly CredentialCheckReport[];
    /** What the user can do with one listed vault. */
    action?: Snippet<[ProviderVaultSummary]>;
    /** What the user can do with an identity that does not open yet. */
    identityActions?: Snippet<[ProviderIdentityGroup]>;
  } = $props();

  const groups = $derived(groupByIdentity(vaults));
  const standings = $derived(new IdentityStandings(checks));

  /** One reported time and the line that names it. */
  interface TimeLineRequest {
    readonly key: I18nKey;
    readonly time: ProviderVaultTime;
  }

  const dateFormat = $derived.by(() => {
    const options: ConstructorParameters<typeof Intl.DateTimeFormat>[1] = {
      dateStyle: "medium",
      timeStyle: "short",
    };
    return new Intl.DateTimeFormat(vault.locale, options);
  });

  function timeLine({ key, time }: TimeLineRequest): string {
    if (time.state === "unreported") return "";
    const request: Parameters<typeof vault.t>[0] = {
      key,
      replacements: { date: dateFormat.format(new Date(time.at)) },
    };
    return vault.t(request);
  }

  function nameLine(summary: ProviderVaultSummary): string {
    switch (summary.name.state) {
      case "named":
        return summary.name.name;
      case "unknown":
        break;
    }
    const opened = standings.vaultName(summary.storeId);
    if (opened) return opened;
    const request: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.FirstRunRestoreVaultItem,
      replacements: { id: summary.shortId },
    };
    return vault.t(request);
  }

  /** The identity: its label when this browser holds it or a passkey opened
   * it, else its three words. */
  function identityLine(identity: FilingIdentity): string {
    let label = identity.words.join("-");
    switch (identity.name.state) {
      case "named":
        label = identity.name.name;
        break;
      case "unknown": {
        const opened = standings.name(identity);
        if (opened) label = opened;
        break;
      }
    }
    const request: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.ProviderVaultsFiledUnder,
      replacements: { identity: label },
    };
    return vault.t(request);
  }

  function standingLine(standing: IdentityStanding): string {
    switch (standing.kind) {
      case IdentityStandingKind.ThisBrowser:
        return vault.t(I18N_KEYS.AccessCheckIdentityThisBrowser);
      case IdentityStandingKind.OpenedByPasskey: {
        const request: Parameters<typeof vault.t>[0] = {
          key: I18N_KEYS.AccessCheckIdentityOpenedBy,
          replacements: { id: standing.passkey },
        };
        return vault.t(request);
      }
      case IdentityStandingKind.NotOpened:
        return vault.t(I18N_KEYS.AccessCheckIdentityNotOpened);
      case IdentityStandingKind.Unchecked:
        return vault.t(I18N_KEYS.AccessCheckIdentityUnchecked);
    }
  }

  /** The access label and the line that says what it means. */
  function accessLines(access: ProviderVaultAccess): readonly [string, string] {
    switch (access.state) {
      case "syncs":
        return [
          vault.t(I18N_KEYS.ProviderVaultsAccessSyncs),
          vault.t(I18N_KEYS.ProviderVaultsHintSyncs),
        ];
      case "otherIdentityHere": {
        const label: Parameters<typeof vault.t>[0] = {
          key: I18N_KEYS.ProviderVaultsAccessOtherIdentity,
          replacements: { identity: access.identityLabel },
        };
        const hint: Parameters<typeof vault.t>[0] = {
          key: I18N_KEYS.ProviderVaultsHintOtherIdentity,
          replacements: { identity: access.identityLabel },
        };
        return [vault.t(label), vault.t(hint)];
      }
      case "granted":
        return [
          vault.t(I18N_KEYS.ProviderVaultsAccessGranted),
          vault.t(I18N_KEYS.ProviderVaultsHintGranted),
        ];
      case "backupPassword":
        return [
          vault.t(I18N_KEYS.ProviderVaultsAccessBackupPassword),
          vault.t(I18N_KEYS.ProviderVaultsHintBackupPassword),
        ];
      case "unchecked":
        return [
          vault.t(I18N_KEYS.ProviderVaultsAccessUnchecked),
          vault.t(I18N_KEYS.ProviderVaultsHintUnchecked),
        ];
      case "requested":
        return [
          vault.t(I18N_KEYS.ProviderVaultsAccessRequested),
          vault.t(I18N_KEYS.ProviderVaultsHintRequested),
        ];
      case "locked":
        return [
          vault.t(I18N_KEYS.ProviderVaultsAccessLocked),
          vault.t(I18N_KEYS.ProviderVaultsHintLocked),
        ];
    }
  }

  /** What the identity's public control log tells, where it was read. */
  function identityLogLines(log: ProviderIdentityLog): readonly string[] {
    switch (log.state) {
      case "absent":
        return [];
      case "read": {
        const devices: Parameters<typeof vault.t>[0] = {
          key: I18N_KEYS.ProviderVaultsDevices,
          replacements: { count: String(log.devices) },
        };
        const newest: TimeLineRequest = {
          key: I18N_KEYS.ProviderVaultsNewestDevice,
          time: log.newestDevice,
        };
        const vaults: Parameters<typeof vault.t>[0] = {
          key: I18N_KEYS.ProviderVaultsIdentityVaults,
          replacements: { count: String(log.vaults) },
        };
        return [vault.t(devices), timeLine(newest), vault.t(vaults)].filter(
          (line) => line.length > 0,
        );
      }
    }
  }

  function eventLine(summary: ProviderVaultSummary): string {
    const request: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.ProviderVaultsEvents,
      replacements: { count: String(summary.eventCount) },
    };
    return vault.t(request);
  }
</script>

<div class="space-y-3" data-testid="provider-vault-list">
  {#each groups as group (group.identity.identityId)}
    {@const standing = standings.of(group.identity)}
    {@const opened = identityOpened(standing)}
    <section
      class="nk-frame space-y-3 px-4 py-3"
      data-testid="provider-identity"
      data-identity-id={group.identity.identityId}
      data-standing={standing.kind}
    >
      <div class="flex items-start gap-3">
        <span class="nk-tile nk-tile-sm" aria-hidden="true">
          <UserRound class="size-4" />
        </span>
        <div class="min-w-0 flex-1 space-y-1">
          <p
            class="text-sm font-semibold text-foreground"
            data-testid="provider-vault-identity"
            title={group.identity.identityId}
          >
            {identityLine(group.identity)}
          </p>
          <p class="nk-spec" data-testid="provider-identity-facts">
            {#each identityLogLines(group.identity.log) as line (line)}
              <span data-testid="provider-vault-identity-log">{line}</span>
            {/each}
          </p>
          <p
            class={opened
              ? "nk-tag nk-tag-success"
              : standing.kind === IdentityStandingKind.NotOpened
                ? "nk-tag nk-tag-warning"
                : "nk-tag"}
            data-testid="provider-identity-standing"
          >
            {standingLine(standing)}
          </p>
        </div>
      </div>
      {#if identityActions && !opened}
        {@render identityActions(group)}
      {/if}
      <ul class="nk-list">
        {#each group.vaults as summary (summary.storeId)}
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
                  class={summary.access.state === "locked"
                    ? "nk-tag nk-tag-warning"
                    : summary.access.state === "syncs" ||
                        summary.access.state === "granted"
                      ? "nk-tag nk-tag-success"
                      : "nk-tag"}
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
              {#if standings.opensWithBackupPassword(summary.storeId)}
                <p
                  class="nk-tag nk-tag-success mt-1"
                  data-testid="provider-vault-verification"
                >
                  {vault.t(I18N_KEYS.AccessCheckVaultVerifiedPassword)}
                </p>
              {/if}
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
    </section>
  {/each}
</div>
