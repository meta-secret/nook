<script lang="ts">
  import { ChevronLeft } from '@lucide/svelte'
  import MarkdownContent from '$lib/components/MarkdownContent.svelte'
  import { Button } from '$lib/components/ui/button'
  import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
  } from '$lib/components/ui/card'
  import { appPath, legalPageForId, type LegalPageId } from '$lib/legal-content'

  let {
    pageId,
    onClose,
  }: {
    pageId: LegalPageId
    onClose: () => void
  } = $props()

  const page = $derived(legalPageForId(pageId))
  const otherPageId = $derived<LegalPageId>(
    pageId === 'privacy' ? 'terms' : 'privacy',
  )
  const otherPage = $derived(legalPageForId(otherPageId))
</script>

<div
  class="w-full animate-in fade-in duration-300"
  data-testid="legal-document-page"
  data-legal-page={pageId}
>
  <Card
    class="gap-0 border-border bg-card/80 py-0 shadow-lg shadow-black/20 backdrop-blur-sm overflow-hidden"
  >
    <CardHeader
      class="border-b border-border/60 space-y-0 gap-0 px-4 pb-2 pt-3 sm:px-5"
    >
      <div class="flex items-start justify-between gap-2">
        <div class="space-y-0.5">
          <CardTitle
            class="text-base font-semibold tracking-tight text-foreground"
          >
            {page.title}
          </CardTitle>
          <CardDescription class="text-pretty text-xs leading-snug">
            Nook open-source password manager
          </CardDescription>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          class="shrink-0 border-border"
          data-testid="legal-document-back-btn"
          onclick={onClose}
        >
          <ChevronLeft class="size-3.5" />
          Back
        </Button>
      </div>
    </CardHeader>

    <CardContent class="px-4 pb-4 pt-3 sm:px-5">
      <MarkdownContent source={page.source} testId="legal-document-body" />

      <nav
        class="mt-6 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/60 pt-4 text-xs text-muted-foreground"
        aria-label="Legal documents"
      >
        <a
          href={appPath(otherPage.path)}
          class="font-medium text-foreground/80 underline-offset-4 hover:text-foreground hover:underline"
          data-testid="legal-document-related-link"
        >
          {otherPage.title}
        </a>
        <span aria-hidden="true">·</span>
        <a
          href="https://github.com/meta-secret/nook"
          target="_blank"
          rel="noreferrer"
          class="underline-offset-4 hover:text-foreground hover:underline"
        >
          Source on GitHub
        </a>
      </nav>
    </CardContent>
  </Card>
</div>
