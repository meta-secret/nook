<script lang="ts">
  import { Fingerprint, Lock, Orbit, ShieldCheck } from '@lucide/svelte'
  import ExperimentBack from '$lib/components/ExperimentBack.svelte'
  import type { ExperimentProps } from '../../index'

  let { navigate }: ExperimentProps = $props()
  let open = $state(false)
</script>

<main class="min-h-screen overflow-hidden bg-[#f6f7f8] text-[#101214]">
  <ExperimentBack {navigate} light />
  <section
    class="relative mx-auto flex min-h-screen max-w-7xl items-center px-6 py-24"
  >
    <div class="grid w-full gap-14 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
      <div>
        <p class="font-mono text-xs tracking-[0.2em] text-[#77808c] uppercase">
          Capsule 07 / personal data vessel
        </p>
        <h1 class="mt-6 text-6xl font-light tracking-[-0.07em] sm:text-8xl">
          Sealed by you.<br />Opened by you.
        </h1>
        <p class="mt-8 max-w-lg text-lg leading-8 text-[#747b84]">
          One encrypted capsule holds the things that matter. Its surface
          reveals nothing—not even what is inside.
        </p>
        <button
          class="mt-10 flex items-center gap-3 rounded-full bg-black px-7 py-4 text-sm font-medium text-white"
          onclick={() => (open = !open)}
          >{#if open}<Lock class="size-5" /> Reseal capsule{:else}<Fingerprint
              class="size-5"
            /> Authenticate to open{/if}</button
        >
      </div>
      <div class="relative grid min-h-[36rem] place-items-center">
        <div
          class="absolute size-[32rem] max-w-full rounded-full border border-black/5"
        ></div>
        <div
          class="absolute size-[25rem] max-w-[80%] rounded-full border border-black/10"
        ></div>
        <div
          class={`relative grid size-72 place-items-center rounded-full border border-black/15 bg-[radial-gradient(circle_at_35%_25%,#fff,#cdd2d8_55%,#89919a)] shadow-[0_45px_100px_rgb(46_55_63/0.3)] transition duration-700 ${open ? 'scale-110' : ''}`}
        >
          <div
            class="grid size-32 place-items-center rounded-full border border-white/50 bg-black/85 text-white shadow-inner"
          >
            {#if open}<ShieldCheck
                class="size-12 text-[#8dffcf]"
              />{:else}<Orbit class="size-12" />{/if}
          </div>
        </div>
        <p
          class="absolute bottom-4 font-mono text-xs tracking-[0.22em] text-[#858d96] uppercase"
        >
          {open ? 'Capsule open · session isolated' : 'Encryption shell intact'}
        </p>
      </div>
    </div>
  </section>
</main>
