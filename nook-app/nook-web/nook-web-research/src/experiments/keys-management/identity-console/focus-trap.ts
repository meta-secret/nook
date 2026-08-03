/**
 * Keyboard containment for the add-identity dialog.
 *
 * `aria-modal` tells assistive technology the background is inert; it does not
 * stop Tab from walking into the rail, the graph switch, and the catalog
 * button behind the panel. This keeps the ring inside the panel and hands
 * focus back to whatever opened it.
 */

/** Whatever held focus when the dialog opened, if anything did. */
export enum OpenerKind {
  Nothing = 'nothing',
  Element = 'element',
}

export type Opener =
  | { kind: OpenerKind.Nothing }
  | { kind: OpenerKind.Element; node: HTMLElement }

const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea'

export function currentOpener(): Opener {
  const active = document.activeElement
  if (active instanceof HTMLElement) {
    return { kind: OpenerKind.Element, node: active }
  }
  return { kind: OpenerKind.Nothing }
}

export function restore(opener: Opener): void {
  if (opener.kind === OpenerKind.Element) opener.node.focus()
}

/** Wraps Tab and Shift+Tab around the panel's own controls. */
export function keepFocusInside(
  panel: HTMLElement,
  event: KeyboardEvent,
): void {
  if (event.key !== 'Tab') return
  const stops = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)]
  if (stops.length === 0) return
  const [first] = stops
  const last = stops[stops.length - 1]
  const active = document.activeElement
  const leavingBack =
    event.shiftKey && (active === first || !panel.contains(active))
  const leavingForward = !event.shiftKey && active === last
  if (leavingBack) {
    event.preventDefault()
    last.focus()
    return
  }
  if (leavingForward) {
    event.preventDefault()
    first.focus()
  }
}
