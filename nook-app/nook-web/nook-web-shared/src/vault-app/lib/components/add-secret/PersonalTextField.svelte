<!-- One labelled personal-data input; concealable ones get a show/hide toggle. -->
<script lang="ts">
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { Eye, EyeOff } from '@lucide/svelte'
  import { cn } from '$lib/utils'
  import type { VaultState } from '$lib/vault.svelte'
  import { SlotWidth } from '../vault/secret-slot'
  import { FieldConcealment, type PersonalFieldSpec } from './personal-data-fields'

  let {
    vault,
    field,
    value = $bindable(''),
    shown = $bindable(false),
  }: {
    vault: VaultState
    field: PersonalFieldSpec<string>
    value?: string
    /** For concealable inputs: whether the value is currently shown. */
    shown?: boolean
  } = $props()

  const inputClass =
    'flex h-10 w-full rounded-none border border-input bg-background px-3 text-sm focus:outline-hidden focus:border-foreground/40 focus:ring-2 focus:ring-ring'

  const placeholder = $derived.by(() => {
    switch (field.placeholderKey) {
      case '':
        return ''
      default:
        return vault.t(field.placeholderKey)
    }
  })
</script>

<div
  class={cn('space-y-1.5', field.width === SlotWidth.Full && 'sm:col-span-2')}
>
  <label class="nk-field-label" for={field.testId}
    >{vault.t(field.labelKey)}</label
  >
  {#if field.concealment === FieldConcealment.Concealable}
    <div class="relative">
      <input
        id={field.testId}
        type={shown ? 'text' : 'password'}
        data-testid={field.testId}
        bind:value
        {placeholder}
        autocomplete="off"
        spellcheck="false"
        class={cn(inputClass, 'pr-10 font-mono')}
      />
      <button
        type="button"
        class="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        aria-label={shown
          ? vault.t(I18N_KEYS.VaultHideValue)
          : vault.t(I18N_KEYS.VaultShowValue)}
        aria-pressed={shown}
        data-testid={`toggle-${field.testId}-visibility`}
        onclick={() => (shown = !shown)}
      >
        {#if shown}
          <EyeOff class="size-4" />
        {:else}
          <Eye class="size-4" />
        {/if}
      </button>
    </div>
  {:else}
    <input
      id={field.testId}
      type={field.inputType}
      data-testid={field.testId}
      bind:value
      {placeholder}
      autocomplete={field.autocomplete}
      class={inputClass}
    />
  {/if}
</div>
