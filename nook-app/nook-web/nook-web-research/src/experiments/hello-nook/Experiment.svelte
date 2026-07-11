<script lang="ts">
  import { ArrowLeft, Sparkles } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'

  import type { ExperimentProps } from '../index'

  let { navigate }: ExperimentProps = $props()
</script>

<main class="grid min-h-screen place-items-center bg-[#efeee8] p-4">
  <section
    class="w-full max-w-xl rounded-[2rem] border border-[#c9c9be] bg-[#faf9f4] p-10 shadow-[0_2rem_6rem_rgb(31_35_28/0.1)] sm:p-16"
  >
    <Sparkles class="mb-8 size-6 text-[#59723e]" aria-hidden="true" />
    <h1
      class="font-serif text-6xl leading-[0.9] font-normal tracking-[-0.06em] text-[#20231e] sm:text-8xl"
    >
      Hello,<br />Nook.
    </h1>
    <p class="mt-8 max-w-sm leading-7 text-[#62665d]">
      This component is one complete experiment. Change anything in this
      directory without affecting another sketch.
    </p>
    <Button
      variant="outline"
      class="mt-10 border-[#b8b9ad] bg-transparent text-[#3b5626] hover:bg-[#e5e5dc]"
      onclick={() => navigate('/')}
    >
      <ArrowLeft />
      Back to catalog
    </Button>
  </section>
</main>
