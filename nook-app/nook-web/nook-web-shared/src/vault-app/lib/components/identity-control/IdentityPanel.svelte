<!--
The identity this browser uses, in one panel beside its card, as three
sub-panels from most to least prominent. First what keeps it replicated and
resilient: its sync providers, then its devices, each a section listing
them with its add action. A device joins through a sync provider, so until
the identity has a cloud one the devices section says so first, as an amber
row in place of its add action, and that row leads to adding one; until then the providers
list holds one empty, dashed row in its place, and that row adds one. Then the other
management actions (its vaults, this browser), then the details (sign-in
keys). Each action says what it leads to; nothing hides behind a menu.
-->
<script lang="ts">
  import { onMount, type Snippet } from "svelte";
  import { Button } from "$lib/components/ui/button";
  import {
    ChevronRight,
    Cloud,
    FolderKey,
    Lock,
    MonitorSmartphone,
    Plus,
    Settings2,
    SlidersHorizontal,
    TriangleAlert,
  } from "@lucide/svelte";
  import { I18N_KEYS } from "../../../../generated/i18n-keys";
  import { localizeProviderLabel, type StorageProvider } from "$lib/auth/providers";
  import { ProviderSyncStatusView } from "$lib/auth/provider-sync-status";
  import { NookIdentityNextStep, type NookIdentityHealth } from "$app-wasm";
  import { CurrentDeviceName } from "$lib/components/settings/current-device-name";
  import { DeviceIdLabel } from "$lib/components/settings/device-id-label";
  import {
    DeviceJoinAvailability,
    DeviceJoinReadiness,
  } from "$lib/components/add-device/device-join-mounts";
  import type { VaultState } from "$lib/vault.svelte";
  import { WorkspaceSection } from "$lib/vault/state/ui.svelte";

  let {
    vault,
    health,
    onOpen,
    onAddSyncProvider,
  }: {
    vault: VaultState;
    health: NookIdentityHealth;
    onOpen: (section: WorkspaceSection) => void;
    onAddSyncProvider: () => void;
  } = $props();

  const control = $derived(vault.identityControl);
  const members = $derived(
    control.snapshot === false ? [] : control.snapshot.members,
  );
  /** Each device that opens the identity holds its own key; this browser
   * holds one even before the device list loads. */
  const keyCount = $derived(Math.max(members.length, 1));
  const deviceCount = $derived(Math.max(members.length, 1));
  const keyCountText = $derived.by(() => {
    const request: Parameters<typeof vault.t>[0] = {
      key:
        keyCount === 1
          ? I18N_KEYS.WorkspaceCardKeyCountSingular
          : I18N_KEYS.WorkspaceCardKeyCountPlural,
      replacements: { count: String(keyCount) },
    };
    return vault.t(request);
  });

  /** A device joins through a cloud sync provider: until the identity has
   * one, adding a provider leads and adding a device waits. Unknown until
   * the providers load, so nothing locks early. */
  const needsCloud = $derived.by(() => {
    const request: ConstructorParameters<typeof DeviceJoinReadiness>[0] = {
      providers: vault.syncProviders,
      providersLoaded: vault.providersLoaded,
      replication: vault.vaultArchitecture.replication_type,
    };
    return (
      new DeviceJoinReadiness(request).availability ===
      DeviceJoinAvailability.NeedsCloud
    );
  });
  const devicesAtRisk = $derived(
    health.nextStep === NookIdentityNextStep.AddDevice,
  );
  const copiesAtRisk = $derived(
    health.nextStep === NookIdentityNextStep.AddSyncProvider ||
      health.nextStep === NookIdentityNextStep.AddCloudProvider ||
      vault.syncProviders.length === 0,
  );

  function memberName(
    ...[label, appId, current]: readonly [string, string, boolean]
  ): string {
    if (label.trim()) return label.trim();
    if (current) {
      const nameRequest: ConstructorParameters<typeof CurrentDeviceName>[0] = {
        t: vault.t,
      };
      return new CurrentDeviceName(nameRequest).text;
    }
    const idRequest: ConstructorParameters<typeof DeviceIdLabel>[0] = {
      value: appId,
      head: 6,
      tail: 4,
    };
    return `${vault.t(I18N_KEYS.DevicesCardDevicePrefix)}${new DeviceIdLabel(idRequest).text}`;
  }

  function providerName(provider: StorageProvider): string {
    const labelRequest: Parameters<typeof localizeProviderLabel>[0] = {
      label: provider.label,
      t: vault.t,
    };
    return localizeProviderLabel(labelRequest);
  }

  function providerStatus(provider: StorageProvider): string {
    const statusRequest: ConstructorParameters<
      typeof ProviderSyncStatusView
    >[0] = {
      provider,
      locale: vault.locale,
      labels: {
        lastSynced: vault.t(I18N_KEYS.AuthStorageLastSynced),
        notSyncedYet: vault.t(I18N_KEYS.AuthStorageNotSyncedYet),
      },
    };
    return new ProviderSyncStatusView(statusRequest).text;
  }

  const memberNames = $derived(
    members.map((member) =>
      memberName(member.label, member.appId, member.isCurrentInstallation),
    ),
  );
  /** This browser counts as a device before the device list loads. */
  const deviceNames = $derived(
    memberNames.length > 0
      ? memberNames
      : [vault.t(I18N_KEYS.IdentityOverviewThisBrowser)],
  );

  onMount(() => {
    void control.followOpenVault();
  });
