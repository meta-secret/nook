<script lang="ts">
  import { untrack } from "svelte";
  import type { VaultState } from "$lib/vault.svelte";
  import {
    SentinelGenesisActions,
    type SentinelActionResult,
  } from "$lib/vault/sentinel-genesis";
  import { SentinelUnlockActions } from "$lib/vault/sentinel-unlock";
  import { SentinelGenesisPhase } from "$app-wasm";
  import { I18N_KEYS as K } from "../../../generated/i18n-keys";
  let { vault }: { vault: VaultState } = $props();
  const genesis = untrack(() => new SentinelGenesisActions(vault));
  const unlock = untrack(() => new SentinelUnlockActions(vault));
  let label = $state("");
  let participantCount = $state(2);
  let threshold = $state(2);
  let invitationInput = $state("");
  let participantResponseInput = $state("");
  let deliveryInput = $state("");
  let unlockRequestInput = $state("");
  let unlockContributionInput = $state("");
  let unlockOutput = $state("");
  let participantLabel = $state("");
  let output = $state("");
  let shareStoreId = $state("");
  let creating = $state(false);
  let busy = $state(false);
  async function run<T>(operation: () => Promise<SentinelActionResult<T>>) {
    busy = true;
    try {
      const result = await operation();
      if (result.isErr()) vault.errorMsg = vault.t(result.error.translationKey);
    } finally {
      busy = false;
    }
  }
  async function response() {
    output = "";
    busy = true;
    try {
      const request: Parameters<
        SentinelGenesisActions["createParticipantResponse"]
      >[0] = {
        requestPayload: invitationInput,
      };
      const result = await genesis.createParticipantResponse(request);
      if (result.isErr()) vault.errorMsg = vault.t(result.error.translationKey);
      else output = result.value;
    } finally {
      busy = false;
    }
  }
  async function createUnlockResponse() {
    unlockOutput = "";
    busy = true;
    try {
      const request: Parameters<
        SentinelUnlockActions["createSentinelUnlockResponse"]
      >[0] = { storeId: shareStoreId, request: unlockRequestInput };
      const result = await unlock.createSentinelUnlockResponse(request);
      if (result.isErr()) vault.errorMsg = vault.t(result.error.translationKey);
      else unlockOutput = result.value;
    } finally {
      busy = false;
    }
  }
  function startGenesis() {
    const request: Parameters<VaultState["startSentinelGenesis"]>[0] = {
      label,
      participantCount,
      threshold,
    };
    return run(() => vault.startSentinelGenesis(request));
  }
  function addParticipant() {
    const request: Parameters<
      SentinelGenesisActions["addParticipantResponse"]
    >[0] = { payload: participantResponseInput, participantLabel };
    return run(() => genesis.addParticipantResponse(request));
  }
  function acceptDelivery() {
    const request: Parameters<
      SentinelGenesisActions["acceptShareDelivery"]
    >[0] = { payload: deliveryInput };
    return run(() => genesis.acceptShareDelivery(request));
  }
  function addUnlockResponse() {
    const request: Parameters<
      SentinelUnlockActions["addSentinelUnlockResponse"]
    >[0] = { response: unlockContributionInput };
    return run(() => unlock.addSentinelUnlockResponse(request));
  }
</script>

