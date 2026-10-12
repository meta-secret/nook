<script lang="ts">
  import { ResearchView, researchNavigation } from './navigation'
  let view = $state(ResearchView.Items)
  const items = ['Personal email', 'Project notes', 'Development key']
  let selected = $state('')
</script>

<div class="study">
  <aside>
    <strong>Nook / Research</strong>
    {#each researchNavigation as entry (entry.view)}
      <button
        onclick={() => {
          view = entry.view
        }}>{entry.label}</button
      >
    {/each}
    <p>Workspace study<br />Fictional sample data</p>
  </aside>
  {#if view === ResearchView.Items}<section>
      <h1>All items</h1>
      {#each items as item (item)}<button
          class:active={selected === item}
          onclick={() => {
            selected = item
          }}>{item}</button
        >{/each}
    </section>
    <main>
      <p class="eyebrow">ITEM DETAILS</p>
      <h2>{selected || 'A place for what matters.'}</h2>
      <p>
        {selected
          ? 'Select, inspect, and edit one record at a time.'
          : 'Choose an item from the list.'}
      </p>
    </main>{:else}<main>
      <p class="eyebrow">WORKSPACE</p>
      <h1>Settings</h1>
      <p>One flat page for language, appearance, and access.</p>
    </main>{/if}
</div>