</script>

{#snippet detailRow(
  testId: string,
  title: string,
  detail: string,
  risk: string,
  section: WorkspaceSection,
)}
  <li>
    <button
      type="button"
      class="group flex w-full min-w-0 items-center gap-3 px-1 py-2.5 text-left transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      data-testid={testId}
      data-risk={risk ? "true" : "false"}
      onclick={() => onOpen(section)}
    >
      <span class="flex min-w-0 flex-1 flex-col">
        <span class="flex items-center gap-2 text-sm text-foreground">
          {title}
          {#if risk}
            <span class="nk-tag nk-tag-warning">
              <TriangleAlert class="size-3" aria-hidden="true" />
              {risk}
            </span>
          {/if}
        </span>
        <span class="truncate text-xs text-muted-foreground">{detail}</span>
      </span>
      <ChevronRight
        class="size-4 flex-none text-muted-foreground opacity-60 transition-transform group-hover:translate-x-0.5"
        aria-hidden="true"
      />
    </button>
  </li>
{/snippet}

{#snippet actionTile(
  testId: string,
  label: string,
  hint: string,
  icon: Snippet,
  onSelect: () => void,
)}
  <button
    type="button"
    class="nk-identity-menu-item nk-plate"
    data-testid={testId}
    onclick={onSelect}
  >
    <span class="nk-vault-icon" aria-hidden="true">{@render icon()}</span>
    <span class="flex min-w-0 flex-1 flex-col">
      <span class="truncate text-sm font-medium text-foreground">{label}</span>
      <span class="truncate text-xs text-muted-foreground">{hint}</span>
    </span>
    <ChevronRight
      class="size-4 flex-none text-muted-foreground opacity-60"
      aria-hidden="true"
    />
  </button>
{/snippet}

