<script lang="ts">
  import { BookOpen, ChevronDown, ChevronLeft } from '@lucide/svelte'
  import { HELP_SECTIONS } from '$lib/help-content'
  import HelpMermaidDiagram from '$lib/components/HelpMermaidDiagram.svelte'
  import { appPath } from '$lib/legal-content'
  import { Button } from '$lib/components/ui/button'
  import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
  } from '$lib/components/ui/card'
  import type { MermaidTheme } from '$lib/mermaid-diagram'
  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
    onClose,
    colorMode = 'dark',
  }: {
    vault: VaultState
    onClose: () => void
    colorMode?: MermaidTheme
  } = $props()

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
            {vault.t('help.title')}
          </CardTitle>
          <CardDescription class="text-pretty text-xs leading-snug">
            {vault.t('help.subtitle')}
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
          {vault.t('common.back')}
        </Button>
      </div>
    </CardHeader>

    <CardContent class="space-y-2 px-4 pb-3 pt-2 sm:px-5">
      <div class="space-y-0.5">
        <label
          for="help-section-select"
          class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
        >
          {vault.t('help.in_this_guide')}
        </label>
        <div class="relative">
          <select
            id="help-section-select"
            class="w-full appearance-none rounded-md border border-border bg-background py-1.5 pl-3 pr-10 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            data-testid="help-navigation"
            onchange={handleSectionJump}
          >
            <option value="" selected disabled>
              {vault.t('help.jump_to_section')}
            </option>
            {#each HELP_SECTIONS as section (section.id)}
              <option value={section.id}>
                {vault.t(`help.sections.${section.id}.title`)}
              </option>
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
              {vault.t(`help.sections.${section.id}.title`)}
            </h2>
            <p class="text-sm leading-snug text-muted-foreground text-pretty">
              {vault.t(`help.sections.${section.id}.summary`)}
            </p>
            <ul
              class="list-disc space-y-0.5 pl-4 text-sm leading-snug text-muted-foreground text-pretty"
            >
              {#each Array.from({ length: section.bulletCount }, (_, index) => index + 1) as bulletNumber (section.id + bulletNumber)}
                <li>
                  {vault.t(`help.sections.${section.id}.bullet${bulletNumber}`)}
                </li>
              {/each}
            </ul>
            {#if section.diagram}
              <HelpMermaidDiagram
                source={section.diagram(vault.t)}
                sectionId={section.id}
                theme={colorMode}
              />
            {/if}
          </section>
        {/each}
      </div>

      <nav
        class="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/60 pt-3 text-xs text-muted-foreground"
        aria-label="Legal"
      >
        <a
          href={appPath('/privacy.html')}
          class="font-medium underline-offset-4 hover:text-foreground hover:underline"
        >
          {vault.t('legal.privacy_policy')}
        </a>
        <span aria-hidden="true">·</span>
        <a
          href={appPath('/terms.html')}
          class="font-medium underline-offset-4 hover:text-foreground hover:underline"
        >
          {vault.t('legal.terms_of_service')}
        </a>
      </nav>
    </CardContent>
  </Card>
</div>
