import type { WidgetPosition } from './state'
import { widgetState } from './state'
import { DRAG_THRESHOLD_PX } from './workflow-ui'

export function clampWidgetPosition(
  left: number,
  top: number,
  width: number,
  height: number,
): WidgetPosition {
  const margin = 8
  const maxLeft = Math.max(margin, window.innerWidth - width - margin)
  const maxTop = Math.max(margin, window.innerHeight - height - margin)
  return {
    left: Math.min(Math.max(margin, left), maxLeft),
    top: Math.min(Math.max(margin, top), maxTop),
  }
}

export function applyWidgetPosition(
  host: HTMLElement,
  position: WidgetPosition,
): void {
  host.style.top = `${position.top}px`
  host.style.left = `${position.left}px`
  host.style.right = 'auto'
}

export function attachPointerDrag(
  host: HTMLElement,
  handle: HTMLElement,
  options?: { onTap?: () => void },
): void {
  enum DragPointerStateKind {
    Released = 'released',
    Captured = 'captured',
  }

  type DragPointerState =
    | { kind: DragPointerStateKind.Released }
    | { kind: DragPointerStateKind.Captured; pointerId: number }

  let pointer: DragPointerState = { kind: DragPointerStateKind.Released }
  let startX = 0
  let startY = 0
  let originLeft = 0
  let originTop = 0
  let dragged = false

  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return
    const target = event.target
    if (
      target instanceof Element &&
      target.closest('button') &&
      !handle.classList.contains('collapsed-launch')
    ) {
      return
    }
    pointer = {
      kind: DragPointerStateKind.Captured,
      pointerId: event.pointerId,
    }
    handle.setPointerCapture(pointer.pointerId)
    const rect = host.getBoundingClientRect()
    startX = event.clientX
    startY = event.clientY
    originLeft = rect.left
    originTop = rect.top
    dragged = false
  })

  handle.addEventListener('pointermove', (event) => {
    if (
      pointer.kind !== DragPointerStateKind.Captured ||
      event.pointerId !== pointer.pointerId
    ) {
      return
    }
    const dx = event.clientX - startX
    const dy = event.clientY - startY
    if (!dragged && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
    dragged = true
    host.classList.add('dragging')
    widgetState.position = clampWidgetPosition(
      originLeft + dx,
      originTop + dy,
      host.offsetWidth,
      host.offsetHeight,
    )
    applyWidgetPosition(host, widgetState.position)
  })

  const endDrag = (event: PointerEvent) => {
    if (
      pointer.kind !== DragPointerStateKind.Captured ||
      event.pointerId !== pointer.pointerId
    ) {
      return
    }
    if (handle.hasPointerCapture(pointer.pointerId)) {
      handle.releasePointerCapture(pointer.pointerId)
    }
    pointer = { kind: DragPointerStateKind.Released }
    host.classList.remove('dragging')
    if (!dragged) options?.onTap?.()
  }

  handle.addEventListener('pointerup', endDrag)
  handle.addEventListener('pointercancel', endDrag)
}
