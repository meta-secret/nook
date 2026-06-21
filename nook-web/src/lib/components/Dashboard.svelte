<script lang="ts">
  import type { NookSnapshot } from '$lib/nook'
  import { Badge } from '$lib/components/ui/badge'
  import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
  } from '$lib/components/ui/card'
  import { Skeleton } from '$lib/components/ui/skeleton'
  import { getProjectInitials } from '$lib/project-format'
  import { Boxes, CheckCircle2, Layers3 } from '@lucide/svelte'

  let {
    snapshot,
    loadError,
  }: { snapshot: NookSnapshot | null; loadError: string } = $props()
</script>

<div class="space-y-8 animate-in fade-in duration-200">
  <!-- Banner -->
  <div
    class="relative overflow-hidden rounded-xl border border-slate-800 bg-slate-900/50 p-6 md:p-8"
  >
    <div
      class="absolute -right-16 -top-16 size-48 rounded-full bg-indigo-500/10 blur-3xl"
    ></div>
    <div
      class="absolute -left-16 -bottom-16 size-48 rounded-full bg-violet-500/10 blur-3xl"
    ></div>

    <div class="relative max-w-3xl space-y-3">
      <Badge
        variant="outline"
        class="border-indigo-500/30 text-indigo-400 bg-indigo-950/20"
        >Monorepo Workspace</Badge
      >
      <h1 class="text-3xl font-bold tracking-tight text-white md:text-5xl">
        Stateless security, backed by Rust.
      </h1>
      <p class="text-base text-slate-400 md:text-lg">
        {snapshot?.summary ?? 'Loading Wasm toolchain...'}
      </p>
    </div>
  </div>

  <!-- Metrics Grid -->
  <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
    <Card class="bg-slate-900/40 border-slate-800/80">
      <CardHeader class="pb-2">
        <CardTitle
          class="flex items-center gap-2 text-sm font-semibold text-slate-400"
        >
          <Boxes class="size-4 text-indigo-400" />
          Workspace Crates
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div class="text-3xl font-bold text-white">
          {snapshot?.projects.length ?? 0}
        </div>
        <p class="text-xs text-slate-500 mt-1">
          Svelte web interface & core modules
        </p>
      </CardContent>
    </Card>

    <Card class="bg-slate-900/40 border-slate-800/80">
      <CardHeader class="pb-2">
        <CardTitle
          class="flex items-center gap-2 text-sm font-semibold text-slate-400"
        >
          <Layers3 class="size-4 text-indigo-400" />
          Dependency Flow
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div class="text-3xl font-bold text-white">1-Way</div>
        <p class="text-xs text-slate-500 mt-1">
          nook-core ➔ nook-wasm ➔ nook-web
        </p>
      </CardContent>
    </Card>

    <Card class="bg-slate-900/40 border-slate-800/80">
      <CardHeader class="pb-2">
        <CardTitle
          class="flex items-center gap-2 text-sm font-semibold text-slate-400"
        >
          <CheckCircle2 class="size-4 text-emerald-400" />
          Rust WASM Runtime
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div class="text-3xl font-bold text-white">
          {snapshot ? 'Ready' : 'Initializing...'}
        </div>
        <p class="text-xs text-slate-500 mt-1">
          Encrypted with rage-compatible age standard
        </p>
      </CardContent>
    </Card>
  </div>

  <!-- Projects Grid -->
  <div>
    <h2 class="text-lg font-semibold text-white mb-4">Crate Registry</h2>
    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {#each snapshot?.projects ?? [] as project (project.name)}
        <Card
          class="bg-slate-900/20 border-slate-800/80 hover:border-slate-700/80 transition-all duration-200"
        >
          <CardHeader>
            <div
              class="mb-4 flex size-10 items-center justify-center rounded-lg bg-indigo-600/10 border border-indigo-500/20 text-sm font-bold text-indigo-400"
            >
              {getProjectInitials(project.name)}
            </div>
            <CardTitle class="text-white text-base">{project.name}</CardTitle>
            <CardDescription class="text-slate-400 text-xs mt-1"
              >{project.purpose}</CardDescription
            >
          </CardHeader>
          <CardContent class="pt-0">
            <Badge class="bg-slate-800 text-slate-300 hover:bg-slate-800"
              >{project.language}</Badge
            >
          </CardContent>
        </Card>
      {/each}

      {#if !snapshot && !loadError}
        {#each [1, 2, 3] as index (index)}
          <Card
            class="bg-slate-900/20 border-slate-800/80"
            aria-hidden="true"
            data-index={index}
          >
            <CardHeader>
              <Skeleton class="mb-4 size-10 rounded-lg bg-slate-800" />
              <Skeleton class="h-4 w-28 bg-slate-800" />
              <Skeleton class="h-3 w-full mt-2 bg-slate-800" />
            </CardHeader>
            <CardContent>
              <Skeleton class="h-6 w-16 bg-slate-800" />
            </CardContent>
          </Card>
        {/each}
      {/if}
    </div>
  </div>
</div>
