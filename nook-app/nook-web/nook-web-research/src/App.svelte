<script lang="ts">
  import { onMount } from 'svelte'
  import { ArrowRight, FlaskConical, Vault } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import {
    Card,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
  } from '$lib/components/ui/card'
  import { categories, experiments, subcategories } from './experiments'

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
  <main class="mx-auto w-full max-w-6xl px-6 py-10 sm:py-14">
    <header class="max-w-3xl">
      <div
        class="text-primary mb-5 flex items-center gap-2 text-sm font-semibold"
      >
        <FlaskConical class="size-4" aria-hidden="true" />
        Nook web research
      </div>
      <h1
        class="font-serif text-6xl leading-[0.92] font-normal tracking-[-0.06em] sm:text-7xl"
      >
        Nook ideas,<br />tried quickly.
      </h1>
      <p class="text-muted-foreground mt-5 max-w-2xl text-base leading-7">
        Independent Svelte UI sketches for the whole Nook experience. Each
        category explores one product area through distinct, interactive
        directions.
      </p>
    </header>

    <div class="mt-12 space-y-12">
      {#each categories as category, categoryIndex (category.slug)}
        {@const categoryExperiments = experiments.filter(
          (experiment) => experiment.category.slug === category.slug,
        )}
        {@const categorySubcategories = subcategories.filter(
          (subcategory) => subcategory.categorySlug === category.slug,
        )}
        <section
          aria-labelledby={`category-${category.slug}`}
          class="border-t pt-5"
        >
          <div class="mb-7 grid gap-5 md:grid-cols-[13rem_1fr]">
            <div>
              <p
                class="text-primary font-mono text-xs font-bold tracking-[0.16em] uppercase"
              >
                Category {String(categoryIndex + 1).padStart(2, '0')}
              </p>
              <div class="mt-3 flex items-center gap-2">
                <div
                  class="bg-secondary text-secondary-foreground rounded-md p-2"
                >
                  <Vault class="size-4" aria-hidden="true" />
                </div>
                <span class="text-muted-foreground font-mono text-xs uppercase"
                  >{categoryExperiments.length} experiments</span
                >
              </div>
            </div>
            <div class="max-w-2xl">
              <h2
                id={`category-${category.slug}`}
                class="font-serif text-3xl font-normal tracking-[-0.04em] sm:text-4xl"
              >
                {category.title}
              </h2>
              <p class="text-muted-foreground mt-2 max-w-3xl leading-7">
                {category.description}
              </p>
            </div>
          </div>

          <div class="mt-7 space-y-12">
            {#each categorySubcategories as subcategory (subcategory.slug)}
              {@const subcategoryExperiments = categoryExperiments.filter(
                (experiment) =>
                  experiment.subcategory.slug === subcategory.slug,
              )}
              <section aria-labelledby={`subcategory-${subcategory.slug}`}>
                <div class="mb-4 border-t pt-4">
                  <p
                    class="text-primary font-mono text-xs font-bold tracking-[0.16em] uppercase"
                  >
                    {subcategory.slug}
                  </p>
                  <h3
                    id={`subcategory-${subcategory.slug}`}
                    class="mt-1 text-lg font-semibold tracking-tight"
                  >
                    {subcategory.title}
                  </h3>
                  <p
                    class="text-muted-foreground mt-1 max-w-3xl text-sm leading-6"
                  >
                    {subcategory.description}
                  </p>
                </div>

                <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {#each subcategoryExperiments as item, index (item.slug)}
                    <Card class="gap-3 py-4">
                      <CardHeader class="gap-1 px-4">
                        <p class="text-muted-foreground font-mono text-xs">
                          {subcategory.slug} / {String(index + 1).padStart(
                            3,
                            '0',
                          )}
                        </p>
                        <p
                          class="text-primary mt-1 font-mono text-[10px] font-bold tracking-[0.12em] uppercase"
                        >
                          {category.title} concept
                        </p>
                        <CardTitle class="mt-4 text-xl">{item.title}</CardTitle>
                        <CardDescription>{item.description}</CardDescription>
                      </CardHeader>
                      <CardFooter class="mt-auto px-4">
                        <Button
                          class="h-9 px-3 text-sm"
                          onclick={() => navigate(`/experiments/${item.slug}`)}
                        >
                          Open experiment
                          <ArrowRight />
                        </Button>
                      </CardFooter>
                    </Card>
                  {/each}
                </div>
              </section>
            {/each}
          </div>
        </section>
      {/each}
    </div>
  </main>
{/if}
