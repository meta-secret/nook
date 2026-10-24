<!--
In-app radio group for the identity-document kind: one plate per Rust-owned
kind, the chosen one edged in titanium. Arrow keys move the choice (wrapping)
and focus; only the chosen plate is in the tab order.
-->
<script lang="ts">
  import type { IdentityDocumentKind } from '$app-wasm'
  import { tick, type Component } from 'svelte'
  import {
    BookUser,
    CarFront,
    IdCard,
    ReceiptText,
    ShieldUser,
    Ticket,
  } from '@lucide/svelte'
  import type { VaultState } from '$lib/vault.svelte'
  import {
    IDENTITY_DOCUMENT_KINDS,
    documentKindLabelKey,
  } from './personal-data-fields'

  /** A key press on one of the group's plates. */
  type KindKeyEvent = KeyboardEvent & {
    readonly currentTarget: HTMLButtonElement
  }

  /** Direction an arrow key moves the choice through the kinds. */
  enum KindStep {
    Previous = -1,
    Next = 1,
  }

  let {
    vault,
    labelId,
    kind = $bindable<IdentityDocumentKind>('passport'),
  }: {
    vault: VaultState
    /** Id of the visible label that names the group. */
    labelId: string
    kind: IdentityDocumentKind
  } = $props()

  function icon(entry: IdentityDocumentKind): Component {
    switch (entry) {
      case 'passport':
        return BookUser
      case 'national-id':
        return IdCard
      case 'drivers-license':
        return CarFront
      case 'social-security':
        return ShieldUser
      case 'tax-id':
        return ReceiptText
      case 'membership':
        return Ticket
    }
  }

  function step(direction: KindStep): void {
    const count = IDENTITY_DOCUMENT_KINDS.length
    const target =
      (IDENTITY_DOCUMENT_KINDS.indexOf(kind) + direction + count) % count
    for (const [position, candidate] of IDENTITY_DOCUMENT_KINDS.entries()) {
      switch (position) {
        case target:
          kind = candidate
          return
        default:
          continue
      }
    }
  }

  async function moveWithKeys(event: KindKeyEvent): Promise<void> {
    const group = event.currentTarget.parentElement
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowUp':
        step(KindStep.Previous)
        break
      case 'ArrowRight':
      case 'ArrowDown':
        step(KindStep.Next)
        break
      default:
        return
    }
    event.preventDefault()
    await tick()
    group?.querySelector<HTMLElement>(`[data-kind="${kind}"]`)?.focus()
  }
</script>

<div
  role="radiogroup"
  aria-labelledby={labelId}
  data-testid="identity-document-kind"
  class="grid grid-cols-2 gap-2 sm:grid-cols-3"
>
  {#each IDENTITY_DOCUMENT_KINDS as entry (entry)}
    {@const Icon = icon(entry)}
    <button
      type="button"
      role="radio"
      aria-checked={entry === kind}
      tabindex={entry === kind ? 0 : -1}
      data-kind={entry}
      data-testid={`identity-document-kind-${entry}`}
      class="nk-frame-nick nk-frame-interactive nk-choice-tile group flex min-h-14 items-center gap-2.5 px-3 py-2.5 text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
      onclick={() => (kind = entry)}
      onkeydown={moveWithKeys}
    >
      <span
        class="nk-choice-icon flex size-8 shrink-0 items-center justify-center border border-border text-muted-foreground"
      >
        <Icon class="size-4" />
      </span>
      <span class="min-w-0 text-sm font-medium text-foreground"
        >{vault.t(documentKindLabelKey(entry))}</span
      >
    </button>
  {/each}
</div>
