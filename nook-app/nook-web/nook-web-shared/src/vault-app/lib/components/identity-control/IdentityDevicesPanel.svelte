<!--
Devices block of the identity home: the apps in the current identity,
pending joins, identity upgrade notices, and adding a new app through an
identity mount.
-->
<script lang="ts">
  import { I18N_KEYS } from "../../../../generated/i18n-keys";
  import { onMount, type ComponentProps } from "svelte";
  import { RefreshCw } from "@lucide/svelte";
  import OnboardDevice from "$lib/components/OnboardDevice.svelte";
  import ManageSection from "$lib/components/settings/ManageSection.svelte";
  import VaultDevicesCard from "$lib/components/settings/VaultDevicesCard.svelte";
  import { Button } from "$lib/components/ui/button";
  import { StatusTag, StatusTone } from "$lib/components/ui/status-tag";
  import type { VaultState } from "$lib/vault.svelte";
  import { IdentityUpgradeKind } from "$lib/vault/identity-control.svelte";
  import { IdentityStandingPresentation } from "./identity-standing";

  type OnboardDeviceProps = ComponentProps<typeof OnboardDevice>;
  type VaultDevicesCardProps = ComponentProps<typeof VaultDevicesCard>;

  let {
    vault,
    onOpenSync,
  }: {
    vault: VaultState;
    onOpenSync: () => void;
  } = $props();

  const control = $derived(vault.identityControl);
  const snapshot = $derived(control.snapshot);
  const standing = $derived(new IdentityStandingPresentation(snapshot));
  const members = $derived(snapshot === false ? [] : snapshot.members);
  const pendingJoins = $derived(snapshot === false ? [] : snapshot.pendingJoins);
  const isBusy = $derived(control.busy || vault.isSaving || vault.isVerifying);

  function reportFailure(translationKey: Parameters<typeof vault.t>[0]) {
    vault.errorMsg = vault.t(translationKey);
  }

  onMount(() => {
    void control.followOpenVault().then((refreshed) => {
      if (refreshed.isErr()) reportFailure(refreshed.error.translationKey);
    });
  });
</script>

<div class="grid min-w-0 grid-cols-1 gap-8" data-testid="vault-devices-panel">
  {#if standing.isRevoked()}
    <div
      class="nk-banner nk-banner-warning p-3 text-sm text-foreground"
      data-testid="identity-revoked-banner"
    >
      {vault.t(I18N_KEYS.IdentityControlRevoked)}
    </div>
  {/if}

  {#if control.upgrade.kind === IdentityUpgradeKind.AwaitingFounder}
    <div
      class="nk-banner nk-banner-warning space-y-2 p-3 text-sm text-foreground"
      data-testid="identity-awaiting-founder-banner"
    >
      <p class="font-medium">
        {vault.t(I18N_KEYS.IdentityControlAwaitingFounderTitle)}
      </p>
      <p class="text-xs text-muted-foreground">
        {vault.t(I18N_KEYS.IdentityControlAwaitingFounderDescription)}
      </p>
      <div class="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isBusy}
          data-testid="identity-check-providers-btn"
          onclick={() => void control.adoptFromProviders()}
        >
          {vault.t(I18N_KEYS.IdentityControlCheckProviders)}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={isBusy}
          data-testid="identity-upgrade-here-btn"
          onclick={() => void control.upgradeHere()}
        >
          {vault.t(I18N_KEYS.IdentityControlUpgradeHere)}
        </Button>
      </div>
    </div>
  {:else if standing.isNotReplicated()}
    <div
      class="nk-banner nk-banner-warning space-y-2 p-3 text-sm text-foreground"
      data-testid="identity-not-replicated-banner"
    >
      <p class="font-medium">
        {vault.t(I18N_KEYS.IdentityControlNotReplicatedTitle)}
      </p>
      <p class="text-xs text-muted-foreground">
        {vault.t(I18N_KEYS.IdentityControlNotReplicatedDescription)}
      </p>
      <Button
        type="button"
        size="sm"
        disabled={isBusy}
        data-testid="identity-upgrade-btn"
        onclick={() => void control.upgradeHere()}
      >
        {vault.t(I18N_KEYS.IdentityControlUpgrade)}
      </Button>
    </div>
  {/if}

  <ManageSection
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
      {pendingJoins}
      {isBusy}
      onApproveJoin={(
        appId: Parameters<VaultDevicesCardProps["onApproveJoin"]>[0],
      ) => control.approve(appId)}
      onDenyJoin={(appId: Parameters<VaultDevicesCardProps["onDenyJoin"]>[0]) =>
        control.deny(appId)}
      onRenameApp={(
        renameRequest: Parameters<VaultDevicesCardProps["onRenameApp"]>[0],
      ) => control.rename(renameRequest)}
      onRevokeApp={(
        appId: Parameters<VaultDevicesCardProps["onRevokeApp"]>[0],
      ) => control.revoke(appId)}
    />
  </ManageSection>

  {#if standing.isMember()}
    <OnboardDevice
      {vault}
      mounts={control.mounts}
      enrollmentCode={vault.enrollmentCode}
      {isBusy}
      onIssueCode={(
        issueRequest: Parameters<OnboardDeviceProps["onIssueCode"]>[0],
      ) => vault.issueEnrollmentCode(issueRequest)}
      onClearCode={() => vault.clearEnrollmentCode()}
      {onOpenSync}
    />
  {/if}
</div>
