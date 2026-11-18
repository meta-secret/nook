<script lang="ts">
  import type { ExperimentProps } from '../../index'
  import KeyLaterAuth from '../_shared/KeyLaterAuth.svelte'
  import VaultAuthExperiment from '../_shared/VaultAuthExperiment.svelte'

  let { navigate }: ExperimentProps = $props()
</script>

<VaultAuthExperiment {navigate} Auth={KeyLaterAuth} />
