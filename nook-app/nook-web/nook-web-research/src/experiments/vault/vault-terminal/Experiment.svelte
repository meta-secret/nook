<script lang="ts">
  import VaultTerminal from '../../vault-auth-workflow/_shared/VaultTerminal.svelte'
  import type { ExperimentProps } from '../../index'

  let { navigate }: ExperimentProps = $props()
</script>

<VaultTerminal
  backLabel="Catalog"
  backPositionClass="left-5"
  onBack={() => navigate('/')}
/>
