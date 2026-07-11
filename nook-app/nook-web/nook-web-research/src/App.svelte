<script lang="ts">
  import { onMount } from 'svelte'
  import { ArrowRight, FlaskConical } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import {
    Card,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
  } from '$lib/components/ui/card'
  import { experiments } from './experiments'

  let path = $state(window.location.pathname)
  const experiment = $derived(
    experiments.find(({ slug }) => path === `/experiments/${slug}`),
  )

  function navigate(nextPath: string) {
    window.history.pushState({}, '', nextPath)
    path = nextPath
    window.scrollTo({ top: 0 })
  }

  onMount(() => {
    const handlePopState = () => {
      path = window.location.pathname
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  })
</script>

{#if experiment}
  {@const ExperimentComponent = experiment.component}
  <ExperimentComponent {navigate} />
{:else}
  <main class="mx-auto w-full max-w-6xl px-6 py-20 sm:py-28">
    <header class="max-w-3xl">
      <div
        class="text-primary mb-5 flex items-center gap-2 text-sm font-semibold"
      >
        <FlaskConical class="size-4" aria-hidden="true" />
        Nook web research
      </div>
      <h1
        class="font-serif text-6xl leading-[0.92] font-normal tracking-[-0.06em] sm:text-8xl"
      >
        Small ideas,<br />tried quickly.
      </h1>
      <p class="text-muted-foreground mt-8 max-w-2xl text-lg leading-8">
        Independent Svelte UI sketches. Each page can explore its own layout,
        interaction, and visual direction without becoming production code.
      </p>
    </header>

    <section
      class="mt-16 grid gap-5 sm:grid-cols-2 lg:grid-cols-3"
      aria-label="Experiments"
    >
      {#each experiments as item, index (item.slug)}
        <Card class="min-h-72">
          <CardHeader>
            <p class="text-muted-foreground font-mono text-xs">
              {String(index + 1).padStart(3, '0')}
            </p>
            <CardTitle class="mt-16 text-2xl">{item.title}</CardTitle>
            <CardDescription>{item.description}</CardDescription>
          </CardHeader>
          <CardFooter class="mt-auto">
            <Button onclick={() => navigate(`/experiments/${item.slug}`)}>
              Open experiment
              <ArrowRight />
            </Button>
          </CardFooter>
        </Card>
      {/each}
    </section>
  </main>
{/if}
