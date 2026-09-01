import type { WidgetPosition } from './state'
import { widgetState } from './state'
import { DRAG_THRESHOLD_PX } from './workflow-ui'

type ClampWidgetPositionArgs = {
  left: number
  top: number
  width: number
  height: number
}

export function clampWidgetPosition({
  left,
  top,
  width,
  height,
}: ClampWidgetPositionArgs): WidgetPosition {
  const margin = 8
  const maxLeft = Math.max(margin, window.innerWidth - width - margin)
  const maxTop = Math.max(margin, window.innerHeight - height - margin)
  return {
    left: Math.min(Math.max(margin, left), maxLeft),
    top: Math.min(Math.max(margin, top), maxTop),
  }
}

type ApplyWidgetPositionArgs = {
  host: HTMLElement
  position: WidgetPosition
}

export function applyWidgetPosition({
  host,
  position,
}: ApplyWidgetPositionArgs): void {
  host.style.top = `${position.top}px`
  host.style.left = `${position.left}px`
  host.style.right = 'auto'
}

export enum PointerDragBehaviorKind {
  DragOnly = 'drag-only',
  Tappable = 'tappable',
}

export type PointerDragBehavior =
  | { kind: PointerDragBehaviorKind.DragOnly }
  | { kind: PointerDragBehaviorKind.Tappable; onTap: () => void }

type AttachPointerDragRequest = {
  host: HTMLElement
  handle: HTMLElement
  behavior: PointerDragBehavior
}

export function attachPointerDrag({
  host,
  handle,
  behavior,
}: AttachPointerDragRequest): void {
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
    const nookTypedArgs0_0: Parameters<typeof clampWidgetPosition>[0] = {
      left: originLeft + dx,
      top: originTop + dy,
      width: host.offsetWidth,
      height: host.offsetHeight,
    }
    const position = clampWidgetPosition(nookTypedArgs0_0)
    widgetState.setPosition(position)
    const nookTypedArgs0_1: Parameters<typeof applyWidgetPosition>[0] = {
      host,
      position,
    }
    applyWidgetPosition(nookTypedArgs0_1)
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
    if (!dragged && behavior.kind === PointerDragBehaviorKind.Tappable) {
      behavior.onTap()
    }
  }

  handle.addEventListener('pointerup', endDrag)
  handle.addEventListener('pointercancel', endDrag)
}
