<!--
The devices in the current identity, with rename and removal. Membership is
identity-level; every vault the identity owns follows it. Join requests and
adding a device live on the Devices page around this list.
-->
<script lang="ts">
  import type { Result } from "neverthrow";
  import type { IdentityMemberView } from "$app-wasm";
  import type { VaultStorageFailure } from "$lib/runtime/storage-failure";
  import type { OAuthFailure } from "$lib/auth/oauth-failure";
  import type { IdentityActionOutcome } from "$lib/vault/identity-control.svelte";
  type AppRename = { readonly appId: string; readonly label: string };
  type IdentityActionResult = Result<
    IdentityActionOutcome,
    VaultStorageFailure | OAuthFailure
  >;

  import { I18N_KEYS } from "../../../../generated/i18n-keys";
  import {
    Check,
    ChevronDown,
    Copy,
    Laptop,
    Pencil,
    ShieldOff,
    Smartphone,
    TriangleAlert,
    X,
  } from "@lucide/svelte";
  import { CurrentDeviceName } from "./current-device-name";
  import { DeviceIdLabel } from "./device-id-label";
  import { Button } from "$lib/components/ui/button";
  import type { VaultState } from "$lib/vault.svelte";
  import { VaultType } from "$lib/vault/architecture-model";
  import {
    MemberDetailsKind,
    MemberRenameKind,
    MemberRevocationKind,
    type MemberDetails,
    type MemberRename,
    type MemberRevocation,
  } from "./vault-devices-card-state";


  let {
    vault,
    members = [],
    isBusy,
    onRenameApp,
    onRevokeApp,
  }: {
    vault: VaultState;
    members?: IdentityMemberView[];
    isBusy: boolean;
    onRenameApp: (args: AppRename) => Promise<IdentityActionResult>;
    onRevokeApp: (appId: string) => Promise<IdentityActionResult>;
  } = $props();

  let detailsAppId = $state<MemberDetails>({
    kind: MemberDetailsKind.Collapsed,
  });
  let renameAppId = $state<MemberRename>({ kind: MemberRenameKind.Idle });
  let renameLabel = $state("");
  let revokeAppId = $state<MemberRevocation>({
    kind: MemberRevocationKind.Idle,
  });
  const isSentinelVault = $derived(
    vault.vaultArchitecture.vault_type === VaultType.Sentinel,
  );

  type MemberComparison = readonly [
    left: IdentityMemberView,
    right: IdentityMemberView,
  ];

  class MemberOrdering {
    static currentAppFirst(...[a, b]: MemberComparison): number {
      if (a.isCurrentInstallation) return -1;
      if (b.isCurrentInstallation) return 1;
      return displayName(a).localeCompare(displayName(b));
    }
  }

  const sortedMembers = $derived(
    [...members].sort(MemberOrdering.currentAppFirst),
  );

  function currentDeviceName(): string {
    const nameRequest: ConstructorParameters<typeof CurrentDeviceName>[0] = {
      t: vault.t,
    };
    return new CurrentDeviceName(nameRequest).text;
  }

  function displayName(member: IdentityMemberView): string {
    const label = member.label.trim();
    if (label) return label;
    if (member.isCurrentInstallation) return currentDeviceName();
    const idRequest: ConstructorParameters<typeof DeviceIdLabel>[0] = {
      value: member.appId,
      head: 6,
      tail: 4,
    };
    return `${vault.t(I18N_KEYS.DevicesCardDevicePrefix)}${new DeviceIdLabel(idRequest).text}`;
  }

  function beginRename(member: IdentityMemberView) {
    renameAppId = { kind: MemberRenameKind.Editing, appId: member.appId };
    renameLabel = member.label.trim();
    revokeAppId = { kind: MemberRevocationKind.Idle };
  }

  async function saveRename(member: IdentityMemberView) {
    const rename: AppRename = { appId: member.appId, label: renameLabel };
    const renamed = await onRenameApp(rename);
    if (renamed.isErr()) return;
    renameAppId = { kind: MemberRenameKind.Idle };
    renameLabel = "";
  }

  async function copyText(value: string) {
    if (!value) return;
    await navigator.clipboard.writeText(value);
  }
