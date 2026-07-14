<script lang="ts">
  let {
    vault,
    request,
    onClose,
  }: {
    vault: unknown
    request: unknown
    onClose: () => void
  } = $props()

  const disabled = $derived(Boolean(vault && request && onClose))
</script>

<div aria-hidden="true" data-disabled={disabled} hidden></div>
