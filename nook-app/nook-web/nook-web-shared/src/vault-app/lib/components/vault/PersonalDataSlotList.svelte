<!-- Detail slots of a person, address, identity document or bank account. -->
<script lang="ts">
  import type { NookSecretListItem } from '$lib/nook'
  import type { VaultState } from '$lib/vault.svelte'
  import type { ClipboardNotice, SecretReveal } from '../secret-vault-state'
  import SecretSlot from './SecretSlot.svelte'
  import type { SecretFieldCopy } from './secret-detail-copies'
  import {
    PersonalDataSlots,
    type PersonalDataSlotsContext,
  } from './personal-data-slots'

  let {
    item,
    reveal,
    copiedNotice,
    onCopyToClipboard,
    vault,
  }: {
    item: NookSecretListItem
    reveal: SecretReveal
    copiedNotice: ClipboardNotice
    onCopyToClipboard: (args: SecretFieldCopy) => Promise<void>
    vault: VaultState
  } = $props()

  const slots = $derived.by(() => {
    const context: PersonalDataSlotsContext = {
      item,
      reveal,
      notice: copiedNotice,
      translate: (request) => vault.t(request),
      copyField: onCopyToClipboard,
    }
    return new PersonalDataSlots(context).slots
  })
</script>

{#each slots as slot (slot.testId)}
  <SecretSlot
    label={slot.label}
    seal={slot.seal}
    width={slot.width}
    copy={slot.copy}
    testId={`personal-slot-${slot.testId}`}
  >
    <span class="[overflow-wrap:anywhere]" data-testid={`${slot.testId}-value`}
      >{slot.value}</span
    >
  </SecretSlot>
{/each}
