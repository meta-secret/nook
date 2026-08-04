<script lang="ts">
  import type { ExperimentProps } from '../../index'
  import IdentityAndKeysView from '../../identity-management/identity-keys/IdentityAndKeysView.svelte'

  let { navigate }: ExperimentProps = $props()
</script>

<IdentityAndKeysView {navigate} />
