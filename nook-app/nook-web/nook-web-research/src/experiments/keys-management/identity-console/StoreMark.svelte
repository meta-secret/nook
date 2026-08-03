<script lang="ts">
  import { Fingerprint } from '@lucide/svelte'
  import { type KeyStore } from '../_shared/key-graph'
  import { storeInk } from './console-ui'

  interface Props {
    store: KeyStore
    large?: boolean
  }

  let { store, large = false }: Props = $props()
</script>

<span
  class={`flex shrink-0 items-center justify-center rounded-lg ${large ? 'size-10' : 'size-7'}`}
  style={`background:${storeInk(store)}1f;border:1px solid ${storeInk(store)}59`}
  aria-hidden="true"
>
  <Fingerprint
    class={large ? 'size-5' : 'size-3.5'}
    style={`color:${storeInk(store)}`}
  />
</span>
