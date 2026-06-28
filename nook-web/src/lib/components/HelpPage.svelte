<script lang="ts">
  import { BookOpen, ChevronDown, ChevronLeft } from '@lucide/svelte'
  import { HELP_SECTIONS } from '$lib/help-content'
  import HelpArchitectureDiagram from '$lib/components/HelpArchitectureDiagram.svelte'
  import { appPath } from '$lib/legal-content'
  import { Button } from '$lib/components/ui/button'
  import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
  } from '$lib/components/ui/card'

  let { onClose }: { onClose: () => void } = $props()

  function scrollToSection(id: string) {
    document
      .getElementById(`help-${id}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function handleSectionJump(event: Event) {
    const select = event.currentTarget as HTMLSelectElement
    const id = select.value
    if (!id) return
    scrollToSection(id)
    select.value = ''
  }
</script>

<div class="w-full animate-in fade-in duration-300" data-testid="help-page">
  <Card
    class="gap-0 border-border bg-card/80 py-0 shadow-lg shadow-black/20 backdrop-blur-sm overflow-hidden"
  >
    <CardHeader
      class="border-b border-border/60 space-y-0 gap-0 px-4 pb-2 pt-3 sm:px-5"
    >
      <div class="flex items-start justify-between gap-2">
        <div class="space-y-0.5">
          <CardTitle
            class="text-base font-semibold tracking-tight text-foreground inline-flex items-center gap-1.5"
          >
            <BookOpen class="size-4 shrink-0" />
            Your vault, optional sync replicas
          </CardTitle>
          <CardDescription class="text-pretty text-xs leading-snug">
            One encrypted vault on this device — sync providers keep copies in
            sync.
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

    <CardContent class="space-y-2 px-4 pb-3 pt-2 sm:px-5">
      <div class="space-y-0.5">
        <label
          for="help-section-select"
          class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
        >
          In this guide
        </label>
        <div class="relative">
          <select
            id="help-section-select"
            class="w-full appearance-none rounded-md border border-border bg-background py-1.5 pl-3 pr-10 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            data-testid="help-navigation"
            onchange={handleSectionJump}
          >
            <option value="" selected disabled>Jump to section…</option>
            {#each HELP_SECTIONS as section (section.id)}
              <option value={section.id}>{section.title}</option>
            {/each}
          </select>
          <ChevronDown
            class="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
        </div>
      </div>

      <div class="space-y-2">
        {#each HELP_SECTIONS as section (section.id)}
          <section
            id="help-{section.id}"
            class="scroll-mt-20 space-y-1 rounded-lg border border-border bg-muted/20 p-3"
            data-testid="help-section-{section.id}"
          >
            <h2 class="text-sm font-semibold leading-tight text-foreground">
              {section.title}
            </h2>
            <p class="text-sm leading-snug text-muted-foreground text-pretty">
              {section.summary}
            </p>
            <ul
              class="list-disc space-y-0.5 pl-4 text-sm leading-snug text-muted-foreground text-pretty"
            >
              {#each section.bullets as bullet, index (section.id + index)}
                <li>{bullet}</li>
              {/each}
            </ul>
            {#if section.diagram}
              <HelpArchitectureDiagram sectionId={section.id} />
            {/if}
          </section>
        {/each}
      </div>

      <nav
        class="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/60 pt-3 text-xs text-muted-foreground"
        aria-label="Legal"
      >
        <a
          href={appPath('/privacy')}
          class="font-medium underline-offset-4 hover:text-foreground hover:underline"
        >
          Privacy Policy
        </a>
        <span aria-hidden="true">·</span>
        <a
          href={appPath('/terms')}
          class="font-medium underline-offset-4 hover:text-foreground hover:underline"
        >
          Terms of Service
        </a>
      </nav>
    </CardContent>
  </Card>
</div>
