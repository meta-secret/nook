<!-- One identity per browser, shown as the app would ship: a popup-sized
window with one question per screen, then home with the devices that open
the identity and where it is synced. Prototype controls sit in a rail beside
the window, out of the product. -->
<script lang="ts">
  import ExperimentBack from '$lib/components/ExperimentBack.svelte'
  import type { ExperimentProps } from '../../index'
  import App from './App.svelte'
  import Rail from './Rail.svelte'
  import { IdentityFlow } from './flow.svelte'
  import { ui } from './ui'

  let { navigate }: ExperimentProps = $props()

  const flow = new IdentityFlow()
</script>

<svelte:head>
  <title>One identity · Nook research</title>
</svelte:head>

<main class={ui.page}>
  <ExperimentBack {navigate} />
  <div class="mx-auto flex w-full max-w-[860px] flex-col items-center gap-12 px-5 pt-24 pb-16 md:flex-row md:items-start md:justify-between">
    <Rail {flow} />
    <App {flow} />
  </div>
</main>
