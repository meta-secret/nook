<script lang="ts">
  import { BookOpen, Cloud, Database, ShieldCheck } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import NookLogo from '$lib/components/NookLogo.svelte'

  let {
    colorMode,
    onOpenHelp,
  }: {
    colorMode: 'light' | 'dark'
    onOpenHelp: () => void
  } = $props()

  const points = [
    {
      icon: ShieldCheck,
      title: 'Client-side encryption',
      text: 'Secrets are encrypted in your browser before they are saved or synced.',
    },
    {
      icon: Database,
      title: 'Your storage',
      text: 'Keep a local vault first, then optionally sync encrypted vault data through providers you choose.',
    },
    {
      icon: Cloud,
      title: 'Optional Google Drive sync',
      text: 'When you connect Google Drive, Nook uses app-data storage for its own encrypted vault files only.',
    },
  ]
</script>

<section class="space-y-6" data-testid="public-home">
  <div class="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(20rem,0.9fr)]">
    <div class="space-y-5 py-2 sm:py-4">
      <div class="flex items-center gap-4">
        <NookLogo {colorMode} size="lg" class="overflow-hidden rounded-xl" />
        <div class="min-w-0">
          <p class="text-sm font-medium text-muted-foreground">
            Open-source password manager
          </p>
          <h1
            class="text-4xl font-semibold tracking-normal text-foreground sm:text-5xl"
          >
            Nook
          </h1>
        </div>
      </div>

      <div class="max-w-2xl space-y-3">
        <p class="text-xl font-medium leading-relaxed text-foreground">
          Nook is a client-side password and secrets manager for encrypted
          vaults that stay under your control.
        </p>
        <p class="text-base leading-7 text-muted-foreground">
          Create a vault in this browser, protect it with this device's keys,
          and connect optional sync providers such as Google Drive or GitHub to
          replicate encrypted vault data. Nook does not run a central account
          service and cannot read your secrets.
        </p>
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        class="h-10 rounded-lg border-border/50 bg-background/60 px-3.5 text-sm text-muted-foreground [&_svg]:size-4"
        data-testid="public-home-help-link"
        onclick={onOpenHelp}
      >
        <BookOpen class="size-4" />
        How Nook works
      </Button>
    </div>

    <div class="grid gap-3 self-center">
      {#each points as point (point.title)}
        {@const Icon = point.icon}
        <article class="rounded-lg border border-border/60 bg-card/70 p-4">
          <div class="flex gap-3">
            <span
              class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground"
            >
              <Icon class="size-5" />
            </span>
            <div class="min-w-0 space-y-1">
              <h2 class="text-base font-semibold text-foreground">
                {point.title}
              </h2>
              <p class="text-sm leading-6 text-muted-foreground">
                {point.text}
              </p>
            </div>
          </div>
        </article>
      {/each}
    </div>
  </div>
</section>