</script>


<div class="space-y-4" data-testid="vault-devices-card">
  {#if isSentinelVault}
    <div
      class="nk-banner flex items-start gap-2 px-3 py-2 text-xs leading-relaxed text-muted-foreground"
      role="status"
      data-testid="sentinel-device-change-guidance"
    >
      <TriangleAlert class="mt-0.5 size-3.5 shrink-0" />
      <span>{vault.t(I18N_KEYS.DevicesCardSentinelDeviceChangeGuidance)}</span>
    </div>
  {/if}

  <section class="space-y-2">

    {#if sortedMembers.length === 0}
      <div
        class="border border-border px-3 py-4 text-center text-sm text-muted-foreground"
        data-testid="vault-devices-empty"
      >
        {vault.t(I18N_KEYS.DevicesCardNoDevices)}
      </div>
    {:else}
      <ul class="space-y-2" data-testid="vault-members-list">
        {#each sortedMembers as member (member.appId)}
          {@const isCurrent = member.isCurrentInstallation}
          {@const isRenaming =
            renameAppId.kind === MemberRenameKind.Editing &&
            renameAppId.appId === member.appId}
          {@const isConfirmingRevoke =
            revokeAppId.kind === MemberRevocationKind.Confirming &&
            revokeAppId.appId === member.appId}
          {@const canRevoke = members.length > 1}
          <li
            class="border border-border bg-card p-3"
            data-testid="vault-member-row"
            data-app-id={member.appId}
          >
            <div class="flex items-start justify-between gap-3">
              <div class="flex min-w-0 items-start gap-3">
                <div class="nk-tile shrink-0" aria-hidden="true">
                  {#if isCurrent}
                    <Laptop class="size-4" />
                  {:else}
                    <Smartphone class="size-4" />
                  {/if}
                </div>
                <div class="min-w-0 space-y-1">
                  {#if isRenaming}
                    <label class="sr-only" for={`rename-${member.appId}`}>
                      {vault.t(I18N_KEYS.DevicesCardDeviceNameLabel)}
                    </label>
                    <input
                      id={`rename-${member.appId}`}
                      bind:value={renameLabel}
                      maxlength="80"
                      class="h-9 w-full rounded-md border border-border/45 bg-background/80 px-3 text-sm text-foreground focus:outline-hidden focus:ring-2 focus:ring-ring"
                      data-testid="device-rename-input"
                    />
                  {:else}
                    <p
                      class="truncate text-sm font-medium text-foreground"
                      data-testid="device-display-name"
                    >
                      {displayName(member)}
                    </p>
                  {/if}
                  <div class="flex flex-wrap items-center gap-1.5">
                    {#if isCurrent}
                      <span
                        class="nk-tag nk-tag-success"
                        data-testid="current-device-badge"
                      >
                        {vault.t(I18N_KEYS.IdentityControlCurrentApp)}
                      </span>
                    {:else}
                      <span class="nk-tag">
                        {vault.t(I18N_KEYS.DevicesCardEnrolled)}
                      </span>
                    {/if}
                  </div>
                </div>
              </div>

              <div class="flex shrink-0 items-center gap-1">
                {#if isRenaming}
                  <Button
                    type="button"
                    size="sm"
                    class="px-2"
                    disabled={isBusy}
                    data-testid="device-rename-save"
                    aria-label={vault.t(I18N_KEYS.DevicesCardSaveDeviceName)}
                    onclick={() => void saveRename(member)}
                  >
                    <Check class="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    class="border-border/50 px-2"
                    disabled={isBusy}
                    aria-label={vault.t(I18N_KEYS.DevicesCardCancelRename)}
                    onclick={() => {
                      renameAppId = { kind: MemberRenameKind.Idle };
                      renameLabel = "";
                    }}
                  >
                    <X class="size-3.5" />
                  </Button>
                {:else}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    class="px-2 text-muted-foreground"
                    disabled={isBusy}
                    data-testid="device-rename-btn"
                    aria-label={vault.t(I18N_KEYS.DevicesCardRenameDevice)}
                    onclick={() => beginRename(member)}
                  >
                    <Pencil class="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    class="px-2 text-muted-foreground hover:text-destructive"
                    disabled={isBusy || !canRevoke}
                    data-testid="device-revoke-btn"
                    aria-label={vault.t(I18N_KEYS.IdentityControlRevoke)}
                    onclick={() => {
                      revokeAppId = {
                        kind: MemberRevocationKind.Confirming,
                        appId: member.appId,
                      };
                      renameAppId = { kind: MemberRenameKind.Idle };
                    }}
                  >
                    <ShieldOff class="size-3.5" />
                  </Button>
                {/if}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  class="px-2 text-muted-foreground"
                  aria-label={vault.t(I18N_KEYS.DevicesCardToggleDetails)}
                  aria-expanded={detailsAppId.kind ===
                    MemberDetailsKind.Expanded &&
                    detailsAppId.appId === member.appId}
                  data-testid="device-details-toggle"
                  onclick={() =>
                    (detailsAppId =
                      detailsAppId.kind === MemberDetailsKind.Expanded &&
                      detailsAppId.appId === member.appId
                        ? { kind: MemberDetailsKind.Collapsed }
                        : {
                            kind: MemberDetailsKind.Expanded,
                            appId: member.appId,
                          })}
                >
                  <ChevronDown
                    class="size-3.5 transition-transform {detailsAppId.kind ===
                      MemberDetailsKind.Expanded &&
                    detailsAppId.appId === member.appId
                      ? 'rotate-180'
                      : ''}"
                  />
                </Button>
              </div>
            </div>

            {#if isConfirmingRevoke}
              <div
                class="mt-3 rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                data-testid="device-revoke-confirm"
              >
                <div
                  class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
                >
                  <p>
                    {isCurrent
                      ? vault.t(I18N_KEYS.DevicesCardConfirmRevokeCurrent)
                      : (() => {
                          const confirmArgs: Parameters<typeof vault.t>[0] = {
                            key: I18N_KEYS.IdentityControlRevokeConfirm,
                            replacements: { label: displayName(member) },
                          };
                          return vault.t(confirmArgs);
                        })()}
                  </p>
                  <div class="flex shrink-0 items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      class="h-8 border-destructive/30 bg-transparent text-destructive hover:bg-destructive/10 hover:text-destructive"
                      disabled={isBusy}
                      data-testid="device-revoke-cancel"
                      onclick={() =>
                        (revokeAppId = {
                          kind: MemberRevocationKind.Idle,
                        })}
                    >
                      {vault.t(I18N_KEYS.DevicesCardCancel)}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      class="h-8"
                      disabled={isBusy}
                      data-testid="device-revoke-confirm-btn"
                      onclick={() =>
                        void onRevokeApp(member.appId).then(() => {
                          revokeAppId = { kind: MemberRevocationKind.Idle };
                        })}
                    >
                      {vault.t(I18N_KEYS.IdentityControlRevoke)}
                    </Button>
                  </div>
                </div>
              </div>
            {/if}

            {#if detailsAppId.kind === MemberDetailsKind.Expanded && detailsAppId.appId === member.appId}
              <dl
                class="mt-3 space-y-2 border-t border-border/30 pt-3 text-xs"
                data-testid="device-technical-details"
              >
                <div class="flex items-center justify-between gap-3">
                  <dt class="text-muted-foreground">
                    {vault.t(I18N_KEYS.DevicesCardDeviceId)}
                  </dt>
                  <dd class="flex min-w-0 items-center gap-1 font-mono">
                    <span class="truncate">{member.appId}</span>
                    <button
                      type="button"
                      class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                      aria-label={vault.t(I18N_KEYS.DevicesCardCopyDeviceId)}
                      onclick={() => void copyText(member.appId)}
                    >
                      <Copy class="size-3" />
                    </button>
                  </dd>
                </div>
              </dl>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</div>
