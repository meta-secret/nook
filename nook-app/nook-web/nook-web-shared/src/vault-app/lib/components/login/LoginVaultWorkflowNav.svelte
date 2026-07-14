<script lang="ts">
  import { CloudDownload, FolderOpen, Plus } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
    active,
    onSelect,
  }: {
    vault: VaultState
    active: 'open' | 'create' | 'import'
    onSelect: (workflow: 'open' | 'create' | 'import') => void
  } = $props()

  const workflows = [
    { id: 'open', icon: FolderOpen, label: 'login.vault_workflow_open' },
    { id: 'create', icon: Plus, label: 'login.vault_workflow_create' },
    { id: 'import', icon: CloudDownload, label: 'login.vault_workflow_import' },
  ] as const

  function handleTabKeydown(event: KeyboardEvent, index: number) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const offset = event.key === 'ArrowRight' ? 1 : -1
    const nextIndex = (index + offset + workflows.length) % workflows.length
    onSelect(workflows[nextIndex].id)
    requestAnimationFrame(() => {
      const tabs = (event.currentTarget as HTMLElement)
        .closest('[role="tablist"]')
        ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      tabs?.[nextIndex]?.focus()
    })
  }
</script>

<div
  class="grid grid-cols-3 gap-1 rounded-md border border-border/60 bg-muted/20 p-1"
  role="tablist"
  aria-label={vault.t('login.vault_workflow_label')}
  data-testid="login-vault-workflow-nav"
>
  {#each workflows as workflow, index (workflow.id)}
    <Button
      type="button"
      size="sm"
      variant={active === workflow.id ? 'secondary' : 'ghost'}
      class="min-w-0 px-2"
      role="tab"
      aria-selected={active === workflow.id}
      tabindex={active === workflow.id ? 0 : -1}
      data-testid={`login-vault-workflow-${workflow.id}`}
      onclick={() => onSelect(workflow.id)}
      onkeydown={(event) => handleTabKeydown(event, index)}
    >
      <workflow.icon class="size-4" />
      <span class="truncate">{vault.t(workflow.label)}</span>
    </Button>
  {/each}
</div>
