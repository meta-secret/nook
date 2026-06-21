<script lang="ts">
  import { onMount } from 'svelte'
  import {
    Boxes,
    CheckCircle2,
    GitBranch,
    Layers3,
    TriangleAlert,
  } from '@lucide/svelte'
  import { Badge } from '$lib/components/ui/badge'
  import { Button } from '$lib/components/ui/button'
  import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
  } from '$lib/components/ui/card'
  import { Skeleton } from '$lib/components/ui/skeleton'
  import { getProjectInitials } from '$lib/project-format'
  import { loadNookSnapshot, type NookSnapshot } from '$lib/nook'

  let snapshot: NookSnapshot | null = null
  let loadError = ''

  onMount(async () => {
    try {
      snapshot = await loadNookSnapshot()
    } catch (error) {
      loadError =
        error instanceof Error ? error.message : 'Unable to load nook-wasm.'
    }
  })
</script>

<main class="min-h-svh bg-background">
  <section
    class="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-12 lg:px-8"
    aria-labelledby="page-title"
  >
    <div
      class="flex flex-col gap-6 border-b pb-8 md:flex-row md:items-end md:justify-between"
    >
      <div class="space-y-5">
        <Badge variant="outline">nook monorepo</Badge>
        <div class="space-y-4">
          <h1
            id="page-title"
            class="max-w-3xl text-4xl leading-tight font-semibold tracking-normal text-balance md:text-6xl"
          >
            Rust core, wasm bridge, Svelte surface.
          </h1>
          <p class="max-w-2xl text-base text-muted-foreground md:text-lg">
            {snapshot?.summary ??
              'Loading the wasm package generated from nook-core...'}
          </p>
        </div>

        {#if loadError}
          <div
            class="flex w-fit max-w-full items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            role="alert"
          >
            <TriangleAlert class="size-4 shrink-0" />
            <span>{loadError}</span>
          </div>
        {/if}
      </div>

      <div class="flex flex-wrap gap-2">
        <Button variant="outline" size="sm">
          <GitBranch />
          Taskfile
        </Button>
        <Button size="sm">
          <CheckCircle2 />
          {snapshot ? 'wasm ready' : 'initializing'}
        </Button>
      </div>
    </div>

    <div class="grid gap-4 md:grid-cols-3" aria-label="Workspace status">
      <Card>
        <CardHeader>
          <CardTitle class="flex items-center gap-2 text-base">
            <Boxes class="size-4" />
            Projects
          </CardTitle>
          <CardDescription>Crates and web app in this workspace</CardDescription
          >
        </CardHeader>
        <CardContent class="text-3xl font-semibold">
          {snapshot?.projects.length ?? 0}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle class="flex items-center gap-2 text-base">
            <Layers3 class="size-4" />
            Dependency Flow
          </CardTitle>
          <CardDescription>nook-core to nook-wasm to nook-web</CardDescription>
        </CardHeader>
        <CardContent class="text-3xl font-semibold">1-way</CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle class="flex items-center gap-2 text-base">
            <CheckCircle2 class="size-4" />
            Runtime
          </CardTitle>
          <CardDescription
            >Loaded from the generated wasm package</CardDescription
          >
        </CardHeader>
        <CardContent class="text-3xl font-semibold">
          {snapshot ? 'ready' : 'loading'}
        </CardContent>
      </Card>
    </div>

    <section class="grid gap-4 md:grid-cols-3" aria-label="Workspace projects">
      {#each snapshot?.projects ?? [] as project (project.name)}
        <Card class="min-h-56">
          <CardHeader>
            <div
              class="mb-6 grid size-12 place-items-center rounded-md bg-primary text-sm font-semibold text-primary-foreground"
            >
              {getProjectInitials(project.name)}
            </div>
            <CardTitle>{project.name}</CardTitle>
            <CardDescription>{project.purpose}</CardDescription>
          </CardHeader>
          <CardContent>
            <Badge variant="secondary">{project.language}</Badge>
          </CardContent>
        </Card>
      {/each}

      {#if !snapshot && !loadError}
        {#each [0, 1, 2] as index (index)}
          <Card class="min-h-56" aria-hidden="true">
            <CardHeader>
              <Skeleton class="mb-6 size-12" />
              <Skeleton class="h-5 w-28" />
              <Skeleton class="h-4 w-full" />
              <Skeleton class="h-4 w-4/5" />
            </CardHeader>
            <CardContent>
              <Skeleton class="h-6 w-20" />
            </CardContent>
          </Card>
        {/each}
      {/if}
    </section>
  </section>
</main>
