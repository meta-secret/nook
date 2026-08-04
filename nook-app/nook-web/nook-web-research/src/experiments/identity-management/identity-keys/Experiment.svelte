<script lang="ts">
  import type { ExperimentProps } from '../../index'
  import IdentityAndKeysView from './IdentityAndKeysView.svelte'

  let { navigate }: ExperimentProps = $props()
</script>

<IdentityAndKeysView {navigate} />
