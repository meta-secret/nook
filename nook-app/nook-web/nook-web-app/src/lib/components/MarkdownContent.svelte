<script lang="ts">
  import { renderMarkdown } from '$lib/markdown'
  import MarkdownBody from './MarkdownBody.svelte'

  let {
    source,
    testId,
  }: {
    source: string
    testId?: string
  } = $props()

  const html = $derived(renderMarkdown(source))
</script>

<MarkdownBody {html} {testId} />
