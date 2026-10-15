<!--
Identity Devices page: the devices that open this identity, with join
requests waiting for approval above them. It reports; adding a device is
in Manage on the card. Upgrade notices sit above when the identity needs
one.
-->
<script lang="ts">
  import { I18N_KEYS } from "../../../../generated/i18n-keys";
  import { onMount, type ComponentProps } from "svelte";
  import { RefreshCw, TriangleAlert } from "@lucide/svelte";
  import ManageSection from "$lib/components/settings/ManageSection.svelte";
  import PendingJoinList from "$lib/components/settings/PendingJoinList.svelte";
  import VaultDevicesCard from "$lib/components/settings/VaultDevicesCard.svelte";
  import { Button } from "$lib/components/ui/button";
  import { StatusTag, StatusTone } from "$lib/components/ui/status-tag";
  import type { VaultState } from "$lib/vault.svelte";
  import { VaultType } from "$lib/vault/architecture-model";
  import IdentityStandingNotices from "./IdentityStandingNotices.svelte";
  import { IdentityStandingPresentation } from "./identity-standing";

  type PendingJoinListProps = ComponentProps<typeof PendingJoinList>;
  type VaultDevicesCardProps = ComponentProps<typeof VaultDevicesCard>;

  let {
    vault,
  }: {
    vault: VaultState;
  } = $props();

  const control = $derived(vault.identityControl);
  const snapshot = $derived(control.snapshot);
  const standing = $derived(new IdentityStandingPresentation(snapshot));
  const members = $derived(snapshot === false ? [] : snapshot.members);
  const pendingJoins = $derived(snapshot === false ? [] : snapshot.pendingJoins);
  const isBusy = $derived(control.busy || vault.isSaving || vault.isVerifying);
  const isSentinelVault = $derived(
    vault.vaultArchitecture.vault_type === VaultType.Sentinel,
  );

  function reportFailure(translationKey: Parameters<typeof vault.t>[0]) {
    vault.errorMsg = vault.t(translationKey);
  }

  onMount(() => {
    void control.followOpenVault().then((refreshed) => {
      if (refreshed.isErr()) reportFailure(refreshed.error.translationKey);
    });
  });
</script>

<div class="grid min-w-0 grid-cols-1 gap-6" data-testid="vault-devices-panel">
  <IdentityStandingNotices {vault} />

  {#if standing.isMember() && members.length <= 1}
    <p
      class="nk-banner nk-banner-warning flex items-start gap-2 px-4 py-3 text-sm text-pretty text-foreground"
      role="note"
      data-testid="single-device-warning"
    >
      <TriangleAlert
        class="mt-0.5 size-4 shrink-0 text-warning"
        aria-hidden="true"
      />
      {vault.t(
        isSentinelVault
          ? I18N_KEYS.DevicesCardSentinelSingleDeviceWarning
          : I18N_KEYS.AddDeviceSingleDevice,
      )}
    </p>
  {/if}

  {#if pendingJoins.length > 0}
    <PendingJoinList
      {vault}
      {pendingJoins}
      {isBusy}
      onApproveJoin={(
        appId: Parameters<PendingJoinListProps["onApproveJoin"]>[0],
      ) => control.approve(appId)}
      onDenyJoin={(appId: Parameters<PendingJoinListProps["onDenyJoin"]>[0]) =>
        control.deny(appId)}
    />
  {/if}

  <ManageSection
    compact
    title={vault.t(I18N_KEYS.WorkspaceSectionDevices)}
    subtitle={vault.t(I18N_KEYS.IdentityControlMembersDescription)}
    testId="vault-devices-section"
  >
    {#snippet badge()}
      <div class="flex items-center gap-2">
        <StatusTag
          tone={members.length > 0 ? StatusTone.Success : StatusTone.Neutral}
          label={members.length === 1
            ? vault.t(I18N_KEYS.SettingsDeviceCountSingular)
            : (() => {
                const countRequest: Parameters<typeof vault.t>[0] = {
                  key: I18N_KEYS.SettingsDeviceCountPlural,
                  replacements: { count: String(members.length) },
                };
                return vault.t(countRequest);
              })()}
          testId="vault-devices-status"
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isBusy}
          data-testid="identity-sync-now-btn"
          aria-label={vault.t(I18N_KEYS.IdentityControlSyncNow)}
          onclick={() =>
            void control.syncWithMounts().then((synced) => {
              if (synced.isErr()) reportFailure(synced.error.translationKey);
            })}
        >
          <RefreshCw class="size-3.5 {control.busy ? 'animate-spin' : ''}" />
        </Button>
      </div>
    {/snippet}
    <VaultDevicesCard
      {vault}
      {members}
      {isBusy}
      onRenameApp={(
        renameRequest: Parameters<VaultDevicesCardProps["onRenameApp"]>[0],
      ) => control.rename(renameRequest)}
      onRevokeApp={(
        appId: Parameters<VaultDevicesCardProps["onRevokeApp"]>[0],
      ) => control.revoke(appId)}
    />
  </ManageSection>

</div>
