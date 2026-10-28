<!-- Nook setup as one straight path: create an identity, create or use a
passkey, connect Google Drive, and choose among the identities Nook finds
there — continue as a member, ask to join, or create a new one. Prototype
controls sit in a rail beside the panel. -->
<script lang="ts">
  import ExperimentBack from '$lib/components/ExperimentBack.svelte'
  import type { ExperimentProps } from '../../index'
  import Panel from './Panel.svelte'
  import Rail from './Rail.svelte'
  import { SetupFlow } from './flow.svelte'
  import { ui } from './ui'

  let { navigate }: ExperimentProps = $props()

  const flow = new SetupFlow()
</script>

<svelte:head>
  <title>Identity setup · Nook research</title>
</svelte:head>

<main class={ui.page}>
  <ExperimentBack {navigate} />
  <div class="mx-auto flex w-full max-w-[900px] flex-col items-center gap-12 px-5 pt-24 pb-16 md:flex-row md:items-start md:justify-between">
    <Rail {flow} />
    <Panel {flow} />
  </div>
</main>
