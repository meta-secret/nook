<script lang="ts">
  import { err } from "neverthrow";
  import {
    VaultStorageFailure,
    VaultStorageFailureKind,
  } from "$lib/runtime/storage-failure";
  import SentinelCardStackDashboard from "$lib/components/login/SentinelCardStackDashboard.svelte";
  import SentinelTerminalDashboard from "$lib/components/login/SentinelTerminalDashboard.svelte";
  import {
    SentinelDashboard,
  } from "$lib/components/login/sentinel-dashboard-portal";
  import type { SentinelDashboardSurfaceProps } from "$lib/components/login/sentinel-dashboard-surface-contract";

  let {
    vault,
    dashboard,
    name = $bindable(""),
    participantCount = $bindable(3),
    threshold = $bindable(2),
    status,
    request,
    participantResponse,
    participants,
    deliveries,
    isBusy,
    initiatorFingerprint,
    initiatorKeyLoading,
    onPrepareInitiator,
    onBack,
    onStart,
    onAddCardParticipant,
    onAddTerminalParticipant,
    onFinalizeSentinelGenesis,
    onCompleteSentinelGenesisDelivery,
  }: SentinelDashboardSurfaceProps = $props();

  function operationFailure() {
    return err(
      new VaultStorageFailure(VaultStorageFailureKind.OperationFailed),
    );
  }

  function finalizeSentinelGenesis() {
    return onFinalizeSentinelGenesis
      ? onFinalizeSentinelGenesis()
      : Promise.resolve(operationFailure());
  }

  function completeSentinelGenesisDelivery() {
    return onCompleteSentinelGenesisDelivery
      ? onCompleteSentinelGenesisDelivery()
      : Promise.resolve(operationFailure());
  }
</script>

{#if dashboard === SentinelDashboard.CardStack}
  <SentinelCardStackDashboard
    {vault}
    bind:name
    bind:participantCount
    bind:threshold
    {status}
    {request}
    {participantResponse}
    {participants}
    {deliveries}
    {isBusy}
    {initiatorFingerprint}
    {initiatorKeyLoading}
    onPrepareInitiator={onPrepareInitiator}
    onBack={onBack}
    onStart={onStart}
    onAddParticipant={onAddCardParticipant}
    onFinalize={finalizeSentinelGenesis}
    onCompleteDelivery={completeSentinelGenesisDelivery}
  />
{:else}
  <SentinelTerminalDashboard
    {vault}
    bind:name
    bind:participantCount
    bind:threshold
    {status}
    {request}
    {participants}
    {deliveries}
    {isBusy}
    onBack={onBack}
    onStart={onStart}
    onAddParticipant={onAddTerminalParticipant}
    onFinalize={finalizeSentinelGenesis}
    onCompleteDelivery={completeSentinelGenesisDelivery}
  />
{/if}
