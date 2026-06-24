<script lang="ts">
  import { renderMarkdown } from '$lib/markdown'
  import MarkdownBody from './MarkdownBody.svelte'

  let { source }: { source: string } = $props()

  const html = $derived(renderMarkdown(source))
</script>

<MarkdownBody {html} />
