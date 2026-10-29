<!-- Step three: connect Google Drive. Signing in shows the account once it
is done, then setup goes on to read the Nook folder there. -->
<script lang="ts">
  import { HardDrive } from '@lucide/svelte'
  import Heading from './Heading.svelte'
  import Option from './Option.svelte'
  import type { SetupFlow } from './flow.svelte'
  import { Step, account } from './model'
  import { OptionState } from './option-state'

  let { flow }: { flow: SetupFlow } = $props()

  let working = $state(false)

  async function connect(): Promise<void> {
    working = true
    await new Promise((resolve) => setTimeout(resolve, 900))
    working = false
    flow.connected = true
    await new Promise((resolve) => setTimeout(resolve, 450))
    flow.go(Step.Identities)
  }
</script>

<Heading
  eyebrow="Step 2 of 3 · Sync provider"
  title="Add a sync provider"
  sub="Your identity's events are kept there, encrypted."
/>
<Option
  title="Google Drive"
  hint={flow.connected
    ? account
    : working
      ? 'Signing in…'
      : 'Sign in with Google'}
  action="Connect"
  state={working
    ? OptionState.Working
    : flow.connected
      ? OptionState.Done
      : OptionState.Idle}
  onPick={connect}
>
  {#snippet lead()}
    <span
      class="grid size-11 shrink-0 place-items-center bg-[#23272b] text-[#c9ccd0]"
      ><HardDrive class="size-5" aria-hidden="true" /></span
    >
  {/snippet}
</Option>
