<script lang="ts">
  import type { Component } from 'svelte'
  import ExperimentBack from '$lib/components/ExperimentBack.svelte'
  import type { ExperimentProps } from '../../index'
  import SentinelCardStack from './SentinelCardStack.svelte'
  import VaultTerminal from './VaultTerminal.svelte'
  import {
    type SentinelLaunch,
    SentinelUi,
    type VaultAuthDestination,
    VaultAuthStage,
  } from './vault-auth-workflow-state.svelte'

  interface Props extends ExperimentProps {
    Auth: Component<{ onSentinel: (launch: SentinelLaunch) => void }>
  }

  let { navigate, Auth }: Props = $props()
  const chooser: VaultAuthDestination = { stage: VaultAuthStage.Chooser }
  let destination = $state<VaultAuthDestination>(chooser)

  function openSentinel(launch: SentinelLaunch) {
    destination = { stage: VaultAuthStage.Sentinel, launch }
  }

  function backToAuth() {
    destination = chooser
  }
</script>

{#if destination.stage === VaultAuthStage.Sentinel}
  <ExperimentBack {navigate} />
  {#if destination.launch.ui === SentinelUi.CardStack}
    <SentinelCardStack
      initialName={destination.launch.vaultName}
      onBack={backToAuth}
    />
  {:else}
    <VaultTerminal
      initialName={destination.launch.vaultName}
      onBack={backToAuth}
    />
  {/if}
{:else}
  <ExperimentBack {navigate} light />
  <Auth onSentinel={openSentinel} />
{/if}
