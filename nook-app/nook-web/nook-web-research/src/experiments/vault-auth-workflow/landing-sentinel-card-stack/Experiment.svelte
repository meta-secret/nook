<script lang="ts">
  import type { ExperimentProps } from '../../index'
  import LandingAuth from '../_shared/LandingAuth.svelte'
  import VaultAuthExperiment from '../_shared/VaultAuthExperiment.svelte'

  let { navigate }: ExperimentProps = $props()
</script>

<VaultAuthExperiment {navigate} Auth={LandingAuth} />
