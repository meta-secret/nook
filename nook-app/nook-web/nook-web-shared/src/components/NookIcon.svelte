<script lang="ts">
  let {
    src,
    alt = 'Nook logo',
    filter = undefined,
    class: className = '',
  }: {
    src: string
    alt?: string
    filter?: string | undefined
    class?: string
  } = $props()
</script>

<img {src} {alt} class={className} style:filter={filter} />