<div class="stack">
  {#if !creating && vault.localVaults.length && (vault.sentinelGenesisPhase === SentinelGenesisPhase.Inactive || vault.sentinelGenesisPhase === SentinelGenesisPhase.Complete)}
    {#each vault.localVaults as local (local.storeId)}<button
        onclick={async () => {
          await vault.chooseLoginVault(local.storeId);
          await vault.loadDb();
        }}>{local.label || vault.t(K.LoginVaultPickerUnnamed)}</button
      >{/each}
    <button
      disabled={busy}
      onclick={() => run(() => unlock.startSentinelUnlock())}
      >{vault.t(K.ArchitectureModesSentinelUnlockStart)}</button
    >
    {#if vault.sentinelUnlockRequest}<label
        >{vault.t(K.ArchitectureModesSentinelUnlockRequestLabel)}<textarea
          readonly
          rows="4"
          value={vault.sentinelUnlockRequest}></textarea></label
      ><label
        >{vault.t(K.ArchitectureModesSentinelUnlockResponseLabel)}<textarea
          bind:value={unlockContributionInput}
          rows="4"></textarea></label
      ><button disabled={busy} onclick={addUnlockResponse}
        >{vault.t(K.CommonSave)}</button
      >
      <p>
        {vault.t(K.ArchitectureModesSentinelUnlockProgress)}: {vault
          .sentinelUnlockSession.collected} / {vault.sentinelUnlockSession
          .threshold}
      </p>
      <button
        class="primary"
        disabled={busy || !vault.sentinelUnlockSession.ready}
        onclick={() => run(() => unlock.finalizeSentinelUnlock())}
        >{vault.t(K.ArchitectureModesSentinelUnlockFinalize)}</button
      >{/if}
    <button
      class="text-button"
      onclick={() => {
        creating = true;
      }}>{vault.t(K.WorkspaceNewVault)}</button
    >
  {:else}
    {#if vault.sentinelGenesisPhase === SentinelGenesisPhase.Inactive}
      <form
        class="stack"
        onsubmit={(e) => {
          e.preventDefault();
          void startGenesis();
        }}
      >
        <label
          >{vault.t(K.WorkspaceVaultName)}<input bind:value={label} /></label
        >
        <label
          >{vault.t(K.LoginSentinelGenesisParticipantCount)}<input
            type="number"
            bind:value={participantCount}
          /></label
        >
        <label
          >{vault.t(K.LoginSentinelGenesisThreshold)}<input
            type="number"
            bind:value={threshold}
          /></label
        >
        <button class="primary" disabled={busy}
          >{vault.t(K.LoginSentinelGenesisStart)}</button
        >
      </form>
    {:else}
      <label
        >{vault.t(K.LoginSentinelGenesisRequestTitle)}<textarea
          readonly
          rows="4"
          value={vault.sentinelGenesisRequest}></textarea></label
      >
      {#each vault.sentinelGenesisParticipants as participant (participant.deviceId)}<p
        >
          {participant.label} · {participant.fingerprint}
        </p>{/each}
      {#if vault.sentinelGenesisPhase === SentinelGenesisPhase.CollectingParticipants || vault.sentinelGenesisPhase === SentinelGenesisPhase.ReadyToFinalize}
        <label
          >{vault.t(K.LoginSentinelGenesisResponseLabel)}<textarea
            bind:value={participantResponseInput}
            rows="4"></textarea></label
        >
        <label
          >{vault.t(K.LoginSentinelGenesisDeliveryParticipant)}<input
            bind:value={participantLabel}
          /></label
        >
        <button disabled={busy} onclick={addParticipant}
          >{vault.t(K.LoginSentinelGenesisAddParticipant)}</button
        >
        <button
          class="primary"
          disabled={busy ||
            vault.sentinelGenesisPhase !== SentinelGenesisPhase.ReadyToFinalize}
          onclick={() => run(() => genesis.finalize())}
          >{vault.t(K.LoginSentinelGenesisFinalize)}</button
        >
      {/if}
      {#each vault.sentinelGenesisDeliveries as delivery (delivery.deviceId)}<label
          >{delivery.fingerprint}<textarea
            readonly
            rows="4"
            value={delivery.payload}></textarea></label
        >{/each}
      {#if vault.sentinelGenesisPhase === SentinelGenesisPhase.DeliveringShares}<button
          disabled={busy}
          onclick={() => run(() => genesis.completeDelivery())}
          >{vault.t(K.CommonDone)}</button
        >{/if}
    {/if}
  {/if}
  <details>
    <summary>{vault.t(K.LoginSentinelGenesisJoinTitle)}</summary>
    <div class="stack">
      <label
        >{vault.t(K.LoginSentinelGenesisJoinRequestLabel)}<textarea
          rows="4"
          bind:value={invitationInput}></textarea></label
      ><button disabled={busy} onclick={response}
        >{vault.t(K.ArchitectureModesSentinelUnlockCreateResponse)}</button
      >{#if output}<label
          >{vault.t(K.LoginSentinelGenesisResponseLabel)}<textarea
            readonly
            rows="4"
            value={output}></textarea></label
        >{/if}<label
        >{vault.t(K.LoginSentinelGenesisReceiveShareLabel)}<textarea
          rows="4"
          bind:value={deliveryInput}></textarea></label
      ><button disabled={busy} onclick={acceptDelivery}
        >{vault.t(K.LoginSentinelGenesisReceiveShare)}</button
      >
    </div>
  </details>
  <details
    ontoggle={(event) => {
      if (event.currentTarget.open)
        void run(() => unlock.listSentinelStoredDeliveries());
    }}
  >
    <summary>{vault.t(K.ArchitectureModesSentinelUnlockHelpTitle)}</summary>
    <div class="stack">
      <p>{vault.t(K.ArchitectureModesSentinelUnlockHelpDescription)}</p>
      <label
        >{vault.t(K.ArchitectureModesSentinelUnlockDeliveryLabel)}<select
          bind:value={shareStoreId}
        >
          <option value="" disabled
            >{vault.t(
              K.ArchitectureModesSentinelUnlockDeliveryPlaceholder,
            )}</option
          >
          {#each vault.sentinelStoredDeliveries as delivery (delivery.storeId)}<option
              value={delivery.storeId}>{delivery.storeId}</option
            >{/each}
        </select></label
      >
      <label
        >{vault.t(K.ArchitectureModesSentinelUnlockPasteRequest)}<textarea
          rows="4"
          bind:value={unlockRequestInput}></textarea></label
      >
      <button disabled={busy} onclick={createUnlockResponse}
        >{vault.t(K.ArchitectureModesSentinelUnlockCreateResponse)}</button
      >
      {#if unlockOutput}<label
          >{vault.t(
            K.ArchitectureModesSentinelUnlockGeneratedResponse,
          )}<textarea readonly rows="4" value={unlockOutput}></textarea></label
        >{/if}
    </div>
  </details>
</div>
