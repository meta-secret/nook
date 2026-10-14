<!--
Apps in the current identity: pending joins, members, rename, and removal.
Membership is identity-level; every vault the identity owns follows it.
-->
<script lang="ts">
  import type { Result } from "neverthrow";
  import type { IdentityJoinView, IdentityMemberView } from "$app-wasm";
  import type { VaultStorageFailure } from "$lib/runtime/storage-failure";
  import type { OAuthFailure } from "$lib/auth/oauth-failure";
  import type { IdentityActionOutcome } from "$lib/vault/identity-control.svelte";
  type IdentityTextTruncation = {
    readonly value: string;
    readonly head: number;
    readonly tail: number;
  };

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
  import { configured_vault_application_supports_extension } from "$app-wasm";
  import { Button } from "$lib/components/ui/button";
  import {
    extensionConnectionBrowser,
    PairedExtensionDiscoveryFailure,
  } from "$lib/extension/connect";
  import {
    ExtensionSetupStatus,
    extensionInstallationBrowser,
  } from "$lib/extension/install";
  import type { VaultState } from "$lib/vault.svelte";
  import { VaultType } from "$lib/vault/architecture-model";
  import {
    ExtensionSetupOfferKind,
    type ExtensionSetupOffer,
  } from "$lib/app/extension-setup";
  import {
    MemberDetailsKind,
    MemberRenameKind,
    MemberRevocationKind,
    type MemberDetails,
    type MemberRename,
    type MemberRevocation,
  } from "./vault-devices-card-state";

  const SUPPORTS_EXTENSION = configured_vault_application_supports_extension();

  let {
    vault,
    members = [],
    pendingJoins = [],
    isBusy,
    onApproveJoin,
    onDenyJoin,
    onRenameApp,
    onRevokeApp,
  }: {
    vault: VaultState;
    members?: IdentityMemberView[];
    pendingJoins?: IdentityJoinView[];
    isBusy: boolean;
    onApproveJoin: (appId: string) => Promise<IdentityActionResult>;
    onDenyJoin: (appId: string) => Promise<IdentityActionResult>;
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
  let extensionSetupState = $state<ExtensionSetupOffer>({
    kind: ExtensionSetupOfferKind.Hidden,
  });
  let extensionInstallBusy = $state(false);
  let extensionConnectError = $state(false);
  const isSentinelVault = $derived(
    vault.vaultArchitecture.vault_type === VaultType.Sentinel,
  );

  async function refreshExtensionSetupStatus() {
    if (!SUPPORTS_EXTENSION) return;
    try {
      const state =
        await extensionInstallationBrowser.resolveExtensionSetupState(
          vault.activeVault,
        );
      extensionSetupState = (() => {
        const shouldOfferExtensionSetupArgs: Parameters<
          typeof extensionInstallationBrowser.shouldOfferExtensionSetup
        >[0] = { status: state.status, environment: navigator };
        return extensionInstallationBrowser.shouldOfferExtensionSetup(
          shouldOfferExtensionSetupArgs,
        );
      })()
        ? { kind: ExtensionSetupOfferKind.Visible, setup: state }
        : { kind: ExtensionSetupOfferKind.Hidden };
    } catch (failure) {
      if (!(failure instanceof PairedExtensionDiscoveryFailure)) throw failure;
      vault.errorMsg = vault.t(failure.translationKey);
    }
  }

  async function handleExtensionInstall() {
    extensionInstallBusy = true;
    try {
      const target =
        await extensionInstallationBrowser.loadExtensionInstallTarget();
      extensionInstallationBrowser.openExtensionInstallTarget(target);
    } finally {
      extensionInstallBusy = false;
    }
  }

  async function handleExtensionConnect() {
    extensionInstallBusy = true;
    extensionConnectError = false;
    try {
      extensionConnectError =
        !(await extensionConnectionBrowser.openInstalledExtension());
    } finally {
      extensionInstallBusy = false;
    }
  }

  async function handleExtensionSetupAction() {
    if (extensionSetupState.kind !== ExtensionSetupOfferKind.Visible) return;
    const state = extensionSetupState.setup;
    if (state.status === ExtensionSetupStatus.NotInstalled) {
      await handleExtensionInstall();
      return;
    }
    await handleExtensionConnect();
  }

  function extensionStatusLabel(status: ExtensionSetupStatus): string {
    if (status === ExtensionSetupStatus.NotInstalled) {
      return vault.t(I18N_KEYS.ExtensionSetupStatusNotInstalled);
    }
    if (status === ExtensionSetupStatus.InstalledUnpaired) {
      return vault.t(I18N_KEYS.ExtensionSetupStatusInstalledUnpaired);
    }
    if (status === ExtensionSetupStatus.PairedElsewhere) {
      return vault.t(I18N_KEYS.ExtensionSetupStatusPairedElsewhere);
    }
    return vault.t(I18N_KEYS.ExtensionSetupStatusPaired);
  }

  $effect(() => {
    void vault.activeVault;
    void refreshExtensionSetupStatus();

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshExtensionSetupStatus();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    const observer = new MutationObserver(() => {
      void refreshExtensionSetupStatus();
    });
    const observeArgs: Parameters<typeof observer.observe>[1] = {
      attributes: true,
      attributeFilter: ["data-nook-extension-runtime-id"],
    };
    observer.observe(document.documentElement, observeArgs);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      observer.disconnect();
    };
  });

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
    if (!("navigator" in globalThis))
      return vault.t(I18N_KEYS.DevicesCardThisBrowserOs);
    const ua = navigator.userAgent;
    let os = vault.t(I18N_KEYS.DevicesCardUnknownOs);
    if (ua.includes("Android")) os = "Android";
    else if (ua.includes("like Mac")) os = "iOS";
    else if (ua.includes("Win")) os = "Windows";
    else if (ua.includes("Mac")) os = "Mac";
    else if (ua.includes("Linux")) os = "Linux";

    let browser = "Browser";
    if (ua.includes("Edg")) browser = "Edge";
    else if (ua.includes("Firefox")) browser = "Firefox";
    else if (ua.includes("Chrome")) browser = "Chrome";
    else if (ua.includes("Safari")) browser = "Safari";
    return `${browser} ${vault.t(I18N_KEYS.DevicesCardOn)} ${os}`;
  }

  function truncate({ value, head, tail }: IdentityTextTruncation) {
    if (value.length <= head + tail + 3) return value;
    return `${value.slice(0, head)}…${value.slice(-tail)}`;
  }

  function formatRequestDate(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
      return vault.t(I18N_KEYS.DevicesCardRecently);
    return date.toLocaleDateString();
  }

  function displayName(member: IdentityMemberView): string {
    const label = member.label.trim();
    if (label) return label;
    if (member.isCurrentInstallation) return currentDeviceName();
    const truncateArgs: Parameters<typeof truncate>[0] = {
      value: member.appId,
      head: 6,
      tail: 4,
    };
    return `${vault.t(I18N_KEYS.DevicesCardDevicePrefix)}${truncate(truncateArgs)}`;
  }

  function joinName(join: IdentityJoinView): string {
    const label = join.label.trim();
    if (label) return label;
    const truncateArgs: Parameters<typeof truncate>[0] = {
      value: join.appId,
      head: 14,
      tail: 10,
    };
    return `${vault.t(I18N_KEYS.DevicesCardDevicePrefix)}${truncate(truncateArgs)}`;
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
  {#if SUPPORTS_EXTENSION && extensionSetupState.kind === ExtensionSetupOfferKind.Visible}
    {@const extensionSetup = extensionSetupState.setup}
    <section
      class="space-y-2 rounded-lg border border-border/40 bg-background/60 p-3 sm:border-border/60"
      data-testid="extension-setup-settings"
      data-status={extensionSetup.status}
    >
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0 space-y-1">
          <h3 class="text-sm font-semibold text-foreground">
            {vault.t(I18N_KEYS.ExtensionSetupSettingsTitle)}
          </h3>
          <p class="text-xs leading-relaxed text-muted-foreground">
            {vault.t(I18N_KEYS.ExtensionSetupSettingsBody)}
          </p>
        </div>
        {#if extensionSetup}
          <span
            class="nk-tag shrink-0"
            data-testid="extension-setup-settings-status"
          >
            {extensionStatusLabel(extensionSetup.status)}
          </span>
        {/if}
      </div>
      {#if extensionSetup.status === ExtensionSetupStatus.PairedElsewhere}
        <p
          class="font-mono text-[11px] leading-relaxed text-amber-700 dark:text-amber-300"
          data-testid="extension-setup-settings-connected-vault"
        >
          {(() => {
            const tArgs: Parameters<typeof vault.t>[0] = {
              key: I18N_KEYS.ExtensionSetupConnectedVault,
              replacements: {
                vault: ((v) => (v ? v : ""))(extensionSetup.connectedVaultName),
                store: ((v) => (v ? v : ""))(
                  extensionSetup.connectedVaultStoreId,
                ),
              },
            };
            return vault.t(tArgs);
          })()}
        </p>
      {/if}
      {#if extensionSetup.status === ExtensionSetupStatus.InstalledUnpaired || extensionSetup.status === ExtensionSetupStatus.PairedElsewhere}
        <p class="text-[11px] leading-relaxed text-muted-foreground/80">
          {vault.t(I18N_KEYS.ExtensionSetupPairHint)}
        </p>
        {#if extensionConnectError}
          <p class="text-xs text-destructive" role="alert">
            {vault.t(I18N_KEYS.ExtensionSetupConnectFailed)}
          </p>
        {/if}
      {/if}
      {#if extensionSetup.status !== ExtensionSetupStatus.Paired}
        <Button
          type="button"
          size="sm"
          variant={extensionSetup.status === ExtensionSetupStatus.NotInstalled
            ? "default"
            : "outline"}
          class={extensionSetup.status === ExtensionSetupStatus.NotInstalled
            ? ""
            : "border-border"}
          disabled={extensionInstallBusy || isBusy}
          data-testid="extension-setup-settings-cta"
          onclick={() => void handleExtensionSetupAction()}
        >
          {#if extensionInstallBusy}
            {vault.t(
              extensionSetup.status === ExtensionSetupStatus.NotInstalled
                ? I18N_KEYS.ExtensionSetupLoadingInstall
                : I18N_KEYS.ExtensionSetupOpeningExtension,
            )}
          {:else if extensionSetup.status === ExtensionSetupStatus.NotInstalled}
            {vault.t(I18N_KEYS.ExtensionSetupInstallCta)}
          {:else}
            {vault.t(
              extensionSetup.status === ExtensionSetupStatus.PairedElsewhere
                ? I18N_KEYS.ExtensionSetupSwitchCta
                : I18N_KEYS.ExtensionSetupConnectCta,
            )}
          {/if}
        </Button>
      {/if}
    </section>
  {/if}

  {#if members.length <= 1}
    <div
      class="nk-banner nk-banner-warning flex items-start gap-2 px-3 py-2 text-xs leading-relaxed text-foreground"
      role="alert"
      data-testid="single-device-warning"
    >
      <TriangleAlert class="mt-0.5 size-3.5 shrink-0" />
      <span>
        {vault.t(
          isSentinelVault
            ? I18N_KEYS.DevicesCardSentinelSingleDeviceWarning
            : I18N_KEYS.DevicesCardSingleDeviceWarning,
        )}
      </span>
    </div>
  {/if}

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

  {#if pendingJoins.length > 0}
    <section class="space-y-2" data-testid="pending-join-list">
      <div class="flex items-center justify-between gap-3">
        <h3 class="text-sm font-semibold text-foreground">
          {vault.t(I18N_KEYS.IdentityControlPendingTitle)}
        </h3>
        <span class="text-xs text-muted-foreground">
          {pendingJoins.length === 1
            ? vault.t(I18N_KEYS.DevicesCardRequestsCountSingular)
            : (() => {
                const countArgs: Parameters<typeof vault.t>[0] = {
                  key: I18N_KEYS.DevicesCardRequestsCountPlural,
                  replacements: { count: String(pendingJoins.length) },
                };
                return vault.t(countArgs);
              })()}
        </span>
      </div>
      <ul class="space-y-2">
        {#each pendingJoins as join (join.appId)}
          <li
            class="rounded-lg border border-border/40 bg-background/60 p-3 sm:border-border/60"
            data-testid="pending-join-row"
            data-app-id={join.appId}
          >
            <div class="flex items-center justify-between gap-3">
              <div class="flex min-w-0 items-center gap-3">
                <div
                  class="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/40 bg-muted/35 text-muted-foreground"
                >
                  <Smartphone class="size-4.5" />
                </div>
                <div class="min-w-0">
                  <p class="truncate text-sm font-medium text-foreground">
                    {joinName(join)}
                  </p>
                  <p class="font-mono text-[11px] text-muted-foreground">
                    {join.appId}
                  </p>
                  <p class="text-xs text-muted-foreground">
                    {vault.t(
                      I18N_KEYS.DevicesCardRequestedPrefix,
                    )}{formatRequestDate(join.requestedAt)}
                  </p>
                </div>
              </div>
              <div class="flex shrink-0 items-center gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  class="border-border/50 px-2"
                  disabled={isBusy}
                  data-testid="deny-join-btn"
                  aria-label={vault.t(I18N_KEYS.IdentityControlDeny)}
                  onclick={() => void onDenyJoin(join.appId)}
                >
                  <X class="size-3.5" />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={isBusy}
                  data-testid="approve-join-btn"
                  onclick={() => void onApproveJoin(join.appId)}
                >
                  <Check class="size-3.5" />
                  {vault.t(I18N_KEYS.IdentityControlApprove)}
                </Button>
              </div>
            </div>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <section class="space-y-2">

    {#if sortedMembers.length === 0}
      <div
        class="rounded-lg border border-border/40 bg-muted/15 px-3 py-4 text-center text-sm text-muted-foreground"
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
            class="rounded-lg border border-border/40 bg-background/60 p-3 sm:border-border/60"
            data-testid="vault-member-row"
            data-app-id={member.appId}
          >
            <div class="flex items-start justify-between gap-3">
              <div class="flex min-w-0 items-start gap-3">
                <div
                  class="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/40 bg-muted/35 text-muted-foreground"
                >
                  {#if isCurrent}
                    <Laptop class="size-4.5" />
                  {:else}
                    <Smartphone class="size-4.5" />
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
                      <span
                        class="rounded-full border border-border/40 bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
                      >
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
