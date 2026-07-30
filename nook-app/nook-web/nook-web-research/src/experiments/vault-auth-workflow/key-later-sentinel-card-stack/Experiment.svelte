<script lang="ts">
  import ExperimentBack from '$lib/components/ExperimentBack.svelte'
  import type { ExperimentProps } from '../../index'
  import KeyLaterAuth from '../_shared/KeyLaterAuth.svelte'
  import SentinelCardStack from '../_shared/SentinelCardStack.svelte'
  import VaultTerminal from '../_shared/VaultTerminal.svelte'
  import {
    SentinelUi,
    VaultAuthExperimentStage,
  } from '../_shared/vault-auth-workflow-state.svelte'

  let { navigate }: ExperimentProps = $props()
  let stage = $state<VaultAuthExperimentStage>(VaultAuthExperimentStage.Auth)
  let sentinelUi = $state<SentinelUi>(SentinelUi.CardStack)
  let vaultName = $state('')

  function openSentinel(ui: SentinelUi, name: string) {
    sentinelUi = ui
    vaultName = name
    stage = VaultAuthExperimentStage.Sentinel
  }
</script>

{#if stage === VaultAuthExperimentStage.Auth}
  <ExperimentBack {navigate} light />
  <KeyLaterAuth onSentinel={openSentinel} />
{:else if sentinelUi === SentinelUi.CardStack}
  <ExperimentBack {navigate} />
  <SentinelCardStack
    initialName={vaultName}
    onBack={() => (stage = VaultAuthExperimentStage.Auth)}
  />
{:else}
  <ExperimentBack {navigate} />
  <VaultTerminal
    initialName={vaultName}
    onBack={() => (stage = VaultAuthExperimentStage.Auth)}
  />
{/if}
