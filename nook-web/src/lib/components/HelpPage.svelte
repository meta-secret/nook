<script lang="ts">
  import { BookOpen, ChevronLeft } from '@lucide/svelte'
  import { HELP_SECTIONS } from '$lib/help-content'
  import { Button } from '$lib/components/ui/button'
  import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
  } from '$lib/components/ui/card'

  let { onClose }: { onClose: () => void } = $props()
</script>

<div class="w-full animate-in fade-in duration-300" data-testid="help-page">
  <Card
    class="border-border bg-card/80 shadow-lg shadow-black/20 backdrop-blur-sm overflow-hidden"
  >
    <CardHeader class="border-b border-border/60 pb-4 pt-5">
      <div class="flex items-start justify-between gap-3">
        <div class="space-y-1">
          <CardTitle
            class="text-lg font-semibold tracking-tight text-foreground inline-flex items-center gap-2"
          >
            <BookOpen class="size-4 shrink-0" />
            How nook works
          </CardTitle>
          <CardDescription class="text-pretty">
            Architecture and design of our decentralized, offline-capable secret
            manager — no hosted account required.
          </CardDescription>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          class="shrink-0 border-border"
          data-testid="help-close-btn"
          onclick={onClose}
        >
          <ChevronLeft class="size-3.5" />
          Back
        </Button>
      </div>
    </CardHeader>

    <CardContent class="space-y-5 pt-4">
      {#each HELP_SECTIONS as section (section.id)}
        <section
          class="space-y-2 rounded-lg border border-border bg-muted/20 p-4"
          data-testid="help-section-{section.id}"
        >
          <h2 class="text-sm font-semibold text-foreground">{section.title}</h2>
          <p class="text-sm leading-relaxed text-muted-foreground text-pretty">
            {section.summary}
          </p>
          <ul
            class="list-disc space-y-1.5 pl-4 text-sm text-muted-foreground text-pretty"
          >
            {#each section.bullets as bullet, index (section.id + index)}
              <li>{bullet}</li>
            {/each}
          </ul>
        </section>
      {/each}
    </CardContent>
  </Card>
</div>
