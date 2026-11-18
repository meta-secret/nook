<script lang="ts">
  import type { Component } from 'svelte'
  import ExperimentBack from '$lib/components/ExperimentBack.svelte'
  import type { ExperimentProps } from '../../index'
  import SentinelCardStack from './SentinelCardStack.svelte'
  import VaultTerminal from './VaultTerminal.svelte'
  import {
    type SentinelLaunch,
    SentinelUi,
  } from './vault-auth-workflow-state.svelte'

  interface Props extends ExperimentProps {
    Auth: Component<{ onSentinel: (launch: SentinelLaunch) => void }>
  }

  let { navigate, Auth }: Props = $props()
  let destination = $state<SentinelLaunch>()

  function openSentinel(launch: SentinelLaunch) {
    destination = launch
  }

  function backToAuth() {
    destination = undefined
  }
</script>

{#if destination}
  <ExperimentBack {navigate} />
  {#if destination.ui === SentinelUi.CardStack}
    <SentinelCardStack
      initialName={destination.vaultName}
      onBack={backToAuth}
    />
  {:else}
    <VaultTerminal initialName={destination.vaultName} onBack={backToAuth} />
  {/if}
{:else}
  <ExperimentBack {navigate} light />
  <Auth onSentinel={openSentinel} />
{/if}