{#snippet vaultsIcon()}<FolderKey class="size-4" />{/snippet}
{#snippet browserIcon()}<SlidersHorizontal class="size-4" />{/snippet}

<div class="grid min-w-0 gap-6" data-testid="identity-overview">
  <!-- Devices and sync: the raised panel that keeps the identity replicated,
       as two ordered sections. A device joins through a sync provider, so
       providers come first and adding a device waits for one. -->
  <section
    class="nk-panel grid gap-5 p-4 sm:p-5"
    data-testid="identity-panel-sync"
  >
    <h3 class="nk-subpanel-head nk-subpanel-head-accent">
      {vault.t(I18N_KEYS.IdentityOverviewResilienceHeading)}
    </h3>

    <div
      class="grid gap-2"
      data-state={copiesAtRisk ? "risk" : "ok"}
      data-testid="identity-panel-providers"
    >
      <div class="flex items-center gap-2.5">
        <span class="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-sm font-medium text-foreground">
          {vault.t(I18N_KEYS.IdentityOverviewProvidersHeading)}
          {#if copiesAtRisk}
            <span class="nk-tag nk-tag-warning">
              <TriangleAlert class="size-3" aria-hidden="true" />
              {vault.t(I18N_KEYS.IdentityOverviewRiskLocal)}
            </span>
          {/if}
        </span>
        {#if vault.syncProviders.length > 0}
          <Button
            type="button"
            size="sm"
            variant="outline"
            class="shrink-0"
            data-testid="overview-open-sync"
            onclick={() => onOpen(WorkspaceSection.Sync)}
          >
            <Settings2 class="size-4" aria-hidden="true" />
            {vault.t(I18N_KEYS.WorkspaceManage)}
          </Button>
        {/if}
      </div>
      {#if vault.syncProviders.length === 0}
        <!-- The place the first provider takes, as the card's add rows
             look: a dashed slot that adds one. -->
        <button
          type="button"
          class="nk-vault-row nk-vault-row-add text-muted-foreground hover:text-foreground"
          data-lead={needsCloud ? "true" : "false"}
          data-testid="identity-action-add-sync"
          onclick={onAddSyncProvider}
        >
          <span class="nk-vault-icon" aria-hidden="true">
            <Cloud class="size-4" />
          </span>
          <span class="min-w-0 flex-1 truncate text-sm font-medium"
            >{vault.t(I18N_KEYS.AddDeviceCloudAction)}</span
          >
          <Plus class="size-4 flex-none" aria-hidden="true" />
        </button>
      {:else}
        <ul class="divide-y divide-border/60">
          {#each vault.syncProviders as provider (provider.id)}
            <li
              class="flex min-w-0 items-center gap-3 py-2"
              data-testid="identity-panel-provider-{provider.type}"
            >
              <Cloud
                class="size-4 flex-none text-muted-foreground"
                aria-hidden="true"
              />
              <span class="flex min-w-0 flex-1 flex-col">
                <span class="truncate text-sm text-foreground"
                  >{providerName(provider)}</span
                >
                <span class="truncate text-xs text-muted-foreground"
                  >{providerStatus(provider)}</span
                >
              </span>
            </li>
          {/each}
        </ul>
        <Button
          type="button"
          size="sm"
          variant={needsCloud ? "default" : "outline"}
          data-lead={needsCloud ? "true" : "false"}
          class="justify-self-start"
          data-testid="identity-action-add-sync"
          onclick={onAddSyncProvider}
        >
          <Plus class="size-4" aria-hidden="true" />
          {vault.t(I18N_KEYS.AddDeviceCloudAction)}
        </Button>
      {/if}
    </div>

    <div class="border-t border-border/60"></div>

    <div
      class="grid gap-2"
      data-state={devicesAtRisk ? "risk" : "ok"}
      data-testid="identity-panel-devices"
    >
      <div class="flex items-center gap-2.5">
        <span class="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-sm font-medium text-foreground">
          {`${vault.t(I18N_KEYS.WorkspaceSectionDevices)} · ${deviceCount}`}
          {#if devicesAtRisk}
            <span class="nk-tag nk-tag-warning">
              <TriangleAlert class="size-3" aria-hidden="true" />
              {vault.t(I18N_KEYS.IdentityOverviewRiskOneDevice)}
            </span>
          {/if}
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          class="shrink-0"
          data-testid="overview-open-devices"
          onclick={() => onOpen(WorkspaceSection.Devices)}
        >
          <Settings2 class="size-4" aria-hidden="true" />
          {vault.t(I18N_KEYS.WorkspaceManage)}
        </Button>
      </div>
      <ul class="divide-y divide-border/60">
        {#each deviceNames as name, index (index)}
          <li
            class="flex min-w-0 items-center gap-3 py-2"
            data-testid="identity-panel-device"
          >
            <MonitorSmartphone
              class="size-4 flex-none text-muted-foreground"
              aria-hidden="true"
            />
            <span class="min-w-0 flex-1 truncate text-sm text-foreground"
              >{name}</span
            >
          </li>
        {/each}
      </ul>
      {#if needsCloud}
        <!-- What blocks adding a device is what this section says first,
             drawn as the card's amber protection row, and it leads there. -->
        <button
          type="button"
          class="nk-vault-row bg-warning/5"
          data-testid="identity-device-needs-cloud"
          onclick={onAddSyncProvider}
        >
          <span
            class="nk-vault-icon border-warning/50 text-warning"
            aria-hidden="true"
          >
            <Lock class="size-4" />
          </span>
          <span class="min-w-0 flex-1 truncate text-[0.9375rem] font-medium"
            >{vault.t(I18N_KEYS.IdentityMenuAddDeviceNeedsCloud)}</span
          >
          <ChevronRight
            class="size-4 flex-none text-muted-foreground opacity-60"
            aria-hidden="true"
          />
        </button>
      {:else}
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Button
            type="button"
            size="sm"
            variant={devicesAtRisk ? "default" : "outline"}
            data-lead={devicesAtRisk ? "true" : "false"}
            data-testid="identity-action-add-device"
            onclick={() => onOpen(WorkspaceSection.AddDevice)}
          >
            <Plus class="size-4" aria-hidden="true" />
            {vault.t(I18N_KEYS.AddDeviceTitle)}
          </Button>
          <span class="text-xs text-muted-foreground">
            {vault.t(I18N_KEYS.IdentityMenuAddDeviceHint)}
          </span>
        </div>
      {/if}
    </div>
  </section>

  <!-- Manage: the identity's other actions, each opening its page. -->
  <section
    class="nk-panel grid gap-4 p-4 sm:p-5"
    data-testid="identity-panel-manage"
  >
    <h3 class="nk-subpanel-head">
      {vault.t(I18N_KEYS.WorkspaceManage)}
    </h3>
    <div class="grid gap-2 sm:grid-cols-2">
      {@render actionTile(
        "overview-open-vaults",
        vault.t(I18N_KEYS.WorkspaceSectionVaults),
        vault.t(I18N_KEYS.IdentityMenuVaultsHint),
        vaultsIcon,
        () => onOpen(WorkspaceSection.Vaults),
      )}
      {@render actionTile(
        "overview-browser-settings",
        vault.t(I18N_KEYS.IdentityMenuBrowser),
        vault.t(I18N_KEYS.IdentityMenuBrowserHint),
        browserIcon,
        () => onOpen(WorkspaceSection.Settings),
      )}
    </div>
  </section>

  <!-- Details: recessed below, what the identity consists of. -->
  <section
    class="nk-subpanel-recessed grid gap-2 px-4 pt-4 pb-2 sm:px-5"
    data-testid="identity-panel-details"
  >
    <h3 class="nk-subpanel-head">
      {vault.t(I18N_KEYS.IdentityOverviewDetailsHeading)}
    </h3>
    <ul class="divide-y divide-border/60">
      {@render detailRow(
        "overview-keys",
        vault.t(I18N_KEYS.IdentityOverviewKeysLink),
        keyCountText,
        "",
        WorkspaceSection.Keys,
      )}
    </ul>
  </section>
</div>
