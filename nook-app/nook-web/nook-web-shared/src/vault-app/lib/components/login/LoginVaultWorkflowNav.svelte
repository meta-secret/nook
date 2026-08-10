<script lang="ts">
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { CloudDownload, FolderOpen, Plus } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import type { VaultState } from '$lib/vault.svelte'
  import { LoginVaultWorkflow } from './login-unlock-state'

  let {
    vault,
    active,
    onSelect,
  }: {
    vault: VaultState
    active: LoginVaultWorkflow
    onSelect: (workflow: LoginVaultWorkflow) => void
  } = $props()

  const workflows = [
    {
      id: LoginVaultWorkflow.Open,
      icon: FolderOpen,
      label: I18N_KEYS.LoginVaultWorkflowOpen,
    },
    {
      id: LoginVaultWorkflow.Create,
      icon: Plus,
      label: I18N_KEYS.LoginVaultWorkflowCreate,
    },
    {
      id: LoginVaultWorkflow.Import,
      icon: CloudDownload,
      label: I18N_KEYS.LoginVaultWorkflowImport,
    },
  ] as const

  function handleTabKeydown({ event, index }: { readonly event: KeyboardEvent; readonly index: number }) {
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
  aria-label={vault.t(I18N_KEYS.LoginVaultWorkflowLabel)}
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
      onkeydown={(event) => (() => { const handleTabKeydownArgs: Parameters<typeof handleTabKeydown>[0] = { event, index }; return handleTabKeydown(handleTabKeydownArgs); })()}
    >
      <workflow.icon class="size-4" />
      <span class="truncate">{vault.t(workflow.label)}</span>
    </Button>
  {/each}
</div>
