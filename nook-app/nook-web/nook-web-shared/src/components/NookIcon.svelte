<script lang="ts">
  import { omittedValue } from '../explicit-state'

  let {
    src,
    alt = 'Nook logo',
    filter = omittedValue(),
    class: className = '',
  }: {
    src: string
    alt?: string
    filter?: string | void
    class?: string
  } = $props()
</script>

<img {src} {alt} class={className} style:filter={filter} />
