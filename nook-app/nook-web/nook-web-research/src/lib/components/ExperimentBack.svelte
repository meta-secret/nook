<script lang="ts">
  import { ArrowLeft } from '@lucide/svelte'

  interface Props {
    navigate: (path: string) => void
    light?: boolean
  }

  let { navigate, light = false }: Props = $props()
</script>

<button
  class={`fixed top-5 left-5 z-50 flex h-10 items-center gap-2 rounded-full border px-4 text-xs font-semibold backdrop-blur-md transition ${light ? 'border-black/15 bg-white/70 text-black' : 'border-white/15 bg-black/40 text-white'}`}
  onclick={() => navigate('/')}
>
  <ArrowLeft class="size-4" aria-hidden="true" />
  Catalog
</button>
