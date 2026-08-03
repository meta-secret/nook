<script lang="ts">
  import {
    type AccessScenario,
    ScenarioId,
    scenarios,
  } from './keys-management-state'

  interface Props {
    scenario: AccessScenario
    onScenario: (next: ScenarioId) => void
    light?: boolean
  }

  let { scenario, onScenario, light = false }: Props = $props()
</script>

<div
  class={`fixed top-[4.25rem] right-3 z-50 flex items-center gap-1 rounded-full border p-1 text-[11px] font-semibold tracking-wide backdrop-blur-md sm:top-5 sm:right-5 ${light ? 'border-black/15 bg-white/75 text-black' : 'border-white/15 bg-black/45 text-white'}`}
  role="group"
  aria-label="Access scenario"
>
  {#each scenarios as option (option.id)}
    <button
      class={`rounded-full px-3 py-1.5 transition ${
        option.id === scenario.id
          ? light
            ? 'bg-black text-white'
            : 'bg-white text-black'
          : 'opacity-60 hover:opacity-100'
      }`}
      aria-pressed={option.id === scenario.id}
      onclick={() => onScenario(option.id)}
    >
      {option.label}
    </button>
  {/each}
</div>
