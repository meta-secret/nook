<script lang="ts">
  import { markdownRenderer } from "$lib/content/markdown";
  import MarkdownBody from "./MarkdownBody.svelte";

  let {
    source,
    testId,
  }: {
    source: string;
    testId?: string;
  } = $props();

  const html = $derived(markdownRenderer.renderMarkdown(source));
</script>

<MarkdownBody {html} {testId} />
