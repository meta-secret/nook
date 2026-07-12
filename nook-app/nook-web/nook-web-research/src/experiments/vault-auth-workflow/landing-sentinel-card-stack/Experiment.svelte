<script lang="ts">
  import ExperimentBack from '$lib/components/ExperimentBack.svelte'
  import type { ExperimentProps } from '../../index'
  import type { SentinelUi } from '../_shared/KeyLaterAuth.svelte'
  import LandingAuth from '../_shared/LandingAuth.svelte'
  import SentinelCardStack from '../_shared/SentinelCardStack.svelte'
  import VaultTerminal from '../_shared/VaultTerminal.svelte'

  let { navigate }: ExperimentProps = $props()
  let stage = $state<'auth' | 'sentinel'>('auth')
  let sentinelUi = $state<SentinelUi>('card-stack')
  let vaultName = $state('')

  function openSentinel(ui: SentinelUi, name: string) {
    sentinelUi = ui
    vaultName = name
    stage = 'sentinel'
  }
</script>

{#if stage === 'auth'}
  <ExperimentBack {navigate} light />
  <LandingAuth onSentinel={openSentinel} />
{:else if sentinelUi === 'card-stack'}
  <ExperimentBack {navigate} />
  <SentinelCardStack initialName={vaultName} onBack={() => (stage = 'auth')} />
{:else}
  <ExperimentBack {navigate} />
  <VaultTerminal initialName={vaultName} onBack={() => (stage = 'auth')} />
{/if}
