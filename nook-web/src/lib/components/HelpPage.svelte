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
            Your device is the key
          </CardTitle>
          <CardDescription class="text-pretty">
            No master password. Your devices unlock the vault.
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

    <CardContent
      class="pt-4 lg:grid lg:grid-cols-[11rem_minmax(0,1fr)] lg:items-start lg:gap-5"
    >
      <aside class="mb-5 lg:sticky lg:top-20 lg:mb-0">
        <p
          class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
        >
          In this guide
        </p>
        <nav
          aria-label="Help sections"
          class="flex gap-2 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:flex-col lg:gap-1 lg:overflow-visible lg:pb-0"
          data-testid="help-navigation"
        >
          {#each HELP_SECTIONS as section (section.id)}
            <a
              href="#help-{section.id}"
              class="shrink-0 rounded-md border border-border bg-muted/20 px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:border-transparent lg:bg-transparent"
            >
              {section.title}
            </a>
          {/each}
        </nav>
      </aside>

      <div class="space-y-5">
        {#each HELP_SECTIONS as section (section.id)}
          <section
            id="help-{section.id}"
            class="scroll-mt-20 space-y-2 rounded-lg border border-border bg-muted/20 p-4"
            data-testid="help-section-{section.id}"
          >
            <h2 class="text-sm font-semibold text-foreground">
              {section.title}
            </h2>
            <p class="text-sm text-muted-foreground text-pretty">
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
      </div>
    </CardContent>
  </Card>
</div>
