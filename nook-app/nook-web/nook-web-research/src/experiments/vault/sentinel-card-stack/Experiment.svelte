<script lang="ts">
  import SentinelCardStack from '../../vault-auth-workflow/_shared/SentinelCardStack.svelte'
  import type { ExperimentProps } from '../../index'

  let { navigate }: ExperimentProps = $props()
</script>

<SentinelCardStack
  backLabel="Catalog"
  backPositionClass="left-5"
  onBack={() => navigate('/')}
/>
