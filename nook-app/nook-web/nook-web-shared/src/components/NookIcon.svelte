<script lang="ts">

  let {
    src,
    alt = 'Nook logo',
    filter,
    class: className = '',
  }: {
    src: string
    alt?: string
    filter?: string | void
    class?: string
  } = $props()
</script>

<img {src} {alt} class={className} style:filter={filter} />
